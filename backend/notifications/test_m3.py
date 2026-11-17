import io
from unittest import mock

from django.core.files.uploadedfile import SimpleUploadedFile
from django.db import transaction
from PIL import Image
from rest_framework.test import APITestCase, APITransactionTestCase

from contacts.models import EmergencyContact
from incidents.models import Incident
from incidents.tests import make_society, make_user, place_resident
from notifications.models import Notification
from notifications.services import notify_incident
from society.models import SocietyAssignment


def make_png(name='proof.png'):
    buf = io.BytesIO()
    Image.new('RGB', (24, 24), color=(217, 56, 30)).save(buf, format='PNG')
    return SimpleUploadedFile(name, buf.getvalue(), content_type='image/png')


class Milestone3NotificationRoutingTests(APITestCase):
    def setUp(self):
        self.soc1, block1 = make_society('Green Meadows', 'M3N1')
        self.adm1 = make_user('n3_adm', 'admin')
        self.soc1.admin = self.adm1
        self.soc1.save()

        self.res1 = make_user('n3_res', 'resident')
        place_resident(self.res1, block1, '101')

        self.sec1 = make_user('n3_sec', 'security')
        self.vol1 = make_user('n3_vol', 'volunteer')
        SocietyAssignment.objects.create(society=self.soc1, user=self.sec1)
        SocietyAssignment.objects.create(society=self.soc1, user=self.vol1)

        self.guard1 = make_user('n3_guard', 'guardian')
        EmergencyContact.objects.create(
            resident=self.res1, linked_user=self.guard1,
            contact_type='primary_guardian', name='Guard 1',
            phone='9876543210', email='n3_guard@test.com', status='accepted', is_verified=True,
        )

    def test_full_event_routing_and_unread_endpoints(self):
        # 1. Resident creates incident -> Admin receives INCIDENT_REPORTED alert
        self.client.force_authenticate(self.res1)
        with self.captureOnCommitCallbacks(execute=True):
            r = self.client.post(
                '/api/incidents/',
                {'title': 'Electrical smoke', 'category': 'fire', 'description': 'Hallway spark'},
                format='json',
            )
        self.assertEqual(r.status_code, 201)
        iid = r.data['id']

        adm_alerts = Notification.objects.filter(
            incident_id=iid, recipient=self.adm1, event_type='INCIDENT_REPORTED'
        )
        self.assertEqual(set(adm_alerts.values_list('channel', flat=True)), {'push', 'in_app', 'email'})
        self.assertTrue(all(n.recipient_type == 'admin' for n in adm_alerts))

        # 2. Resident uploads evidence -> Admin receives EVIDENCE_ADDED notification
        with self.captureOnCommitCallbacks(execute=True):
            ev_r = self.client.post(f'/api/incidents/{iid}/evidence/', {'image': make_png()}, format='multipart')
        self.assertEqual(ev_r.status_code, 201)
        self.assertTrue(
            Notification.objects.filter(
                incident_id=iid, recipient=self.adm1, event_type='EVIDENCE_ADDED', channel='in_app'
            ).exists()
        )

        # 3. Escalation -> Admin receives ESCALATED notification
        with self.captureOnCommitCallbacks(execute=True):
            esc_r = self.client.post(f'/api/incidents/{iid}/escalate/', {'note': 'Urgent'}, format='json')
        self.assertEqual(esc_r.status_code, 200)
        self.assertTrue(
            Notification.objects.filter(
                incident_id=iid, recipient=self.adm1, event_type='ESCALATED', channel='in_app'
            ).exists()
        )

        # 4. Security acknowledges -> Resident receives STATUS_CHANGED notification
        self.client.force_authenticate(self.sec1)
        with self.captureOnCommitCallbacks(execute=True):
            s_r = self.client.patch(f'/api/incidents/{iid}/status/', {'status': 'ACKNOWLEDGED', 'note': 'Verified'}, format='json')
        self.assertEqual(s_r.status_code, 200)
        self.assertTrue(
            Notification.objects.filter(
                incident_id=iid, recipient=self.res1, event_type='STATUS_CHANGED', channel='in_app'
            ).exists()
        )

        # 5. Admin assigns volunteer -> Volunteer AND Resident receive INCIDENT_ASSIGNED notifications
        self.client.force_authenticate(self.adm1)
        with self.captureOnCommitCallbacks(execute=True):
            a_r = self.client.post(f'/api/incidents/{iid}/assign/', {'volunteer_id': self.vol1.pk}, format='json')
        self.assertEqual(a_r.status_code, 200)
        self.assertTrue(
            Notification.objects.filter(
                incident_id=iid, recipient=self.vol1, event_type='INCIDENT_ASSIGNED', channel='in_app'
            ).exists()
        )
        self.assertTrue(
            Notification.objects.filter(
                incident_id=iid, recipient=self.res1, event_type='INCIDENT_ASSIGNED', channel='in_app'
            ).exists()
        )

        # 6. Admin changes ASSIGNED -> IN_PROGRESS -> notifies resident AND assigned volunteer
        with self.captureOnCommitCallbacks(execute=True):
            self.client.patch(f'/api/incidents/{iid}/status/', {'status': 'IN_PROGRESS'}, format='json')
        self.assertEqual(
            Notification.objects.filter(
                incident_id=iid, recipient=self.vol1, event_type='STATUS_CHANGED', channel='in_app'
            ).count(),
            1,
        )

        # 7. Admin resolves IN_PROGRESS -> RESOLVED -> notifies resident, volunteer, AND verified guardian
        with self.captureOnCommitCallbacks(execute=True):
            self.client.patch(f'/api/incidents/{iid}/status/', {'status': 'RESOLVED', 'note': 'Safe now'}, format='json')
        self.assertTrue(
            Notification.objects.filter(
                incident_id=iid, recipient=self.guard1, event_type='STATUS_CHANGED', channel='in_app'
            ).exists()
        )

        # 8. Filters (?type=alerts|updates), unread-count, mark one, mark all read
        self.client.force_authenticate(self.adm1)
        alerts = self.client.get('/api/notifications/?type=alerts')
        self.assertEqual(alerts.status_code, 200)
        self.assertTrue(all(n['event_type'] in ('INCIDENT_REPORTED', 'ESCALATED') for n in alerts.data))

        updates = self.client.get('/api/notifications/?type=updates')
        self.assertEqual(updates.status_code, 200)
        self.assertTrue(all(n['event_type'] in ('INCIDENT_ASSIGNED', 'STATUS_CHANGED', 'EVIDENCE_ADDED') for n in updates.data))

        self.client.force_authenticate(self.res1)
        uc = self.client.get('/api/notifications/unread-count/')
        self.assertEqual(uc.status_code, 200)
        initial_unread = uc.data['unread_count']
        self.assertGreaterEqual(initial_unread, 3)

        first_note = Notification.objects.filter(recipient=self.res1, channel='in_app', is_read=False).first()
        self.assertEqual(self.client.patch(f'/api/notifications/{first_note.pk}/read/').status_code, 200)
        self.assertEqual(self.client.get('/api/notifications/unread-count/').data['unread_count'], initial_unread - 1)

        ra = self.client.post('/api/notifications/read-all/')
        self.assertEqual(ra.status_code, 200)
        self.assertEqual(ra.data['marked_read'], initial_unread - 1)
        self.assertEqual(self.client.get('/api/notifications/unread-count/').data['unread_count'], 0)
        # History never deleted
        self.assertGreaterEqual(Notification.objects.filter(recipient=self.res1).count(), initial_unread)


class NotificationRollbackTransactionTests(APITransactionTestCase):
    def test_rolled_back_incident_transaction_never_notifies(self):
        soc1, block1 = make_society('Rollback Soc', 'M3RB1')
        adm = make_user('rb_adm', 'admin')
        soc1.admin = adm
        soc1.save()
        res = make_user('rb_res', 'resident')
        place_resident(res, block1, '101')

        with mock.patch('notifications.services.send_via_provider') as mock_send:
            try:
                with transaction.atomic():
                    inc = Incident.objects.create(resident=res, title='Will rollback', category='fire')
                    transaction.on_commit(lambda: notify_incident(inc))
                    raise RuntimeError('Simulated DB error before commit')
            except RuntimeError:
                pass

        self.assertEqual(Incident.objects.filter(title='Will rollback').count(), 0)
        self.assertEqual(Notification.objects.count(), 0)
        mock_send.assert_not_called()

