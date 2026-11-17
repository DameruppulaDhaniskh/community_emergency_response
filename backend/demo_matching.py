#!/usr/bin/env python
"""
SafeCircle Demo: Block-First Volunteer Matching Verification Script
Demonstrates:
  - Reference point resolution (incident coordinates -> society)
  - Resident block resolution
  - Tier 1: Same block, same society (closest first)
  - Tier 2: Same society, different block
  - Tier 3: Neighbouring societies (cross-society radius & volunteer opt-in)
  - Exclusions & fallbacks (unavailable, unapproved, stale GPS -> base pin, out of range)
"""
import os
import sys

# Ensure django environment is loaded
os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'config.settings')
import django
django.setup()

from django.contrib.auth import get_user_model
from incidents.matching import (
    estimate_volunteer_breakdown,
    haversine_km,
    select_nearby_volunteers,
)
from incidents.models import Incident, ResidentEscalationSettings
from society.models import Block, ResidentFlatMapping, Society, SocietyAlertPolicy, SocietyAssignment, VolunteerLocation, VolunteerProfile

User = get_user_model()


def main():
    print("=" * 80)
    print(" SafeCircle - Volunteer Matching Engine Demo")
    print("=" * 80)

    # 1. Fetch demo resident
    resident = User.objects.filter(username='asha_resident').first()
    if not resident:
        print("[!] Demo resident 'asha_resident' not found. Please run: python manage.py seed_demo")
        return

    # Check resident flat & block
    mapping = ResidentFlatMapping.objects.filter(user=resident, is_active=True).select_related('flat__block__society').first()
    if mapping:
        society = mapping.flat.block.society
        block = mapping.flat.block
        print(f"Resident: {resident.get_full_name()} (@{resident.username})")
        print(f"Society : {society.name} (Pin: {society.latitude}, {society.longitude})")
        print(f"Location: Flat {mapping.flat.flat_number}, {block.name}")
    else:
        print(f"Resident: {resident.get_full_name()} (No flat mapping found)")
        society = Society.objects.filter(is_active=True).first()

    # 2. Find or create a test incident
    incident = Incident.objects.filter(resident=resident).order_by('-created_at').first()
    if not incident:
        incident = Incident(
            resident=resident,
            latitude=12.971600,
            longitude=77.594600,
            category='medical',
            status='REPORTED',
            title='Demo Medical SOS',
        )

    print(f"\nIncident Target Coordinates: Lat {incident.latitude}, Lng {incident.longitude}")
    print(f"Radius configured          : 2.0 km")

    # 3. Run Matching
    result = select_nearby_volunteers(incident, radius_km=2.0)
    selected = result['selected']

    print("\n" + "-" * 80)
    print(f" MATCHED & SELECTED VOLUNTEERS (Limit: 5, Ranked by Tier & Distance)")
    print("-" * 80)
    if not selected:
        print("  No eligible volunteers found within radius.")
    else:
        for idx, v in enumerate(selected, 1):
            tier_label = {
                1: "Tier 1 (Same Block)",
                2: "Tier 2 (Same Society)",
                3: "Tier 3 (Neighbour Society)",
            }.get(v['tier'], f"Tier {v['tier']}")

            print(f"  #{idx} [{tier_label}] {v['name']} (@{v['user'].username})")
            print(f"      Distance : {v['distance_km']} km (Location source: {v['source']})")
            print(f"      Society  : {v['society_name']} | Block: {getattr(v['profile'].block, 'name', 'N/A')}")
            lat_disp = v['profile'].latitude or 'N/A'
            lng_disp = v['profile'].longitude or 'N/A'
            print(f"      Coords   : ({lat_disp}, {lng_disp})")

    print("\n" + "-" * 80)
    print(" SUMMARY COUNTS")
    print("-" * 80)
    print(f"  Tier 1 candidates (Same Block)   : {result['tier1_count']}")
    print(f"  Tier 2 candidates (Same Society) : {result['tier2_count']}")
    print(f"  Tier 3 candidates (Neighbours)   : {result['tier3_count']}")
    print(f"  Radius Widened                   : {result['radius_widened']}")

    # 4. Breakdown Estimate
    breakdown = estimate_volunteer_breakdown(resident, radius_km=2.0)
    print("\n" + "-" * 80)
    print(" RESIDENT ESCALATION SETTINGS PREVIEW BREAKDOWN")
    print("-" * 80)
    print(f"  Total eligible          : {breakdown['total']}")
    print(f"  - Same block (Tier 1)   : {breakdown['tier1']}")
    print(f"  - Same society (Tier 2) : {breakdown['tier2']}")
    print(f"  - Neighbours (Tier 3)   : {breakdown['tier3']}")
    print(f"  - Policy allows Tier 3  : {breakdown['policy_allows_neighbour']}")
    print("=" * 80)


if __name__ == '__main__':
    main()
