from django.conf import settings
from django.db import models


class SOSAlert(models.Model):
    CATEGORY_CHOICES = [
        ('medical', 'Medical Emergency'),
        ('fall', 'Fall / Injury'),
        ('fire', 'Fire'),
        ('security', 'Security Threat'),
        ('accident', 'Accident'),
        ('other', 'Other'),
    ]
    STATUS_CHOICES = [
        ('active', 'Active'),
        ('acknowledged', 'Acknowledged'),
        ('escalated', 'Escalated'),
        ('resolved', 'Resolved'),
        ('cancelled', 'Cancelled'),
    ]

    resident = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name='sos_alerts'
    )
    category = models.CharField(max_length=20, choices=CATEGORY_CHOICES, default='other')
    message = models.TextField(blank=True)
    latitude = models.DecimalField(max_digits=9, decimal_places=6, null=True, blank=True)
    longitude = models.DecimalField(max_digits=9, decimal_places=6, null=True, blank=True)
    location_text = models.CharField(max_length=255, blank=True)
    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default='active')
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)
    resolved_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ['-created_at']

    def __str__(self):
        return f"SOS #{self.pk} - {self.resident.username} ({self.status})"


class NotificationLog(models.Model):
    RECIPIENT_TYPES = [
        ('primary_guardian', 'Primary Guardian'),
        ('secondary_guardian', 'Secondary Guardian'),
        ('emergency_contact', 'Emergency Contact'),
        ('security', 'Security'),
        ('volunteer', 'Volunteer'),
        ('community', 'Community'),
    ]
    CHANNEL_CHOICES = [
        ('push', 'Push'),
        ('sms', 'SMS'),
        ('email', 'Email'),
        ('in_app', 'In-App'),
    ]
    STATUS_CHOICES = [
        ('pending', 'Pending'),
        ('sent', 'Sent'),
        ('delivered', 'Delivered'),
        ('failed', 'Failed'),
    ]

    alert = models.ForeignKey(SOSAlert, on_delete=models.CASCADE, related_name='notifications')
    recipient_user = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True,
        related_name='received_notifications',
    )
    recipient_name = models.CharField(max_length=100, blank=True)
    recipient_phone = models.CharField(max_length=15, blank=True)
    recipient_email = models.EmailField(blank=True)
    recipient_type = models.CharField(max_length=25, choices=RECIPIENT_TYPES)
    channel = models.CharField(max_length=10, choices=CHANNEL_CHOICES)
    status = models.CharField(max_length=10, choices=STATUS_CHOICES, default='pending')
    error_message = models.TextField(blank=True)
    sent_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['-created_at']

    def __str__(self):
        return f"{self.channel} -> {self.recipient_name} ({self.status})"


class InAppNotification(models.Model):
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name='in_app_notifications'
    )
    alert = models.ForeignKey(
        SOSAlert, on_delete=models.CASCADE, null=True, blank=True, related_name='in_app_notifications'
    )
    title = models.CharField(max_length=200)
    message = models.TextField()
    is_read = models.BooleanField(default=False)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['-created_at']

    def __str__(self):
        return f"{self.title} -> {self.user.username}"


class AlertResponse(models.Model):
    STATUS_CHOICES = [
        ('acknowledged', 'Acknowledged'),
        ('on_the_way', 'On The Way'),
        ('arrived', 'Arrived'),
        ('resolved', 'Resolved'),
    ]

    alert = models.ForeignKey(SOSAlert, on_delete=models.CASCADE, related_name='responses')
    responder = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name='alert_responses'
    )
    status = models.CharField(max_length=15, choices=STATUS_CHOICES, default='acknowledged')
    note = models.TextField(blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['created_at']

    def __str__(self):
        return f"{self.responder.username}: {self.status} (SOS #{self.alert_id})"