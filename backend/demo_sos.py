import os
import django

os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'config.settings')
django.setup()

from django.contrib.auth import get_user_model
from rest_framework.test import APIClient
from contacts.models import EmergencyContact

User = get_user_model()


def get_user(name, role):
    user, created = User.objects.get_or_create(
        email=f'{name}@demo.com',
        defaults={'username': name, 'phone': '9999999999', 'role': role},
    )
    if created:
        user.set_password('Pass12345!')
        user.save()
    return user


def client_for(user):
    c = APIClient(HTTP_HOST='localhost')
    c.force_authenticate(user)
    return c


resident = get_user('demo_resident', 'resident')
guardian = get_user('demo_guardian', 'guardian')
security = get_user('demo_security', 'security')
volunteer = get_user('demo_volunteer', 'volunteer')

EmergencyContact.objects.get_or_create(
    resident=resident, contact_type='primary_guardian',
    defaults={
        'linked_user': guardian, 'name': 'Demo Guardian',
        'phone': '8888888888', 'email': 'demo_guardian@demo.com',
    },
)

print('\n--- 1. Resident triggers SOS ---')
r = client_for(resident).post(
    '/api/sos/',
    {'category': 'medical', 'message': 'Chest pain, please help',
     'latitude': '16.506200', 'longitude': '80.648000', 'location_text': 'Flat 101, Block A'},
)
print(r.status_code, r.data)
alert_id = r.data['id']

print('\n--- 2. Security acknowledges ---')
r = client_for(security).post(f'/api/sos/{alert_id}/respond/', {'status': 'on_the_way', 'note': 'Leaving now'})
print(r.status_code, r.data)

print('\n--- 3. Security resolves ---')
r = client_for(security).post(f'/api/sos/{alert_id}/respond/', {'status': 'resolved', 'note': 'Resident is safe'})
print(r.status_code, r.data)

print('\n--- 4. Delivery tracking ---')
r = client_for(resident).get(f'/api/sos/{alert_id}/delivery/')
print('total:', r.data['total'], '| sent:', r.data['sent'], '| failed:', r.data['failed'])

print('\n--- 5. Final alert status ---')
r = client_for(resident).get(f'/api/sos/{alert_id}/')
print(r.data['status'])