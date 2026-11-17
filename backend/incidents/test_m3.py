import io

from django.core.files.uploadedfile import SimpleUploadedFile
from PIL import Image
from rest_framework.test import APITestCase

from contacts.models import EmergencyContact
from society.models import SocietyAssignment

from .models import Incident, IncidentEvidence, IncidentHistory
from .tests import make_society, make_user, place_resident


def make_test_image(name='photo.png', fmt='PNG', size=(32, 32)):
    buf = io.BytesIO()
    Image.new('RGB', size, color=(217, 56, 30)).save(buf, format=fmt)
    ctype = 'image/png' if fmt == 'PNG' else 'image/jpeg'
    return SimpleUploadedFile(name, buf.getvalue(), content_type=ctype)


class IncidentReportAndEvidenceTests(APITestCase):
    def setUp(self):
        self.soc1, block1 = make_society('Green Meadows', 'M3REG1')
        self.res1 = make_user('m3_res1', 'resident')
        self.res2 = make_user('m3_res2', 'resident')
        self.adm1 = make_user('m3_adm1', 'admin')
        self.guard1 = make_user('m3_guard1', 'guardian')
        self.sec1 = make_user('m3_sec1', 'security')
        self.vol1 = make_user('m3_vol1', 'volunteer')

        self.soc1.admin = self.adm1
        self.soc1.save()
        place_resident(self.res1, block1, '101')
        SocietyAssignment.objects.create(society=self.soc1, user=self.sec1)
        SocietyAssignment.objects.create(society=self.soc1, user=self.vol1)
        EmergencyContact.objects.create(
            resident=self.res1, linked_user=self.guard1,
            contact_type='primary_guardian', name='Guard 1',
            phone='8888888888', status='accepted', is_verified=True,
        )

    def test_resident_reports_form_incident_with_images_and_history(self):
        self.client.force_authenticate(self.res1)
        with self.captureOnCommitCallbacks(execute=True):
            r = self.client.post(
                '/api/incidents/',
                {
                    'title': 'Water pipe burst in utility shaft',
                    'category': 'other',
                    'description': 'Water entering lift lobby',
                    'latitude': '12.971600',
                    'longitude': '77.594600',
                    'images': [make_test_image('p1.png'), make_test_image('p2.jpg', 'JPEG')],
                },
                format='multipart',
            )
        self.assertEqual(r.status_code, 201)
        self.assertEqual(r.data['status'], 'REPORTED')
        self.assertTrue(r.data['location_available'])
        self.assertEqual(r.data['evidence_count'], 2)

        iid = r.data['id']
        inc = Incident.objects.get(pk=iid)
        self.assertEqual(inc.title, 'Water pipe burst in utility shaft')
        self.assertEqual(inc.category, 'other')
        self.assertEqual(inc.reported_by, self.res1)
        self.assertEqual(inc.evidence.count(), 2)
        self.assertEqual(inc.history.count(), 1)
        self.assertEqual(inc.history.first().event_type, 'created')

        detail = self.client.get(f'/api/incidents/{iid}/')
        self.assertEqual(detail.status_code, 200)
        self.assertEqual(detail.data['reporter']['name'], 'm3_res1')
        self.assertEqual(len(detail.data['evidence_urls']), 2)
        self.assertEqual(detail.data['history_summary']['total_events'], 1)
        self.assertTrue(detail.data['location']['available'])

    def test_sos_creates_auto_title_and_history(self):
        self.client.force_authenticate(self.res1)
        with self.captureOnCommitCallbacks(execute=True):
            r = self.client.post('/api/incidents/sos/', {'emergency_type': 'medical'})
        self.assertEqual(r.status_code, 201)
        self.assertEqual(r.data['status'], 'REPORTED')
        inc = Incident.objects.get(pk=r.data['id'])
        self.assertIn('SOS:', inc.title)
        self.assertEqual(inc.reported_by, self.res1)
        self.assertEqual(inc.history.filter(event_type='created').count(), 1)

    def test_invalid_report_submissions_rejected(self):
        self.client.force_authenticate(self.res1)
        # Missing title
        r = self.client.post('/api/incidents/', {'category': 'fire'}, format='multipart')
        self.assertEqual(r.status_code, 400)

        # Bad category
        r = self.client.post('/api/incidents/', {'title': 'Valid title', 'category': 'meteor'}, format='multipart')
        self.assertEqual(r.status_code, 400)

        # Bad image file
        bad_file = SimpleUploadedFile('malware.jpg', b'not-an-image-bytes', content_type='image/jpeg')
        r = self.client.post(
            '/api/incidents/',
            {'title': 'Valid', 'category': 'fire', 'images': bad_file},
            format='multipart',
        )
        self.assertEqual(r.status_code, 400)

        # Oversized image (> 5 MB)
        big_file = SimpleUploadedFile('huge.png', b'x' * (5 * 1024 * 1024 + 10), content_type='image/png')
        r = self.client.post(
            '/api/incidents/',
            {'title': 'Huge upload', 'category': 'fire', 'images': big_file},
            format='multipart',
        )
        self.assertEqual(r.status_code, 400)

        # Too many images (> 5)
        too_many = [make_test_image(f'img{i}.png') for i in range(6)]
        r = self.client.post(
            '/api/incidents/',
            {'title': 'Six images', 'category': 'fire', 'images': too_many},
            format='multipart',
        )
        self.assertEqual(r.status_code, 400)

        # Wrong roles cannot create report
        for u in (self.guard1, self.adm1, self.sec1, self.vol1):
            self.client.force_authenticate(u)
            r = self.client.post('/api/incidents/', {'title': 'Blocked', 'category': 'fire'}, format='multipart')
            self.assertEqual(r.status_code, 403)

    def test_evidence_endpoint_rules_and_limits(self):
        inc = Incident.objects.create(resident=self.res1, title='Broken gate', category='security')

        # Non-reporter admin/security get 403; outsider resident gets 404
        for role_user, code in ((self.adm1, 403), (self.sec1, 403), (self.res2, 404)):
            self.client.force_authenticate(role_user)
            r = self.client.post(
                f'/api/incidents/{inc.pk}/evidence/',
                {'image': make_test_image('x.png')},
                format='multipart',
            )
            self.assertEqual(r.status_code, code)

        # Reporter can upload up to 5 images
        self.client.force_authenticate(self.res1)
        r = self.client.post(
            f'/api/incidents/{inc.pk}/evidence/',
            {'images': [make_test_image(f'e{i}.png') for i in range(4)]},
            format='multipart',
        )
        self.assertEqual(r.status_code, 201)
        self.assertEqual(IncidentEvidence.objects.filter(incident=inc).count(), 4)
        self.assertTrue(IncidentHistory.objects.filter(incident=inc, event_type='evidence_added').exists())

        # Adding 2 more (4 + 2 = 6 > 5) must fail 400
        r = self.client.post(
            f'/api/incidents/{inc.pk}/evidence/',
            {'images': [make_test_image('e5.png'), make_test_image('e6.png')]},
            format='multipart',
        )
        self.assertEqual(r.status_code, 400)

        # Closed incident rejects evidence upload
        inc.status = 'CLOSED'
        inc.close_reason = 'Done'
        inc.save()
        r = self.client.post(
            f'/api/incidents/{inc.pk}/evidence/',
            {'image': make_test_image('late.png')},
            format='multipart',
        )
        self.assertEqual(r.status_code, 400)


class IncidentFilterPaginationAndWorkflowTests(APITestCase):
    def setUp(self):
        self.soc1, block1 = make_society('Green Meadows', 'M3W1')
        self.soc2, block2 = make_society('Lake View', 'M3W2')

        self.adm1 = make_user('w_adm1', 'admin')
        self.adm2 = make_user('w_adm2', 'admin')
        self.soc1.admin = self.adm1
        self.soc1.save()
        self.soc2.admin = self.adm2
        self.soc2.save()

        self.res1 = make_user('w_res1', 'resident')
        self.res2 = make_user('w_res2', 'resident')
        place_resident(self.res1, block1, '101')
        place_resident(self.res2, block2, '201')

        self.sec1 = make_user('w_sec1', 'security')
        self.sec2 = make_user('w_sec2', 'security')
        SocietyAssignment.objects.create(society=self.soc1, user=self.sec1)
        SocietyAssignment.objects.create(society=self.soc2, user=self.sec2)

        self.vol1 = make_user('w_vol1', 'volunteer')
        self.vol_busy_off = make_user('w_vol_off', 'volunteer')
        self.vol_other = make_user('w_vol_other', 'volunteer')
        SocietyAssignment.objects.create(society=self.soc1, user=self.vol1, is_available=True)
        SocietyAssignment.objects.create(society=self.soc1, user=self.vol_busy_off, is_available=False)
        SocietyAssignment.objects.create(society=self.soc2, user=self.vol_other, is_available=True)

        self.guard_ok = make_user('w_guard', 'guardian')
        EmergencyContact.objects.create(
            resident=self.res1, linked_user=self.guard_ok,
            contact_type='primary_guardian', name='Guard Ok',
            phone='9888888888', status='accepted', is_verified=True,
        )

    def test_filters_search_ordering_and_pagination(self):
        i1 = Incident.objects.create(resident=self.res1, title='Alpha Fire', category='fire', status='REPORTED')
        i2 = Incident.objects.create(resident=self.res1, title='Beta Fall', category='fall', status='ASSIGNED', assigned_to=self.vol1)
        i3 = Incident.objects.create(resident=self.res1, title='Gamma Medical', category='medical', status='RESOLVED', assigned_to=self.vol1)
        Incident.objects.create(resident=self.res2, title='Other Society', category='fire', status='REPORTED')

        self.client.force_authenticate(self.adm1)
        # Filter by status + category + assigned_to + search
        r = self.client.get('/api/incidents/?category=fire')
        self.assertEqual([x['id'] for x in r.data], [i1.pk])

        r = self.client.get('/api/incidents/?assigned_to=unassigned')
        self.assertEqual([x['id'] for x in r.data], [i1.pk])

        r = self.client.get(f'/api/incidents/?assigned_to={self.vol1.pk}&status=ASSIGNED')
        self.assertEqual([x['id'] for x in r.data], [i2.pk])

        r = self.client.get('/api/incidents/?search=Gamma')
        self.assertEqual([x['id'] for x in r.data], [i3.pk])

        # Pagination
        r = self.client.get('/api/incidents/?page=1&page_size=2&ordering=created_at')
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r.data['count'], 3)
        self.assertEqual(len(r.data['results']), 2)
        self.assertEqual(r.data['results'][0]['id'], i1.pk)

    def test_full_assignment_reassignment_and_status_lifecycle(self):
        inc = Incident.objects.create(resident=self.res1, title='Power fault', category='other', status='REPORTED')
        IncidentHistory.objects.create(incident=inc, changed_by=self.res1, event_type='created', to_status='REPORTED')

        # 1. Available volunteers endpoint (admin only)
        self.client.force_authenticate(self.res1)
        self.assertEqual(self.client.get(f'/api/volunteers/available/?incident_id={inc.pk}').status_code, 403)

        self.client.force_authenticate(self.adm1)
        avail = self.client.get(f'/api/volunteers/available/?incident_id={inc.pk}')
        self.assertEqual(avail.status_code, 200)
        avail_ids = [v['id'] for v in avail.data]
        self.assertEqual(avail_ids, [self.vol1.pk])
        self.assertEqual(avail.data[0]['open_assignments_count'], 0)

        # 2. Security acknowledges REPORTED -> ACKNOWLEDGED
        self.client.force_authenticate(self.sec1)
        r = self.client.patch(f'/api/incidents/{inc.pk}/status/', {'status': 'ACKNOWLEDGED', 'note': 'Security checked'}, format='json')
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r.data['status'], 'ACKNOWLEDGED')

        # Security cannot skip to RESOLVED or CLOSED
        r_bad = self.client.patch(f'/api/incidents/{inc.pk}/status/', {'status': 'RESOLVED'}, format='json')
        self.assertEqual(r_bad.status_code, 400)

        # 3. Resident & Guardian get 403 on status / assign
        for u in (self.res1, self.guard_ok):
            self.client.force_authenticate(u)
            self.assertEqual(self.client.patch(f'/api/incidents/{inc.pk}/status/', {'status': 'IN_PROGRESS'}, format='json').status_code, 403)
            self.assertEqual(self.client.post(f'/api/incidents/{inc.pk}/assign/', {'volunteer_id': self.vol1.pk}, format='json').status_code, 403)

        # 4. Admin assigns vol1
        self.client.force_authenticate(self.adm1)
        r = self.client.post(f'/api/incidents/{inc.pk}/assign/', {'volunteer_id': self.vol1.pk, 'note': 'Check main panel'}, format='json')
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r.data['status'], 'ASSIGNED')
        self.assertEqual(r.data['assigned_to']['id'], self.vol1.pk)

        # Reassignment before IN_PROGRESS allowed and writes 'reassigned'
        vol2 = make_user('w_vol2', 'volunteer')
        SocietyAssignment.objects.create(society=self.soc1, user=vol2, is_available=True)
        r = self.client.post(f'/api/incidents/{inc.pk}/assign/', {'volunteer_id': vol2.pk, 'note': 'Reassign closer'}, format='json')
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r.data['assigned_to']['id'], vol2.pk)
        self.assertTrue(IncidentHistory.objects.filter(incident=inc, event_type='reassigned').exists())

        # vol1 (no longer assigned) gets 404 on incident detail & status
        self.client.force_authenticate(self.vol1)
        self.assertEqual(self.client.get(f'/api/incidents/{inc.pk}/').status_code, 404)

        # 5. Assigned volunteer (vol2) sees in /api/volunteer/incidents/ and moves ASSIGNED -> IN_PROGRESS -> RESOLVED
        self.client.force_authenticate(vol2)
        v_list = self.client.get('/api/volunteer/incidents/')
        self.assertEqual([x['id'] for x in v_list.data], [inc.pk])

        r = self.client.patch(f'/api/incidents/{inc.pk}/status/', {'status': 'IN_PROGRESS', 'note': 'Working'}, format='json')
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r.data['status'], 'IN_PROGRESS')

        # Reassignment rejected once IN_PROGRESS
        self.client.force_authenticate(self.adm1)
        r = self.client.post(f'/api/incidents/{inc.pk}/assign/', {'volunteer_id': self.vol1.pk}, format='json')
        self.assertEqual(r.status_code, 400)

        # Volunteer cannot close directly
        self.client.force_authenticate(vol2)
        self.assertEqual(self.client.patch(f'/api/incidents/{inc.pk}/status/', {'status': 'CLOSED'}, format='json').status_code, 400)

        r = self.client.patch(f'/api/incidents/{inc.pk}/status/', {'status': 'RESOLVED', 'note': 'Fixed'}, format='json')
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r.data['status'], 'RESOLVED')

        # 6. Admin closes RESOLVED -> CLOSED
        self.client.force_authenticate(self.adm1)
        r = self.client.patch(f'/api/incidents/{inc.pk}/status/', {'status': 'CLOSED', 'close_reason': 'Confirmed'}, format='json')
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r.data['status'], 'CLOSED')

        # Closed incident is read-only
        self.assertEqual(self.client.patch(f'/api/incidents/{inc.pk}/status/', {'status': 'REPORTED'}, format='json').status_code, 400)

        # Timeline check
        hist = self.client.get(f'/api/incidents/{inc.pk}/history/')
        self.assertEqual(hist.status_code, 200)
        self.assertGreaterEqual(len(hist.data), 6)

    def test_assignment_failures_and_admin_shortcuts(self):
        inc = Incident.objects.create(resident=self.res1, title='Lift stuck', category='other', status='REPORTED')
        self.client.force_authenticate(self.adm1)

        # Unavailable volunteer rejected
        r = self.client.post(f'/api/incidents/{inc.pk}/assign/', {'volunteer_id': self.vol_busy_off.pk}, format='json')
        self.assertEqual(r.status_code, 400)

        # Other society volunteer rejected
        r = self.client.post(f'/api/incidents/{inc.pk}/assign/', {'volunteer_id': self.vol_other.pk}, format='json')
        self.assertEqual(r.status_code, 400)

        # Non-volunteer user rejected
        r = self.client.post(f'/api/incidents/{inc.pk}/assign/', {'volunteer_id': self.sec1.pk}, format='json')
        self.assertEqual(r.status_code, 400)

        # Invalid jump REPORTED -> RESOLVED rejected
        r = self.client.patch(f'/api/incidents/{inc.pk}/status/', {'status': 'RESOLVED'}, format='json')
        self.assertEqual(r.status_code, 400)

        # Early close without reason rejected, with reason succeeds
        r = self.client.patch(f'/api/incidents/{inc.pk}/status/', {'status': 'CLOSED'}, format='json')
        self.assertEqual(r.status_code, 400)
        r = self.client.patch(f'/api/incidents/{inc.pk}/status/', {'status': 'CLOSED', 'close_reason': 'Duplicate'}, format='json')
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r.data['close_reason'], 'Duplicate')

    def test_volunteer_availability_and_escalation(self):
        # Volunteer toggles availability
        self.client.force_authenticate(self.vol1)
        r = self.client.patch('/api/volunteer/availability/', {'is_available': False}, format='json')
        self.assertEqual(r.status_code, 200)
        self.assertFalse(r.data['is_available'])
        self.assertFalse(SocietyAssignment.objects.get(user=self.vol1, society=self.soc1).is_available)

        # Invalid type -> 400
        self.assertEqual(self.client.patch('/api/volunteer/availability/', {'is_available': 'yes'}, format='json').status_code, 400)

        # Non-volunteer -> 403
        self.client.force_authenticate(self.res1)
        self.assertEqual(self.client.patch('/api/volunteer/availability/', {'is_available': True}, format='json').status_code, 403)

        # Escalation
        inc = Incident.objects.create(resident=self.res1, title='Gas leak', category='fire', status='REPORTED')
        r = self.client.post(f'/api/incidents/{inc.pk}/escalate/', {'note': 'No response yet'}, format='json')
        self.assertEqual(r.status_code, 200)
        self.assertTrue(r.data['is_escalated'])
        self.assertIsNotNone(r.data['escalated_at'])
        self.assertTrue(IncidentHistory.objects.filter(incident=inc, event_type='escalated').exists())


class HealthAndSchemaTests(APITestCase):
    def test_health_and_openapi_endpoints(self):
        r = self.client.get('/api/health/')
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r.data['status'], 'ok')
        self.assertEqual(r.data['database'], 'connected')

        r_schema = self.client.get('/api/schema/?format=json')
        self.assertEqual(r_schema.status_code, 200)

        r_docs = self.client.get('/api/docs/')
        self.assertEqual(r_docs.status_code, 200)

