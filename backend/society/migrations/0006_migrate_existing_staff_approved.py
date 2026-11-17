from django.db import migrations
from django.utils import timezone


def migrate_existing_staff_approved(apps, schema_editor):
    User = apps.get_model('users', 'User')
    Society = apps.get_model('society', 'Society')
    SocietyAssignment = apps.get_model('society', 'SocietyAssignment')
    VolunteerProfile = apps.get_model('society', 'VolunteerProfile')
    SecurityProfile = apps.get_model('society', 'SecurityProfile')

    first_society = Society.objects.filter(is_active=True).first()

    # 1. Security staff
    for user in User.objects.filter(role='security'):
        assignment = SocietyAssignment.objects.filter(user=user).first()
        society = assignment.society if assignment else first_society
        if not society:
            continue

        SecurityProfile.objects.update_or_create(
            user=user,
            defaults={
                'society': society,
                'post_label': 'Main Gate',
                'approval_status': 'approved',
                'approval_reviewed_at': timezone.now(),
            },
        )
        SocietyAssignment.objects.update_or_create(
            user=user,
            society=society,
            defaults={
                'is_active': True,
                'is_available': True,
            },
        )

    # 2. Volunteer staff
    for user in User.objects.filter(role='volunteer'):
        vp = VolunteerProfile.objects.filter(user=user).first()
        if vp:
            if not vp.area_label and vp.pin_label:
                vp.area_label = vp.pin_label
            vp.approval_status = 'approved'
            vp.save(update_fields=['area_label', 'approval_status'])

        assignment = SocietyAssignment.objects.filter(user=user).first()
        society = vp.society if vp else (assignment.society if assignment else first_society)
        if society:
            SocietyAssignment.objects.update_or_create(
                user=user,
                society=society,
                defaults={
                    'is_active': True,
                    'is_available': True,
                },
            )


def reverse_func(apps, schema_editor):
    pass


class Migration(migrations.Migration):

    dependencies = [
        ('society', '0005_residentflatmapping_home_label_and_more'),
    ]

    operations = [
        migrations.RunPython(migrate_existing_staff_approved, reverse_func),
    ]

