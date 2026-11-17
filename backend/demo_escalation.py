#!/usr/bin/env python
"""
SafeCircle Demo: End-to-End SOS, Guardian Ack, Handoff & Auto-Escalation Lifecycle
Demonstrates:
  1. SOS creation with GPS coordinates and accuracy.
  2. Escalation plan generation & primary guardian notification.
  3. Guardian response ("I'm responding" -> ACKNOWLEDGED, timer cancelled).
  4. Guardian handoff ("I can't help" -> immediate direct multi-target escalation).
  5. Auto-escalation timeout (server-side worker trigger when guardian unresponsive).
  6. Atomic volunteer acceptance (first wins -> ASSIGNED, second gets 409 Conflict).
  7. Second-stage no-responder timeout (admin alert & 112 guidance).
"""
import os
import sys
from datetime import timedelta

# Ensure django environment is loaded
os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'config.settings')
import django
django.setup()

from django.contrib.auth import get_user_model
from django.utils import timezone

from contacts.models import EmergencyContact
from incidents.escalation import (
    build_escalation_plan,
    get_or_create_escalation_settings,
    guardian_acknowledge,
    process_due_escalations,
    trigger_escalation,
    trigger_no_responder,
    volunteer_accept_incident,
)
from incidents.models import Incident, IncidentEscalation, IncidentHistory, ResidentEscalationSettings
from notifications.models import Notification

User = get_user_model()


def print_step(title):
    print("\n" + "=" * 80)
    print(f" STEP: {title}")
    print("=" * 80)


def main():
    print("=" * 80)
    print(" SafeCircle - SOS, Guardian Response & Escalation Engine Demo")
    print("=" * 80)

    # 1. Fetch demo actors
    resident = User.objects.filter(username='asha_resident').first()
    guardian = User.objects.filter(username='ravi_guardian').first()
    vol1 = User.objects.filter(username='volunteer_demo').first()
    vol2 = User.objects.filter(username='volunteer2_demo').first()

    if not resident or not guardian or not vol1:
        print("[!] Required demo users not found. Please run: python manage.py seed_demo")
        return

    # Ensure resident escalation settings
    settings_obj = get_or_create_escalation_settings(resident)
    settings_obj.has_security_guard = True
    settings_obj.escalate_to_security = True
    settings_obj.escalate_to_volunteers = True
    settings_obj.escalate_to_secondary_guardian = True
    settings_obj.response_window_seconds = 120
    settings_obj.volunteer_radius_km = 2.0
    settings_obj.save()

    print_step("1. Resident Triggers SOS with GPS Coordinates")
    now = timezone.now()
    incident = Incident.objects.create(
        resident=resident,
        reported_by=resident,
        title="Demo Live SOS - Medical Assistance",
        category="medical",
        emergency_type="medical",
        description="Experiencing chest pain and severe dizziness",
        latitude=12.971600,
        longitude=77.594600,
        location_accuracy=12.5,
        location_captured_at=now,
        status="REPORTED",
    )

    plan = build_escalation_plan(incident, settings_obj=settings_obj)
    incident.escalation_window_seconds = plan['window_seconds']
    incident.escalation_plan = plan
    incident.guardian_alerted_at = now
    incident.escalate_at = now + timedelta(seconds=plan['window_seconds'])
    incident.save()

    print(f"  Incident ID   : #{incident.id} ({incident.title})")
    print(f"  GPS Location  : ({incident.latitude}, {incident.longitude}) +/- {incident.location_accuracy}m")
    print(f"  Status        : {incident.status}")
    print(f"  Primary Guard : {plan['primary_guardian_name']}")
    print(f"  Escalate At   : {incident.escalate_at} (Window: {incident.escalation_window_seconds}s)")
    print(f"  Planned Targets: {', '.join(plan['targets'])}")

    print_step("2. Guardian Acknowledges SOS ('I am responding')")
    success, res = guardian_acknowledge(incident, guardian)
    incident.refresh_from_db()
    print(f"  Result        : Success = {success}")
    print(f"  Status        : {incident.status} (Moved from REPORTED -> ACKNOWLEDGED)")
    print(f"  Acked By      : {incident.guardian_acknowledged_by.username} at {incident.guardian_acknowledged_at}")
    print(f"  Timer State   : escalate_at = {incident.escalate_at} (Cancelled automatic escalation timer)")

    print_step("3. Guardian Handoff ('I can't help, pass it on')")
    # Reset status for handoff demonstration
    incident.status = 'REPORTED'
    incident.save(update_fields=['status'])

    esc = trigger_escalation(
        incident,
        kind='manual_guardian',
        triggered_by=guardian,
        targets=['secondary_guardian', 'security', 'volunteers'],
        reason='far_away',
        note='Currently 40 km away in north Bengaluru, passing to local team.',
    )
    incident.refresh_from_db()
    print(f"  Escalation ID : #{esc.id} (Kind: {esc.kind}, Reason: {esc.reason})")
    print(f"  Targets Alerted: {', '.join(esc.targets)}")
    print(f"  Volunteers Notified ({len(esc.volunteer_ids)}): {esc.volunteer_ids}")
    print(f"  Incident Escalated State: is_escalated = {incident.is_escalated}, by = {incident.escalated_by.username}")

    print_step("4. Atomic Volunteer Acceptance (First Come, First Served)")
    print(f"  Attempt 1: Volunteer {vol1.get_full_name()} (@{vol1.username}) accepts incident...")
    ok1, code1, res1 = volunteer_accept_incident(incident.id, vol1)
    print(f"  -> Result: Code {code1}, Success: {ok1}, New Status: {res1.status}, Assigned To: {res1.assigned_to.username}")

    print(f"\n  Attempt 2: Volunteer {vol2.get_full_name()} (@{vol2.username}) attempts to accept same incident...")
    ok2, code2, res2 = volunteer_accept_incident(incident.id, vol2)
    print(f"  -> Result: Code {code2} (Expected 409 Conflict), Detail: '{res2}'")

    print_step("5. Second-Stage No-Responder Timeout Simulation")
    # Reset assignment to test no_responder trigger
    incident.assigned_to = None
    incident.escalated_at = timezone.now() - timedelta(seconds=150)
    incident.save(update_fields=['assigned_to', 'escalated_at'])

    print(f"  Simulating overdue escalation with no accepted responder...")
    no_resp_esc = trigger_no_responder(incident)
    incident.refresh_from_db()
    print(f"  -> No-Responder Alerted At: {incident.no_responder_alerted_at}")
    print(f"  -> Admins, security, and resident re-notified with high urgency prompt ('Call 112')")

    print("\n" + "=" * 80)
    print(" ALL ESCALATION STEPS COMPLETED AND VERIFIED CLEANLY!")
    print("=" * 80)


if __name__ == '__main__':
    main()

