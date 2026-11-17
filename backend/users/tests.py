from django.contrib.auth import get_user_model
from django.core.cache import cache
from django.core.management import call_command
from django.db import IntegrityError, transaction
from io import StringIO
from rest_framework.test import APITestCase

User = get_user_model()


class UserRegistrationAndLookupTests(APITestCase):
    def setUp(self):
        cache.clear()
        self.resident = User.objects.create_user(
            username='asha.rao',
            email='asha@test.local',
            password='Password123!',
            first_name='Asha',
            last_name='Rao',
            phone='9876543210',
            role='resident',
        )
        self.guardian = User.objects.create_user(
            username='Ravi_Kumar',
            email='ravi@test.local',
            password='Password123!',
            first_name='Ravi',
            last_name='Kumar',
            phone='+91 98765-00001',
            role='guardian',
        )
        self.inactive_user = User.objects.create_user(
            username='inactive_guard',
            email='inactive@test.local',
            password='Password123!',
            first_name='Inactive',
            last_name='User',
            phone='9876599999',
            role='guardian',
            is_active=False,
        )

    def test_phone_normalized_on_save_and_unique_db_constraints(self):
        self.assertEqual(self.resident.phone, '+919876543210')
        self.assertEqual(self.guardian.phone, '+919876500001')

        # DB enforces case-insensitive username uniqueness
        with self.assertRaises(IntegrityError):
            with transaction.atomic():
                User.objects.create_user(
                    username='ASHA.RAO',
                    email='dup1@test.local',
                    password='Password123!',
                    phone='9000011111',
                )

        # DB enforces normalized phone uniqueness
        with self.assertRaises(IntegrityError):
            with transaction.atomic():
                User.objects.create_user(
                    username='unique_name',
                    email='dup2@test.local',
                    password='Password123!',
                    phone='9876543210',
                )

    def test_register_validation_and_duplicate_errors(self):
        # Missing phone rejected
        r = self.client.post('/api/auth/register/', {
            'username': 'new_res',
            'email': 'new@test.local',
            'first_name': 'New',
            'last_name': 'Res',
            'role': 'resident',
            'password': 'Password123!',
            'confirm_password': 'Password123!',
        }, format='json')
        self.assertEqual(r.status_code, 400)
        self.assertIn('phone', r.data)

        # Case-insensitive duplicate username rejected
        r = self.client.post('/api/auth/register/', {
            'username': 'ASHA.RAO',
            'email': 'new@test.local',
            'first_name': 'New',
            'last_name': 'Res',
            'phone': '9111122222',
            'role': 'resident',
            'password': 'Password123!',
            'confirm_password': 'Password123!',
        }, format='json')
        self.assertEqual(r.status_code, 400)
        self.assertEqual(r.data['username'], ['This username is taken.'])

        # Duplicate phone with different formatting rejected
        r = self.client.post('/api/auth/register/', {
            'username': 'brand_new_user',
            'email': 'new2@test.local',
            'first_name': 'New',
            'last_name': 'User',
            'phone': '+91 98765 43210',
            'role': 'resident',
            'password': 'Password123!',
            'confirm_password': 'Password123!',
        }, format='json')
        self.assertEqual(r.status_code, 400)
        self.assertEqual(r.data['phone'], ['This phone number is already registered.'])

        # Invalid username format rejected
        r = self.client.post('/api/auth/register/', {
            'username': 'bad name!',
            'email': 'new3@test.local',
            'first_name': 'New',
            'last_name': 'User',
            'phone': '9111122223',
            'role': 'resident',
            'password': 'Password123!',
            'confirm_password': 'Password123!',
        }, format='json')
        self.assertEqual(r.status_code, 400)
        self.assertIn('username', r.data)

    def test_profile_update_validation_errors(self):
        self.client.force_authenticate(self.resident)
        r = self.client.patch('/api/auth/profile/', {'username': 'ravi_kumar'}, format='json')
        self.assertEqual(r.status_code, 400)
        self.assertEqual(r.data['username'], ['This username is taken.'])

        r = self.client.patch('/api/auth/profile/', {'phone': '09876500001'}, format='json')
        self.assertEqual(r.status_code, 400)
        self.assertEqual(r.data['phone'], ['This phone number is already registered.'])

        r = self.client.patch('/api/auth/profile/', {'username': 'ab'}, format='json')
        self.assertEqual(r.status_code, 400)
        self.assertIn('username', r.data)

        # Updating own profile with formatted version of own phone succeeds and stays normalized
        r = self.client.patch('/api/auth/profile/', {'phone': '98765 43219'}, format='json')
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r.data['phone'], '+919876543219')

    def test_lookup_exact_match_masked_and_throttled(self):
        # Requires auth
        r_unauth = self.client.get('/api/users/lookup/?identifier=Ravi_Kumar')
        self.assertIn(r_unauth.status_code, (401, 403))

        self.client.force_authenticate(self.resident)

        # Exact case-insensitive username match
        r = self.client.get('/api/users/lookup/?identifier=ravi_kumar')
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r.data, {
            'id': self.guardian.pk,
            'name': 'Ravi Kumar',
            'username': 'Ravi_Kumar',
            'masked_phone': '+91 ******0001',
            'role': 'guardian',
        })
        self.assertNotIn('email', r.data)
        self.assertNotIn('phone', r.data)

        # Exact normalized phone match with spaces / local format
        r_phone = self.client.get('/api/users/lookup/?identifier=98765%2000001')
        self.assertEqual(r_phone.status_code, 200)
        self.assertEqual(r_phone.data['id'], self.guardian.pk)

        # Substring does NOT match (no enumeration/autocomplete)
        r_sub = self.client.get('/api/users/lookup/?identifier=ravi')
        self.assertEqual(r_sub.status_code, 404)
        self.assertEqual(r_sub.data['detail'], 'No account found with that username or phone.')

        # Inactive user NOT returned
        r_inactive = self.client.get('/api/users/lookup/?identifier=inactive_guard')
        self.assertEqual(r_inactive.status_code, 404)

        # Rate limit (20/min -> we already did 4 calls, 17 more hits 429)
        hit_429 = False
        for _ in range(25):
            resp = self.client.get('/api/users/lookup/?identifier=ravi_kumar')
            if resp.status_code == 429:
                hit_429 = True
                break
        self.assertTrue(hit_429)

    def test_report_duplicate_phones_command(self):
        out = StringIO()
        call_command('report_duplicate_phones', stdout=out)
        self.assertIn('valid and unique', out.getvalue())
