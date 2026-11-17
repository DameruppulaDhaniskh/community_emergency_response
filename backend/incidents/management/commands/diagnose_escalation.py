import json
from django.core.management.base import BaseCommand, CommandError
from incidents.models import Incident
from incidents.escalation import _resident_society_ids, get_incident_reference_point
from society.models import ResidentFlatMapping, SecurityProfile, SocietyAssignment, VolunteerProfile
from contacts.models import EmergencyContact, ResidentSecurityGuard


class Command(BaseCommand):
    help = 'Diagnose emergency escalation status and responder availability for an incident.'

    def add_arguments(self, parser):
        parser.add_argument('incident_id', type=int, help='Incident ID to diagnose')
        parser.add_argument('--json', action='store_true', help='Output in JSON format')

    def handle(self, *args, **options):
        incident_id = options['incident_id']
        as_json = options['json']

        try:
            incident = Incident.objects.select_related('resident').get(pk=incident_id)
        except Incident.DoesNotExist:
            raise CommandError(f'Incident #{incident_id} does not exist.')

        res = incident.resident
        soc_ids = _resident_society_ids(res)
        mapping = ResidentFlatMapping.objects.filter(user=res, is_active=True).select_related('flat__block__society').first()

        pri_g = EmergencyContact.objects.filter(resident=res, contact_type='primary_guardian', is_active=True).first()
        sec_g = EmergencyContact.objects.filter(resident=res, contact_type='secondary_guardian', is_active=True).first()

        res_guards = ResidentSecurityGuard.objects.filter(resident=res, is_active=True)
        soc_sec_approved = SecurityProfile.objects.filter(society_id__in=soc_ids, approval_status='approved').count()
        soc_sec_on_duty = SocietyAssignment.objects.filter(
            society_id__in=soc_ids, user__role='security', is_active=True, is_available=True
        ).count()

        settings_obj = getattr(res, 'escalation_settings', None)
        search_radius = settings_obj.volunteer_radius_km if settings_obj else 2.0
        total_vol = VolunteerProfile.objects.filter(society_id__in=soc_ids, approval_status='approved').count()
        avail_vol = VolunteerProfile.objects.filter(
            society_id__in=soc_ids, approval_status='approved', user__society_assignments__is_available=True
        ).distinct().count()

        ref_lat, ref_lng, ref_src = get_incident_reference_point(incident)

        data = {
            'incident_id': incident.pk,
            'status': incident.status,
            'resident': {
                'id': res.pk,
                'username': res.username,
                'society_linked': bool(soc_ids),
                'society_name': mapping.flat.block.society.name if mapping and mapping.flat and mapping.flat.block and mapping.flat.block.society else None,
                'block_name': mapping.flat.block.name if mapping and mapping.flat and mapping.flat.block else None,
                'flat_number': mapping.flat.flat_number if mapping and mapping.flat else None,
            },
            'location': {
                'has_coordinates': incident.location_available,
                'latitude': float(incident.latitude) if incident.latitude else None,
                'longitude': float(incident.longitude) if incident.longitude else None,
                'source': ref_src,
            },
            'guardians': {
                'primary': {
                    'configured': pri_g is not None,
                    'verified': bool(pri_g and pri_g.is_verified),
                    'name': pri_g.name if pri_g else None,
                },
                'secondary': {
                    'configured': sec_g is not None,
                    'verified': bool(sec_g and sec_g.is_verified),
                    'name': sec_g.name if sec_g else None,
                },
            },
            'security': {
                'has_security_guard_configured': bool(settings_obj and settings_obj.has_security_guard),
                'resident_guard_count': res_guards.count(),
                'society_security_approved_count': soc_sec_approved,
                'society_security_on_duty_count': soc_sec_on_duty,
                'security_alerted': bool(incident.is_escalated and 'security' in (incident.escalation_plan or {}).get('targets', [])),
            },
            'volunteers': {
                'search_radius_km': search_radius,
                'total_approved_volunteers': total_vol,
                'available_volunteers': avail_vol,
                'volunteers_notified_count': len(incident.escalations.last().volunteer_ids) if incident.escalations.exists() else 0,
            },
            'escalation_status': {
                'is_escalated': incident.is_escalated,
                'escalate_at': incident.escalate_at.isoformat() if incident.escalate_at else None,
                'escalation_trigger': incident.escalation_trigger,
                'plan': incident.escalation_plan,
            },
        }

        if as_json:
            self.stdout.write(json.dumps(data, indent=2))
        else:
            self.stdout.write(self.style.MIGRATE_HEADING(f"=== Escalation Diagnostics for Incident #{incident.pk} ==="))
            self.stdout.write(f"Status: {incident.status} | Category: {incident.category}")
            self.stdout.write(f"Resident: {res.username} (Society: {data['resident']['society_name'] or 'None - UNLINKED'})")
            self.stdout.write(f"Location: {'Coordinates ' + str(data['location']['latitude']) + ', ' + str(data['location']['longitude']) if data['location']['has_coordinates'] else 'No GPS'}")
            self.stdout.write(f"Primary Guardian: {data['guardians']['primary']['name'] or 'None'} (Verified: {data['guardians']['primary']['verified']})")
            self.stdout.write(f"Secondary Guardian: {data['guardians']['secondary']['name'] or 'None'} (Verified: {data['guardians']['secondary']['verified']})")
            self.stdout.write(f"Security: Configured={data['security']['has_security_guard_configured']}, Society Approved={soc_sec_approved}, On Duty={soc_sec_on_duty}")
            self.stdout.write(f"Volunteers: Approved={total_vol}, Available={avail_vol}, Radius={search_radius}km")
            self.stdout.write(f"Escalation Plan: Targets={data['escalation_status']['plan'].get('targets', [])}")
            self.stdout.write(f"Is Escalated: {incident.is_escalated} (Trigger: {incident.escalation_trigger})")

