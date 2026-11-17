from django.db import migrations
from django.utils import timezone

from users.validators import try_normalize_phone


def migrate_existing_contacts(apps, schema_editor):
    EmergencyContact = apps.get_model('contacts', 'EmergencyContact')
    User = apps.get_model('users', 'User')

    seen_slots = set()

    for c in EmergencyContact.objects.all().order_by('-is_verified', '-id'):
        if c.phone:
            norm = try_normalize_phone(c.phone)
            if norm:
                c.phone = norm

        if not c.linked_user_id:
            matched = None
            if c.phone:
                matched = User.objects.filter(is_active=True, phone=c.phone).first()
            if not matched and c.email:
                matched = User.objects.filter(is_active=True, email__iexact=c.email.strip()).first()

            if matched:
                if c.contact_type == 'emergency_contact':
                    c.linked_user_id = matched.id
                    c.is_verified = True
                    if not c.verified_at:
                        c.verified_at = timezone.now()
                elif matched.role == 'guardian' and matched.id != c.resident_id:
                    c.linked_user_id = matched.id

        if c.is_verified:
            c.status = 'accepted'
            if not c.verified_at:
                c.verified_at = timezone.now()
            if not c.responded_at:
                c.responded_at = c.verified_at
        else:
            c.status = 'pending'

        if (
            c.is_active
            and c.status in ('pending', 'accepted')
            and c.contact_type in ('primary_guardian', 'secondary_guardian')
        ):
            slot = (c.resident_id, c.contact_type)
            if slot in seen_slots:
                c.status = 'cancelled'
                c.is_verified = False
                c.verified_at = None
            else:
                seen_slots.add(slot)

        c.save()


class Migration(migrations.Migration):

    dependencies = [
        ('contacts', '0002_guardian_request_lifecycle'),
    ]

    operations = [
        migrations.RunPython(migrate_existing_contacts, migrations.RunPython.noop),
    ]

