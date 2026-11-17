from django.conf import settings
from django.db import models
from django.utils import timezone

from users.validators import try_normalize_phone


class EmergencyContact(models.Model):
    """
    An emergency contact or guardian link configured by a resident.
    Guardians require acceptance (status='accepted') before receiving SOS alerts
    or accessing resident incidents.
    """
    CONTACT_TYPES = [
        ('primary_guardian', 'Primary Guardian'),
        ('secondary_guardian', 'Secondary Guardian'),
        ('emergency_contact', 'Emergency Contact'),
    ]

    RELATIONSHIP_CHOICES = [
        ('spouse', 'Spouse'),
        ('parent', 'Parent'),
        ('sibling', 'Sibling'),
        ('child', 'Child'),
        ('relative', 'Relative'),
        ('friend', 'Friend'),
        ('neighbor', 'Neighbor'),
        ('colleague', 'Colleague'),
        ('doctor', 'Doctor'),
        ('other', 'Other'),
    ]

    STATUS_CHOICES = [
        ('pending', 'Pending'),
        ('accepted', 'Accepted'),
        ('declined', 'Declined'),
        ('cancelled', 'Cancelled'),
    ]

    resident = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name='emergency_contacts',
    )
    linked_user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='linked_as_contact',
    )

    contact_type = models.CharField(
        max_length=25,
        choices=CONTACT_TYPES,
        default='emergency_contact',
    )
    relationship = models.CharField(
        max_length=20,
        choices=RELATIONSHIP_CHOICES,
        default='other',
    )

    name = models.CharField(max_length=100)
    phone = models.CharField(max_length=20)
    email = models.EmailField(blank=True)
    address = models.TextField(blank=True)

    # Priority order for notification routing (lower = higher priority)
    priority = models.PositiveIntegerField(default=1)

    # Acceptance & verification lifecycle (kept strictly in sync)
    status = models.CharField(
        max_length=15,
        choices=STATUS_CHOICES,
        default='pending',
    )
    is_verified = models.BooleanField(default=False)
    verified_at = models.DateTimeField(null=True, blank=True)
    responded_at = models.DateTimeField(null=True, blank=True)
    last_reminded_at = models.DateTimeField(null=True, blank=True)

    is_active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['resident', 'priority']
        constraints = [
            models.UniqueConstraint(
                fields=['resident', 'contact_type'],
                condition=models.Q(
                    contact_type='primary_guardian',
                    is_active=True,
                    status__in=['pending', 'accepted'],
                ),
                name='unique_active_primary_guardian_per_resident',
            ),
            models.UniqueConstraint(
                fields=['resident', 'contact_type'],
                condition=models.Q(
                    contact_type='secondary_guardian',
                    is_active=True,
                    status__in=['pending', 'accepted'],
                ),
                name='unique_active_secondary_guardian_per_resident',
            ),
        ]

    def save(self, *args, **kwargs):
        if self.phone:
            norm = try_normalize_phone(self.phone)
            if norm:
                self.phone = norm
        self.is_verified = (self.status == 'accepted')
        if self.is_verified and not self.verified_at:
            self.verified_at = timezone.now()
        elif not self.is_verified:
            self.verified_at = None
        super().save(*args, **kwargs)

    def __str__(self):
        return (
            f"{self.name} ({self.get_contact_type_display()} · {self.status}) "
            f"← {self.resident.username}"
        )


class ResidentSecurityGuard(models.Model):
    """
    Security guard configured by a resident:
    - society_security: an approved security personnel from resident's society (linked_user set)
    - building_guard: a private/building guard not on app (name + phone for simulated SMS)
    """
    GUARD_TYPES = [
        ('society_security', 'Society Security'),
        ('building_guard', 'Building Guard'),
    ]

    resident = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name='resident_security_guards',
    )
    name = models.CharField(max_length=100)
    phone = models.CharField(max_length=20)
    guard_type = models.CharField(
        max_length=30,
        choices=GUARD_TYPES,
        default='society_security',
    )
    linked_user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='linked_as_guard',
    )
    post_label = models.CharField(max_length=100, blank=True)
    is_active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['-created_at']

    def save(self, *args, **kwargs):
        if self.phone:
            norm = try_normalize_phone(self.phone)
            if norm:
                self.phone = norm
        super().save(*args, **kwargs)

    def __str__(self):
        return f"{self.name} ({self.get_guard_type_display()}) for {self.resident.username}"
