from django.contrib import admin
from .models import EmergencyContact


@admin.register(EmergencyContact)
class EmergencyContactAdmin(admin.ModelAdmin):
    list_display = (
        'name', 'resident', 'linked_user', 'contact_type', 'relationship',
        'phone', 'status', 'is_verified', 'is_active',
    )
    list_filter = ('contact_type', 'relationship', 'status', 'is_verified', 'is_active')
    search_fields = ('name', 'phone', 'email', 'resident__email', 'linked_user__username')
    readonly_fields = ('is_verified', 'verified_at', 'responded_at', 'last_reminded_at')
