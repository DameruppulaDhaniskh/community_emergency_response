from django.db import migrations
from django.utils import timezone


def migrate_volunteers_as_approved(apps, schema_editor):
    User = apps.get_model('users', 'User')
    Society = apps.get_model('society', 'Society')
    SocietyAssignment = apps.get_model('society', 'SocietyAssignment')
    VolunteerProfile = apps.get_model('society', 'VolunteerProfile')

    first_society = Society.objects.filter(is_active=True).first()

    for user in User.objects.filter(role='volunteer'):
        assignment = SocietyAssignment.objects.filter(user=user, is_active=True).first()
        society = assignment.society if assignment else first_society
        if not society:
            continue

        VolunteerProfile.objects.update_or_create(
            user=user,
            defaults={
                'society': society,
                'approval_status': 'approved',
                'approval_reviewed_at': timezone.now(),
                'serves_nearby_societies': False,
                'max_travel_km': 2.0,
            },
        )


def reverse_func(apps, schema_editor):
    pass


class Migration(migrations.Migration):

    dependencies = [
        ('society', '0003_society_latitude_society_longitude_and_more'),
    ]

    operations = [
        migrations.RunPython(migrate_volunteers_as_approved, reverse_func),
    ]

