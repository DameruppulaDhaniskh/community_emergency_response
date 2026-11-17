from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):

    dependencies = [
        ('incidents', '0003_migrate_m2_statuses'),
        ('notifications', '0002_notification_event_type_and_more'),
    ]

    operations = [
        migrations.RemoveConstraint(
            model_name='notification',
            name='unique_notification_per_recipient_channel',
        ),
        migrations.AlterField(
            model_name='notification',
            name='incident',
            field=models.ForeignKey(
                blank=True,
                null=True,
                on_delete=django.db.models.deletion.CASCADE,
                related_name='notifications',
                to='incidents.incident',
            ),
        ),
        migrations.AlterField(
            model_name='notification',
            name='event_type',
            field=models.CharField(
                choices=[
                    ('INCIDENT_REPORTED', 'Incident Reported'),
                    ('INCIDENT_ASSIGNED', 'Incident Assigned'),
                    ('STATUS_CHANGED', 'Status Changed'),
                    ('EVIDENCE_ADDED', 'Evidence Added'),
                    ('ESCALATED', 'Escalated'),
                    ('GUARDIAN_REQUEST', 'Guardian Request'),
                    ('GUARDIAN_ACCEPTED', 'Guardian Request Accepted'),
                    ('GUARDIAN_DECLINED', 'Guardian Request Declined'),
                ],
                default='INCIDENT_REPORTED',
                max_length=30,
            ),
        ),
        migrations.AlterField(
            model_name='notification',
            name='recipient_type',
            field=models.CharField(
                choices=[
                    ('primary_guardian', 'Primary Guardian'),
                    ('secondary_guardian', 'Secondary Guardian'),
                    ('security', 'Security'),
                    ('volunteer', 'Volunteer'),
                    ('community', 'Community'),
                    ('admin', 'Society Admin'),
                    ('resident', 'Resident'),
                ],
                max_length=20,
            ),
        ),
        migrations.AlterField(
            model_name='notification',
            name='recipient_phone',
            field=models.CharField(blank=True, max_length=20),
        ),
        migrations.AddConstraint(
            model_name='notification',
            constraint=models.UniqueConstraint(
                condition=models.Q(('incident__isnull', False)),
                fields=('incident', 'dedupe_key'),
                name='unique_notification_per_incident_dedupe',
            ),
        ),
        migrations.AddConstraint(
            model_name='notification',
            constraint=models.UniqueConstraint(
                condition=models.Q(('incident__isnull', True)),
                fields=('dedupe_key',),
                name='unique_non_incident_notification_dedupe',
            ),
        ),
    ]

