import os
from io import BytesIO

from django.contrib.auth import get_user_model
from django.utils import timezone
from drf_spectacular.types import OpenApiTypes
from drf_spectacular.utils import extend_schema_field
from PIL import Image, UnidentifiedImageError
from rest_framework import serializers

from .models import (
    Incident,
    IncidentEscalation,
    IncidentEvidence,
    IncidentHistory,
    IncidentLocationUpdate,
    ResidentEscalationSettings,
)
from society.models import (
    ResidentFlatMapping,
    SocietyAssignment,
    VolunteerLocation,
    VolunteerProfile,
)

User = get_user_model()

VALID_CATEGORIES = [c[0] for c in Incident.EMERGENCY_TYPES]
ALLOWED_IMAGE_FORMATS = {'JPEG', 'PNG', 'WEBP'}


def validate_evidence_image_file(file_obj):
    """Validate uploaded image type (jpg/png/webp) and max size (5 MB)."""
    if file_obj is None:
        raise serializers.ValidationError('No image file provided.')

    if file_obj.size > IncidentEvidence.MAX_FILE_SIZE_BYTES:
        raise serializers.ValidationError(
            f'File "{file_obj.name}" exceeds the 5 MB maximum size limit.'
        )

    ext = os.path.splitext(file_obj.name or '')[1].lower().lstrip('.')
    if ext not in IncidentEvidence.ALLOWED_EXTENSIONS:
        raise serializers.ValidationError(
            f'Unsupported file type ".{ext}". Allowed types: jpg, jpeg, png, webp.'
        )

    try:
        pos = file_obj.tell()
        raw = file_obj.read()
        file_obj.seek(pos)
        img = Image.open(BytesIO(raw))
        img.verify()
        if (img.format or '').upper() not in ALLOWED_IMAGE_FORMATS:
            raise serializers.ValidationError(
                'Invalid image format. Only JPG, PNG, and WEBP images are allowed.'
            )
    except (UnidentifiedImageError, Exception) as exc:
        if isinstance(exc, serializers.ValidationError):
            raise
        raise serializers.ValidationError(
            f'"{file_obj.name}" is not a valid JPG, PNG, or WEBP image.'
        )


class CoordinateField(serializers.DecimalField):
    """
    Accepts floats, strings, or Decimals, and safely quantizes them to 6 decimal places
    (e.g. Decimal('0.000001')) and rounds to prevent max_decimal_places validation errors
    from standard browser GPS readings.
    """
    def __init__(self, **kwargs):
        kwargs.setdefault('max_digits', 9)
        kwargs.setdefault('decimal_places', 6)
        kwargs.setdefault('coerce_to_string', False)
        super().__init__(**kwargs)

    def to_internal_value(self, data):
        if data in (None, ''):
            return None
        try:
            val = round(float(data), self.decimal_places)
            data = f"{val:.{self.decimal_places}f}"
        except (ValueError, TypeError):
            pass
        return super().to_internal_value(data)


def _validate_coordinates(attrs):
    lat = attrs.get('latitude')
    lng = attrs.get('longitude')
    acc = attrs.get('location_accuracy') if attrs.get('location_accuracy') is not None else attrs.get('accuracy')
    if (lat is None) != (lng is None):
        raise serializers.ValidationError(
            'Provide both latitude and longitude, or neither.'
        )
    if lat is not None:
        if not -90 <= lat <= 90:
            raise serializers.ValidationError({'latitude': 'Must be between -90 and 90.'})
        if not -180 <= lng <= 180:
            raise serializers.ValidationError({'longitude': 'Must be between -180 and 180.'})
        if acc is not None and acc < 0:
            raise serializers.ValidationError({'location_accuracy': 'Accuracy must be positive or zero.'})
        if not attrs.get('location_captured_at'):
            attrs['location_captured_at'] = timezone.now()
    return attrs


class IncidentCreateSerializer(serializers.ModelSerializer):
    """SOS creation serializer (keeps Milestone 2 contract intact)."""
    emergency_type = serializers.ChoiceField(
        choices=Incident.EMERGENCY_TYPES, required=False
    )
    category = serializers.ChoiceField(
        choices=Incident.EMERGENCY_TYPES, required=False
    )
    latitude = CoordinateField(required=False, allow_null=True)
    longitude = CoordinateField(required=False, allow_null=True)

    class Meta:
        model = Incident
        fields = [
            'emergency_type', 'category', 'description', 'latitude', 'longitude',
            'location_captured_at', 'location_accuracy',
        ]

    def validate(self, attrs):
        cat = attrs.get('category') or attrs.get('emergency_type')
        if not cat:
            raise serializers.ValidationError(
                {'emergency_type': 'emergency_type (or category) is required.'}
            )
        attrs['emergency_type'] = cat
        attrs['category'] = cat
        return _validate_coordinates(attrs)


class IncidentReportCreateSerializer(serializers.ModelSerializer):
    """Detailed form-based incident report serializer (POST /api/incidents/)."""
    title = serializers.CharField(max_length=200, required=True, allow_blank=False)
    category = serializers.ChoiceField(choices=Incident.EMERGENCY_TYPES, required=False)
    emergency_type = serializers.ChoiceField(choices=Incident.EMERGENCY_TYPES, required=False)
    latitude = CoordinateField(required=False, allow_null=True)
    longitude = CoordinateField(required=False, allow_null=True)

    class Meta:
        model = Incident
        fields = [
            'title', 'category', 'emergency_type', 'description',
            'latitude', 'longitude', 'location_captured_at', 'location_accuracy',
        ]

    def validate_title(self, value):
        cleaned = (value or '').strip()
        if not cleaned:
            raise serializers.ValidationError('Title is required.')
        return cleaned

    def validate(self, attrs):
        cat = attrs.get('category') or attrs.get('emergency_type')
        if not cat:
            raise serializers.ValidationError({'category': 'Category is required.'})
        attrs['category'] = cat
        attrs['emergency_type'] = cat
        return _validate_coordinates(attrs)


class IncidentEvidenceSerializer(serializers.ModelSerializer):
    uploaded_by_name = serializers.SerializerMethodField()
    image_url = serializers.SerializerMethodField()
    url = serializers.SerializerMethodField()

    class Meta:
        model = IncidentEvidence
        fields = [
            'id', 'incident', 'uploaded_by', 'uploaded_by_name',
            'image', 'image_url', 'url', 'created_at',
        ]
        read_only_fields = ['id', 'incident', 'uploaded_by', 'uploaded_by_name', 'image_url', 'url', 'created_at']

    def get_uploaded_by_name(self, obj) -> str:
        if obj.uploaded_by:
            return obj.uploaded_by.get_full_name() or obj.uploaded_by.username
        return ''

    def _build_url(self, obj):
        if not obj.image:
            return None
        url = obj.image.url
        request = self.context.get('request')
        if request and url.startswith('/'):
            return request.build_absolute_uri(url)
        return url

    def get_image_url(self, obj) -> str | None:
        return self._build_url(obj)

    def get_url(self, obj) -> str | None:
        return self._build_url(obj)


class IncidentHistorySerializer(serializers.ModelSerializer):
    changed_by_name = serializers.SerializerMethodField()

    class Meta:
        model = IncidentHistory
        fields = [
            'id', 'incident', 'changed_by', 'changed_by_name',
            'event_type', 'from_status', 'to_status', 'note', 'created_at',
        ]
        read_only_fields = fields

    def get_changed_by_name(self, obj) -> str:
        if obj.changed_by:
            return obj.changed_by.get_full_name() or obj.changed_by.username
        return 'System'


class UserSummarySerializer(serializers.ModelSerializer):
    name = serializers.SerializerMethodField()

    class Meta:
        model = User
        fields = ['id', 'name', 'phone', 'email', 'role']

    def get_name(self, obj) -> str:
        return obj.get_full_name() or obj.username


class IncidentSerializer(serializers.ModelSerializer):
    location_available = serializers.BooleanField(read_only=True)
    resident_name = serializers.SerializerMethodField()
    flat_number = serializers.SerializerMethodField()
    reporter = serializers.SerializerMethodField()
    assigned_to = serializers.SerializerMethodField()
    assigned_to_id = serializers.IntegerField(read_only=True)
    evidence = IncidentEvidenceSerializer(many=True, read_only=True)
    evidence_urls = serializers.SerializerMethodField()
    history = IncidentHistorySerializer(many=True, read_only=True)
    history_summary = serializers.SerializerMethodField()
    location = serializers.SerializerMethodField()
    escalation = serializers.SerializerMethodField()
    guardian_acknowledged = serializers.SerializerMethodField()
    alerted = serializers.SerializerMethodField()
    handoff_defaults = serializers.SerializerMethodField()

    class Meta:
        model = Incident
        fields = [
            'id', 'resident', 'resident_name', 'flat_number',
            'reported_by', 'reporter',
            'title', 'category', 'emergency_type', 'description',
            'latitude', 'longitude', 'location_available',
            'location_captured_at', 'location_accuracy', 'location',
            'status', 'is_escalated', 'escalated_at', 'escalation_trigger',
            'assigned_to_id', 'assigned_to', 'assigned_at',
            'acknowledged_at', 'in_progress_at', 'resolved_at',
            'closed_at', 'close_reason',
            'evidence', 'evidence_urls',
            'history', 'history_summary',
            'escalation', 'guardian_acknowledged', 'alerted', 'handoff_defaults',
            'created_at', 'updated_at',
        ]
        read_only_fields = fields

    def to_representation(self, obj):
        data = super().to_representation(obj)
        request = self.context.get('request')
        user = getattr(request, 'user', None)

        # Cross-society privacy rule:
        # Cross-society volunteers receive only category, maps link, distance, and resident's first name
        # (no phone, flat, message or other personal details until accepted)
        if user and getattr(user, 'role', '') == 'volunteer' and obj.assigned_to_id != user.id:
            vp = VolunteerProfile.objects.filter(user=user).first()
            mapping = ResidentFlatMapping.objects.filter(user=obj.resident, is_active=True).select_related('flat__block').first()
            res_soc_id = mapping.flat.block.society_id if mapping and mapping.flat and mapping.flat.block else None

            if vp and res_soc_id and vp.society_id != res_soc_id:
                first_name = obj.resident.first_name or obj.resident.username.split()[0]
                data['resident_name'] = first_name
                data['flat_number'] = None
                data['description'] = ''
                data['reporter'] = {'id': obj.resident_id, 'name': first_name, 'phone': ''}
                data['evidence'] = []
                data['evidence_urls'] = []
                data['is_cross_society_preview'] = True

        return data

    def get_resident_name(self, obj) -> str:
        return obj.resident.get_full_name() or obj.resident.username

    def get_flat_number(self, obj) -> str | None:
        mapping = next(
            (m for m in obj.resident.flat_mappings.all() if m.is_active),
            None,
        )
        if mapping and mapping.flat:
            return f"Flat {mapping.flat.flat_number}, {mapping.flat.block.name}"
        return None

    @extend_schema_field(OpenApiTypes.OBJECT)
    def get_reporter(self, obj) -> dict:
        u = obj.reported_by or obj.resident
        return {
            'id': u.pk,
            'name': u.get_full_name() or u.username,
            'phone': u.phone,
        }

    @extend_schema_field(OpenApiTypes.OBJECT)
    def get_assigned_to(self, obj) -> dict | None:
        if not obj.assigned_to:
            return None
        u = obj.assigned_to
        return {
            'id': u.pk,
            'name': u.get_full_name() or u.username,
            'phone': u.phone,
        }

    def get_evidence_urls(self, obj) -> list[str]:
        urls = []
        request = self.context.get('request')
        for ev in obj.evidence.all():
            if ev.image:
                url = ev.image.url
                if request and url.startswith('/'):
                    url = request.build_absolute_uri(url)
                urls.append(url)
        return urls

    @extend_schema_field(OpenApiTypes.OBJECT)
    def get_history_summary(self, obj) -> dict:
        entries = list(obj.history.all())
        latest = entries[-1] if entries else None
        return {
            'total_events': len(entries),
            'latest_event_type': latest.event_type if latest else None,
            'latest_note': latest.note if latest else '',
            'latest_event_at': latest.created_at if latest else None,
        }

    @extend_schema_field(OpenApiTypes.OBJECT)
    def get_location(self, obj) -> dict:
        lat = float(obj.latitude) if obj.latitude is not None else None
        lng = float(obj.longitude) if obj.longitude is not None else None
        maps_url = f"https://www.google.com/maps?q={obj.latitude},{obj.longitude}" if lat is not None and lng is not None else None
        return {
            'available': obj.location_available,
            'latitude': str(obj.latitude) if obj.latitude is not None else None,
            'longitude': str(obj.longitude) if obj.longitude is not None else None,
            'accuracy': obj.location_accuracy,
            'captured_at': obj.location_captured_at,
            'maps_url': maps_url,
        }

    @extend_schema_field(OpenApiTypes.OBJECT)
    def get_escalation(self, obj) -> dict:
        now = timezone.now()
        seconds_remaining = None
        if obj.escalate_at and not obj.is_escalated and not obj.guardian_acknowledged_at:
            seconds_remaining = max(0, int((obj.escalate_at - now).total_seconds()))

        esc_history = []
        for esc in obj.escalations.all():
            esc_history.append({
                'id': esc.pk,
                'kind': esc.kind,
                'triggered_by': esc.triggered_by.get_full_name() or esc.triggered_by.username if esc.triggered_by else None,
                'targets': esc.targets,
                'reason': esc.reason,
                'note': esc.note,
                'volunteer_count': len(esc.volunteer_ids or []),
                'created_at': esc.created_at,
            })

        return {
            'window_seconds': obj.escalation_window_seconds or 120,
            'escalate_at': obj.escalate_at,
            'seconds_remaining': seconds_remaining,
            'is_escalated': obj.is_escalated,
            'trigger': obj.escalation_trigger,
            'escalated_at': obj.escalated_at,
            'escalated_by': obj.escalated_by.get_full_name() or obj.escalated_by.username if obj.escalated_by else None,
            'targets': obj.escalation_plan.get('targets', []) if obj.escalation_plan else [],
            'history': esc_history,
            'no_responder_alerted': bool(obj.no_responder_alerted_at),
        }

    @extend_schema_field(OpenApiTypes.OBJECT)
    def get_guardian_acknowledged(self, obj) -> dict | None:
        if not obj.guardian_acknowledged_at:
            return None
        u = obj.guardian_acknowledged_by
        return {
            'acknowledged_at': obj.guardian_acknowledged_at,
            'acknowledged_by_id': u.pk if u else None,
            'acknowledged_by_name': u.get_full_name() or u.username if u else None,
        }

    @extend_schema_field(OpenApiTypes.OBJECT)
    def get_alerted(self, obj) -> dict:
        groups = set()
        vol_ids = set()
        for esc in obj.escalations.all():
            for t in (esc.targets or []):
                groups.add(t)
            for vid in (esc.volunteer_ids or []):
                vol_ids.add(vid)

        return {
            'groups': list(groups),
            'volunteer_count': len(vol_ids),
            'who_accepted': (
                obj.assigned_to.get_full_name() or obj.assigned_to.username
                if obj.assigned_to else None
            ),
            'accepted_at': obj.assigned_at,
        }

    @extend_schema_field(OpenApiTypes.OBJECT)
    def get_handoff_defaults(self, obj) -> list[str]:
        cat = obj.category or obj.emergency_type or 'other'
        defaults_by_cat = {
            'medical': ['volunteers', 'security', 'secondary_guardian'],
            'fire': ['security', 'volunteers'],
            'security': ['security', 'secondary_guardian'],
            'fall': ['volunteers', 'secondary_guardian'],
            'accident': ['volunteers', 'secondary_guardian'],
            'other': ['secondary_guardian', 'volunteers'],
        }
        targets = list(defaults_by_cat.get(cat, ['secondary_guardian', 'volunteers']))

        settings_obj = getattr(obj.resident, 'escalation_settings', None)
        if settings_obj:
            if not settings_obj.escalate_to_secondary_guardian and 'secondary_guardian' in targets:
                targets.remove('secondary_guardian')
            if (not settings_obj.has_security_guard or not settings_obj.escalate_to_security) and 'security' in targets:
                targets.remove('security')
            if not settings_obj.escalate_to_volunteers and 'volunteers' in targets:
                targets.remove('volunteers')
        return targets


class ResidentEscalationSettingsSerializer(serializers.ModelSerializer):
    class Meta:
        model = ResidentEscalationSettings
        fields = [
            'has_security_guard',
            'escalate_to_security',
            'escalate_to_volunteers',
            'escalate_to_secondary_guardian',
            'response_window_seconds',
            'volunteer_radius_km',
            'updated_at',
        ]

    def validate_response_window_seconds(self, value):
        if not (60 <= value <= 300):
            raise serializers.ValidationError("response_window_seconds must be between 60 and 300.")
        return value

    def validate_volunteer_radius_km(self, value):
        if not (0.5 <= value <= 5.0):
            raise serializers.ValidationError("volunteer_radius_km must be between 0.5 and 5.0.")
        return value


class GuardianHandoffSerializer(serializers.Serializer):
    targets = serializers.ListField(
        child=serializers.ChoiceField(choices=['secondary_guardian', 'security', 'volunteers']),
        allow_empty=False,
    )
    reason = serializers.ChoiceField(choices=['far_away', 'busy', 'other'])
    note = serializers.CharField(max_length=500, required=False, allow_blank=True, default='')
    volunteer_mode = serializers.ChoiceField(
        choices=['auto', 'selected'], required=False, default='auto'
    )
    volunteer_ids = serializers.ListField(
        child=serializers.IntegerField(), required=False, default=list
    )
    security_guard_ids = serializers.ListField(
        child=serializers.IntegerField(), required=False, default=list
    )


class IncidentLocationUpdateSerializer(serializers.ModelSerializer):
    latitude = CoordinateField(required=False, allow_null=True)
    longitude = CoordinateField(required=False, allow_null=True)

    class Meta:
        model = IncidentLocationUpdate
        fields = ['latitude', 'longitude', 'accuracy']

    def validate(self, attrs):
        return _validate_coordinates(attrs)


class VolunteerLocationSerializer(serializers.ModelSerializer):
    latitude = CoordinateField(required=False, allow_null=True)
    longitude = CoordinateField(required=False, allow_null=True)

    class Meta:
        model = VolunteerLocation
        fields = ['latitude', 'longitude', 'accuracy', 'updated_at']
        read_only_fields = ['updated_at']

    def validate(self, attrs):
        return _validate_coordinates(attrs)


class VolunteerProfileSerializer(serializers.ModelSerializer):
    society_name = serializers.CharField(source='society.name', read_only=True)
    block_name = serializers.CharField(source='block.name', read_only=True)
    latitude = CoordinateField(required=False, allow_null=True)
    longitude = CoordinateField(required=False, allow_null=True)

    class Meta:
        model = VolunteerProfile
        fields = [
            'id', 'society', 'society_name', 'block', 'block_name',
            'latitude', 'longitude', 'pin_label', 'max_travel_km',
            'serves_nearby_societies', 'approval_status',
            'approval_reviewed_at', 'approval_note',
            'pin_far_from_society', 'pin_distance_from_society_km',
        ]
        read_only_fields = [
            'approval_status', 'approval_reviewed_at', 'approval_note',
            'pin_far_from_society', 'pin_distance_from_society_km',
        ]

    def validate_max_travel_km(self, value):
        if value is not None and value <= 0:
            raise serializers.ValidationError("max_travel_km must be greater than 0.")
        return value


class AdminVolunteerApprovalSerializer(serializers.Serializer):
    reason = serializers.CharField(max_length=500, required=False, allow_blank=True, default='')



class IncidentStatusSerializer(serializers.ModelSerializer):
    class Meta:
        model = Incident
        fields = [
            'id', 'status', 'is_escalated', 'escalated_at',
            'acknowledged_at', 'assigned_at', 'in_progress_at',
            'resolved_at', 'closed_at', 'close_reason', 'updated_at',
        ]
        read_only_fields = fields


class IncidentStatusUpdateSerializer(serializers.Serializer):
    status = serializers.ChoiceField(choices=[c[0] for c in Incident.STATUS_CHOICES])
    note = serializers.CharField(max_length=1000, required=False, allow_blank=True, default='')
    close_reason = serializers.CharField(max_length=500, required=False, allow_blank=True, default='')


class IncidentAssignSerializer(serializers.Serializer):
    volunteer_id = serializers.IntegerField()
    note = serializers.CharField(max_length=500, required=False, allow_blank=True, default='')


class AvailableVolunteerSerializer(serializers.ModelSerializer):
    name = serializers.SerializerMethodField()
    is_available = serializers.SerializerMethodField()
    open_assignments_count = serializers.IntegerField(read_only=True)

    class Meta:
        model = User
        fields = ['id', 'name', 'phone', 'email', 'is_available', 'open_assignments_count']

    def get_name(self, obj) -> str:
        return obj.get_full_name() or obj.username

    def get_is_available(self, obj) -> bool:
        society_ids = self.context.get('society_ids')
        qs = obj.society_assignments.filter(is_active=True)
        if society_ids is not None:
            qs = qs.filter(society_id__in=society_ids)
        return qs.filter(is_available=True).exists()
