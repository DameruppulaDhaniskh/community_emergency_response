from datetime import timedelta
from decimal import Decimal
from unittest import mock

from django.conf import settings
from django.contrib.auth import get_user_model
from django.utils import timezone
from rest_framework.test import APITestCase

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
from incidents.matching import select_nearby_volunteers
from incidents.models import Incident, IncidentEscalation, ResidentEscalationSettings
from incidents.tests import make_society, make_user, place_resident
from notifications.models import Notification
from society.models import (
    Block,
    Flat,
    ResidentFlatMapping,
    Society,
    SocietyAlertPolicy,
    SocietyAssignment,
    VolunteerLocation,
    VolunteerProfile,
)

User = get_user_model()


class EscalationAndMatchingTests(APITestCase):
    def setUp(self):
        # 1. Society 1: Green Meadows (12.9716, 77.5946)
        self.soc1, self.block1_a = make_society('Green Meadows', 'GM-TEST-01')
        self.soc1.latitude = Decimal('12.971600')
        self.soc1.longitude = Decimal('77.594600')
        self.soc1.save()

        self.block1_b, _ = Block.objects.get_or_create(society=self.soc1, name='Block B')
        self.policy1, _ = SocietyAlertPolicy.objects.get_or_create(
            society=self.soc1,
            defaults={
                'notify_community': True,
                'include_neighbour_societies': True,
                'neighbour_radius_km': 3.0,
            },
        )

        # 2. Society 2: Palm Heights (~1.5 km away: 12.9820, 77.6040)
        self.soc2, self.block2 = make_society('Palm Heights', 'PH-TEST-02')
        self.soc2.latitude = Decimal('12.982000')
        self.soc2.longitude = Decimal('77.604000')
        self.soc2.save()

        # Admin & Security
        self.admin1 = make_user('admin1', 'admin')
        self.soc1.admin = self.admin1
        self.soc1.save()

        self.sec1 = make_user('sec1', 'security')
        SocietyAssignment.objects.create(society=self.soc1, user=self.sec1, is_active=True, is_available=True)

        # Resident Asha in Block 1A
        self.resident = make_user('asha', 'resident')
        self.resident.first_name = 'Asha'
        self.resident.save()
        place_resident(self.resident, self.block1_a, '101')

        # Primary Guardian Ravi
        self.guardian = make_user('ravi', 'guardian')
        self.primary_contact = EmergencyContact.objects.create(
            resident=self.resident,
            linked_user=self.guardian,
            contact_type='primary_guardian',
            name='Ravi Kumar',
            phone=self.guardian.phone,
            status='accepted',
            is_verified=True,
            is_active=True,
        )

        # Secondary Guardian Neha
        self.sec_guardian = make_user('neha', 'guardian')
        self.secondary_contact = EmergencyContact.objects.create(
            resident=self.resident,
            linked_user=self.sec_guardian,
            contact_type='secondary_guardian',
            name='Neha Kapoor',
            phone=self.sec_guardian.phone,
            status='accepted',
            is_verified=True,
            is_active=True,
        )

        # Resident Escalation Settings
        self.settings = ResidentEscalationSettings.objects.create(
            resident=self.resident,
            has_security_guard=True,
            escalate_to_security=True,
            escalate_to_volunteers=True,
            escalate_to_secondary_guardian=True,
            response_window_seconds=120,
            volunteer_radius_km=2.0,
        )

        # Volunteers
        # V1: Same block (Block A), live GPS ~100m away (12.9720, 77.5950)
        self.v1 = make_user('vol_v1', 'volunteer')
        SocietyAssignment.objects.create(society=self.soc1, user=self.v1, is_active=True, is_available=True)
        VolunteerProfile.objects.create(
            user=self.v1, society=self.soc1, block=self.block1_a,
            latitude=Decimal('12.9720'), longitude=Decimal('77.5950'),
            approval_status='approved', max_travel_km=2.0,
        )
        VolunteerLocation.objects.create(
            user=self.v1, latitude=Decimal('12.9720'), longitude=Decimal('77.5950'), accuracy=10.0,
        )

        # V2: Same society, different block (Block B), live GPS ~400m away (12.9735, 77.5960)
        self.v2 = make_user('vol_v2', 'volunteer')
        SocietyAssignment.objects.create(society=self.soc1, user=self.v2, is_active=True, is_available=True)
        VolunteerProfile.objects.create(
            user=self.v2, society=self.soc1, block=self.block1_b,
            latitude=Decimal('12.9735'), longitude=Decimal('77.5960'),
            approval_status='approved', max_travel_km=2.0,
        )
        VolunteerLocation.objects.create(
            user=self.v2, latitude=Decimal('12.9735'), longitude=Decimal('77.5960'), accuracy=10.0,
        )

        # V3: Neighbouring society (Palm Heights), live GPS ~1.4km away (12.9810, 77.6030), serves neighbours
        self.v3 = make_user('vol_v3', 'volunteer')
        SocietyAssignment.objects.create(society=self.soc2, user=self.v3, is_active=True, is_available=True)
        VolunteerProfile.objects.create(
            user=self.v3, society=self.soc2, block=self.block2,
            latitude=Decimal('12.9810'), longitude=Decimal('77.6030'),
            serves_nearby_societies=True, approval_status='approved', max_travel_km=3.0,
        )
        VolunteerLocation.objects.create(
            user=self.v3, latitude=Decimal('12.9810'), longitude=Decimal('77.6030'), accuracy=10.0,
        )

    def test_sos_creates_plan_and_alerts_primary_guardian_only(self):
        self.client.force_authenticate(self.resident)
        with self.captureOnCommitCallbacks(execute=True):
            r = self.client.post('/api/incidents/sos/', {
                'emergency_type': 'medical',
                'description': 'Chest pain',
                'latitude': '12.971600',
                'longitude': '77.594600',
                'accuracy': 12.0,
            })
        self.assertEqual(r.status_code, 201)
        iid = r.data['id']
        incident = Incident.objects.get(id=iid)

        self.assertEqual(incident.status, 'REPORTED')
        self.assertIsNotNone(incident.guardian_alerted_at)
        self.assertIsNotNone(incident.escalate_at)
        self.assertIn('escalation', r.data)
        self.assertEqual(r.data['escalation']['window_seconds'], 120)

        # Primary guardian notified with GUARDIAN_SOS
        notes = Notification.objects.filter(incident_id=iid, recipient=self.guardian)
        self.assertTrue(notes.exists())
        sos_note = notes.filter(event_type='GUARDIAN_SOS').first()
        self.assertIsNotNone(sos_note)
        self.assertIn('12.971600', sos_note.message)
        self.assertIn('google.com/maps', sos_note.message)

        # Security and Volunteers are NOT notified yet (they wait for escalation)
        self.assertFalse(Notification.objects.filter(incident_id=iid, recipient=self.sec1).exists())
        self.assertFalse(Notification.objects.filter(incident_id=iid, recipient=self.v1).exists())

    def test_guardian_ack_cancels_auto_escalation_timer(self):
        self.client.force_authenticate(self.resident)
        r = self.client.post('/api/incidents/sos/', {
            'emergency_type': 'medical',
            'latitude': '12.971600',
            'longitude': '77.594600',
        })
        iid = r.data['id']

        # Guardian acknowledges
        self.client.force_authenticate(self.guardian)
        ack_r = self.client.post(f'/api/incidents/{iid}/guardian-ack/')
        self.assertEqual(ack_r.status_code, 200)

        incident = Incident.objects.get(id=iid)
        self.assertEqual(incident.status, 'ACKNOWLEDGED')
        self.assertEqual(incident.guardian_acknowledged_by, self.guardian)
        self.assertIsNone(incident.escalate_at)  # Timer cancelled

    def test_guardian_handoff_immediate_escalation(self):
        self.client.force_authenticate(self.resident)
        r = self.client.post('/api/incidents/sos/', {
            'emergency_type': 'medical',
            'latitude': '12.971600',
            'longitude': '77.594600',
        })
        iid = r.data['id']

        # Guardian hands off to security and volunteers
        self.client.force_authenticate(self.guardian)
        with self.captureOnCommitCallbacks(execute=True):
            handoff_r = self.client.post(f'/api/incidents/{iid}/handoff/', {
                'targets': ['security', 'volunteers'],
                'reason': 'far_away',
                'note': '30 km away, cannot reach quickly.',
            })
        self.assertEqual(handoff_r.status_code, 200)

        incident = Incident.objects.get(id=iid)
        self.assertTrue(incident.is_escalated)
        self.assertEqual(incident.escalation_trigger, 'manual_guardian')

        # Security and volunteers received handoff notifications
        sec_notes = Notification.objects.filter(incident_id=iid, recipient=self.sec1, event_type='ESCALATION_HANDOFF')
        self.assertTrue(sec_notes.exists())
        vol_notes = Notification.objects.filter(incident_id=iid, recipient=self.v1, event_type='ESCALATION_HANDOFF')
        self.assertTrue(vol_notes.exists())

    def test_auto_escalation_after_timeout(self):
        self.client.force_authenticate(self.resident)
        r = self.client.post('/api/incidents/sos/', {
            'emergency_type': 'medical',
            'latitude': '12.971600',
            'longitude': '77.594600',
        })
        iid = r.data['id']
        incident = Incident.objects.get(id=iid)

        # Simulate 125 seconds passed
        incident.escalate_at = timezone.now() - timedelta(seconds=5)
        incident.save(update_fields=['escalate_at'])

        # Run worker processing
        with self.captureOnCommitCallbacks(execute=True):
            process_due_escalations()

        incident.refresh_from_db()
        self.assertTrue(incident.is_escalated)
        self.assertEqual(incident.escalation_trigger, 'auto_timeout')

        # Secondary guardian, security and volunteers alerted
        self.assertTrue(Notification.objects.filter(incident_id=iid, recipient=self.sec_guardian).exists())
        self.assertTrue(Notification.objects.filter(incident_id=iid, recipient=self.sec1).exists())
        self.assertTrue(Notification.objects.filter(incident_id=iid, recipient=self.v1).exists())

    def test_block_first_volunteer_matching_tiers(self):
        incident = Incident.objects.create(
            resident=self.resident,
            latitude=Decimal('12.971600'),
            longitude=Decimal('77.594600'),
            category='medical',
            status='REPORTED',
            title='Test Matching',
        )
        res = select_nearby_volunteers(incident, radius_km=2.0)
        selected = res['selected']
        self.assertEqual(len(selected), 3)

        # Tier 1: v1 (same block A)
        self.assertEqual(selected[0]['id'], self.v1.id)
        self.assertEqual(selected[0]['tier'], 1)

        # Tier 2: v2 (same society, block B)
        self.assertEqual(selected[1]['id'], self.v2.id)
        self.assertEqual(selected[1]['tier'], 2)

        # Tier 3: v3 (neighbour society)
        self.assertEqual(selected[2]['id'], self.v3.id)
        self.assertEqual(selected[2]['tier'], 3)

    def test_atomic_volunteer_accept_conflict(self):
        incident = Incident.objects.create(
            resident=self.resident,
            latitude=Decimal('12.971600'),
            longitude=Decimal('77.594600'),
            category='medical',
            status='REPORTED',
            title='Test Atomic Accept',
            is_escalated=True,
        )

        # First volunteer accepts -> 200 ASSIGNED
        self.client.force_authenticate(self.v1)
        r1 = self.client.post(f'/api/incidents/{incident.id}/accept/')
        self.assertEqual(r1.status_code, 200)
        self.assertEqual(r1.data['status'], 'ASSIGNED')
        self.assertEqual(r1.data['assigned_to']['id'], self.v1.id)

        # Second volunteer accepts -> 409 Conflict
        self.client.force_authenticate(self.v2)
        r2 = self.client.post(f'/api/incidents/{incident.id}/accept/')
        self.assertEqual(r2.status_code, 409)
        self.assertIn('already accepted', r2.data['detail'])

    def test_second_stage_no_responder_alert(self):
        incident = Incident.objects.create(
            resident=self.resident,
            latitude=Decimal('12.971600'),
            longitude=Decimal('77.594600'),
            category='medical',
            status='REPORTED',
            title='Test No Responder',
            is_escalated=True,
            escalated_at=timezone.now() - timedelta(seconds=130),
            escalation_window_seconds=120,
        )

        with self.captureOnCommitCallbacks(execute=True):
            process_due_escalations()

        incident.refresh_from_db()
        self.assertIsNotNone(incident.no_responder_alerted_at)

        # Admin received NO_RESPONDER alert
        admin_notes = Notification.objects.filter(incident=incident, recipient=self.admin1, event_type='NO_RESPONDER')
        self.assertTrue(admin_notes.exists())

    def test_volunteer_admin_approval_and_far_pin(self):
        # Admin approves pending volunteer
        new_vol = make_user('new_vol', 'volunteer')
        SocietyAssignment.objects.create(society=self.soc1, user=new_vol, is_active=False)
        profile = VolunteerProfile.objects.create(
            user=new_vol, society=self.soc1, block=self.block1_a,
            latitude=Decimal('12.9720'), longitude=Decimal('77.5950'),
            approval_status='pending',
        )

        self.client.force_authenticate(self.admin1)
        app_r = self.client.post(f'/api/admin/volunteers/{profile.id}/approve/')
        self.assertEqual(app_r.status_code, 200)
        profile.refresh_from_db()
        self.assertEqual(profile.approval_status, 'approved')

        # Volunteer updates pin > 3km from society center -> re-pends approval
        self.client.force_authenticate(new_vol)
        patch_r = self.client.patch('/api/volunteer/profile/', {
            'latitude': '13.0500',  # ~9km away
            'longitude': '77.6500',
        })
        self.assertEqual(patch_r.status_code, 200)
        profile.refresh_from_db()
        self.assertEqual(profile.approval_status, 'pending')
        self.assertTrue(profile.pin_far_from_society)

    def test_cross_society_volunteer_privacy_redaction(self):
        # Neighbouring society volunteer requests incident detail before acceptance
        incident = Incident.objects.create(
            resident=self.resident,
            latitude=Decimal('12.971600'),
            longitude=Decimal('77.594600'),
            category='medical',
            description='Sensitive resident condition description',
            status='REPORTED',
            title='Test Privacy',
            is_escalated=True,
        )
        IncidentEscalation.objects.create(
            incident=incident,
            kind='auto_timeout',
            volunteer_ids=[self.v3.id],
            targets=['volunteers'],
        )
        self.client.force_authenticate(self.v3)
        r = self.client.get(f'/api/incidents/{incident.id}/')
        self.assertEqual(r.status_code, 200)

        # Description and resident phone must be redacted for cross-society volunteer before accept
        self.assertEqual(r.data['description'], '')
        self.assertEqual(r.data['reporter']['phone'], '')
        self.assertEqual(r.data['resident_name'], 'Asha')
        self.assertTrue(r.data.get('is_cross_society_preview'))
