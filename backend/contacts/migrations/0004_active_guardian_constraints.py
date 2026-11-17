from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('contacts', '0003_migrate_existing_contacts'),
    ]

    operations = [
        migrations.AddConstraint(
            model_name='emergencycontact',
            constraint=models.UniqueConstraint(
                condition=models.Q(
                    ('contact_type', 'primary_guardian'),
                    ('is_active', True),
                    ('status__in', ['pending', 'accepted']),
                ),
                fields=('resident', 'contact_type'),
                name='unique_active_primary_guardian_per_resident',
            ),
        ),
        migrations.AddConstraint(
            model_name='emergencycontact',
            constraint=models.UniqueConstraint(
                condition=models.Q(
                    ('contact_type', 'secondary_guardian'),
                    ('is_active', True),
                    ('status__in', ['pending', 'accepted']),
                ),
                fields=('resident', 'contact_type'),
                name='unique_active_secondary_guardian_per_resident',
            ),
        ),
    ]

