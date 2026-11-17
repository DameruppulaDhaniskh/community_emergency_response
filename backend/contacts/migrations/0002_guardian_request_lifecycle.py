from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('contacts', '0001_initial'),
        ('users', '0004_phone_username_constraints'),
    ]

    operations = [
        migrations.RemoveConstraint(
            model_name='emergencycontact',
            name='unique_primary_guardian_per_resident',
        ),
        migrations.RemoveConstraint(
            model_name='emergencycontact',
            name='unique_secondary_guardian_per_resident',
        ),
        migrations.RemoveField(
            model_name='emergencycontact',
            name='verification_token',
        ),
        migrations.RemoveField(
            model_name='emergencycontact',
            name='verification_sent_at',
        ),
        migrations.AddField(
            model_name='emergencycontact',
            name='status',
            field=models.CharField(
                choices=[
                    ('pending', 'Pending'),
                    ('accepted', 'Accepted'),
                    ('declined', 'Declined'),
                    ('cancelled', 'Cancelled'),
                ],
                default='pending',
                max_length=15,
            ),
        ),
        migrations.AddField(
            model_name='emergencycontact',
            name='responded_at',
            field=models.DateTimeField(blank=True, null=True),
        ),
        migrations.AddField(
            model_name='emergencycontact',
            name='last_reminded_at',
            field=models.DateTimeField(blank=True, null=True),
        ),
        migrations.AlterField(
            model_name='emergencycontact',
            name='phone',
            field=models.CharField(max_length=20),
        ),
    ]
