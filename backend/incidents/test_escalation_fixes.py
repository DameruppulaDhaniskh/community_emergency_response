from decimal import Decimal
from django.test import TestCase
from django.utils import timezone
from rest_framework import status
from rest_framework.test import APIClient

from contacts.models import EmergencyContact
from incidents.models import Incident
from society.models import (
    Block,
    Flat,
    ResidentFlatMapping,
    SecurityProfile,
    Society,
    SocietyAssignment,
    VolunteerProfile,
)
from users.models import User


class EscalationFixesTestCase(TestCase):
    def setUp(self):
        self.client = APIClient()

        # Admin user
        self.admin_user = User.objects.create_user(
            username="admin_user",
            email="admin@emerald.org",
            password="Password123!",
            role="admin",
            phone="+919876543200",
            first_name="Admin",
            last_name="User",
        )

        # Create Society, Block, Flat
        self.society = Society.objects.create(
            name="Emerald Palms",
            city="Bengaluru",
            latitude=Decimal("12.971600"),
            longitude=Decimal("77.594600"),
            is_active=True,
            admin=self.admin_user,
        )
        self.block = Block.objects.create(
            society=self.society,
            name="Tower A",
            total_floors=10,
        )
        self.flat = Flat.objects.create(
            block=self.block,
            flat_number="101",
            floor=1,
        )

        SocietyAssignment.objects.create(
            user=self.admin_user,
            society=self.society,
            is_active=True,
        )

    def test_public_cascading_endpoints(self):
        # GET /api/public/societies/
        res = self.client.get("/api/public/societies/")
        self.assertEqual(res.status_code, status.HTTP_200_OK)
        data = res.json()
        self.assertTrue(any(s["id"] == self.society.id for s in data))

        # GET /api/public/societies/<id>/blocks/
        res = self.client.get(f"/api/public/societies/{self.society.id}/blocks/")
        self.assertEqual(res.status_code, status.HTTP_200_OK)
        blocks = res.json()
        self.assertTrue(any(b["id"] == self.block.id for b in blocks))

        # GET /api/public/blocks/<id>/flats/
        res = self.client.get(f"/api/public/blocks/{self.block.id}/flats/")
        self.assertEqual(res.status_code, status.HTTP_200_OK)
        flats = res.json()
        self.assertTrue(any(f["id"] == self.flat.id for f in flats))

    def test_resident_registration_links_society(self):
        payload = {
            "username": "new_resident",
            "email": "resident@example.com",
            "first_name": "Rohan",
            "last_name": "Mehta",
            "phone": "+919876543201",
            "password": "Password123!",
            "confirm_password": "Password123!",
            "role": "resident",
            "society_id": self.society.id,
            "block_id": self.block.id,
            "flat_id": self.flat.id,
            "home_latitude": 12.971650,
            "home_longitude": 77.594650,
            "home_label": "Tower A, 101",
        }
        res = self.client.post("/api/auth/register/", payload, format="json")
        self.assertEqual(res.status_code, status.HTTP_201_CREATED)

        user = User.objects.get(username="new_resident")
        mapping = ResidentFlatMapping.objects.filter(user=user, is_active=True).first()
        self.assertIsNotNone(mapping)
        self.assertEqual(mapping.flat_id, self.flat.id)
        self.assertEqual(mapping.home_label, "Tower A, 101")
        self.assertAlmostEqual(float(mapping.home_latitude), 12.971650, places=4)

    def test_volunteer_registration_and_admin_approval(self):
        payload = {
            "username": "new_volunteer",
            "email": "volunteer@example.com",
            "first_name": "Vikram",
            "last_name": "Singh",
            "phone": "+919876543202",
            "password": "Password123!",
            "confirm_password": "Password123!",
            "role": "volunteer",
            "society_id": self.society.id,
            "base_latitude": 12.971700,
            "base_longitude": 77.594700,
            "area_label": "Clubhouse Area",
            "max_travel_km": 3.5,
            "serves_nearby_societies": True,
        }
        res = self.client.post("/api/auth/register/", payload, format="json")
        self.assertEqual(res.status_code, status.HTTP_201_CREATED)

        user = User.objects.get(username="new_volunteer")
        vp = VolunteerProfile.objects.filter(user=user).first()
        self.assertIsNotNone(vp)
        self.assertEqual(vp.approval_status, "pending")
        self.assertEqual(vp.area_label, "Clubhouse Area")
        self.assertEqual(vp.max_travel_km, Decimal("3.50"))

        # Admin approves via /api/admin/volunteers/<id>/approve/
        self.client.force_authenticate(user=self.admin_user)
        approve_res = self.client.post(f"/api/admin/volunteers/{vp.id}/approve/", {})
        self.assertEqual(approve_res.status_code, status.HTTP_200_OK)
        vp.refresh_from_db()
        self.assertEqual(vp.approval_status, "approved")

    def test_security_registration_and_duty_toggle(self):
        payload = {
            "username": "gate_guard",
            "email": "guard@emerald.org",
            "first_name": "Ramesh",
            "last_name": "Kumar",
            "phone": "+919876543203",
            "password": "Password123!",
            "confirm_password": "Password123!",
            "role": "security",
            "society_id": self.society.id,
            "post_label": "North Gate",
        }
        res = self.client.post("/api/auth/register/", payload, format="json")
        self.assertEqual(res.status_code, status.HTTP_201_CREATED)

        user = User.objects.get(username="gate_guard")
        sp = SecurityProfile.objects.filter(user=user).first()
        self.assertIsNotNone(sp)
        self.assertEqual(sp.post_label, "North Gate")
        self.assertEqual(sp.approval_status, "pending")

        # Admin approves security staff via /api/admin/security/<id>/approve/
        self.client.force_authenticate(user=self.admin_user)
        approve_res = self.client.post(f"/api/admin/security/{sp.id}/approve/", {"note": "Verified badge"})
        self.assertEqual(approve_res.status_code, status.HTTP_200_OK)
        sp.refresh_from_db()
        self.assertEqual(sp.approval_status, "approved")

        # Security staff duty toggle
        self.client.force_authenticate(user=user)
        duty_get = self.client.get("/api/security/duty/")
        self.assertEqual(duty_get.status_code, status.HTTP_200_OK)
        self.assertFalse(duty_get.json()["on_duty"])

        duty_patch = self.client.patch("/api/security/duty/", {"on_duty": True}, format="json")
        self.assertEqual(duty_patch.status_code, status.HTTP_200_OK)
        self.assertTrue(duty_patch.json()["on_duty"])

        sa = SocietyAssignment.objects.filter(user=user, society=self.society).first()
        self.assertIsNotNone(sa)
        self.assertTrue(sa.is_available)

    def test_security_sos_acknowledgement(self):
        # Create resident with flat mapping
        resident = User.objects.create_user(
            username="res_user",
            email="res@emerald.org",
            password="Password123!",
            role="resident",
            phone="+919876543204",
            first_name="Asha",
            last_name="Rao",
        )
        ResidentFlatMapping.objects.create(
            user=resident,
            flat=self.flat,
            is_active=True,
        )

        # Create security guard
        security_user = User.objects.create_user(
            username="sec_guard_1",
            email="sec1@emerald.org",
            password="Password123!",
            role="security",
            phone="+919876543205",
            first_name="Suresh",
            last_name="Guard",
        )
        SecurityProfile.objects.create(
            user=security_user,
            society=self.society,
            post_label="Main Gate",
            approval_status="approved",
        )
        SocietyAssignment.objects.create(
            user=security_user,
            society=self.society,
            is_active=True,
            is_available=True,
        )

        # Resident creates SOS incident
        incident = Incident.objects.create(
            resident=resident,
            title="Medical Emergency",
            category="medical",
            emergency_type="medical",
            status="REPORTED",
            escalate_at=timezone.now() + timezone.timedelta(minutes=2),
        )

        # Security user acknowledges SOS ("Acknowledge, I'm going")
        self.client.force_authenticate(user=security_user)
        ack_res = self.client.post(f"/api/incidents/{incident.id}/security-ack/")
        self.assertEqual(ack_res.status_code, status.HTTP_200_OK)

        incident.refresh_from_db()
        self.assertEqual(incident.status, "ACKNOWLEDGED")
        self.assertIsNotNone(incident.acknowledged_at)
        self.assertIsNone(incident.escalate_at)  # 2-min auto-escalation cancelled

    def test_nearby_volunteers_search_and_sanitization(self):
        resident = User.objects.create_user(
            username="res_search",
            email="res_search@emerald.org",
            password="Password123!",
            role="resident",
            phone="+919876543206",
            first_name="Pooja",
            last_name="Nair",
        )
        ResidentFlatMapping.objects.create(
            user=resident,
            flat=self.flat,
            is_active=True,
        )

        # Approved Volunteer
        vol_user = User.objects.create_user(
            username="vol_search_1",
            first_name="Aarav",
            last_name="Sharma",
            email="vol_search@emerald.org",
            password="Password123!",
            role="volunteer",
            phone="+919876543207",
        )
        VolunteerProfile.objects.create(
            user=vol_user,
            society=self.society,
            block=self.block,
            latitude=Decimal("12.971620"),
            longitude=Decimal("77.594620"),
            area_label="Tower A Lobby",
            approval_status="approved",
        )
        SocietyAssignment.objects.create(
            user=vol_user,
            society=self.society,
            is_active=True,
            is_available=True,
        )

        # Guardian user
        guardian = User.objects.create_user(
            username="guardian_user",
            email="guard@emerald.org",
            password="Password123!",
            role="guardian",
            phone="+919876543208",
            first_name="Manoj",
            last_name="Guardian",
        )
        EmergencyContact.objects.create(
            resident=resident,
            linked_user=guardian,
            name="Guardian Test",
            phone="+919876543208",
            contact_type="primary_guardian",
            relationship="friend",
            status="accepted",
            is_verified=True,
        )

        incident = Incident.objects.create(
            resident=resident,
            title="Fall Incident",
            category="fall",
            emergency_type="fall",
            status="REPORTED",
            latitude=Decimal("12.971600"),
            longitude=Decimal("77.594600"),
        )

        self.client.force_authenticate(user=guardian)
        search_res = self.client.get(f"/api/incidents/{incident.id}/nearby-volunteers/?radius_km=3.0")
        self.assertEqual(search_res.status_code, status.HTTP_200_OK)
        candidates = search_res.json()
        self.assertTrue(len(candidates) >= 1)

        candidate = candidates[0]
        self.assertEqual(candidate["username"], "vol_search_1")
        self.assertEqual(candidate["block_name"], "Tower A")
        self.assertTrue(candidate["same_block"])
        # Privacy check: Phone number and exact GPS coordinates must not be present
        self.assertNotIn("phone", candidate)
        self.assertNotIn("latitude", candidate)
        self.assertNotIn("longitude", candidate)

    def test_escalation_diagnostics(self):
        resident = User.objects.create_user(
            username="res_diag",
            email="res_diag@emerald.org",
            password="Password123!",
            role="resident",
            phone="+919876543209",
            first_name="Deepak",
            last_name="Verma",
        )
        ResidentFlatMapping.objects.create(
            user=resident,
            flat=self.flat,
            is_active=True,
        )

        incident = Incident.objects.create(
            resident=resident,
            title="Fire Alert",
            category="fire",
            emergency_type="fire",
            status="REPORTED",
        )

        self.client.force_authenticate(user=resident)
        diag_res = self.client.get(f"/api/incidents/{incident.id}/escalation-diagnostics/")
        self.assertEqual(diag_res.status_code, status.HTTP_200_OK)
        diag = diag_res.json()
        self.assertTrue(diag["resident"]["society_linked"])
        self.assertEqual(diag["resident"]["society_name"], "Emerald Palms")
        self.assertEqual(diag["resident"]["flat_number"], "101")
        self.assertIn("guardians", diag)
        self.assertIn("security", diag)
        self.assertIn("volunteers", diag)
        self.assertIn("escalation_status", diag)

    def test_sos_high_precision_gps_coordinates(self):
        """Test that SOS dispatch accepts high-precision browser GPS coordinates without 400 errors."""
        resident = User.objects.create_user(
            username="res_high_gps",
            email="res_high_gps@emerald.org",
            password="Password123!",
            role="resident",
            phone="+919876543299",
            first_name="Anita",
            last_name="Roy",
        )
        ResidentFlatMapping.objects.create(
            user=resident,
            flat=self.flat,
            is_active=True,
        )

        self.client.force_authenticate(user=resident)
        # Coordinates with 10+ decimal digits, exactly as returned by browser HTML5 Geolocation
        sos_payload = {
            "emergency_type": "medical",
            "description": "High precision GPS test",
            "latitude": "12.9715987654321",
            "longitude": "77.5945627891234",
            "location_accuracy": 15,
        }
        res = self.client.post("/api/incidents/sos/", data=sos_payload, format="json")
        self.assertEqual(res.status_code, status.HTTP_201_CREATED, res.data)
        data = res.json()
        self.assertTrue(data["location_available"])

        incident = Incident.objects.get(pk=data["id"])
        # Should be quantized to 6 decimal places safely
        self.assertEqual(incident.latitude, Decimal("12.971599"))
        self.assertEqual(incident.longitude, Decimal("77.594563"))
