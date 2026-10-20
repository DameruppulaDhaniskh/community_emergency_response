import logging

from django.conf import settings
from django.contrib.auth import get_user_model
from django.core.mail import send_mail
from django.utils import timezone

from contacts.models import EmergencyContact
from society.models import ResidentFlatMapping
from .models import NotificationLog, InAppNotification

logger = logging.getLogger(__name__)
User = get_user_model()


def build_message(alert):
    resident = alert.resident
    name = resident.get_full_name() or resident.username
    title = f"SOS: {alert.get_category_display()} - {name}"
    body = (
        f"{name} needs help.\n"
        f"Category: {alert.get_category_display()}\n"
        f"Message: {alert.message or 'No message'}\n"
        f"Location: {alert.location_text or 'Not provided'}"
    )
    if alert.latitude and alert.longitude:
        body += f"\nMap: https://maps.google.com/?q={alert.latitude},{alert.longitude}"
    return title, body


def deliver(alert, recipient_type, channel, title, body,
            user=None, name='', phone='', email=''):
    """Send one notification on one channel and record the result."""
    log = NotificationLog.objects.create(
        alert=alert,
        recipient_user=user,
        recipient_name=name or (user.get_full_name() or user.username if user else ''),
        recipient_phone=phone,
        recipient_email=email,
        recipient_type=recipient_type,
        channel=channel,
    )
    try:
        if channel == 'email':
            if not email:
                raise ValueError('No email address')
            send_mail(title, body, settings.DEFAULT_FROM_EMAIL, [email])
        elif channel == 'sms':
            if not phone:
                raise ValueError('No phone number')
            print(f"[SMS to {phone}] {title}")
        elif channel == 'push':
            if not user:
                raise ValueError('Not a registered user')
            print(f"[PUSH to {user.username}] {title}")
        elif channel == 'in_app':
            if not user:
                raise ValueError('Not a registered user')
            InAppNotification.objects.create(
                user=user, alert=alert, title=title, message=body
            )
        log.status = 'sent'
        log.sent_at = timezone.now()
    except Exception as exc:
        log.status = 'failed'
        log.error_message = str(exc)
    log.save()
    return log


def _notify_user(alert, user, recipient_type, channels, title, body):
    for channel in channels:
        deliver(
            alert, recipient_type, channel, title, body,
            user=user, phone=user.phone, email=user.email,
        )


def route_alert(alert):
    """Notify everyone who should know about this SOS."""
    title, body = build_message(alert)
    resident = alert.resident

    # 1. Primary guardian (push + sms + email + in-app)
    guardian = EmergencyContact.objects.filter(
        resident=resident, contact_type='primary_guardian', is_active=True
    ).first()
    if guardian:
        for channel in ('push', 'sms', 'email', 'in_app'):
            deliver(
                alert, 'primary_guardian', channel, title, body,
                user=guardian.linked_user, name=guardian.name,
                phone=guardian.phone, email=guardian.email,
            )

    # 2. Security personnel
    for user in User.objects.filter(role='security', is_active=True):
        _notify_user(alert, user, 'security', ('push', 'in_app'), title, body)

    # 3. Volunteers
    for user in User.objects.filter(role='volunteer', is_active=True):
        _notify_user(alert, user, 'volunteer', ('push', 'in_app'), title, body)

    # 4. Community broadcast: other residents in the same society
    society_ids = ResidentFlatMapping.objects.filter(
        user=resident, is_active=True
    ).values_list('flat__block__society_id', flat=True)
    neighbour_ids = ResidentFlatMapping.objects.filter(
        is_active=True, flat__block__society_id__in=society_ids
    ).exclude(user=resident).values_list('user_id', flat=True)
    for user in User.objects.filter(id__in=neighbour_ids, role='resident', is_active=True):
        _notify_user(alert, user, 'community', ('in_app',), title, body)