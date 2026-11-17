import logging
import math
from datetime import timedelta
from decimal import Decimal
from django.conf import settings
from django.utils import timezone

from society.models import (
    ResidentFlatMapping,
    Society,
    SocietyAlertPolicy,
    SocietyAssignment,
    VolunteerLocation,
    VolunteerProfile,
)

logger = logging.getLogger(__name__)


def haversine_km(lat1, lon1, lat2, lon2):
    """
    Compute great-circle distance between two points in kilometers.
    Returns float rounded to 3 decimal places (metres precision) or None.
    """
    if None in (lat1, lon1, lat2, lon2):
        return None
    try:
        lat1, lon1, lat2, lon2 = float(lat1), float(lon1), float(lat2), float(lon2)
    except (ValueError, TypeError):
        return None

    r = 6371.0  # Earth radius in km
    dlat = math.radians(lat2 - lat1)
    dlon = math.radians(lon2 - lon1)
    a = (
        math.sin(dlat / 2.0) ** 2
        + math.cos(math.radians(lat1))
        * math.cos(math.radians(lat2))
        * math.sin(dlon / 2.0) ** 2
    )
    c = 2.0 * math.atan2(math.sqrt(a), math.sqrt(max(0.0, 1.0 - a)))
    return round(r * c, 3)


def get_incident_reference_point(incident):
    """
    Resolve the best available reference point for distance calculations:
    1. Incident coordinates
    2. Resident's flat/block or society coordinates
    """
    if incident.latitude is not None and incident.longitude is not None:
        return float(incident.latitude), float(incident.longitude), 'incident'

    # Check resident's society
    mapping = (
        ResidentFlatMapping.objects.filter(user=incident.resident, is_active=True)
        .select_related('flat__block__society')
        .first()
    )
    if mapping and mapping.flat and mapping.flat.block and mapping.flat.block.society:
        soc = mapping.flat.block.society
        if soc.latitude is not None and soc.longitude is not None:
            return float(soc.latitude), float(soc.longitude), 'society'

    return None, None, 'none'


def get_resident_block_id(resident):
    """Return resident's current block ID if mapped, else None."""
    mapping = (
        ResidentFlatMapping.objects.filter(user=resident, is_active=True)
        .select_related('flat__block')
        .first()
    )
    if mapping and mapping.flat and mapping.flat.block_id:
        return mapping.flat.block_id
    return None


def select_nearby_volunteers(incident, radius_km=None, limit=None):
    """
    Select and rank volunteers according to block-first matching:
    - Tier 1: same society AND same block as resident.
    - Tier 2: same society, different block (or resident has no block).
    - Tier 3: neighbouring societies (fill remaining slots when Tiers 1 and 2 < limit).
    - Volunteers with no usable location go last, flagged "location missing".
    - Widening fallback if nobody qualifies in radius.
    """
    if radius_km is None:
        radius_km = getattr(settings, 'VOLUNTEER_DEFAULT_RADIUS_KM', 2.0)
    if limit is None:
        limit = getattr(settings, 'VOLUNTEER_NOTIFY_LIMIT', 5)

    ref_lat, ref_lng, _ref_source = get_incident_reference_point(incident)
    resident_block_id = get_resident_block_id(incident.resident)

    # Resident's primary society
    mapping = (
        ResidentFlatMapping.objects.filter(user=incident.resident, is_active=True)
        .select_related('flat__block__society__alert_policy')
        .first()
    )
    resident_society = mapping.flat.block.society if mapping and mapping.flat and mapping.flat.block else None

    policy = None
    if resident_society:
        policy = getattr(resident_society, 'alert_policy', None)

    # Allowed neighbouring societies policy
    include_neighbours = bool(policy and policy.include_neighbour_societies)
    neighbour_radius_km = float(policy.neighbour_radius_km) if policy else 3.0

    stale_delta = timedelta(
        minutes=getattr(settings, 'VOLUNTEER_LOCATION_STALE_MINUTES', 15)
    )
    now = timezone.now()

    # Query all active, approved volunteers with active & available assignment
    candidate_profiles = (
        VolunteerProfile.objects.filter(
            approval_status='approved',
            user__is_active=True,
            user__society_assignments__is_active=True,
            user__society_assignments__is_available=True,
        )
        .select_related('user', 'society', 'block')
        .prefetch_related('user__live_volunteer_location')
        .distinct()
    )

    tier1_candidates = []
    tier2_candidates = []
    tier3_candidates = []
    missing_loc_candidates = []

    for vp in candidate_profiles:
        u = vp.user
        soc = vp.society

        # Resolve position: check live location first
        live_loc = getattr(u, 'live_volunteer_location', None)
        v_lat, v_lng = None, None
        source = 'missing'

        if live_loc and live_loc.latitude is not None and live_loc.longitude is not None:
            if live_loc.updated_at >= (now - stale_delta):
                v_lat, v_lng = float(live_loc.latitude), float(live_loc.longitude)
                source = 'live'

        if v_lat is None and vp.latitude is not None and vp.longitude is not None:
            v_lat, v_lng = float(vp.latitude), float(vp.longitude)
            source = 'base'

        # Compute distance to reference point
        dist = None
        if ref_lat is not None and ref_lng is not None and v_lat is not None and v_lng is not None:
            dist = haversine_km(ref_lat, ref_lng, v_lat, v_lng)

        # Max allowed travel for volunteer
        max_travel = float(vp.max_travel_km or radius_km)
        effective_radius = min(float(radius_km), max_travel)

        # Check society relationship
        is_same_society = bool(resident_society and soc.id == resident_society.id)

        candidate_item = {
            'user': u,
            'id': u.id,
            'name': u.get_full_name() or u.username,
            'phone': u.phone,
            'profile': vp,
            'distance_km': dist,
            'source': source,
            'from_other_society': not is_same_society,
            'society_name': soc.name,
            'society_id': soc.id,
            'within_radius': (dist is not None and dist <= effective_radius),
        }

        if is_same_society:
            if dist is None:
                candidate_item['tier'] = 2 if resident_block_id else 1
                candidate_item['within_radius'] = False
                missing_loc_candidates.append(candidate_item)
            elif resident_block_id is not None and vp.block_id == resident_block_id:
                candidate_item['tier'] = 1
                tier1_candidates.append(candidate_item)
            else:
                candidate_item['tier'] = 2
                tier2_candidates.append(candidate_item)
        elif include_neighbours and vp.serves_nearby_societies:
            # Check neighbour radius
            within_neighbour_rad = False
            if dist is not None and dist <= neighbour_radius_km:
                # Also verify volunteer's own society is within neighbour_radius_km of incident society if both have coordinates
                if (
                    resident_society
                    and resident_society.latitude is not None
                    and resident_society.longitude is not None
                    and soc.latitude is not None
                    and soc.longitude is not None
                ):
                    soc_dist = haversine_km(
                        resident_society.latitude, resident_society.longitude,
                        soc.latitude, soc.longitude
                    )
                    within_neighbour_rad = (soc_dist is not None and soc_dist <= neighbour_radius_km)
                else:
                    within_neighbour_rad = True

            if within_neighbour_rad:
                candidate_item['tier'] = 3
                candidate_item['within_radius'] = True
                tier3_candidates.append(candidate_item)

    # Sort each tier by distance ascending
    tier1_candidates.sort(key=lambda x: (x['distance_km'] if x['distance_km'] is not None else 99999))
    tier2_candidates.sort(key=lambda x: (x['distance_km'] if x['distance_km'] is not None else 99999))
    tier3_candidates.sort(key=lambda x: (x['distance_km'] if x['distance_km'] is not None else 99999))

    # Apply radius filtering on tier 1 and tier 2
    qual_tier1 = [c for c in tier1_candidates if c['within_radius']]
    qual_tier2 = [c for c in tier2_candidates if c['within_radius']]

    selected = []
    radius_widened = False

    # Pick tier 1 first
    for c in qual_tier1:
        if len(selected) < limit:
            selected.append(c)

    # Pick tier 2 next
    for c in qual_tier2:
        if len(selected) < limit:
            selected.append(c)

    # If slots remain and neighbouring societies allowed, fill with tier 3
    if len(selected) < limit:
        for c in tier3_candidates:
            if len(selected) < limit:
                selected.append(c)

    # If nobody qualifies in radius at all, widen to nearest available volunteers of the society
    if not selected:
        same_soc_all = [c for c in (tier1_candidates + tier2_candidates) if c['distance_km'] is not None]
        same_soc_all.sort(key=lambda x: x['distance_km'])
        if same_soc_all:
            selected = same_soc_all[:limit]
            radius_widened = True
            for s in selected:
                s['widened'] = True

    # If still fewer than limit and have missing location volunteers of the society, append last
    if len(selected) < limit and missing_loc_candidates:
        for m in missing_loc_candidates:
            if len(selected) < limit:
                selected.append(m)

    return {
        'selected': selected,
        'radius_widened': radius_widened,
        'ref_lat': ref_lat,
        'ref_lng': ref_lng,
        'tier1_count': len(qual_tier1),
        'tier2_count': len(qual_tier2),
        'tier3_count': len(tier3_candidates),
    }


def estimate_volunteer_breakdown(resident, radius_km=2.0):
    """
    Estimate volunteer count breakdown for resident escalation settings preview:
    - Block count (Tier 1)
    - Elsewhere in society count (Tier 2)
    - Nearby societies count (Tier 3, if policy enabled)
    """
    mapping = (
        ResidentFlatMapping.objects.filter(user=resident, is_active=True)
        .select_related('flat__block__society__alert_policy')
        .first()
    )
    if not mapping or not mapping.flat or not mapping.flat.block:
        return {'tier1': 0, 'tier2': 0, 'tier3': 0, 'total': 0, 'policy_allows_neighbour': False}

    resident_block = mapping.flat.block
    resident_society = resident_block.society
    policy = getattr(resident_society, 'alert_policy', None)
    policy_allows = bool(policy and policy.include_neighbour_societies)

    # Base active approved volunteers in same society
    same_soc_profiles = VolunteerProfile.objects.filter(
        society=resident_society,
        approval_status='approved',
        user__is_active=True,
        user__society_assignments__is_active=True,
    ).select_related('block')

    tier1 = 0
    tier2 = 0
    for vp in same_soc_profiles:
        if vp.block_id == resident_block.id:
            tier1 += 1
        else:
            tier2 += 1

    tier3 = 0
    if policy_allows:
        tier3 = VolunteerProfile.objects.filter(
            approval_status='approved',
            serves_nearby_societies=True,
            user__is_active=True,
            user__society_assignments__is_active=True,
        ).exclude(society=resident_society).count()

    total = tier1 + tier2 + (tier3 if policy_allows else 0)
    summary = f"{total} volunteer{'s' if total != 1 else ''} reachable ({tier1} in your block, {tier2} in other blocks"
    if policy_allows:
        summary += f", {tier3} in nearby societies)"
    else:
        summary += ")"

    return {
        'tier1': tier1,
        'tier2': tier2,
        'tier3': tier3,
        'same_block_count': tier1,
        'same_society_count': tier2,
        'neighbour_society_count': tier3,
        'total': total,
        'total_count': total,
        'summary': summary,
        'policy_allows_neighbour': policy_allows,
    }

