from django.core.management.base import BaseCommand
from django.contrib.auth import get_user_model
from society.models import ResidentFlatMapping, SecurityProfile, VolunteerProfile, SocietyAssignment

User = get_user_model()


class Command(BaseCommand):
    help = "Report users not properly linked to a society, block, or flat."

    def handle(self, *args, **options):
        self.stdout.write(self.style.NOTICE("=" * 80))
        self.stdout.write(self.style.NOTICE(" Scanning for Unlinked Users in SafeCircle"))
        self.stdout.write(self.style.NOTICE("=" * 80))

        unlinked = []

        for u in User.objects.filter(is_active=True).order_by('role', 'id'):
            if u.role == 'resident':
                has_flat = ResidentFlatMapping.objects.filter(user=u, is_active=True).exists()
                if not has_flat:
                    unlinked.append({
                        'id': u.id,
                        'username': u.username,
                        'email': u.email,
                        'role': u.role,
                        'phone': u.phone,
                        'missing': 'No active ResidentFlatMapping (no society/block/flat)',
                    })
            elif u.role == 'security':
                has_profile = SecurityProfile.objects.filter(user=u).exists()
                has_assignment = SocietyAssignment.objects.filter(user=u, is_active=True).exists()
                missing_items = []
                if not has_profile:
                    missing_items.append('No SecurityProfile')
                if not has_assignment:
                    missing_items.append('No active SocietyAssignment')
                if missing_items:
                    unlinked.append({
                        'id': u.id,
                        'username': u.username,
                        'email': u.email,
                        'role': u.role,
                        'phone': u.phone,
                        'missing': ', '.join(missing_items),
                    })
            elif u.role == 'volunteer':
                has_profile = VolunteerProfile.objects.filter(user=u).exists()
                has_assignment = SocietyAssignment.objects.filter(user=u, is_active=True).exists()
                missing_items = []
                if not has_profile:
                    missing_items.append('No VolunteerProfile')
                if not has_assignment:
                    missing_items.append('No active SocietyAssignment')
                if missing_items:
                    unlinked.append({
                        'id': u.id,
                        'username': u.username,
                        'email': u.email,
                        'role': u.role,
                        'phone': u.phone,
                        'missing': ', '.join(missing_items),
                    })
            # Guardian and admin don't require flat mappings

        if not unlinked:
            self.stdout.write(self.style.SUCCESS("All active residents, security, and volunteers are linked to a society!"))
            return

        self.stdout.write(self.style.WARNING(f"Found {len(unlinked)} unlinked user(s):"))
        self.stdout.write("-" * 80)
        for item in unlinked:
            self.stdout.write(
                f"[{item['role'].upper()}] ID={item['id']} @{item['username']} ({item['email']}) Phone={item['phone']}\n"
                f"   Missing: {item['missing']}"
            )
        self.stdout.write("-" * 80)
        self.stdout.write(self.style.NOTICE("Admins can link these users via /api/admin/unlinked-users/."))

