from django.db.models import Q

from contacts.models import EmergencyContact
from society.models import Society, SocietyAssignment

from .models import Incident

ACTIVE_STATES = ['REPORTED', 'ACKNOWLEDGED', 'ASSIGNED', 'IN_PROGRESS']


def _in_societies(society_ids):
    return Incident.objects.filter(
        resident__flat_mappings__is_active=True,
        resident__flat_mappings__flat__block__society_id__in=list(society_ids),
    ).distinct()


def incidents_for_user(user):
    """Only the incidents this user is allowed to see."""
    if user.is_superuser:
        return Incident.objects.all()

    if user.role == 'security':
        ids = SocietyAssignment.objects.filter(
            user=user, is_active=True
        ).values_list('society_id', flat=True)
        return _in_societies(ids)

    if user.role == 'admin':
        ids = Society.objects.filter(admin=user).values_list('id', flat=True)
        return _in_societies(ids)

    if user.role == 'guardian':
        resident_ids = EmergencyContact.objects.filter(
            linked_user=user,
            status='accepted',
            is_verified=True,
            is_active=True,
        ).values_list('resident_id', flat=True)
        return Incident.objects.filter(resident_id__in=list(resident_ids))

    if user.role == 'volunteer':
        assigned_q = Q(assigned_to=user)
        try:
            from .models import IncidentEscalation
            esc_incident_ids = IncidentEscalation.objects.filter(
                incident__status__in=['REPORTED', 'ACKNOWLEDGED', 'ASSIGNED', 'IN_PROGRESS']
            ).values_list('incident_id', 'volunteer_ids')
            notified_ids = [
                inc_id for inc_id, vids in esc_incident_ids
                if isinstance(vids, list) and user.id in vids
            ]
        except Exception:
            notified_ids = []
        return Incident.objects.filter(assigned_q | Q(id__in=notified_ids)).distinct()

    return Incident.objects.filter(Q(resident=user) | Q(reported_by=user)).distinct()
