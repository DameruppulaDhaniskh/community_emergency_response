import logging
from datetime import timedelta
from django.conf import settings
from django.contrib.auth import get_user_model
from django.core.cache import cache
from django.db import transaction
from django.utils import timezone

from contacts.models import EmergencyContact, ResidentSecurityGuard
from notifications.services import (
    notify_escalation_accepted,
    notify_escalation_handoff,
    notify_escalation_timeout,
    notify_guardian_sos,
    notify_no_responder,
    notify_status_changed,
)
from society.models import (
    ResidentFlatMapping,
    SecurityProfile,
    SocietyAssignment,
    VolunteerProfile,
)
from .matching import (
    get_incident_reference_point,
    haversine_km,
    select_nearby_volunteers,
)
from .models import (
    Incident,
    IncidentEscalation,
    IncidentHistory,
    ResidentEscalationSettings,
)

logger = logging.getLogger(__name__)
User = get_user_model()


def _resident_society_ids(resident):
    return list(
        ResidentFlatMapping.objects.filter(user=resident, is_active=True)
        .values_list('flat__block__society_id', flat=True)
        .distinct()
    )


def get_or_create_escalation_settings(resident):
    """Retrieve or create ResidentEscalationSettings with society-aware defaults."""
    settings_obj, created = ResidentEscalationSettings.objects.get_or_create(
        resident=resident,
        defaults={
            'has_security_guard': False,
            'escalate_to_security': True,
            'escalate_to_volunteers': True,
            'escalate_to_secondary_guardian': True,
            'response_window_seconds': getattr(settings, 'ESCALATION_DEFAULT_WINDOW_SECONDS', 120),
            'volunteer_radius_km': getattr(settings, 'VOLUNTEER_DEFAULT_RADIUS_KM', 2.0),
        },
    )
    if created:
        soc_ids = _resident_society_ids(resident)
        has_guard = SocietyAssignment.objects.filter(
            society_id__in=soc_ids, user__role='security', is_active=True
        ).exists()
        if has_guard:
            settings_obj.has_security_guard = True
            settings_obj.save(update_fields=['has_security_guard'])

    return settings_obj


def build_escalation_plan(incident, settings_obj=None):
    """
    Build JSON snapshot of the resident's escalation plan at incident creation time.
    Calculates escalate_at (now if no verified guardian, else now + window).
    """
    if settings_obj is None:
        settings_obj = get_or_create_escalation_settings(incident.resident)

    primary_guardian = EmergencyContact.objects.filter(
        resident=incident.resident,
        contact_type='primary_guardian',
        status='accepted',
        is_verified=True,
        is_active=True,
    ).select_related('linked_user').first()

    secondary_guardian = EmergencyContact.objects.filter(
        resident=incident.resident,
        contact_type='secondary_guardian',
        status='accepted',
        is_verified=True,
        is_active=True,
    ).select_related('linked_user').first()

    soc_ids = _resident_society_ids(incident.resident)
    society_has_security = SocietyAssignment.objects.filter(
        society_id__in=soc_ids, user__role='security', is_active=True
    ).exists()
    has_resident_guards = ResidentSecurityGuard.objects.filter(
        resident=incident.resident, is_active=True
    ).exists()
    has_security = has_resident_guards or society_has_security or settings_obj.has_security_guard

    targets = []
    if settings_obj.escalate_to_secondary_guardian and secondary_guardian:
        targets.append('secondary_guardian')
    if settings_obj.escalate_to_security and (settings_obj.has_security_guard or has_security) and (society_has_security or has_resident_guards):
        targets.append('security')
    if settings_obj.escalate_to_volunteers:
        targets.append('volunteers')

    window_seconds = int(settings_obj.response_window_seconds or 120)
    now = timezone.now()

    if primary_guardian:
        escalate_at = now + timedelta(seconds=window_seconds)
        has_verified_guardian = True
    else:
        escalate_at = now
        has_verified_guardian = False

    return {
        'window_seconds': window_seconds,
        'escalate_at': escalate_at.isoformat(),
        'targets': targets,
        'has_verified_guardian': has_verified_guardian,
        'society_linked': bool(soc_ids),
        'primary_guardian_name': primary_guardian.name if primary_guardian else None,
        'primary_guardian_id': primary_guardian.id if primary_guardian else None,
        'secondary_guardian_name': secondary_guardian.name if secondary_guardian else None,
        'security_included': 'security' in targets,
        'security_skip_reason': (
            'No home society linked'
            if not soc_ids and not has_resident_guards
            else 'Security escalation disabled in settings'
            if not settings_obj.escalate_to_security
            else 'No security personnel on duty or configured'
            if not (society_has_security or has_resident_guards)
            else None
        ),
    }


def trigger_escalation(
    incident,
    kind,
    triggered_by=None,
    targets=None,
    reason='',
    note='',
    volunteer_ids=None,
    volunteer_mode='auto',
    security_guard_ids=None,
):
    """
    Execute escalation for an incident (manual_guardian, manual_resident, auto_timeout).
    Alerts targets simultaneously with coordinates and volunteer distance.
    Supports volunteer_mode ('auto' or 'selected') and explicit security_guard_ids.
    """
    if incident.status in ('RESOLVED', 'CLOSED'):
        return None

    settings_obj = get_or_create_escalation_settings(incident.resident)
    plan = incident.escalation_plan or {}
    configured_targets = plan.get('targets', ['secondary_guardian', 'security', 'volunteers'])

    soc_ids = _resident_society_ids(incident.resident)
    society_has_security = SocietyAssignment.objects.filter(
        society_id__in=soc_ids, user__role='security', is_active=True
    ).exists()
    has_resident_guards = ResidentSecurityGuard.objects.filter(
        resident=incident.resident, is_active=True
    ).exists()
    has_security = has_resident_guards or society_has_security or settings_obj.has_security_guard

    # Determine active targets
    if targets is None:
        resolved_targets = list(configured_targets)
    else:
        resolved_targets = []
        for t in targets:
            if t == 'secondary_guardian':
                resolved_targets.append('secondary_guardian')
            elif t == 'security':
                if (settings_obj.has_security_guard or has_security) and (society_has_security or has_resident_guards):
                    resolved_targets.append('security')
            elif t == 'volunteers':
                resolved_targets.append('volunteers')

    # Select volunteers if volunteers target enabled
    selected_volunteers = []
    if 'volunteers' in resolved_targets:
        if volunteer_mode == 'selected' and volunteer_ids:
            vols = VolunteerProfile.objects.filter(
                user_id__in=volunteer_ids,
                approval_status='approved',
                user__is_active=True,
                user__is_available=True,
            ).select_related('user', 'society', 'block')
            ref_lat, ref_lng, _ = get_incident_reference_point(incident)
            for vp in vols:
                v_lat = vp.latitude
                v_lng = vp.longitude
                dist = haversine_km(ref_lat, ref_lng, v_lat, v_lng) if (ref_lat and v_lat) else None
                selected_volunteers.append({
                    'id': vp.user.id,
                    'user': vp.user,
                    'name': vp.user.get_full_name() or vp.user.username,
                    'username': vp.user.username,
                    'distance_km': dist,
                    'within_radius': True,
                    'tier': 1 if vp.society_id in soc_ids else 3,
                })
        else:
            matching_res = select_nearby_volunteers(
                incident,
                radius_km=settings_obj.volunteer_radius_km,
            )
            selected_volunteers = matching_res['selected']

    resolved_vol_ids = [v['id'] for v in selected_volunteers]

    with transaction.atomic():
        # Lock incident row
        inc = Incident.objects.select_for_update().get(id=incident.id)
        if inc.status in ('RESOLVED', 'CLOSED'):
            return None

        inc.is_escalated = True
        inc.escalated_at = timezone.now()
        inc.escalated_by = triggered_by
        inc.escalation_trigger = kind
        inc.save(update_fields=['is_escalated', 'escalated_at', 'escalated_by', 'escalation_trigger', 'updated_at'])

        esc = IncidentEscalation.objects.create(
            incident=inc,
            kind=kind,
            triggered_by=triggered_by,
            targets=resolved_targets,
            reason=reason,
            note=note,
            volunteer_ids=resolved_vol_ids,
            volunteer_mode=volunteer_mode,
            security_guard_ids=security_guard_ids or [],
        )

        event_name = 'auto_escalated' if kind == 'auto_timeout' else 'escalated'
        history_note = note or f"Escalated ({kind}) to {', '.join(resolved_targets)}."
        if reason:
            history_note += f" Reason: {reason}."
        if selected_volunteers:
            history_note += f" {len(selected_volunteers)} volunteers notified."

        IncidentHistory.objects.create(
            incident=inc,
            changed_by=triggered_by,
            event_type=event_name,
            note=history_note,
        )

        # Dispatch notifications post-commit
        def dispatch_notifications():
            try:
                if kind == 'manual_guardian':
                    notify_escalation_handoff(inc, esc, selected_volunteers)
                elif kind == 'auto_timeout':
                    notify_escalation_timeout(inc, esc, selected_volunteers)
                else:
                    notify_escalation_timeout(inc, esc, selected_volunteers)
            except Exception:
                logger.exception("Escalation notification dispatch failed for Incident #%s", inc.id)

        transaction.on_commit(dispatch_notifications)

    return esc


def trigger_no_responder(incident):
    """Second stage alert when no responder has accepted after escalation window."""
    if incident.assigned_to_id or incident.no_responder_alerted_at or incident.status in ('RESOLVED', 'CLOSED'):
        return None

    with transaction.atomic():
        inc = Incident.objects.select_for_update().get(id=incident.id)
        if inc.assigned_to_id or inc.no_responder_alerted_at or inc.status in ('RESOLVED', 'CLOSED'):
            return None

        inc.no_responder_alerted_at = timezone.now()
        inc.save(update_fields=['no_responder_alerted_at', 'updated_at'])

        esc = IncidentEscalation.objects.create(
            incident=inc,
            kind='no_responder',
            targets=['admin', 'resident', 'security', 'volunteers'],
            reason='no_responder_timeout',
            note='No responder has accepted the escalated incident within the time window.',
        )

        IncidentHistory.objects.create(
            incident=inc,
            event_type='no_responder',
            note='No responder accepted within time window. Admins alerted and targets re-notified.',
        )

        def dispatch_no_responder():
            try:
                notify_no_responder(inc, esc)
            except Exception:
                logger.exception("No-responder notification failed for Incident #%s", inc.id)

        transaction.on_commit(dispatch_no_responder)

    return esc


def process_due_escalations():
    """
    Idempotent server-side escalation processor.
    Selects overdue incidents and triggers automatic escalation or no-responder alert.
    """
    now = timezone.now()

    # 1. First stage: overdue REPORTED incidents with no guardian response and not yet escalated
    due_for_escalation = Incident.objects.filter(
        status='REPORTED',
        escalate_at__lte=now,
        guardian_acknowledged_at__isnull=True,
        is_escalated=False,
    ).order_by('id')

    for inc in due_for_escalation:
        try:
            trigger_escalation(inc, kind='auto_timeout')
        except Exception:
            logger.exception("Failed auto-escalating Incident #%s", inc.id)

    # 2. Second stage: escalated incidents with no assigned volunteer or security after another window
    # Window to wait after escalation before triggering no_responder
    escalated_pending = Incident.objects.filter(
        is_escalated=True,
        assigned_to__isnull=True,
        no_responder_alerted_at__isnull=True,
        status__in=('REPORTED', 'ACKNOWLEDGED'),
    ).order_by('id')

    for inc in escalated_pending:
        window_sec = inc.escalation_window_seconds or 120
        if inc.escalated_at and inc.escalated_at <= (now - timedelta(seconds=window_sec)):
            try:
                trigger_no_responder(inc)
            except Exception:
                logger.exception("Failed triggering no_responder for Incident #%s", inc.id)


def opportunistic_check_escalations():
    """Call process_due_escalations() opportunistically, throttled to at most once per 5 seconds."""
    cache_key = 'safecircle_escalation_tick_throttle'
    if cache.add(cache_key, '1', timeout=5):
        try:
            process_due_escalations()
        except Exception:
            logger.exception("Opportunistic escalation check failed")


def guardian_acknowledge(incident, guardian_user):
    """Verified guardian presses 'I'm responding': sets ack, transitions REPORTED -> ACKNOWLEDGED."""
    with transaction.atomic():
        inc = Incident.objects.select_for_update().get(id=incident.id)
        if inc.status in ('RESOLVED', 'CLOSED'):
            return False, "Incident is already resolved or closed."

        inc.guardian_acknowledged_at = timezone.now()
        inc.guardian_acknowledged_by = guardian_user
        if inc.status == 'REPORTED':
            inc.status = 'ACKNOWLEDGED'
            inc.acknowledged_at = timezone.now()
        inc.escalate_at = None  # Cancel pending auto escalation
        inc.save(update_fields=[
            'guardian_acknowledged_at',
            'guardian_acknowledged_by',
            'status',
            'acknowledged_at',
            'escalate_at',
            'updated_at',
        ])

        name = guardian_user.get_full_name() or guardian_user.username
        IncidentHistory.objects.create(
            incident=inc,
            changed_by=guardian_user,
            event_type='guardian_acknowledged',
            from_status='REPORTED',
            to_status='ACKNOWLEDGED',
            note=f"Guardian {name} acknowledged the SOS and is responding.",
        )

        def dispatch():
            try:
                notify_status_changed(inc, actor=guardian_user, from_status='REPORTED', to_status='ACKNOWLEDGED', note=f"{name} is responding.")
            except Exception:
                logger.exception("Status notification failed on guardian ack for #%s", inc.id)

        transaction.on_commit(dispatch)

    return True, inc


def security_acknowledge(incident, security_user):
    """
    Security personnel acknowledges incident ("I'm going").
    Sets ACKNOWLEDGED, stamps acknowledged_at, cancels pending auto-escalation, writes history, dispatches notifications.
    """
    with transaction.atomic():
        inc = Incident.objects.select_for_update().get(id=incident.id)
        if inc.status in ('RESOLVED', 'CLOSED'):
            return False, "Incident is already resolved or closed."

        inc.acknowledged_at = timezone.now()
        if inc.status == 'REPORTED':
            inc.status = 'ACKNOWLEDGED'
        inc.escalate_at = None  # Cancel pending auto escalation timer
        inc.save(update_fields=[
            'status',
            'acknowledged_at',
            'escalate_at',
            'updated_at',
        ])

        name = security_user.get_full_name() or security_user.username
        IncidentHistory.objects.create(
            incident=inc,
            changed_by=security_user,
            event_type='status_changed',
            from_status='REPORTED',
            to_status='ACKNOWLEDGED',
            note=f"Security guard {name} acknowledged the SOS and is responding.",
        )

        def dispatch():
            try:
                notify_status_changed(
                    inc,
                    actor=security_user,
                    from_status='REPORTED',
                    to_status='ACKNOWLEDGED',
                    note=f"Security guard {name} acknowledged and is responding.",
                )
            except Exception:
                logger.exception("Status notification failed on security ack for #%s", inc.id)

        transaction.on_commit(dispatch)

    return True, inc


def volunteer_accept_incident(incident_id, volunteer_user):
    """
    Atomic first-come assignment with select_for_update.
    Sets assigned_to, transitions to ASSIGNED, notifies everyone, second accept returns 409.
    """
    with transaction.atomic():
        try:
            inc = Incident.objects.select_for_update().get(id=incident_id)
        except Incident.DoesNotExist:
            return False, 404, "Incident not found."

        if inc.status in ('RESOLVED', 'CLOSED'):
            return False, 400, "Cannot accept a resolved or closed incident."

        if inc.assigned_to_id is not None:
            assignee = inc.assigned_to.get_full_name() or inc.assigned_to.username
            return False, 409, f"This incident was already accepted by {assignee}."

        prev_status = inc.status
        inc.assigned_to = volunteer_user
        inc.status = 'ASSIGNED'
        inc.assigned_at = timezone.now()
        inc.save(update_fields=['assigned_to', 'status', 'assigned_at', 'updated_at'])

        vol_name = volunteer_user.get_full_name() or volunteer_user.username
        IncidentHistory.objects.create(
            incident=inc,
            changed_by=volunteer_user,
            event_type='assigned',
            from_status=prev_status,
            to_status='ASSIGNED',
            note=f"Volunteer {vol_name} accepted the incident assignment.",
        )

        def dispatch():
            try:
                notify_escalation_accepted(inc, volunteer_user)
            except Exception:
                logger.exception("Accept notification failed for Incident #%s", inc.id)

        transaction.on_commit(dispatch)

    return True, 200, inc
