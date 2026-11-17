from django.contrib.auth import get_user_model
from django.core.cache import cache
from rest_framework.test import APITestCase

from contacts.models import EmergencyContact
from incidents.tests import make_society, place_resident
from notifications.models import Notification
from society.models import SocietyAssignment

User = get_user_model()


class GuardianRequestEndToEndTests(APITestCase):
    def setUp(self):
        cache.clear()
        self.soc, blk = make_society('Green Meadows', 'CONT1')
        self.res = User.objects.create_user(
            username='res_asha',
            email='asha_c@test.local',
            password='Password123!',
            first_name='Asha',
            last_name='Rao',
            phone='9876543210',
            role='resident',
        )
        place_resident(self.res, blk, '101')

        self.g1 = User.objects.create_user(
            username='guard_ravi',
            email='ravi_c@test.local',
            password='Password123!',
            first_name='Ravi',
            last_name='Kumar',
            phone='9800000011',
            role='guardian',
        )
        self.g2 = User.objects.create_user(
            username='guard_meera',
            email='meera_c@test.local',
            password='Password123!',
            first_name='Meera',
            last_name='Rao',
            phone='9800000012',
            role='guardian',
        )
        self.g3 = User.objects.create_user(
            username='guard_other',
            email='other_c@test.local',
            password='Password123!',
            first_name='Other',
            last_name='Guard',
            phone='9800000013',
            role='guardian',
        )
        self.vol = User.objects.create_user(
            username='vol_priya',
            email='vol_c@test.local',
            password='Password123!',
            first_name='Priya',
            last_name='Sharma',
            phone='9800000014',
            role='volunteer',
        )
        SocietyAssignment.objects.create(society=self.soc, user=self.vol)

    def test_create_guardian_400_validation_rules(self):
        self.client.force_authenticate(self.res)

        # Missing identifier
        r = self.client.post('/api/contacts/', {
            'contact_type': 'primary_guardian',
            'relationship': 'spouse',
        }, format='json')
        self.assertEqual(r.status_code, 400)

        # Unknown account
        r = self.client.post('/api/contacts/', {
            'identifier': 'does_not_exist',
            'contact_type': 'primary_guardian',
            'relationship': 'spouse',
        }, format='json')
        self.assertEqual(r.status_code, 400)

        # Non-guardian role
        r = self.client.post('/api/contacts/', {
            'identifier': 'vol_priya',
            'contact_type': 'primary_guardian',
            'relationship': 'friend',
        }, format='json')
        self.assertEqual(r.status_code, 400)
        self.assertIn('not a guardian account', str(r.data['identifier']))

        # Cannot add self (even if resident somehow picked own username)
        r = self.client.post('/api/contacts/', {
            'identifier': 'res_asha',
            'contact_type': 'primary_guardian',
            'relationship': 'other',
        }, format='json')
        self.assertEqual(r.status_code, 400)
        self.assertIn('yourself', str(r.data['identifier']))

        # Add valid primary guardian by username; spoofed client name/phone ignored
        with self.captureOnCommitCallbacks(execute=True):
            r = self.client.post('/api/contacts/', {
                'identifier': 'GUARD_RAVI',
                'contact_type': 'primary_guardian',
                'relationship': 'spouse',
                'name': 'Spoofed Fake Name',
                'phone': '9000099999',
                'email': 'fake@spoof.local',
            }, format='json')
        self.assertEqual(r.status_code, 201)
        self.assertEqual(r.data['name'], 'Ravi Kumar')
        self.assertEqual(r.data['phone'], '+919800000011')
        self.assertEqual(r.data['email'], 'ravi_c@test.local')
        self.assertEqual(r.data['status'], 'pending')
        self.assertFalse(r.data['is_verified'])

        # Slot already taken
        r = self.client.post('/api/contacts/', {
            'identifier': 'guard_meera',
            'contact_type': 'primary_guardian',
            'relationship': 'sibling',
        }, format='json')
        self.assertEqual(r.status_code, 400)
        self.assertIn('contact_type', r.data)

        # Already an active contact (even in secondary slot)
        r = self.client.post('/api/contacts/', {
            'identifier': '9800000011',
            'contact_type': 'secondary_guardian',
            'relationship': 'spouse',
        }, format='json')
        self.assertEqual(r.status_code, 400)
        self.assertIn('already an active contact', str(r.data['identifier']))

    def test_guardian_lifecycle_accept_notifications_and_access(self):
        # Resident adds primary by username, secondary by phone (with formatting)
        self.client.force_authenticate(self.res)
        with self.captureOnCommitCallbacks(execute=True):
            c1 = self.client.post('/api/contacts/', {
                'identifier': 'guard_ravi',
                'contact_type': 'primary_guardian',
                'relationship': 'spouse',
            }, format='json')
        self.assertEqual(c1.status_code, 201)
        req1_id = c1.data['id']

        with self.captureOnCommitCallbacks(execute=True):
            c2 = self.client.post('/api/contacts/', {
                'identifier': '+91 98000-00012',
                'contact_type': 'secondary_guardian',
                'relationship': 'sibling',
            }, format='json')
        self.assertEqual(c2.status_code, 201)
        req2_id = c2.data['id']

        # Guardian 1 received GUARDIAN_REQUEST notification with incident=None
        self.assertTrue(
            Notification.objects.filter(
                incident__isnull=True,
                recipient=self.g1,
                event_type='GUARDIAN_REQUEST',
                channel='in_app',
            ).exists()
        )

        # Resident cannot self-verify (410 Gone)
        r_verify = self.client.post(f'/api/contacts/{req1_id}/verify/', {'token': 'anything'}, format='json')
        self.assertEqual(r_verify.status_code, 410)
        self.assertFalse(EmergencyContact.objects.get(pk=req1_id).is_verified)

        # Resident raises SOS BEFORE guardian accepts -> guardian gets NO SOS & cannot view incident
        with self.captureOnCommitCallbacks(execute=True):
            sos = self.client.post('/api/incidents/sos/', {'emergency_type': 'medical'}, format='json')
        self.assertEqual(sos.status_code, 201)
        sos_id = sos.data['id']

        self.client.force_authenticate(self.g1)
        self.assertEqual(self.client.get(f'/api/incidents/{sos_id}/').status_code, 404)
        self.assertEqual(self.client.get('/api/guardian/dependents/').data, [])
        self.assertFalse(
            Notification.objects.filter(incident_id=sos_id, recipient=self.g1).exists()
        )

        # Non-guardian cannot call guardian endpoints (403)
        self.client.force_authenticate(self.res)
        self.assertEqual(self.client.get('/api/guardian/requests/').status_code, 403)
        self.assertEqual(self.client.get('/api/guardian/dependents/').status_code, 403)

        # Other guardian trying to accept req1 gets 404
        self.client.force_authenticate(self.g3)
        self.assertEqual(self.client.post(f'/api/guardian/requests/{req1_id}/accept/').status_code, 404)

        # Guardian 1 sees pending request and accepts (idempotent)
        self.client.force_authenticate(self.g1)
        reqs = self.client.get('/api/guardian/requests/?status=pending')
        self.assertEqual(len(reqs.data), 1)
        self.assertEqual(reqs.data[0]['resident_name'], 'Asha Rao')
        self.assertEqual(reqs.data[0]['flat'], '101')

        with self.captureOnCommitCallbacks(execute=True):
            acc = self.client.post(f'/api/guardian/requests/{req1_id}/accept/')
        self.assertEqual(acc.status_code, 200)
        self.assertEqual(acc.data['status'], 'accepted')

        # Idempotent second accept returns 200 without crashing
        self.assertEqual(self.client.post(f'/api/guardian/requests/{req1_id}/accept/').status_code, 200)
        self.assertEqual(self.client.post(f'/api/guardian/requests/{req1_id}/decline/').status_code, 400)

        # Contact is now accepted & verified
        contact_obj = EmergencyContact.objects.get(pk=req1_id)
        self.assertEqual(contact_obj.status, 'accepted')
        self.assertTrue(contact_obj.is_verified)
        self.assertIsNotNone(contact_obj.verified_at)
        self.assertIsNotNone(contact_obj.responded_at)

        # Resident received GUARDIAN_ACCEPTED notification
        self.assertTrue(
            Notification.objects.filter(
                incident__isnull=True,
                recipient=self.res,
                event_type='GUARDIAN_ACCEPTED',
                channel='in_app',
            ).exists()
        )

        # Guardian 1 sees resident in dependents with active SOS & can access incident
        deps = self.client.get('/api/guardian/dependents/')
        self.assertEqual(len(deps.data), 1)
        self.assertTrue(deps.data[0]['has_active_incident'])
        self.assertEqual(deps.data[0]['active_incident_id'], sos_id)
        self.assertEqual(self.client.get(f'/api/incidents/{sos_id}/').status_code, 200)

        # Guardian 2 also accepts -> BOTH primary & secondary receive next SOS notifications
        self.client.force_authenticate(self.g2)
        with self.captureOnCommitCallbacks(execute=True):
            self.assertEqual(self.client.post(f'/api/guardian/requests/{req2_id}/accept/').status_code, 200)

        self.client.force_authenticate(self.res)
        with self.captureOnCommitCallbacks(execute=True):
            sos2 = self.client.post('/api/incidents/sos/', {'emergency_type': 'fire'}, format='json')
        self.assertEqual(sos2.status_code, 201)
        self.assertTrue(Notification.objects.filter(incident_id=sos2.data['id'], recipient=self.g1).exists())
        self.assertTrue(Notification.objects.filter(incident_id=sos2.data['id'], recipient=self.g2).exists())

    def test_slot_reuse_after_decline_cancel_soft_delete_and_resend(self):
        self.client.force_authenticate(self.res)
        with self.captureOnCommitCallbacks(execute=True):
            c = self.client.post('/api/contacts/', {
                'identifier': 'guard_ravi',
                'contact_type': 'primary_guardian',
                'relationship': 'spouse',
            }, format='json')
        cid = c.data['id']

        # 1. Guardian declines -> resident gets GUARDIAN_DECLINED notification & can reuse slot
        self.client.force_authenticate(self.g1)
        with self.captureOnCommitCallbacks(execute=True):
            d = self.client.post(f'/api/guardian/requests/{cid}/decline/')
        self.assertEqual(d.status_code, 200)
        self.assertEqual(d.data['status'], 'declined')
        self.assertTrue(
            Notification.objects.filter(
                incident__isnull=True, recipient=self.res, event_type='GUARDIAN_DECLINED', channel='in_app'
            ).exists()
        )

        # Request again via /resend/ creates a fresh pending contact cleanly
        self.client.force_authenticate(self.res)
        with self.captureOnCommitCallbacks(execute=True):
            r_again = self.client.post(f'/api/contacts/{cid}/resend/')
        self.assertEqual(r_again.status_code, 201)
        new_cid = r_again.data['id']
        self.assertNotEqual(new_cid, cid)
        self.assertEqual(r_again.data['status'], 'pending')

        # Pending /resend/ rate limit check (30s cooldown)
        r_spam = self.client.post(f'/api/contacts/{new_cid}/resend/')
        self.assertEqual(r_spam.status_code, 429)

        # 2. Resident cancels -> slot immediately reusable for guard_meera
        r_cancel = self.client.post(f'/api/contacts/{new_cid}/cancel/')
        self.assertEqual(r_cancel.status_code, 200)
        self.assertEqual(r_cancel.data['status'], 'cancelled')

        c_meera = self.client.post('/api/contacts/', {
            'identifier': 'guard_meera',
            'contact_type': 'primary_guardian',
            'relationship': 'sibling',
        }, format='json')
        self.assertEqual(c_meera.status_code, 201)

        # 3. Resident soft-deletes -> slot immediately reusable for guard_other (no 500 error)
        r_del = self.client.delete(f"/api/contacts/{c_meera.data['id']}/")
        self.assertEqual(r_del.status_code, 204)

        c_other = self.client.post('/api/contacts/', {
            'identifier': 'guard_other',
            'contact_type': 'primary_guardian',
            'relationship': 'friend',
        }, format='json')
        self.assertEqual(c_other.status_code, 201)

    def test_emergency_contact_registered_vs_plain(self):
        self.client.force_authenticate(self.res)

        # Registered user emergency_contact -> linked & accepted immediately
        r_reg = self.client.post('/api/contacts/', {
            'identifier': 'vol_priya',
            'contact_type': 'emergency_contact',
            'relationship': 'neighbor',
        }, format='json')
        self.assertEqual(r_reg.status_code, 201)
        self.assertEqual(r_reg.data['linked_user'], self.vol.pk)
        self.assertEqual(r_reg.data['status'], 'accepted')
        self.assertTrue(r_reg.data['is_verified'])

        # Non-registered emergency_contact -> plain unverified contact
        r_plain = self.client.post('/api/contacts/', {
            'name': 'Dr. Anita Sharma',
            'phone': '9811122233',
            'contact_type': 'emergency_contact',
            'relationship': 'doctor',
        }, format='json')
        self.assertEqual(r_plain.status_code, 201)
        self.assertIsNone(r_plain.data['linked_user'])
        self.assertEqual(r_plain.data['phone'], '+919811122233')
        self.assertFalse(r_plain.data['is_verified'])

