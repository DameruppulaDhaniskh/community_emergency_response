from django.contrib import admin
from .models import Incident, IncidentEvidence, IncidentHistory


@admin.register(Incident)
class IncidentAdmin(admin.ModelAdmin):
    list_display = (
        'id', 'title', 'resident', 'category', 'status',
        'assigned_to', 'is_escalated', 'created_at',
    )
    list_filter = ('status', 'category', 'is_escalated')
    search_fields = ('title', 'description', 'resident__email')


@admin.register(IncidentEvidence)
class IncidentEvidenceAdmin(admin.ModelAdmin):
    list_display = ('id', 'incident', 'uploaded_by', 'created_at')


@admin.register(IncidentHistory)
class IncidentHistoryAdmin(admin.ModelAdmin):
    list_display = ('id', 'incident', 'event_type', 'from_status', 'to_status', 'changed_by', 'created_at')
    list_filter = ('event_type',)
