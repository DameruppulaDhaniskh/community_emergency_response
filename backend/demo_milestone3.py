import io
import os
import django
from PIL import Image

os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'config.settings')
django.setup()

from django.contrib.auth import get_user_model
from django.core.files.uploadedfile import SimpleUploadedFile
from rest_framework.test import APIClient

from contacts.models import EmergencyContact
from society.models import (
    Block, Flat, ResidentFlatMapping, Society, SocietyAlertPolicy, SocietyAssignment,
)

User = get_user_model()
PASS = 'DemoPass123!'


def make_user(email, username, first_name, last_name, phone, role):
    u, _ = User.objects.get_or_create(
        email=email,
        defaults={
            'username': username, 'first_name': first_name, 'last_name': last_name,
            'phone': phone, 'role': role,
        },
    )
    u.role = role
    u.set_password(PASS)
    u.save()
    return u


def login_client(email):
    c = APIClient(HTTP_HOST='localhost')
    res = c.post('/api/auth/login/', {'email': email, 'password': PASS}, format='json')
    assert res.status_code == 200, f'Login failed for {email}: {res.status_code} {res.data}'
    c.credentials(HTTP_AUTHORIZATION=f"Bearer {res.data['access']}")
    return c


def make_png_upload(name='evidence.png'):
    buf = io.BytesIO()
    Image.new('RGB', (40, 40), color=(217, 56, 30)).save(buf, format='PNG')
    return SimpleUploadedFile(name, buf.getvalue(), content_type='image/png')


# Setup isolated demo fixtures
admin = make_user('m3_admin@demo.local', 'm3_admin', 'Vikram', 'Admin', '9000000001', 'admin')
other_admin = make_user('m3_other_admin@demo.local', 'm3_other_admin', 'Other', 'Admin', '9000000009', 'admin')
resident = make_user('m3_res@demo.local', 'm3_res', 'Asha', 'Resident', '9000000002', 'resident')
outsider = make_user('m3_out@demo.local', 'm3_out', 'Neha', 'Outsider', '9000000003', 'resident')
volunteer = make_user('m3_vol@demo.local', 'm3_vol', 'Priya', 'Volunteer', '9000000004', 'volunteer')
guardian = make_user('m3_guard@demo.local', 'm3_guard', 'Ravi', 'Guardian', '9000000005', 'guardian')
security = make_user('m3_sec@demo.local', 'm3_sec', 'Suresh', 'Security', '9000000006', 'security')

soc1, _ = Society.objects.get_or_create(
    registration_number='M3-DEMO-SOC1',
    defaults={
        'name': 'M3 Demo Society', 'address': 'MG Road', 'city': 'Bengaluru',
        'state': 'Karnataka', 'pincode': '560001',
        'contact_email': 'soc1@demo.local', 'contact_phone': '9000000010', 'admin': admin,
    },
)
if soc1.admin_id != admin.pk:
    soc1.admin = admin
    soc1.save()

soc2, _ = Society.objects.get_or_create(
    registration_number='M3-DEMO-SOC2',
    defaults={
        'name': 'M3 Other Society', 'address': 'Park St', 'city': 'Bengaluru',
        'state': 'Karnataka', 'pincode': '560002',
        'contact_email': 'soc2@demo.local', 'contact_phone': '9000000020', 'admin': other_admin,
    },
)

blk1, _ = Block.objects.get_or_create(society=soc1, name='A')
flat1, _ = Flat.objects.get_or_create(block=blk1, flat_number='M3-101')
ResidentFlatMapping.objects.get_or_create(user=resident, flat=flat1, defaults={'is_active': True})

blk2, _ = Block.objects.get_or_create(society=soc2, name='B')
flat2, _ = Flat.objects.get_or_create(block=blk2, flat_number='M3-201')
ResidentFlatMapping.objects.get_or_create(user=outsider, flat=flat2, defaults={'is_active': True})

SocietyAssignment.objects.update_or_create(
    society=soc1, user=volunteer, defaults={'is_active': True, 'is_available': True},
)
SocietyAssignment.objects.update_or_create(
    society=soc1, user=security, defaults={'is_active': True, 'is_available': True},
)
SocietyAlertPolicy.objects.get_or_create(society=soc1, defaults={'notify_community': False})
EmergencyContact.objects.get_or_create(
    resident=resident, contact_type='primary_guardian', is_active=True,
    defaults={
        'linked_user': guardian, 'name': 'Ravi Guardian', 'phone': guardian.phone,
        'email': guardian.email, 'status': 'accepted', 'is_verified': True, 'is_active': True,
    },
)

res_c = login_client(resident.email)
adm_c = login_client(admin.email)
vol_c = login_client(volunteer.email)
grd_c = login_client(guardian.email)
out_c = login_client(outsider.email)
oadm_c = login_client(other_admin.email)

print('=== 1. Resident reports incident with photo evidence ===')
r = res_c.post('/api/incidents/', {
    'title': 'Water main burst & short circuit in Block A basement',
    'category': 'fire',
    'description': 'Sparking near meter board B2',
    'latitude': '12.971600',
    'longitude': '77.594600',
    'images': make_png_upload(),
}, format='multipart')
print('POST /api/incidents/ ->', r.status_code, r.data)
assert r.status_code == 201
iid = r.data['id']

print('\n=== 2. Admin receives INCIDENT_REPORTED alert ===')
r = adm_c.get('/api/notifications/?type=alerts')
adm_notes = [n for n in r.data if n['incident'] == iid]
print('Admin alert count for incident:', len(adm_notes), '| Sample:', adm_notes[0]['title'])
assert len(adm_notes) >= 1

print('\n=== 3. Unauthorized access refused (403 / 404 matrix) ===')
r_res_assign = res_c.post(f'/api/incidents/{iid}/assign/', {'volunteer_id': volunteer.pk}, format='json')
print('Resident tries to assign ->', r_res_assign.status_code)
assert r_res_assign.status_code == 403

r_out_detail = out_c.get(f'/api/incidents/{iid}/')
print('Outsider resident gets 404 ->', r_out_detail.status_code)
assert r_out_detail.status_code == 404

r_oadm_detail = oadm_c.get(f'/api/incidents/{iid}/')
print('Other society admin gets 404 ->', r_oadm_detail.status_code)
assert r_oadm_detail.status_code == 404

r_vol_before = vol_c.get(f'/api/incidents/{iid}/')
print('Unassigned volunteer gets 404 ->', r_vol_before.status_code)
assert r_vol_before.status_code == 404

print('\n=== 4. Admin checks available volunteers & assigns ===')
r_avail = adm_c.get(f'/api/volunteers/available/?incident_id={iid}')
print('Available volunteers:', r_avail.status_code, r_avail.data)
assert r_avail.status_code == 200 and len(r_avail.data) >= 1

r_assign = adm_c.post(f'/api/incidents/{iid}/assign/', {
    'volunteer_id': volunteer.pk,
    'note': 'Proceed with main breaker shutoff check',
}, format='json')
print('POST /api/incidents/{id}/assign/ ->', r_assign.status_code, 'Status:', r_assign.data['status'], 'Assigned:', r_assign.data['assigned_to'])
assert r_assign.status_code == 200 and r_assign.data['status'] == 'ASSIGNED'

print('\n=== 5. Volunteer notified, lists assigned incidents, starts work, resolves ===')
vol_notes = [n for n in vol_c.get('/api/notifications/').data if n['incident'] == iid]
print('Volunteer notifications for incident:', len(vol_notes), '| Latest:', vol_notes[0]['title'])
assert len(vol_notes) >= 1

vol_list = vol_c.get('/api/volunteer/incidents/')
assert any(i['id'] == iid for i in vol_list.data)
print('Volunteer assigned incidents count:', len(vol_list.data))

r_prog = vol_c.patch(f'/api/incidents/{iid}/status/', {'status': 'IN_PROGRESS', 'note': 'On scene'}, format='json')
print('Volunteer -> IN_PROGRESS:', r_prog.status_code, r_prog.data['status'])
assert r_prog.status_code == 200 and r_prog.data['status'] == 'IN_PROGRESS'

r_bad = vol_c.patch(f'/api/incidents/{iid}/status/', {'status': 'CLOSED'}, format='json')
print('Volunteer illegal -> CLOSED refused:', r_bad.status_code, r_bad.data)
assert r_bad.status_code == 400

r_resv = vol_c.patch(f'/api/incidents/{iid}/status/', {'status': 'RESOLVED', 'note': 'Power isolated and technician notified'}, format='json')
print('Volunteer -> RESOLVED:', r_resv.status_code, r_resv.data['status'])
assert r_resv.status_code == 200 and r_resv.data['status'] == 'RESOLVED'

print('\n=== 6. Resident & Guardian receive updates ===')
res_updates = [n for n in res_c.get('/api/notifications/?type=updates').data if n['incident'] == iid]
grd_notes = [n for n in grd_c.get('/api/notifications/').data if n['incident'] == iid]
print('Resident update notifications:', len(res_updates), '| Guardian RESOLVED notifications:', len(grd_notes))
assert len(res_updates) >= 3
assert len(grd_notes) >= 1

print('\n=== 7. Admin closes incident & history verified ===')
r_close = adm_c.patch(f'/api/incidents/{iid}/status/', {
    'status': 'CLOSED', 'close_reason': 'Verified repaired by facility engineer',
}, format='json')
print('Admin -> CLOSED:', r_close.status_code, r_close.data['status'], '| close_reason:', r_close.data['close_reason'])
assert r_close.status_code == 200 and r_close.data['status'] == 'CLOSED'

r_readonly = adm_c.patch(f'/api/incidents/{iid}/status/', {'status': 'REPORTED'}, format='json')
print('Closed incident edit refused ->', r_readonly.status_code)
assert r_readonly.status_code == 400

r_hist = res_c.get(f'/api/incidents/{iid}/history/')
print('Full Incident History timeline:')
for h in r_hist.data:
    print(f"  - [{h['event_type']}] {h['from_status']} -> {h['to_status']} by {h['changed_by_name']}: {h['note']}")

print('\nALL MILESTONE 3 END-TO-END DEMO FLOWS PASSED!')

