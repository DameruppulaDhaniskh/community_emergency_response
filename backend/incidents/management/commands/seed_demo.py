from decimal import Decimal
from django.contrib.auth import get_user_model
from django.core.management.base import BaseCommand
from django.db import transaction
from django.utils import timezone

from contacts.models import EmergencyContact, ResidentSecurityGuard
from incidents.models import Incident, IncidentHistory, ResidentEscalationSettings
from notifications.services import (
    notify_incident,
    notify_incident_assigned,
    notify_status_changed,
)
from society.models import (
    Block,
    Flat,
    ResidentFlatMapping,
    SecurityProfile,
    Society,
    SocietyAlertPolicy,
    SocietyAssignment,
    VolunteerLocation,
    VolunteerProfile,
)

User = get_user_model()

DEMO_PASSWORD = 'password123'


class Command(BaseCommand):
    help = 'Idempotently seed demo societies, users across all roles, multi-tier volunteers, escalation settings, and sample incidents.'

    def _ensure_user(self, email, username, first_name, last_name, phone, role, address=''):
        user, created = User.objects.get_or_create(
            email=email,
            defaults={
                'username': username,
                'first_name': first_name,
                'last_name': last_name,
                'phone': phone,
                'role': role,
                'address': address,
            },
        )
        changed = False
        if user.username != username:
            user.username = username
            changed = True
        if phone and user.phone != phone:
            user.phone = phone
            changed = True
        if created or not user.check_password(DEMO_PASSWORD):
            user.set_password(DEMO_PASSWORD)
            changed = True
        if user.role != role:
            user.role = role
            changed = True
        if not user.is_active:
            user.is_active = True
            changed = True
        if changed:
            user.save()
        return user

    @transaction.atomic
    def handle(self, *args, **options):
        # 1. Management & Security
        admin = self._ensure_user(
            'admin@example.com', 'admin_demo', 'Vikram', 'Mehta',
            '9800000001', 'admin', 'Management Office, Green Meadows',
        )
        admin2 = self._ensure_user(
            'admin2@example.com', 'admin2_demo', 'Sunil', 'Gavaskar',
            '9800000020', 'admin', 'Palm Heights Admin Office',
        )
        security = self._ensure_user(
            'security@example.com', 'security_demo', 'Suresh', 'Nair',
            '9800000002', 'security', 'Main Gate, Green Meadows',
        )

        # 2. Guardians
        guardian = self._ensure_user(
            'ravi@example.com', 'ravi_guardian', 'Ravi', 'Kumar',
            '9800000005', 'guardian', 'Indiranagar, Bengaluru',
        )
        guardian2 = self._ensure_user(
            'neha@example.com', 'neha_guardian', 'Neha', 'Kapoor',
            '9800000006', 'guardian', 'Koramangala, Bengaluru',
        )

        # 3. Residents
        resident = self._ensure_user(
            'asha@example.com', 'asha_resident', 'Asha', 'Rao',
            '9876543210', 'resident', 'Flat 101, Block A, Green Meadows',
        )
        neighbour = self._ensure_user(
            'kiran@example.com', 'kiran_resident', 'Kiran', 'Rao',
            '9876543211', 'resident', 'Flat 204, Block A, Green Meadows',
        )

        # 4. Volunteers V1 - V11
        # Tier 1 (Same block, Block A)
        v1 = self._ensure_user(
            'volunteer@example.com', 'volunteer_demo', 'Priya', 'Sharma',
            '9800000003', 'volunteer', 'Block A, Green Meadows',
        )
        v2 = self._ensure_user(
            'kavita@example.com', 'vol_v2', 'Kavita', 'Patel',
            '9800000012', 'volunteer', 'Block A, Green Meadows',
        )

        # Tier 2 (Same society, Block B)
        v3 = self._ensure_user(
            'volunteer2@example.com', 'volunteer2_demo', 'Arjun', 'Verma',
            '9800000004', 'volunteer', 'Block B, Green Meadows',
        )
        v4 = self._ensure_user(
            'rahul@example.com', 'vol_v4', 'Rahul', 'Sen',
            '9800000014', 'volunteer', 'Block B, Green Meadows',
        )
        v5 = self._ensure_user(
            'deepa@example.com', 'vol_v5', 'Deepa', 'Nair',
            '9800000015', 'volunteer', 'Block B, Green Meadows',
        )

        # Tier 3 (Neighbouring society: Palm Heights)
        v6 = self._ensure_user(
            'manish@example.com', 'vol_v6', 'Manish', 'Das',
            '9800000016', 'volunteer', 'Tower 1, Palm Heights',
        )
        v7 = self._ensure_user(
            'sneha@example.com', 'vol_v7', 'Sneha', 'Iyer',
            '9800000017', 'volunteer', 'Tower 1, Palm Heights',
        )

        # Edge cases:
        v8 = self._ensure_user(
            'amit@example.com', 'vol_v8', 'Amit', 'Roy',
            '9800000018', 'volunteer', 'Block A, Green Meadows',
        )
        v9 = self._ensure_user(
            'pooja@example.com', 'vol_v9', 'Pooja', 'Hegde',
            '9800000019', 'volunteer', 'Block A, Green Meadows',
        )
        v10 = self._ensure_user(
            'rohan@example.com', 'vol_v10', 'Rohan', 'Joshi',
            '9800000021', 'volunteer', 'Block A, Green Meadows',
        )
        v11 = self._ensure_user(
            'karthik@example.com', 'vol_v11', 'Karthik', 'Menon',
            '9800000022', 'volunteer', 'Outer Ring Road, Bengaluru',
        )

        # 5. Society 1: Green Meadows
        society1, _ = Society.objects.get_or_create(
            registration_number='GM-BLR-001',
            defaults={
                'name': 'Green Meadows',
                'address': '100 Feet Road, Indiranagar',
                'city': 'Bengaluru',
                'state': 'Karnataka',
                'pincode': '560038',
                'contact_email': 'office@greenmeadows.local',
                'contact_phone': '08022001122',
                'admin': admin,
                'latitude': Decimal('12.971600'),
                'longitude': Decimal('77.594600'),
            },
        )
        if society1.admin_id != admin.pk or not society1.latitude:
            society1.admin = admin
            society1.latitude = Decimal('12.971600')
            society1.longitude = Decimal('77.594600')
            society1.save()

        # Society 2: Palm Heights (~1.5 km away)
        society2, _ = Society.objects.get_or_create(
            registration_number='PH-BLR-002',
            defaults={
                'name': 'Palm Heights',
                'address': 'HAL 2nd Stage, Indiranagar',
                'city': 'Bengaluru',
                'state': 'Karnataka',
                'pincode': '560038',
                'contact_email': 'office@palmheights.local',
                'contact_phone': '08022003344',
                'admin': admin2,
                'latitude': Decimal('12.982000'),
                'longitude': Decimal('77.604000'),
            },
        )
        if society2.admin_id != admin2.pk or not society2.latitude:
            society2.admin = admin2
            society2.latitude = Decimal('12.982000')
            society2.longitude = Decimal('77.604000')
            society2.save()

        # Alert policies
        policy1, _ = SocietyAlertPolicy.objects.get_or_create(
            society=society1,
            defaults={'notify_community': True, 'include_neighbour_societies': True, 'neighbour_radius_km': 3.0},
        )
        policy1.include_neighbour_societies = True
        policy1.neighbour_radius_km = 3.0
        policy1.save()

        policy2, _ = SocietyAlertPolicy.objects.get_or_create(
            society=society2,
            defaults={'notify_community': True, 'include_neighbour_societies': True, 'neighbour_radius_km': 3.0},
        )

        # Blocks
        block_a, _ = Block.objects.get_or_create(society=society1, name='Block A', defaults={'total_floors': 5})
        block_b, _ = Block.objects.get_or_create(society=society1, name='Block B', defaults={'total_floors': 5})
        block_ph, _ = Block.objects.get_or_create(society=society2, name='Tower 1', defaults={'total_floors': 10})

        # Flats & resident mappings
        flat_101, _ = Flat.objects.get_or_create(block=block_a, flat_number='101', defaults={'floor': 1, 'is_occupied': True})
        flat_204, _ = Flat.objects.get_or_create(block=block_a, flat_number='204', defaults={'floor': 2, 'is_occupied': True})
        Flat.objects.get_or_create(block=block_b, flat_number='301', defaults={'floor': 3, 'is_occupied': False})

        ResidentFlatMapping.objects.get_or_create(
            user=resident, flat=flat_101,
            defaults={'occupancy_type': 'owner', 'is_primary_resident': True, 'is_active': True},
        )
        ResidentFlatMapping.objects.get_or_create(
            user=neighbour, flat=flat_204,
            defaults={'occupancy_type': 'owner', 'is_primary_resident': True, 'is_active': True},
        )

        # Security staff & profiles
        SocietyAssignment.objects.get_or_create(
            society=society1, user=security, defaults={'is_active': True, 'is_available': True},
        )
        SecurityProfile.objects.update_or_create(
            user=security,
            defaults={
                'society': society1,
                'post_label': 'Main Gate & Perimeter',
                'approval_status': 'approved',
                'approval_reviewed_by': admin,
                'approval_reviewed_at': timezone.now(),
            },
        )

        security2 = self._ensure_user(
            'security2@example.com', 'security2_demo', 'Ramesh', 'Kumar',
            '9800000025', 'security', 'South Gate, Green Meadows',
        )
        SocietyAssignment.objects.get_or_create(
            society=society1, user=security2, defaults={'is_active': True, 'is_available': False},
        )
        SecurityProfile.objects.update_or_create(
            user=security2,
            defaults={
                'society': society1,
                'post_label': 'South Gate',
                'approval_status': 'approved',
                'approval_reviewed_by': admin,
                'approval_reviewed_at': timezone.now(),
            },
        )

        # Resident Security Guards for Asha (Society Security + Private Building Guard)
        ResidentSecurityGuard.objects.get_or_create(
            resident=resident,
            linked_user=security,
            guard_type='society_security',
            defaults={
                'name': 'Suresh Nair',
                'phone': security.phone,
                'post_label': 'Main Gate Security',
                'is_active': True,
            },
        )
        ResidentSecurityGuard.objects.get_or_create(
            resident=resident,
            guard_type='building_guard',
            name='Bahadur Singh',
            defaults={
                'phone': '9800000030',
                'post_label': 'Block A Night Guard',
                'is_active': True,
            },
        )

        # Resident Escalation Settings for Asha
        esc_settings, _ = ResidentEscalationSettings.objects.get_or_create(
            resident=resident,
            defaults={
                'has_security_guard': True,
                'escalate_to_security': True,
                'escalate_to_volunteers': True,
                'escalate_to_secondary_guardian': True,
                'response_window_seconds': 120,
                'volunteer_radius_km': 2.0,
            },
        )

        # Verified Emergency Contacts for Asha
        EmergencyContact.objects.get_or_create(
            resident=resident,
            contact_type='primary_guardian',
            defaults={
                'linked_user': guardian,
                'relationship': 'spouse',
                'name': 'Ravi Kumar',
                'phone': guardian.phone,
                'email': 'ravi@example.com',
                'priority': 1,
                'status': 'accepted',
                'is_verified': True,
                'verified_at': timezone.now(),
                'responded_at': timezone.now(),
                'is_active': True,
            },
        )
        EmergencyContact.objects.get_or_create(
            resident=resident,
            contact_type='secondary_guardian',
            defaults={
                'linked_user': guardian2,
                'relationship': 'sibling',
                'name': 'Neha Kapoor',
                'phone': guardian2.phone,
                'email': 'neha@example.com',
                'priority': 2,
                'status': 'accepted',
                'is_verified': True,
                'verified_at': timezone.now(),
                'responded_at': timezone.now(),
                'is_active': True,
            },
        )

        # Setup Volunteer Profiles & Society Assignments
        now = timezone.now()

        def _setup_volunteer(user, soc, blk, lat, lng, live_lat, live_lng, approval='approved', available=True, serves_nbrs=False, stale_live=False):
            SocietyAssignment.objects.update_or_create(
                society=soc, user=user,
                defaults={'is_active': (approval == 'approved'), 'is_available': available},
            )
            vp, _ = VolunteerProfile.objects.update_or_create(
                user=user,
                defaults={
                    'society': soc,
                    'block': blk,
                    'latitude': Decimal(str(lat)) if lat else None,
                    'longitude': Decimal(str(lng)) if lng else None,
                    'approval_status': approval,
                    'approval_reviewed_at': now if approval == 'approved' else None,
                    'approval_reviewed_by': admin if approval == 'approved' else None,
                    'serves_nearby_societies': serves_nbrs,
                    'max_travel_km': 2.0,
                },
            )
            if live_lat and live_lng:
                vloc, _ = VolunteerLocation.objects.update_or_create(
                    user=user,
                    defaults={
                        'latitude': Decimal(str(live_lat)),
                        'longitude': Decimal(str(live_lng)),
                        'accuracy': 10.0,
                    },
                )
                if stale_live:
                    VolunteerLocation.objects.filter(pk=vloc.pk).update(
                        updated_at=now - timezone.timedelta(hours=2)
                    )

        # V1: Block A, live GPS ~100m away (12.9720, 77.5950)
        _setup_volunteer(v1, society1, block_a, '12.9720', '77.5950', '12.9720', '77.5950')
        # V2: Block A, base pin ~200m away (12.9725, 77.5952)
        _setup_volunteer(v2, society1, block_a, '12.9725', '77.5952', None, None)
        # V3: Block B, live GPS ~400m away (12.9735, 77.5960)
        _setup_volunteer(v3, society1, block_b, '12.9735', '77.5960', '12.9735', '77.5960')
        # V4: Block B, live GPS ~600m away (12.9750, 77.5970)
        _setup_volunteer(v4, society1, block_b, '12.9750', '77.5970', '12.9750', '77.5970')
        # V5: Block B, base pin ~800m away (12.9760, 77.5980)
        _setup_volunteer(v5, society1, block_b, '12.9760', '77.5980', None, None)
        # V6: Palm Heights, live GPS ~1.4km away (12.9810, 77.6030), serves neighbours
        _setup_volunteer(v6, society2, block_ph, '12.9810', '77.6030', '12.9810', '77.6030', serves_nbrs=True)
        # V7: Palm Heights, base pin ~1.6km away (12.9825, 77.6045), serves neighbours
        _setup_volunteer(v7, society2, block_ph, '12.9825', '77.6045', None, None, serves_nbrs=True)
        # V8: Block A, unavailable (off-duty)
        _setup_volunteer(v8, society1, block_a, '12.9722', '77.5951', None, None, available=False)
        # V9: Block A, pending approval
        _setup_volunteer(v9, society1, block_a, '12.9723', '77.5953', None, None, approval='pending')
        # V10: Block A, base pin ~250m, stale live GPS > 2 hours ago
        _setup_volunteer(v10, society1, block_a, '12.9726', '77.5955', '13.0500', '77.7000', stale_live=True)
        # V11: Palm Heights, beyond radius (>5km away)
        _setup_volunteer(v11, society2, block_ph, '13.0200', '77.6500', None, None, serves_nbrs=True)

        # Sample Incidents
        samples = [
            {
                'title': 'Demo SOS: Medical checkup assistance',
                'resident': resident,
                'category': 'medical',
                'description': 'Sudden dizziness in living room, door unlocked.',
                'status': 'REPORTED',
                'lat': '12.971600',
                'lng': '77.594600',
            },
            {
                'title': 'Demo Incident: Lobby smoke alarm triggered',
                'resident': resident,
                'category': 'fire',
                'description': 'Smoke near electrical meter room on Block A ground floor.',
                'status': 'ASSIGNED',
                'assigned_to': v1,
                'lat': '12.971800',
                'lng': '77.594900',
            },
            {
                'title': 'Demo Incident: Senior slip on wet stairs',
                'resident': neighbour,
                'category': 'fall',
                'description': 'Need wheelchair support from 2nd floor stairs.',
                'status': 'RESOLVED',
                'assigned_to': v3,
                'lat': '12.971900',
                'lng': '77.595100',
            },
        ]

        for s in samples:
            inc, created = Incident.objects.get_or_create(
                resident=s['resident'],
                title=s['title'],
                defaults={
                    'reported_by': s['resident'],
                    'category': s['category'],
                    'emergency_type': s['category'],
                    'description': s['description'],
                    'status': s['status'],
                    'assigned_to': s.get('assigned_to'),
                    'assigned_at': now if s.get('assigned_to') else None,
                    'acknowledged_at': now if s['status'] != 'REPORTED' else None,
                    'in_progress_at': now if s['status'] in ('IN_PROGRESS', 'RESOLVED', 'CLOSED') else None,
                    'resolved_at': now if s['status'] in ('RESOLVED', 'CLOSED') else None,
                    'latitude': s['lat'],
                    'longitude': s['lng'],
                    'location_captured_at': now,
                    'location_accuracy': 10.0,
                },
            )
            if created:
                IncidentHistory.objects.create(
                    incident=inc,
                    changed_by=s['resident'],
                    event_type='created',
                    to_status='REPORTED',
                    note=f'Seeded: {inc.title}',
                )
                notify_incident(inc)

        self.stdout.write(self.style.SUCCESS(
            'Demo data seeded cleanly!\n'
            f'  Societies:\n'
            f'    1. {society1.name} ({society1.registration_number}) [Indiranagar, coords: 12.9716, 77.5946]\n'
            f'    2. {society2.name} ({society2.registration_number}) [HAL 2nd Stage, coords: 12.9820, 77.6040]\n'
            '  Key Users (password for all = "password123"):\n'
            '    - admin@example.com      (admin, Green Meadows)\n'
            '    - admin2@example.com     (admin, Palm Heights)\n'
            '    - security@example.com   (security, Green Meadows)\n'
            '    - asha@example.com       (resident, Flat 101 Block A)\n'
            '    - ravi@example.com       (primary guardian)\n'
            '    - neha@example.com       (secondary guardian)\n'
            '    - volunteer@example.com  (V1: Block A, live GPS ~100m)\n'
            '    - kavita@example.com     (V2: Block A, base pin ~200m)\n'
            '    - volunteer2@example.com (V3: Block B, live GPS ~400m)\n'
            '    - rahul@example.com      (V4: Block B, live GPS ~600m)\n'
            '    - deepa@example.com      (V5: Block B, base pin ~800m)\n'
            '    - manish@example.com     (V6: Palm Heights, live GPS ~1.4km)\n'
            '    - sneha@example.com      (V7: Palm Heights, base pin ~1.6km)'
        ))
