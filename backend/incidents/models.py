from django.conf import settings
from django.db import models


class Incident(models.Model):
    EMERGENCY_TYPES = [
        ('medical', 'Medical Emergency'),
        ('fall', 'Fall / Injury'),
        ('fire', 'Fire'),
        ('security', 'Security Threat'),
        ('accident', 'Accident'),
        ('other', 'Other'),
    ]
    STATUS_CHOICES = [
        ('REPORTED', 'Reported'),
        ('ACKNOWLEDGED', 'Acknowledged'),
        ('ASSIGNED', 'Assigned'),
        ('IN_PROGRESS', 'In Progress'),
        ('RESOLVED', 'Resolved'),
        ('CLOSED', 'Closed'),
    ]

    resident = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name='incidents'
    )
    reported_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='reported_incidents',
    )
    title = models.CharField(max_length=200, blank=True)
    emergency_type = models.CharField(
        max_length=20, choices=EMERGENCY_TYPES, blank=True, default=''
    )
    category = models.CharField(
        max_length=20, choices=EMERGENCY_TYPES, blank=True, default=''
    )
    description = models.TextField(blank=True)

    latitude = models.DecimalField(max_digits=9, decimal_places=6, null=True, blank=True)
    longitude = models.DecimalField(max_digits=9, decimal_places=6, null=True, blank=True)
    location_captured_at = models.DateTimeField(null=True, blank=True)
    location_accuracy = models.FloatField(null=True, blank=True, help_text='Metres')

    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default='REPORTED')

    assigned_to = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='assigned_incidents',
    )
    assigned_at = models.DateTimeField(null=True, blank=True)
    acknowledged_at = models.DateTimeField(null=True, blank=True)
    in_progress_at = models.DateTimeField(null=True, blank=True)
    resolved_at = models.DateTimeField(null=True, blank=True)
    closed_at = models.DateTimeField(null=True, blank=True)
    close_reason = models.CharField(max_length=500, blank=True)

    is_escalated = models.BooleanField(default=False)
    escalated_at = models.DateTimeField(null=True, blank=True)
    escalated_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='manually_escalated_incidents',
    )
    escalation_trigger = models.CharField(
        max_length=30,
        default='none',
        choices=[
            ('none', 'None'),
            ('manual_guardian', 'Manual Guardian'),
            ('manual_resident', 'Manual Resident'),
            ('auto_timeout', 'Auto Timeout'),
        ],
    )
    guardian_alerted_at = models.DateTimeField(null=True, blank=True)
    guardian_acknowledged_at = models.DateTimeField(null=True, blank=True)
    guardian_acknowledged_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='acknowledged_incidents',
    )
    escalate_at = models.DateTimeField(null=True, blank=True)
    escalation_window_seconds = models.PositiveIntegerField(default=120)
    escalation_plan = models.JSONField(default=dict, blank=True)
    no_responder_alerted_at = models.DateTimeField(null=True, blank=True)

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['-created_at']

    def save(self, *args, **kwargs):
        # Keep category and emergency_type synchronized for M2 & M3 compatibility.
        if self.category and not self.emergency_type:
            self.emergency_type = self.category
        elif self.emergency_type and not self.category:
            self.category = self.emergency_type
        elif not self.emergency_type and not self.category:
            self.emergency_type = 'other'
            self.category = 'other'

        if not self.reported_by_id and self.resident_id:
            self.reported_by_id = self.resident_id

        super().save(*args, **kwargs)

    @property
    def location_available(self):
        return self.latitude is not None and self.longitude is not None

    def get_category_display_label(self):
        labels = dict(self.EMERGENCY_TYPES)
        return labels.get(self.category or self.emergency_type, 'Other')

    def __str__(self):
        return f"Incident #{self.pk} - {self.category or self.emergency_type} ({self.status})"


class IncidentEvidence(models.Model):
    MAX_PER_INCIDENT = 5
    MAX_FILE_SIZE_BYTES = 5 * 1024 * 1024
    ALLOWED_EXTENSIONS = ('jpg', 'jpeg', 'png', 'webp')

    incident = models.ForeignKey(Incident, on_delete=models.CASCADE, related_name='evidence')
    uploaded_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE)
    image = models.ImageField(upload_to='evidence/%Y/%m/')
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['created_at', 'id']

    def __str__(self):
        return f"Evidence #{self.pk} for Incident #{self.incident_id}"


class IncidentHistory(models.Model):
    EVENT_TYPE_CHOICES = [
        ('created', 'Created'),
        ('status_changed', 'Status Changed'),
        ('assigned', 'Assigned'),
        ('reassigned', 'Reassigned'),
        ('evidence_added', 'Evidence Added'),
        ('escalated', 'Escalated'),
        ('guardian_acknowledged', 'Guardian Acknowledged'),
        ('handoff', 'Guardian Handoff'),
        ('auto_escalated', 'Auto Escalated'),
        ('no_responder', 'No Responder Alerted'),
    ]

    incident = models.ForeignKey(Incident, on_delete=models.CASCADE, related_name='history')
    changed_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True)
    event_type = models.CharField(max_length=30, choices=EVENT_TYPE_CHOICES)
    from_status = models.CharField(max_length=20, blank=True)
    to_status = models.CharField(max_length=20, blank=True)
    note = models.TextField(blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['created_at', 'id']

    def __str__(self):
        return f"History #{self.pk} for Incident #{self.incident_id}: {self.event_type}"


class ResidentEscalationSettings(models.Model):
    resident = models.OneToOneField(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name='escalation_settings',
    )
    has_security_guard = models.BooleanField(default=False)
    escalate_to_security = models.BooleanField(default=True)
    escalate_to_volunteers = models.BooleanField(default=True)
    escalate_to_secondary_guardian = models.BooleanField(default=True)
    response_window_seconds = models.PositiveIntegerField(default=120)  # Allowed 60 to 300
    volunteer_radius_km = models.FloatField(default=2.0)  # Allowed 0.5 to 5.0
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        verbose_name = 'Resident escalation settings'
        verbose_name_plural = 'Resident escalation settings'

    def __str__(self):
        return f"Escalation settings for {self.resident.username}"


class IncidentEscalation(models.Model):
    ESCALATION_KINDS = [
        ('manual_guardian', 'Manual Guardian'),
        ('manual_resident', 'Manual Resident'),
        ('auto_timeout', 'Auto Timeout'),
        ('no_responder', 'No Responder'),
    ]

    incident = models.ForeignKey(
        Incident, on_delete=models.CASCADE, related_name='escalations'
    )
    kind = models.CharField(max_length=30, choices=ESCALATION_KINDS)
    triggered_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='triggered_escalations',
    )
    targets = models.JSONField(default=list)  # e.g. ["secondary_guardian", "security", "volunteers"]
    reason = models.CharField(max_length=50, blank=True)
    note = models.TextField(blank=True)
    volunteer_ids = models.JSONField(default=list, blank=True)
    volunteer_mode = models.CharField(
        max_length=20,
        default='auto',
        choices=[('selected', 'Selected'), ('auto', 'Auto')],
    )
    security_guard_ids = models.JSONField(default=list, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['created_at', 'id']

    def __str__(self):
        return f"Escalation #{self.pk} ({self.kind}) for Incident #{self.incident_id}"


class IncidentLocationUpdate(models.Model):
    incident = models.ForeignKey(
        Incident, on_delete=models.CASCADE, related_name='location_updates'
    )
    latitude = models.DecimalField(max_digits=9, decimal_places=6)
    longitude = models.DecimalField(max_digits=9, decimal_places=6)
    accuracy = models.FloatField(null=True, blank=True, help_text='Metres')
    captured_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['captured_at', 'id']

    def __str__(self):
        return f"Location update for Incident #{self.incident_id} at {self.captured_at}"

