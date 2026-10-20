from django.contrib.auth import get_user_model
from rest_framework.test import APITestCase

from .models import SOSAlert

User = get_user_model()


def make_user(name, role):
    return User.objects.create_user(
        username=name, email=f'{name}@test.com', password='Pass12345!',
        phone='9999999999', role=role,
    )


class SOSAlertTests(APITestCase):
    def setUp(self):
        self.resident = make_user('res1', 'resident')
        self.other = make_user('res2', 'resident')
        self.security = make_user('sec1', 'security')

    def test_resident_can_create_sos(self):
        self.client.force_authenticate(self.resident)
        r = self.client.post('/api/sos/', {'category': 'medical', 'message': 'Help'})
        self.assertEqual(r.status_code, 201)
        self.assertEqual(r.data['status'], 'active')

    def test_security_cannot_create_sos(self):
        self.client.force_authenticate(self.security)
        r = self.client.post('/api/sos/', {'category': 'fire'})
        self.assertEqual(r.status_code, 403)

    def test_resident_sees_only_own_alerts(self):
        SOSAlert.objects.create(resident=self.resident, category='fall')
        SOSAlert.objects.create(resident=self.other, category='fire')
        self.client.force_authenticate(self.resident)
        r = self.client.get('/api/sos/')
        self.assertEqual(len(r.data), 1)

    def test_security_sees_all_alerts(self):
        SOSAlert.objects.create(resident=self.resident, category='fall')
        SOSAlert.objects.create(resident=self.other, category='fire')
        self.client.force_authenticate(self.security)
        r = self.client.get('/api/sos/')
        self.assertEqual(len(r.data), 2)

    def test_cancel_alert(self):
        alert = SOSAlert.objects.create(resident=self.resident, category='other')
        self.client.force_authenticate(self.resident)
        r = self.client.post(f'/api/sos/{alert.pk}/cancel/')
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r.data['status'], 'cancelled')
from contacts.models import EmergencyContact
from .models import NotificationLog, InAppNotification


class AlertRoutingTests(APITestCase):
    def setUp(self):
        self.resident = make_user('res1', 'resident')
        self.guardian = make_user('guard1', 'guardian')
        self.security = make_user('sec1', 'security')
        self.volunteer = make_user('vol1', 'volunteer')
        EmergencyContact.objects.create(
            resident=self.resident, linked_user=self.guardian,
            contact_type='primary_guardian', name='Guard One',
            phone='8888888888', email='guard1@test.com',
        )

    def test_sos_notifies_everyone(self):
        self.client.force_authenticate(self.resident)
        r = self.client.post('/api/sos/', {'category': 'medical', 'message': 'Help'})
        self.assertEqual(r.status_code, 201)
        types = set(
            NotificationLog.objects.filter(alert_id=r.data['id'])
            .values_list('recipient_type', flat=True)
        )
        self.assertIn('primary_guardian', types)
        self.assertIn('security', types)
        self.assertIn('volunteer', types)
        self.assertTrue(InAppNotification.objects.filter(user=self.guardian).exists())

    def test_sos_works_without_guardian(self):
        lonely = make_user('res9', 'resident')
        self.client.force_authenticate(lonely)
        r = self.client.post('/api/sos/', {'category': 'fall'})
        self.assertEqual(r.status_code, 201)
class AlertMonitoringTests(APITestCase):
    def setUp(self):
        self.resident = make_user('res1', 'resident')
        self.security = make_user('sec1', 'security')
        self.volunteer = make_user('vol1', 'volunteer')
        self.client.force_authenticate(self.resident)
        r = self.client.post('/api/sos/', {'category': 'medical'})
        self.alert_id = r.data['id']

    def test_security_acknowledges_alert(self):
        self.client.force_authenticate(self.security)
        r = self.client.post(f'/api/sos/{self.alert_id}/respond/', {'status': 'on_the_way'})
        self.assertEqual(r.status_code, 201)
        alert = SOSAlert.objects.get(pk=self.alert_id)
        self.assertEqual(alert.status, 'acknowledged')

    def test_security_resolves_alert(self):
        self.client.force_authenticate(self.security)
        r = self.client.post(f'/api/sos/{self.alert_id}/respond/', {'status': 'resolved'})
        self.assertEqual(r.status_code, 201)
        alert = SOSAlert.objects.get(pk=self.alert_id)
        self.assertEqual(alert.status, 'resolved')
        self.assertIsNotNone(alert.resolved_at)

    def test_resident_cannot_respond(self):
        r = self.client.post(f'/api/sos/{self.alert_id}/respond/', {'status': 'acknowledged'})
        self.assertEqual(r.status_code, 403)

    def test_volunteer_cannot_resolve(self):
        self.client.force_authenticate(self.volunteer)
        r = self.client.post(f'/api/sos/{self.alert_id}/respond/', {'status': 'resolved'})
        self.assertEqual(r.status_code, 403)

    def test_delivery_tracking(self):
        r = self.client.get(f'/api/sos/{self.alert_id}/delivery/')
        self.assertEqual(r.status_code, 200)
        self.assertGreater(r.data['total'], 0)

    def test_notification_center_and_mark_read(self):
        self.client.force_authenticate(self.security)
        r = self.client.get('/api/sos/notifications/')
        self.assertEqual(r.status_code, 200)
        self.assertGreaterEqual(len(r.data), 1)
        note_id = r.data[0]['id']
        r = self.client.post(f'/api/sos/notifications/{note_id}/read/')
        self.assertTrue(r.data['is_read'])