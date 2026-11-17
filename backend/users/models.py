from django.contrib.auth.models import AbstractUser
from django.db import models
from django.db.models.functions import Lower

from .validators import normalize_phone


class User(AbstractUser):
    """
    Custom user model extending Django's AbstractUser.
    Enforces case-insensitive unique username and unique normalized phone number.
    """
    ROLE_CHOICES = [
        ('resident', 'Resident'),
        ('guardian', 'Guardian'),
        ('volunteer', 'Volunteer'),
        ('security', 'Security Personnel'),
        ('admin', 'Society Admin'),
    ]

    role = models.CharField(
        max_length=20,
        choices=ROLE_CHOICES,
        default='resident',
    )
    phone = models.CharField(max_length=20, blank=True)
    address = models.TextField(blank=True)
    profile_image_url = models.URLField(null=True, blank=True)

    # Override email to make it unique and required
    email = models.EmailField(unique=True)

    USERNAME_FIELD = 'email'
    REQUIRED_FIELDS = ['username', 'phone']

    class Meta(AbstractUser.Meta):
        constraints = [
            models.UniqueConstraint(
                Lower('username'),
                name='unique_user_username_ci',
            ),
            models.UniqueConstraint(
                fields=['phone'],
                condition=~models.Q(phone=''),
                name='unique_user_phone',
            ),
        ]

    def save(self, *args, **kwargs):
        if self.username:
            self.username = self.username.strip()
        if self.phone:
            self.phone = normalize_phone(self.phone)
        super().save(*args, **kwargs)

    def __str__(self):
        return f"{self.get_full_name() or self.username} ({self.role})"
