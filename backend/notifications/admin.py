from django.contrib import admin
from .models import Notification


@admin.register(Notification)
class NotificationAdmin(admin.ModelAdmin):
    list_display = (
        'id', 'incident', 'event_type', 'recipient_type',
        'channel', 'delivery_status', 'is_read', 'created_at',
    )
    list_filter = ('event_type', 'recipient_type', 'channel', 'delivery_status', 'is_read')
    search_fields = ('title', 'recipient_name', 'dedupe_key')
