import logging
import uuid

from django.contrib.auth import get_user_model
from django.utils import timezone

from contacts.models import EmergencyContact
from society.models import (
    ResidentFlatMapping,
    Society,
    SocietyAlertPolicy,
    SocietyAssignment,
)
from .models import Notification

logger = logging.getLogger(__name__)
User = get_user_model()

MAX_ATTEMPTS = 3
RETRY_COOLDOWN_SECONDS = 60


def _society_ids(resident):
    return list(
        ResidentFlatMapping.objects.filter(user=resident, is_active=True)
        .values_list('flat__block__society_id', flat=True)
        .distinct()
    )


def _society_admins(society_ids):
    admins = {}
    for soc in Society.objects.filter(
        id__in=society_ids,
        is_active=True,
        admin__isnull=False,
        admin__is_active=True,
    ).select_related('admin'):
        admins[soc.admin_id] = soc.admin
    return list(admins.values())


def _channels_for_user(user, include_email=True):
    channels = ['push', 'in_app']
    if include_email and user and user.email:
        channels.append('email')
    return channels


def build_content(incident, recipient_type, event_type='INCIDENT_REPORTED', extra=None):
    """Privacy: each recipient type only gets the details it is allowed to see."""
    extra = extra or {}
    resident = incident.resident
    name = resident.get_full_name() or resident.username
    kind = incident.get_category_display_label()
    incident_title = incident.title or f'SOS: {kind}'

    if recipient_type == 'community':
        return (
            'Emergency alert in your society',
            f'A resident in your society has requested help ({kind}). '
            f'Please follow instructions from security.',
        )

    if event_type == 'INCIDENT_ASSIGNED':
        vol_name = extra.get('volunteer_name', 'a volunteer')
        if recipient_type == 'volunteer':
            lines = [
                f'You have been assigned to Incident #{incident.pk} ({incident_title}).',
                f'Resident: {name}',
                f'Category: {kind}',
            ]
            if incident.description:
                lines.append(f'Details: {incident.description}')
            if incident.location_available:
                lines.append(
                    f'Location: https://maps.google.com/?q={incident.latitude},{incident.longitude}'
                )
            return f'New Assignment: Incident #{incident.pk} ({kind})', '\n'.join(lines)
        return (
            f'Responder assigned to your incident #{incident.pk}',
            f'{vol_name} has been assigned to your incident ({incident_title}). Status is now ASSIGNED.',
        )

    if event_type == 'STATUS_CHANGED':
        to_status = extra.get('to_status', incident.status)
        note = extra.get('note', '')
        title = f'Incident #{incident.pk} update: {to_status.replace("_", " ").title()}'
        msg_parts = [f'{incident_title} is now {to_status}.']
        if note:
            msg_parts.append(f'Note: {note}')
        return title, ' '.join(msg_parts)

    if event_type == 'EVIDENCE_ADDED':
        return (
            f'New evidence added to Incident #{incident.pk}',
            f'{name} uploaded new photo evidence for "{incident_title}".',
        )

    if event_type == 'ESCALATED':
        return (
            f'ESCALATED: Incident #{incident.pk} ({kind})',
            f'Incident #{incident.pk} for {name} has been escalated and requires immediate admin attention.',
        )

    if event_type == 'GUARDIAN_SOS':
        lines = [f'{name} triggered an SOS.', f'Category: {kind}']
        if incident.description:
            lines.append(f'Message: {incident.description}')
        if incident.location_available:
            acc_str = f' (accuracy: {incident.location_accuracy}m)' if incident.location_accuracy else ''
            lines.append(f'Coordinates: {incident.latitude}, {incident.longitude}{acc_str}')
            lines.append(f'Map: https://www.google.com/maps?q={incident.latitude},{incident.longitude}')
        else:
            lines.append('Location not shared, call the resident')
        return f'SOS Alert: {kind} - {name}', '\n'.join(lines)

    if event_type in ('ESCALATION_AUTO', 'ESCALATION_HANDOFF'):
        reason_text = extra.get('reason_text', '')
        dist = extra.get('distance_km')
        is_cross_soc = extra.get('from_other_society', False)

        if is_cross_soc and recipient_type == 'volunteer':
            # Cross-society privacy: first name only, category, maps link, distance (no phone, flat, description)
            first_name = resident.first_name or name.split()[0]
            lines = [
                f'Emergency alert: {kind}',
                f'Resident: {first_name}',
            ]
            if dist is not None:
                lines.append(f'{kind}, {dist} km from you')
            if incident.location_available:
                lines.append(f'Map: https://www.google.com/maps?q={incident.latitude},{incident.longitude}')
            soc_name = extra.get('incident_society_name', '')
            if soc_name:
                lines.append(f'From neighbouring society: {soc_name}')
            return f'Nearby Emergency: {kind}', '\n'.join(lines)

        lines = [f'{name} needs assistance.', f'Category: {kind}']
        if reason_text:
            lines.append(reason_text)
        if incident.description:
            lines.append(f'Details: {incident.description}')
        if dist is not None and recipient_type == 'volunteer':
            lines.append(f'Distance: {dist} km from you')
        if incident.location_available:
            acc_str = f' (accuracy: {incident.location_accuracy}m)' if incident.location_accuracy else ''
            lines.append(f'Coordinates: {incident.latitude}, {incident.longitude}{acc_str}')
            lines.append(f'Map: https://www.google.com/maps?q={incident.latitude},{incident.longitude}')
        else:
            lines.append('Location not shared, call the resident')

        prefix = 'ESCALATED' if event_type == 'ESCALATION_AUTO' else 'HANDOFF'
        return f'{prefix}: {kind} - {name}', '\n'.join(lines)

    if event_type == 'ESCALATION_ACCEPTED':
        vol_name = extra.get('volunteer_name', 'A volunteer')
        dist = extra.get('distance_km')
        dist_str = f', {dist} km away' if dist is not None else ''
        if recipient_type == 'resident':
            return (
                f'Responder on the way for Incident #{incident.pk}',
                f'{vol_name} is on the way{dist_str}.',
            )
        elif recipient_type == 'volunteer':
            return (
                f'Incident #{incident.pk} Taken',
                f'Incident #{incident.pk} was accepted by {vol_name}.',
            )
        else:
            return (
                f'Incident #{incident.pk} Accepted',
                f'{vol_name} has accepted Incident #{incident.pk} ({kind}). Status is ASSIGNED.',
            )

    if event_type == 'NO_RESPONDER':
        return (
            f'CRITICAL: No responder for Incident #{incident.pk}',
            f'Incident #{incident.pk} ({kind} for {name}) has had no responder accept within the escalation window. Immediate administrative intervention required.',
        )

    if event_type == 'ESCALATION_NOTICE':
        groups_str = extra.get('groups_str', 'secondary guardian, security, and volunteers')
        return (
            f'Incident #{incident.pk} escalated',
            f'Your incident has been escalated. We alerted: {groups_str}.',
        )

    # Default / INCIDENT_REPORTED
    if recipient_type == 'admin':
        lines = [f'{name} reported an incident: {incident_title}.', f'Category: {kind}']
        if incident.description:
            lines.append(f'Details: {incident.description}')
        if incident.location_available:
            lines.append(
                f'Location: https://www.google.com/maps?q={incident.latitude},{incident.longitude}'
            )
        return f'New Incident #{incident.pk}: {kind} - {name}', '\n'.join(lines)

    lines = [f'{name} needs help.', f'Emergency: {kind}']
    if recipient_type in ('primary_guardian', 'secondary_guardian', 'security') and incident.description:
        lines.append(f'Message: {incident.description}')
    if incident.location_available:
        lines.append(
            f'Location: https://www.google.com/maps?q={incident.latitude},{incident.longitude}'
        )
    else:
        lines.append('Location: not available')
    return f'SOS: {kind} - {name}', '\n'.join(lines)


def get_recipients(incident):
    """M2 + M3 recipients for initial incident report (SOS or form)."""
    resident = incident.resident
    society_ids = _society_ids(resident)
    recipients = []

    # 1. Verified & accepted guardians (primary + secondary)
    guardians = EmergencyContact.objects.filter(
        resident=resident,
        contact_type__in=('primary_guardian', 'secondary_guardian'),
        status='accepted',
        is_verified=True,
        is_active=True,
    ).select_related('linked_user').order_by('priority', 'id')
    for guardian in guardians:
        user = guardian.linked_user
        email = guardian.email or (user.email if user else '')
        channels = []
        if user:
            channels.append('push')
        if guardian.phone:
            channels.append('sms')
        if email:
            channels.append('email')
        if user:
            channels.append('in_app')
        if channels:
            recipients.append({
                'type': guardian.contact_type,
                'user': user,
                'name': guardian.name,
                'phone': guardian.phone,
                'email': email,
                'channels': channels,
            })

    # 2. Security assigned to the resident's society
    security = {}
    for a in SocietyAssignment.objects.filter(
        society_id__in=society_ids, is_active=True,
        user__role='security', user__is_active=True,
    ).select_related('user'):
        security[a.user_id] = a.user
    for user in security.values():
        recipients.append({
            'type': 'security', 'user': user,
            'name': user.get_full_name() or user.username,
            'phone': user.phone, 'email': user.email,
            'channels': ['push', 'in_app'],
        })

    # 3. Available volunteers serving the resident's society
    volunteers = {}
    for a in SocietyAssignment.objects.filter(
        society_id__in=society_ids, is_active=True, is_available=True,
        user__role='volunteer', user__is_active=True,
    ).select_related('user'):
        volunteers[a.user_id] = a.user
    for user in volunteers.values():
        recipients.append({
            'type': 'volunteer', 'user': user,
            'name': user.get_full_name() or user.username,
            'phone': user.phone, 'email': user.email,
            'channels': ['push', 'in_app'],
        })

    # 4. Society Admins managing the resident's society (M3 addition)
    for admin_user in _society_admins(society_ids):
        recipients.append({
            'type': 'admin', 'user': admin_user,
            'name': admin_user.get_full_name() or admin_user.username,
            'phone': admin_user.phone, 'email': admin_user.email,
            'channels': _channels_for_user(admin_user, include_email=True),
        })

    # 5. Community: only where the society's alert policy allows it
    allowed_ids = list(
        SocietyAlertPolicy.objects.filter(
            society_id__in=society_ids, notify_community=True
        ).values_list('society_id', flat=True)
    )
    if allowed_ids:
        neighbour_ids = ResidentFlatMapping.objects.filter(
            is_active=True, flat__block__society_id__in=allowed_ids
        ).exclude(user=resident).values_list('user_id', flat=True)
        for user in User.objects.filter(id__in=list(neighbour_ids), role='resident', is_active=True):
            recipients.append({
                'type': 'community', 'user': user,
                'name': user.get_full_name() or user.username,
                'phone': user.phone, 'email': user.email,
                'channels': ['in_app'],
            })

    return recipients


def _create_and_dispatch(incident, recipient_specs, event_type, status_tag='', extra=None):
    created = []
    for r in recipient_specs:
        recip_extra = {**(extra or {}), **(r.get('extra') or {})}
        title, body = build_content(incident, r['type'], event_type=event_type, extra=recip_extra)
        who = r['user'].pk if r['user'] else (r['phone'] or r['email'])
        for channel in r['channels']:
            dedupe = f"{incident.pk}:{event_type}:{r['type']}:{who}:{channel}:{status_tag}"
            note, was_created = Notification.objects.get_or_create(
                incident=incident,
                dedupe_key=dedupe,
                defaults={
                    'event_type': event_type,
                    'recipient': r['user'],
                    'recipient_type': r['type'],
                    'recipient_name': r['name'],
                    'recipient_phone': r['phone'],
                    'recipient_email': r['email'],
                    'channel': channel,
                    'title': title,
                    'message': body,
                },
            )
            if was_created:
                created.append(note)

    for note in created:
        try:
            dispatch(note)
        except Exception:
            logger.exception('Dispatch failed for notification %s', note.pk)
    return created


def create_notifications(incident):
    """Create one record per recipient and channel for INCIDENT_REPORTED."""
    created = []
    for r in get_recipients(incident):
        title, body = build_content(incident, r['type'], event_type='INCIDENT_REPORTED')
        who = r['user'].pk if r['user'] else (r['phone'] or r['email'])
        for channel in r['channels']:
            note, was_created = Notification.objects.get_or_create(
                incident=incident,
                dedupe_key=f"INCIDENT_REPORTED:{r['type']}:{who}:{channel}",
                defaults={
                    'event_type': 'INCIDENT_REPORTED',
                    'recipient': r['user'],
                    'recipient_type': r['type'],
                    'recipient_name': r['name'],
                    'recipient_phone': r['phone'],
                    'recipient_email': r['email'],
                    'channel': channel,
                    'title': title,
                    'message': body,
                },
            )
            if was_created:
                created.append(note)
    return created


def send_via_provider(notification):
    """
    Development mock provider. Results are labelled as simulated.
    Replace with real SMS / push / email providers later.
    """
    if notification.channel == 'sms' and not notification.recipient_phone:
        return {'success': False, 'error': 'No phone number', 'simulated': True}
    if notification.channel == 'email' and not notification.recipient_email:
        return {'success': False, 'error': 'No email address', 'simulated': True}
    if notification.channel in ('push', 'in_app') and not notification.recipient_id:
        return {'success': False, 'error': 'Recipient is not a registered user', 'simulated': True}

    print(
        f"[SIMULATED {notification.channel.upper()}] ({notification.event_type}) "
        f"to {notification.recipient_name}: {notification.title}"
    )
    return {
        'success': True,
        'provider_message_id': f'SIM-{uuid.uuid4().hex[:12]}',
        'simulated': True,
    }


def dispatch(notification):
    """Send one notification and record the result. SENT does not mean DELIVERED."""
    notification.attempt_count += 1
    notification.last_attempt_at = timezone.now()
    try:
        result = send_via_provider(notification)
    except Exception as exc:
        result = {'success': False, 'error': str(exc), 'simulated': False}

    notification.is_simulated = bool(result.get('simulated'))
    if result.get('success'):
        notification.delivery_status = 'SENT'
        notification.sent_at = timezone.now()
        notification.provider_message_id = result.get('provider_message_id', '')
        notification.failure_reason = ''
    else:
        notification.delivery_status = 'FAILED'
        notification.failure_reason = str(result.get('error', 'Unknown error'))[:500]
    notification.save()
    return notification


def notify_incident(incident):
    """Create notification records for a reported incident and dispatch them."""
    notes = create_notifications(incident)
    for note in notes:
        dispatch(note)
    return notes


def notify_incident_assigned(incident, volunteer, tag_suffix='1'):
    """Notify assigned volunteer and reporting resident when an incident is assigned."""
    vol_name = volunteer.get_full_name() or volunteer.username
    resident = incident.resident
    specs = [
        {
            'type': 'volunteer',
            'user': volunteer,
            'name': vol_name,
            'phone': volunteer.phone,
            'email': volunteer.email,
            'channels': _channels_for_user(volunteer, include_email=True),
        },
        {
            'type': 'resident',
            'user': resident,
            'name': resident.get_full_name() or resident.username,
            'phone': resident.phone,
            'email': resident.email,
            'channels': _channels_for_user(resident, include_email=True),
        },
    ]
    return _create_and_dispatch(
        incident,
        specs,
        event_type='INCIDENT_ASSIGNED',
        status_tag=f'ASSIGNED:{volunteer.pk}:{tag_suffix}',
        extra={'volunteer_name': vol_name},
    )


def notify_status_changed(incident, actor, from_status, to_status, note=''):
    """
    Notify:
    - reporting resident on every status change
    - assigned volunteer when admin changes the status
    - verified guardian when status becomes RESOLVED
    """
    resident = incident.resident
    specs = [
        {
            'type': 'resident',
            'user': resident,
            'name': resident.get_full_name() or resident.username,
            'phone': resident.phone,
            'email': resident.email,
            'channels': _channels_for_user(resident, include_email=True),
        }
    ]

    if (
        actor
        and (actor.role == 'admin' or actor.is_superuser)
        and incident.assigned_to
        and incident.assigned_to_id != actor.pk
    ):
        vol = incident.assigned_to
        specs.append({
            'type': 'volunteer',
            'user': vol,
            'name': vol.get_full_name() or vol.username,
            'phone': vol.phone,
            'email': vol.email,
            'channels': _channels_for_user(vol, include_email=True),
        })

    if to_status == 'RESOLVED':
        guardians = EmergencyContact.objects.filter(
            resident=resident,
            contact_type__in=('primary_guardian', 'secondary_guardian'),
            status='accepted',
            is_verified=True,
            is_active=True,
        ).select_related('linked_user')
        for g in guardians:
            u = g.linked_user
            email = g.email or (u.email if u else '')
            channels = []
            if u:
                channels.append('push')
            if g.phone:
                channels.append('sms')
            if email:
                channels.append('email')
            if u:
                channels.append('in_app')
            if channels:
                specs.append({
                    'type': g.contact_type,
                    'user': u,
                    'name': g.name,
                    'phone': g.phone,
                    'email': email,
                    'channels': channels,
                })

    return _create_and_dispatch(
        incident,
        specs,
        event_type='STATUS_CHANGED',
        status_tag=f'{from_status}->{to_status}',
        extra={'from_status': from_status, 'to_status': to_status, 'note': note},
    )


def notify_evidence_added(incident, evidence_ids):
    """Notify society admins when reporter uploads evidence."""
    society_ids = _society_ids(incident.resident)
    admins = _society_admins(society_ids)
    specs = [
        {
            'type': 'admin',
            'user': a,
            'name': a.get_full_name() or a.username,
            'phone': a.phone,
            'email': a.email,
            'channels': _channels_for_user(a, include_email=True),
        }
        for a in admins
    ]
    tag = '_'.join(str(i) for i in evidence_ids) if evidence_ids else 'ev'
    return _create_and_dispatch(
        incident,
        specs,
        event_type='EVIDENCE_ADDED',
        status_tag=tag,
    )


def notify_escalated(incident):
    """Notify society admins when an incident is escalated."""
    society_ids = _society_ids(incident.resident)
    admins = _society_admins(society_ids)
    specs = [
        {
            'type': 'admin',
            'user': a,
            'name': a.get_full_name() or a.username,
            'phone': a.phone,
            'email': a.email,
            'channels': _channels_for_user(a, include_email=True),
        }
        for a in admins
    ]
    return _create_and_dispatch(
        incident,
        specs,
        event_type='ESCALATED',
        status_tag='ESCALATED',
    )


def retry_failed(incident):
    """
    Retry FAILED notifications of one incident.
    Limits: max 3 attempts per notification, 60 second cooldown, and each
    notification is claimed atomically so it can never be sent twice at once.
    """
    now = timezone.now()
    result = {'retried': 0, 'skipped_max_attempts': 0, 'skipped_cooldown': 0}

    for note in Notification.objects.filter(incident=incident, delivery_status='FAILED'):
        if note.attempt_count >= MAX_ATTEMPTS:
            result['skipped_max_attempts'] += 1
            continue
        if note.last_attempt_at and (now - note.last_attempt_at).total_seconds() < RETRY_COOLDOWN_SECONDS:
            result['skipped_cooldown'] += 1
            continue

        claimed = Notification.objects.filter(
            pk=note.pk, delivery_status='FAILED'
        ).update(delivery_status='PENDING')
        if not claimed:
            continue

        note.refresh_from_db()
        dispatch(note)
        result['retried'] += 1
    return result


def update_delivery_from_provider(provider_message_id, new_status, reason=''):
    """
    Apply a provider delivery callback.
    Only a SENT notification can move to DELIVERED or FAILED. Reading a
    notification never changes its delivery status.
    """
    if new_status not in ('DELIVERED', 'FAILED'):
        raise ValueError('new_status must be DELIVERED or FAILED')
    note = Notification.objects.filter(provider_message_id=provider_message_id).first()
    if note is None:
        return None
    if note.delivery_status != 'SENT':
        return note
    note.delivery_status = new_status
    if new_status == 'DELIVERED':
        note.delivered_at = timezone.now()
    else:
        note.failure_reason = reason[:500]
    note.save()
    return note


def _dispatch_guardian_event(user, recipient_type, event_type, title, message, dedupe_prefix):
    """Create & dispatch in_app (always), push, and email notifications without an incident."""
    if not user or not user.is_active:
        return []
    channels = ['in_app', 'push']
    if user.email:
        channels.append('email')

    created = []
    name = user.get_full_name() or user.username
    for ch in channels:
        dedupe = f'{dedupe_prefix}:{user.pk}:{ch}'
        note, was_created = Notification.objects.get_or_create(
            incident=None,
            dedupe_key=dedupe,
            defaults={
                'event_type': event_type,
                'recipient': user,
                'recipient_type': recipient_type,
                'recipient_name': name,
                'recipient_phone': user.phone or '',
                'recipient_email': user.email or '',
                'channel': ch,
                'title': title,
                'message': message,
            },
        )
        if was_created:
            created.append(note)

    for note in created:
        try:
            dispatch(note)
        except Exception:
            logger.exception('Dispatch failed for guardian notification %s', note.pk)
    return created


def notify_guardian_request(contact, resend_tag='initial'):
    """Notify linked guardian when a resident adds them or resends a pending request."""
    if not contact.linked_user:
        return []
    res_name = contact.resident.get_full_name() or contact.resident.username
    role_label = dict(EmergencyContact.CONTACT_TYPES).get(contact.contact_type, 'Guardian')
    rel_label = contact.get_relationship_display()
    title = f'Guardian Request from {res_name}'
    message = (
        f'{res_name} wants to add you as their {role_label} ({rel_label}). '
        f'Open SafeCircle to accept or decline.'
    )
    recipient_type = (
        contact.contact_type
        if contact.contact_type in ('primary_guardian', 'secondary_guardian')
        else 'primary_guardian'
    )
    return _dispatch_guardian_event(
        user=contact.linked_user,
        recipient_type=recipient_type,
        event_type='GUARDIAN_REQUEST',
        title=title,
        message=message,
        dedupe_prefix=f'GUARDIAN_REQUEST:{contact.pk}:{resend_tag}',
    )


def notify_guardian_accepted(contact):
    """Notify resident when their guardian accepts the request."""
    g_name = contact.name or (
        contact.linked_user.get_full_name() or contact.linked_user.username
        if contact.linked_user
        else 'Your guardian'
    )
    role_label = dict(EmergencyContact.CONTACT_TYPES).get(contact.contact_type, 'Guardian')
    title = f'{g_name} accepted your guardian request'
    message = (
        f'{g_name} accepted your {role_label} invitation and is now verified to receive SOS alerts.'
    )
    return _dispatch_guardian_event(
        user=contact.resident,
        recipient_type='resident',
        event_type='GUARDIAN_ACCEPTED',
        title=title,
        message=message,
        dedupe_prefix=f'GUARDIAN_ACCEPTED:{contact.pk}',
    )


def notify_guardian_declined(contact):
    """Notify resident when their guardian declines the request."""
    g_name = contact.name or (
        contact.linked_user.get_full_name() or contact.linked_user.username
        if contact.linked_user
        else 'Guardian'
    )
    role_label = dict(EmergencyContact.CONTACT_TYPES).get(contact.contact_type, 'Guardian')
    title = f'{g_name} declined your guardian request'
    message = (
        f'{g_name} declined your {role_label} invitation. '
        f'You can add another guardian or send a fresh request later.'
    )
    return _dispatch_guardian_event(
        user=contact.resident,
        recipient_type='resident',
        event_type='GUARDIAN_DECLINED',
        title=title,
        message=message,
        dedupe_prefix=f'GUARDIAN_DECLINED:{contact.pk}',
    )


def notify_guardian_sos(incident):
    """Notify primary guardian when an SOS is raised."""
    primary_guardian = EmergencyContact.objects.filter(
        resident=incident.resident,
        contact_type='primary_guardian',
        status='accepted',
        is_verified=True,
        is_active=True,
    ).select_related('linked_user').first()
    if not primary_guardian:
        return []

    user = primary_guardian.linked_user
    channels = []
    if user:
        channels.append('push')
    if primary_guardian.phone:
        channels.append('sms')
    if primary_guardian.email or (user and user.email):
        channels.append('email')
    if user:
        channels.append('in_app')

    spec = {
        'type': 'primary_guardian',
        'user': user,
        'name': primary_guardian.name,
        'phone': primary_guardian.phone,
        'email': primary_guardian.email or (user.email if user else ''),
        'channels': channels,
    }
    return _create_and_dispatch(
        incident,
        [spec],
        event_type='GUARDIAN_SOS',
        status_tag=f'SOS:{incident.pk}',
    )


def notify_escalation_handoff(incident, escalation, volunteers):
    """Notify selected escalation targets when a guardian hands off an incident."""
    guardian_name = (
        escalation.triggered_by.get_full_name() or escalation.triggered_by.username
        if escalation.triggered_by
        else 'Guardian'
    )
    reason_label = {
        'far_away': 'too far away',
        'busy': 'currently busy',
        'other': 'requires immediate local response',
    }.get(escalation.reason, escalation.reason or 'passed on')

    reason_text = f"Passed on by {guardian_name}: {reason_label}."
    if escalation.note:
        reason_text += f" Note: {escalation.note}"

    return _dispatch_escalation_targets(
        incident=incident,
        escalation=escalation,
        volunteers=volunteers,
        event_type='ESCALATION_HANDOFF',
        reason_text=reason_text,
    )


def notify_escalation_timeout(incident, escalation, volunteers):
    """Notify escalation targets when guardian does not respond within the window."""
    reason_text = f"No response from guardian within {incident.escalation_window_seconds or 120} seconds. Auto-escalated."
    return _dispatch_escalation_targets(
        incident=incident,
        escalation=escalation,
        volunteers=volunteers,
        event_type='ESCALATION_AUTO',
        reason_text=reason_text,
    )


def _dispatch_escalation_targets(incident, escalation, volunteers, event_type, reason_text):
    """Internal helper to dispatch escalation alerts to secondary guardian, security, and volunteers."""
    targets = escalation.targets or []
    specs = []
    soc_ids = _society_ids(incident.resident)
    resident = incident.resident

    # 1. Secondary Guardian
    if 'secondary_guardian' in targets:
        sec_g = EmergencyContact.objects.filter(
            resident=resident,
            contact_type='secondary_guardian',
            status='accepted',
            is_verified=True,
            is_active=True,
        ).select_related('linked_user').first()
        if sec_g:
            u = sec_g.linked_user
            specs.append({
                'type': 'secondary_guardian',
                'user': u,
                'name': sec_g.name,
                'phone': sec_g.phone,
                'email': sec_g.email or (u.email if u else ''),
                'channels': ['push', 'in_app'] + (['sms'] if sec_g.phone else []) + (['email'] if sec_g.email or (u and u.email) else []),
            })

    # 2. Security Personnel
    if 'security' in targets:
        from contacts.models import ResidentSecurityGuard
        resident_guards = ResidentSecurityGuard.objects.filter(resident=resident, is_active=True)
        sec_ids = getattr(escalation, 'security_guard_ids', None) or []
        if sec_ids:
            resident_guards = resident_guards.filter(id__in=sec_ids)

        for rg in resident_guards:
            if rg.guard_type == 'building_guard':
                specs.append({
                    'type': 'building_guard',
                    'user': None,
                    'name': rg.name,
                    'phone': rg.phone,
                    'email': '',
                    'channels': ['sms'] if rg.phone else [],
                })
            elif rg.linked_user and rg.linked_user.is_active:
                u = rg.linked_user
                specs.append({
                    'type': 'security',
                    'user': u,
                    'name': rg.name or u.get_full_name() or u.username,
                    'phone': rg.phone or u.phone,
                    'email': u.email,
                    'channels': _channels_for_user(u, include_email=True),
                })

        if not sec_ids:
            for a in SocietyAssignment.objects.filter(
                society_id__in=soc_ids, is_active=True,
                user__role='security', user__is_active=True,
            ).select_related('user'):
                u = a.user
                if getattr(a, 'is_available', True) and not any(s.get('user') == u for s in specs):
                    specs.append({
                        'type': 'security',
                        'user': u,
                        'name': u.get_full_name() or u.username,
                        'phone': u.phone,
                        'email': u.email,
                        'channels': _channels_for_user(u, include_email=True),
                    })

    # 3. Volunteers
    if 'volunteers' in targets:
        mapping = ResidentFlatMapping.objects.filter(user=resident, is_active=True).select_related('flat__block__society').first()
        soc_name = mapping.flat.block.society.name if mapping and mapping.flat and mapping.flat.block else ''
        for v in (volunteers or []):
            u = v['user']
            specs.append({
                'type': 'volunteer',
                'user': u,
                'name': u.get_full_name() or u.username,
                'phone': u.phone,
                'email': u.email,
                'channels': _channels_for_user(u, include_email=True),
                'extra': {
                    'distance_km': v.get('distance_km'),
                    'from_other_society': v.get('from_other_society', False),
                    'incident_society_name': soc_name,
                },
            })

    # Dispatch to targets
    tag = f"ESC:{escalation.pk}:{event_type}"
    created = _create_and_dispatch(
        incident,
        specs,
        event_type=event_type,
        status_tag=tag,
        extra={'reason_text': reason_text},
    )

    # 4. Notice to resident
    target_names = []
    if 'secondary_guardian' in targets:
        target_names.append('secondary guardian')
    if 'security' in targets:
        target_names.append('security')
    if 'volunteers' in targets:
        vol_count = len(volunteers or [])
        target_names.append(f"{vol_count} nearby volunteer{'s' if vol_count != 1 else ''}")
    groups_str = ', '.join(target_names) or 'emergency responders'

    resident_spec = [{
        'type': 'resident',
        'user': resident,
        'name': resident.get_full_name() or resident.username,
        'phone': resident.phone,
        'email': resident.email,
        'channels': _channels_for_user(resident, include_email=True),
        'extra': {'groups_str': groups_str},
    }]
    created += _create_and_dispatch(
        incident,
        resident_spec,
        event_type='ESCALATION_NOTICE',
        status_tag=tag,
        extra={'groups_str': groups_str},
    )
    return created


def notify_escalation_accepted(incident, volunteer):
    """Notify resident, guardians, security, admins, and other volunteers that an incident was accepted."""
    vol_name = volunteer.get_full_name() or volunteer.username
    resident = incident.resident
    soc_ids = _society_ids(resident)

    specs = []

    # 1. Resident
    specs.append({
        'type': 'resident',
        'user': resident,
        'name': resident.get_full_name() or resident.username,
        'phone': resident.phone,
        'email': resident.email,
        'channels': _channels_for_user(resident, include_email=True),
    })

    # 2. Guardians
    for g in EmergencyContact.objects.filter(
        resident=resident,
        status='accepted',
        is_verified=True,
        is_active=True,
    ).select_related('linked_user'):
        u = g.linked_user
        if u:
            specs.append({
                'type': g.contact_type,
                'user': u,
                'name': g.name,
                'phone': g.phone,
                'email': g.email or u.email,
                'channels': ['push', 'in_app'],
            })

    # 3. Security
    for a in SocietyAssignment.objects.filter(
        society_id__in=soc_ids, is_active=True, user__role='security', user__is_active=True
    ).select_related('user'):
        u = a.user
        specs.append({
            'type': 'security',
            'user': u,
            'name': u.get_full_name() or u.username,
            'phone': u.phone,
            'email': u.email,
            'channels': ['push', 'in_app'],
        })

    # 4. Admins
    for admin_user in _society_admins(soc_ids):
        specs.append({
            'type': 'admin',
            'user': admin_user,
            'name': admin_user.get_full_name() or admin_user.username,
            'phone': admin_user.phone,
            'email': admin_user.email,
            'channels': _channels_for_user(admin_user, include_email=True),
        })

    # 5. Other notified volunteers ("Taken")
    notified_volunteer_ids = set()
    for esc in incident.escalations.all():
        for vid in (esc.volunteer_ids or []):
            if vid != volunteer.pk:
                notified_volunteer_ids.add(vid)

    for other_v in User.objects.filter(id__in=list(notified_volunteer_ids), is_active=True):
        specs.append({
            'type': 'volunteer',
            'user': other_v,
            'name': other_v.get_full_name() or other_v.username,
            'phone': other_v.phone,
            'email': other_v.email,
            'channels': ['push', 'in_app'],
        })

    return _create_and_dispatch(
        incident,
        specs,
        event_type='ESCALATION_ACCEPTED',
        status_tag=f'ACCEPTED:{volunteer.pk}',
        extra={'volunteer_name': vol_name},
    )


def notify_no_responder(incident, escalation):
    """Notify society admins and targets when no responder accepts within escalation window."""
    soc_ids = _society_ids(incident.resident)
    admins = _society_admins(soc_ids)
    specs = [
        {
            'type': 'admin',
            'user': a,
            'name': a.get_full_name() or a.username,
            'phone': a.phone,
            'email': a.email,
            'channels': _channels_for_user(a, include_email=True),
        }
        for a in admins
    ]
    return _create_and_dispatch(
        incident,
        specs,
        event_type='NO_RESPONDER',
        status_tag=f'NO_RESPONDER:{escalation.pk}',
    )

