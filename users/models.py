
from django.db import models


class Resident(models.Model):
    ROLE_CHOICES = [
        ('resident', 'Resident'),
        ('guardian', 'Guardian'),
        ('volunteer', 'Volunteer'),
        ('security', 'Security Personnel'),
    ]

    name = models.CharField(max_length=100)
    email = models.EmailField(unique=True)
    phone = models.CharField(max_length=15)
    role = models.CharField(
        max_length=20,
        choices=ROLE_CHOICES,
        default='resident'
    )

    def __str__(self):
        return f"{self.name} ({self.role})"
