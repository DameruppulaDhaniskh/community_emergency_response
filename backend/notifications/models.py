from django.conf import settings
from django.db import models


class Notification(models.Model):
    RECIPIENT_TYPES = [
        ('primary_guardian', 'Primary Guardian'),
        ('secondary_guardian', 'Secondary Guardian'),
        ('security', 'Security'),
        ('volunteer', 'Volunteer'),
        ('community', 'Community'),
        ('admin', 'Society Admin'),
        ('resident', 'Resident'),
    ]
    EVENT_TYPES = [
        ('INCIDENT_REPORTED', 'Incident Reported'),
        ('INCIDENT_ASSIGNED', 'Incident Assigned'),
        ('STATUS_CHANGED', 'Status Changed'),
        ('EVIDENCE_ADDED', 'Evidence Added'),
        ('ESCALATED', 'Escalated'),
        ('GUARDIAN_REQUEST', 'Guardian Request'),
        ('GUARDIAN_ACCEPTED', 'Guardian Request Accepted'),
        ('GUARDIAN_DECLINED', 'Guardian Request Declined'),
        ('GUARDIAN_SOS', 'Guardian SOS Alert'),
        ('ESCALATION_HANDOFF', 'Escalation Handoff'),
        ('ESCALATION_AUTO', 'Automatic Escalation'),
        ('ESCALATION_ACCEPTED', 'Escalation Accepted'),
        ('NO_RESPONDER', 'No Responder Alert'),
        ('ESCALATION_NOTICE', 'Escalation Notice'),
    ]
    CHANNELS = [
        ('push', 'Push'),
        ('sms', 'SMS'),
        ('email', 'Email'),
        ('in_app', 'In-App'),
    ]
    STATUS_CHOICES = [
        ('PENDING', 'Pending'),
        ('SENT', 'Sent'),
        ('DELIVERED', 'Delivered'),
        ('FAILED', 'Failed'),
    ]

    incident = models.ForeignKey(
        'incidents.Incident',
        on_delete=models.CASCADE,
        related_name='notifications',
        null=True,
        blank=True,
    )
    event_type = models.CharField(
        max_length=30, choices=EVENT_TYPES, default='INCIDENT_REPORTED'
    )
    recipient = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='notifications',
    )
    recipient_type = models.CharField(max_length=20, choices=RECIPIENT_TYPES)
    recipient_name = models.CharField(max_length=100, blank=True)
    recipient_phone = models.CharField(max_length=20, blank=True)
    recipient_email = models.EmailField(blank=True)
    channel = models.CharField(max_length=10, choices=CHANNELS)

    title = models.CharField(max_length=200)
    message = models.TextField()

    # Delivery tracking (separate from read status)
    delivery_status = models.CharField(max_length=10, choices=STATUS_CHOICES, default='PENDING')
    provider_message_id = models.CharField(max_length=100, blank=True)
    is_simulated = models.BooleanField(default=False)
    failure_reason = models.TextField(blank=True)
    attempt_count = models.PositiveSmallIntegerField(default=0)
    last_attempt_at = models.DateTimeField(null=True, blank=True)

    # Read tracking (in-app only; reading is NOT delivery or acknowledgment)
    is_read = models.BooleanField(default=False)
    read_at = models.DateTimeField(null=True, blank=True)

    created_at = models.DateTimeField(auto_now_add=True)
    sent_at = models.DateTimeField(null=True, blank=True)
    delivered_at = models.DateTimeField(null=True, blank=True)

    # Prevents duplicate notifications for the same event + recipient + channel
    dedupe_key = models.CharField(max_length=200)

    class Meta:
        ordering = ['-created_at']
        constraints = [
            models.UniqueConstraint(
                fields=['incident', 'dedupe_key'],
                condition=models.Q(incident__isnull=False),
                name='unique_notification_per_incident_dedupe',
            ),
            models.UniqueConstraint(
                fields=['dedupe_key'],
                condition=models.Q(incident__isnull=True),
                name='unique_non_incident_notification_dedupe',
            ),
        ]

    def __str__(self):
        return f"[{self.event_type}] {self.channel} -> {self.recipient_name} ({self.delivery_status})"
