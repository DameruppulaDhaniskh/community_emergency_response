from django.db import migrations


EMERGENCY_LABELS = {
    'medical': 'Medical Emergency',
    'fall': 'Fall / Injury',
    'fire': 'Fire',
    'security': 'Security Threat',
    'accident': 'Accident',
    'other': 'Other',
}


def migrate_m2_incidents_forward(apps, schema_editor):
    Incident = apps.get_model('incidents', 'Incident')
    IncidentHistory = apps.get_model('incidents', 'IncidentHistory')

    for inc in Incident.objects.all().iterator():
        old_status = inc.status

        if old_status == 'OPEN':
            inc.status = 'REPORTED'
        elif old_status == 'ACTIVE_RESPONSE':
            inc.status = 'IN_PROGRESS'
            if not inc.in_progress_at:
                inc.in_progress_at = inc.updated_at or inc.created_at
        elif old_status == 'ESCALATED':
            inc.status = 'REPORTED'
            inc.is_escalated = True
            if not inc.escalated_at:
                inc.escalated_at = inc.updated_at or inc.created_at
        elif old_status == 'CANCELLED':
            inc.status = 'CLOSED'
            if not inc.close_reason:
                inc.close_reason = 'cancelled'
            if not inc.closed_at:
                inc.closed_at = inc.updated_at or inc.created_at
        elif old_status == 'RESOLVED':
            inc.status = 'RESOLVED'

        if not inc.reported_by_id and inc.resident_id:
            inc.reported_by_id = inc.resident_id

        if not inc.category:
            inc.category = inc.emergency_type or 'other'
        if not inc.emergency_type:
            inc.emergency_type = inc.category or 'other'

        if not inc.title:
            label = EMERGENCY_LABELS.get(inc.category, 'Emergency')
            inc.title = f'SOS: {label}'

        inc.save()

        if not IncidentHistory.objects.filter(incident_id=inc.pk).exists():
            IncidentHistory.objects.create(
                incident_id=inc.pk,
                changed_by_id=inc.resident_id,
                event_type='created',
                from_status='',
                to_status=inc.status,
                note='SOS alert raised' if old_status != inc.status else 'Incident created',
            )


def migrate_m2_incidents_backward(apps, schema_editor):
    Incident = apps.get_model('incidents', 'Incident')
    for inc in Incident.objects.all().iterator():
        if inc.is_escalated and inc.status == 'REPORTED':
            inc.status = 'ESCALATED'
        elif inc.status == 'REPORTED':
            inc.status = 'OPEN'
        elif inc.status == 'IN_PROGRESS':
            inc.status = 'ACTIVE_RESPONSE'
        elif inc.status == 'CLOSED' and inc.close_reason == 'cancelled':
            inc.status = 'CANCELLED'
        inc.save(update_fields=['status'])


class Migration(migrations.Migration):
    dependencies = [
        ('incidents', '0002_incident_acknowledged_at_incident_assigned_at_and_more'),
    ]

    operations = [
        migrations.RunPython(
            migrate_m2_incidents_forward,
            reverse_code=migrate_m2_incidents_backward,
        ),
    ]

