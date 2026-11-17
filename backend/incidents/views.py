import logging
from datetime import timedelta
from decimal import Decimal

from django.contrib.auth import get_user_model
from django.db import connection, transaction
from django.db.models import Count, Q
from django.shortcuts import get_object_or_404
from django.utils import timezone
from django_filters import rest_framework as df_filters
from django_filters.rest_framework import DjangoFilterBackend
from drf_spectacular.types import OpenApiTypes
from drf_spectacular.utils import OpenApiExample, OpenApiParameter, extend_schema, inline_serializer
from rest_framework import filters, generics, serializers as drf_serializers, status
from rest_framework.exceptions import PermissionDenied, ValidationError
from rest_framework.pagination import PageNumberPagination
from rest_framework.parsers import FormParser, JSONParser, MultiPartParser
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from contacts.models import EmergencyContact, ResidentSecurityGuard
from notifications.services import (
    notify_escalated,
    notify_evidence_added,
    notify_guardian_sos,
    notify_incident,
    notify_incident_assigned,
    notify_status_changed,
)
from society.models import (
    ResidentFlatMapping,
    SecurityProfile,
    Society,
    SocietyAssignment,
    VolunteerLocation,
    VolunteerProfile,
)

from .access import ACTIVE_STATES, incidents_for_user
from .escalation import (
    _resident_society_ids,
    build_escalation_plan,
    get_or_create_escalation_settings,
    guardian_acknowledge,
    opportunistic_check_escalations,
    security_acknowledge,
    trigger_escalation,
    volunteer_accept_incident,
)
from .matching import (
    estimate_volunteer_breakdown,
    get_incident_reference_point,
    get_resident_block_id,
    haversine_km,
)
from .models import (
    Incident,
    IncidentEvidence,
    IncidentHistory,
    IncidentLocationUpdate,
    ResidentEscalationSettings,
)
from .serializers import (
    AvailableVolunteerSerializer,
    GuardianHandoffSerializer,
    IncidentAssignSerializer,
    IncidentCreateSerializer,
    IncidentEvidenceSerializer,
    IncidentHistorySerializer,
    IncidentLocationUpdateSerializer,
    IncidentReportCreateSerializer,
    IncidentSerializer,
    IncidentStatusSerializer,
    IncidentStatusUpdateSerializer,
    ResidentEscalationSettingsSerializer,
    VolunteerLocationSerializer,
    validate_evidence_image_file,
)

logger = logging.getLogger(__name__)
User = get_user_model()


def _safe_call(fn, *args, **kwargs):
    try:
        fn(*args, **kwargs)
    except Exception:
        logger.exception('Post-commit notification dispatch failed')


def _safe_notify_incident(incident):
    _safe_call(notify_incident, incident)


def _incident_queryset(user):
    return (
        incidents_for_user(user)
        .select_related('resident', 'reported_by', 'assigned_to')
        .prefetch_related(
            'evidence',
            'history',
            'history__changed_by',
            'resident__flat_mappings',
            'resident__flat_mappings__flat',
            'resident__flat_mappings__flat__block',
        )
    )


class OptionalPageNumberPagination(PageNumberPagination):
    """Paginate when ?page= or ?page_size= is passed; preserve list format otherwise."""
    page_size = 20
    page_size_query_param = 'page_size'
    max_page_size = 100

    def paginate_queryset(self, queryset, request, view=None):
        if 'page' not in request.query_params and 'page_size' not in request.query_params:
            return None
        return super().paginate_queryset(queryset, request, view=view)


class IncidentFilter(df_filters.FilterSet):
    category = df_filters.CharFilter(method='filter_category')
    emergency_type = df_filters.CharFilter(method='filter_category')
    assigned_to = df_filters.CharFilter(method='filter_assigned_to')

    class Meta:
        model = Incident
        fields = ['status', 'category', 'emergency_type', 'assigned_to', 'is_escalated']

    def filter_category(self, queryset, name, value):
        return queryset.filter(Q(category=value) | Q(emergency_type=value))

    def filter_assigned_to(self, queryset, name, value):
        if value in ('unassigned', 'none', 'null'):
            return queryset.filter(assigned_to__isnull=True)
        if value.isdigit():
            return queryset.filter(assigned_to_id=int(value))
        return queryset.none()


@extend_schema(
    summary='Trigger one-tap emergency SOS (Resident only)',
    examples=[
        OpenApiExample(
            'SOS Request',
            value={'emergency_type': 'medical', 'description': 'Chest pain', 'latitude': '12.971600', 'longitude': '77.594600'},
            request_only=True,
        ),
        OpenApiExample(
            'SOS Response',
            value={'id': 15, 'status': 'REPORTED', 'created_at': '2026-11-10T10:30:00Z', 'location_available': True},
            response_only=True,
        ),
    ],
    responses={
        201: inline_serializer(
            name='SOSResponse',
            fields={
                'id': drf_serializers.IntegerField(),
                'status': drf_serializers.CharField(),
                'created_at': drf_serializers.DateTimeField(),
                'location_available': drf_serializers.BooleanField(),
            },
        )
    },
)
class SOSCreateView(generics.CreateAPIView):
    """POST /api/incidents/sos/ - one-tap SOS; resident is taken from token only."""
    serializer_class = IncidentCreateSerializer
    permission_classes = [IsAuthenticated]

    def create(self, request, *args, **kwargs):
        if request.user.role != 'resident':
            raise PermissionDenied('Only residents can raise an SOS.')

        serializer = self.get_serializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        category = serializer.validated_data.get('category') or serializer.validated_data.get('emergency_type')
        label = dict(Incident.EMERGENCY_TYPES).get(category, 'Emergency')

        with transaction.atomic():
            incident = serializer.save(
                resident=request.user,
                reported_by=request.user,
                status='REPORTED',
                title=f'SOS: {label}',
            )
            IncidentHistory.objects.create(
                incident=incident,
                changed_by=request.user,
                event_type='created',
                to_status='REPORTED',
                note='SOS alert raised',
            )

            has_settings = ResidentEscalationSettings.objects.filter(resident=request.user).exists()
            if has_settings:
                settings_obj = ResidentEscalationSettings.objects.get(resident=request.user)
                plan = build_escalation_plan(incident, settings_obj=settings_obj)
                incident.escalation_window_seconds = plan['window_seconds']
                incident.escalation_plan = plan
                now = timezone.now()
                if plan['has_verified_guardian']:
                    incident.guardian_alerted_at = now
                    incident.escalate_at = now + timedelta(seconds=plan['window_seconds'])
                    incident.save(update_fields=[
                        'escalation_window_seconds', 'escalation_plan', 'guardian_alerted_at', 'escalate_at', 'updated_at'
                    ])
                    transaction.on_commit(lambda inc=incident: _safe_call(notify_guardian_sos, inc))
                else:
                    incident.escalate_at = now
                    incident.save(update_fields=[
                        'escalation_window_seconds', 'escalation_plan', 'escalate_at', 'updated_at'
                    ])
                    transaction.on_commit(lambda inc=incident: _safe_call(
                        trigger_escalation, inc, kind='auto_timeout', note='Immediate escalation: resident has no verified guardian.'
                    ))
            else:
                transaction.on_commit(lambda inc=incident: _safe_notify_incident(inc))

        resp_data = {
            'id': incident.pk,
            'status': incident.status,
            'created_at': incident.created_at,
            'location_available': incident.location_available,
        }
        if incident.escalation_plan:
            resp_data['escalation'] = {
                'window_seconds': incident.escalation_window_seconds,
                'escalate_at': incident.escalate_at.isoformat() if incident.escalate_at else None,
                'targets': incident.escalation_plan.get('targets', []),
                'has_verified_guardian': incident.escalation_plan.get('has_verified_guardian', False),
                'primary_guardian_name': incident.escalation_plan.get('primary_guardian_name'),
            }
        return Response(resp_data, status=status.HTTP_201_CREATED)


class ResidentIncidentListView(generics.ListAPIView):
    """GET /api/resident/incidents/ - my own incident history."""
    serializer_class = IncidentSerializer
    permission_classes = [IsAuthenticated]

    def get(self, request, *args, **kwargs):
        opportunistic_check_escalations()
        return super().get(request, *args, **kwargs)

    def get_queryset(self):
        if getattr(self, 'swagger_fake_view', False):
            return Incident.objects.none()
        return (
            Incident.objects.filter(resident=self.request.user)
            .select_related('resident', 'reported_by', 'assigned_to')
            .prefetch_related(
                'evidence',
                'history',
                'history__changed_by',
                'resident__flat_mappings',
                'resident__flat_mappings__flat',
                'resident__flat_mappings__flat__block',
            )
        )


class IncidentListCreateView(generics.ListCreateAPIView):
    """
    GET  /api/incidents/ - list incidents authorized for user with filters, search, ordering, pagination.
    POST /api/incidents/ - detailed incident report by resident (supports multipart images).
    """
    permission_classes = [IsAuthenticated]
    parser_classes = [MultiPartParser, FormParser, JSONParser]
    filter_backends = [DjangoFilterBackend, filters.SearchFilter, filters.OrderingFilter]
    filterset_class = IncidentFilter
    search_fields = ['title', 'description', 'resident__first_name', 'resident__last_name', 'resident__username']
    ordering_fields = ['created_at', 'updated_at', 'status', 'category']
    ordering = ['-created_at']
    pagination_class = OptionalPageNumberPagination

    def get_serializer_class(self):
        if self.request.method == 'POST':
            return IncidentReportCreateSerializer
        return IncidentSerializer

    def get_queryset(self):
        if getattr(self, 'swagger_fake_view', False):
            return Incident.objects.none()
        return _incident_queryset(self.request.user)

    @extend_schema(
        summary='List authorized incidents with filters, search, ordering, pagination',
        parameters=[
            OpenApiParameter('status', OpenApiTypes.STR, description='REPORTED|ACKNOWLEDGED|ASSIGNED|IN_PROGRESS|RESOLVED|CLOSED'),
            OpenApiParameter('category', OpenApiTypes.STR, description='medical|fall|fire|security|accident|other'),
            OpenApiParameter('assigned_to', OpenApiTypes.STR, description='Volunteer ID or "unassigned"'),
            OpenApiParameter('search', OpenApiTypes.STR, description='Search title, description, or resident name'),
            OpenApiParameter('ordering', OpenApiTypes.STR, description='e.g. -created_at or status'),
            OpenApiParameter('page', OpenApiTypes.INT, description='Optional page number for paginated response'),
            OpenApiParameter('page_size', OpenApiTypes.INT, description='Page size (max 100)'),
        ],
    )
    def get(self, request, *args, **kwargs):
        opportunistic_check_escalations()
        return super().get(request, *args, **kwargs)

    @extend_schema(
        summary='Report a detailed incident with optional images (Resident only)',
        request={'multipart/form-data': IncidentReportCreateSerializer},
        responses={
            201: inline_serializer(
                name='IncidentReportResponse',
                fields={
                    'id': drf_serializers.IntegerField(),
                    'title': drf_serializers.CharField(),
                    'category': drf_serializers.CharField(),
                    'status': drf_serializers.CharField(),
                    'created_at': drf_serializers.DateTimeField(),
                    'location_available': drf_serializers.BooleanField(),
                    'evidence_count': drf_serializers.IntegerField(),
                },
            )
        },
    )
    def post(self, request, *args, **kwargs):
        return super().post(request, *args, **kwargs)

    def create(self, request, *args, **kwargs):
        if request.user.role != 'resident':
            raise PermissionDenied('Only residents can report incidents.')

        files = request.FILES.getlist('images') or request.FILES.getlist('image')
        if len(files) > IncidentEvidence.MAX_PER_INCIDENT:
            return Response(
                {'images': f'A maximum of {IncidentEvidence.MAX_PER_INCIDENT} images is allowed per incident.'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        from rest_framework.exceptions import ValidationError as DRFValidationError
        for f in files:
            try:
                validate_evidence_image_file(f)
            except DRFValidationError as exc:
                return Response({'images': exc.detail}, status=status.HTTP_400_BAD_REQUEST)

        serializer = self.get_serializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        with transaction.atomic():
            incident = serializer.save(
                resident=request.user,
                reported_by=request.user,
                status='REPORTED',
            )
            for f in files:
                IncidentEvidence.objects.create(
                    incident=incident,
                    uploaded_by=request.user,
                    image=f,
                )
            IncidentHistory.objects.create(
                incident=incident,
                changed_by=request.user,
                event_type='created',
                to_status='REPORTED',
                note=f'Incident reported: {incident.title}',
            )
            transaction.on_commit(lambda inc=incident: _safe_notify_incident(inc))

        return Response(
            {
                'id': incident.pk,
                'title': incident.title,
                'category': incident.category,
                'status': incident.status,
                'created_at': incident.created_at,
                'location_available': incident.location_available,
                'evidence_count': len(files),
            },
            status=status.HTTP_201_CREATED,
        )


class IncidentDetailView(generics.RetrieveAPIView):
    """GET /api/incidents/<id>/ - 404 if not authorized."""
    serializer_class = IncidentSerializer
    permission_classes = [IsAuthenticated]

    def get(self, request, *args, **kwargs):
        opportunistic_check_escalations()
        return super().get(request, *args, **kwargs)

    def get_queryset(self):
        if getattr(self, 'swagger_fake_view', False):
            return Incident.objects.none()
        return _incident_queryset(self.request.user)


class IncidentStatusView(APIView):
    """
    GET   /api/incidents/<id>/status/ - lightweight status polling
    PATCH /api/incidents/<id>/status/ - role-enforced status transition
    """
    permission_classes = [IsAuthenticated]
    serializer_class = IncidentStatusUpdateSerializer

    ADMIN_TRANSITIONS = {
        'REPORTED': ['ACKNOWLEDGED', 'ASSIGNED', 'CLOSED'],
        'ACKNOWLEDGED': ['ASSIGNED', 'CLOSED'],
        'ASSIGNED': ['IN_PROGRESS', 'CLOSED'],
        'IN_PROGRESS': ['RESOLVED', 'CLOSED'],
        'RESOLVED': ['CLOSED'],
    }
    VOLUNTEER_TRANSITIONS = {
        'ASSIGNED': ['IN_PROGRESS'],
        'IN_PROGRESS': ['RESOLVED'],
    }
    SECURITY_TRANSITIONS = {
        'REPORTED': ['ACKNOWLEDGED'],
    }

    @extend_schema(summary='Poll incident lifecycle status', responses={200: IncidentStatusSerializer})
    def get(self, request, pk):
        opportunistic_check_escalations()
        incident = get_object_or_404(incidents_for_user(request.user), pk=pk)
        return Response(IncidentStatusSerializer(incident).data)

    @extend_schema(
        summary='Transition incident status (role-enforced)',
        request=IncidentStatusUpdateSerializer,
        responses={200: IncidentSerializer},
        examples=[
            OpenApiExample('Acknowledge', value={'status': 'ACKNOWLEDGED', 'note': 'Security verifying'}, request_only=True),
            OpenApiExample('Close', value={'status': 'CLOSED', 'close_reason': 'Resolved and inspected'}, request_only=True),
        ],
    )
    def patch(self, request, pk):
        user = request.user
        incident = get_object_or_404(incidents_for_user(user), pk=pk)

        if user.role in ('resident', 'guardian') and not user.is_superuser:
            raise PermissionDenied('Your role does not allow updating incident status.')

        if incident.status == 'CLOSED':
            return Response(
                {'detail': 'Closed incidents are read-only and cannot be modified.'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        serializer = IncidentStatusUpdateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        new_status = serializer.validated_data['status']
        note = serializer.validated_data.get('note', '').strip()
        close_reason = serializer.validated_data.get('close_reason', '').strip()

        role = 'admin' if user.is_superuser else user.role
        old_status = incident.status

        if role == 'volunteer':
            if incident.assigned_to_id != user.pk:
                raise PermissionDenied('You can only update incidents assigned to you.')
            allowed = self.VOLUNTEER_TRANSITIONS.get(old_status, [])
            if new_status not in allowed:
                return Response(
                    {'detail': f'Volunteers cannot transition incident from {old_status} to {new_status}.'},
                    status=status.HTTP_400_BAD_REQUEST,
                )
        elif role == 'security':
            allowed = self.SECURITY_TRANSITIONS.get(old_status, [])
            adding_ack_note = old_status == 'ACKNOWLEDGED' and new_status == 'ACKNOWLEDGED' and bool(note)
            if not adding_ack_note and new_status not in allowed:
                return Response(
                    {'detail': f'Security can only acknowledge REPORTED incidents (invalid transition: {old_status} to {new_status}).'},
                    status=status.HTTP_400_BAD_REQUEST,
                )
        elif role == 'admin':
            allowed = self.ADMIN_TRANSITIONS.get(old_status, [])
            if new_status not in allowed:
                return Response(
                    {'detail': f'Invalid status transition from {old_status} to {new_status}.'},
                    status=status.HTTP_400_BAD_REQUEST,
                )
            if new_status == 'ASSIGNED' and not incident.assigned_to_id:
                return Response(
                    {'detail': 'Assign a volunteer via /assign/ before setting status to ASSIGNED.'},
                    status=status.HTTP_400_BAD_REQUEST,
                )
            if new_status == 'CLOSED' and old_status != 'RESOLVED':
                if not (close_reason or note):
                    return Response(
                        {'detail': 'A close reason is required when closing an unresolved incident.'},
                        status=status.HTTP_400_BAD_REQUEST,
                    )
        else:
            raise PermissionDenied('Your role does not allow updating incident status.')

        now = timezone.now()
        with transaction.atomic():
            incident.status = new_status
            if new_status == 'ACKNOWLEDGED' and not incident.acknowledged_at:
                incident.acknowledged_at = now
            elif new_status == 'ASSIGNED':
                if not incident.acknowledged_at:
                    incident.acknowledged_at = now
                if not incident.assigned_at:
                    incident.assigned_at = now
            elif new_status == 'IN_PROGRESS' and not incident.in_progress_at:
                incident.in_progress_at = now
            elif new_status == 'RESOLVED' and not incident.resolved_at:
                incident.resolved_at = now
            elif new_status == 'CLOSED':
                incident.closed_at = now
                incident.close_reason = close_reason or note or 'Resolved and closed'

            incident.save()
            history_note = note or close_reason or f'Status changed from {old_status} to {new_status}'
            IncidentHistory.objects.create(
                incident=incident,
                changed_by=user,
                event_type='status_changed',
                from_status=old_status,
                to_status=new_status,
                note=history_note,
            )
            transaction.on_commit(
                lambda inc=incident, actor=user, f_st=old_status, t_st=new_status, n=history_note:
                _safe_call(notify_status_changed, inc, actor, f_st, t_st, n)
            )

        refreshed = _incident_queryset(user).get(pk=incident.pk)
        return Response(IncidentSerializer(refreshed, context={'request': request}).data)


class IncidentAssignView(APIView):
    """POST /api/incidents/<id>/assign/ - assign/reassign an available volunteer (admin only)."""
    permission_classes = [IsAuthenticated]
    serializer_class = IncidentAssignSerializer

    @extend_schema(
        summary='Assign or reassign an available volunteer (Admin only)',
        request=IncidentAssignSerializer,
        responses={200: IncidentSerializer},
        examples=[OpenApiExample('Assign Volunteer', value={'volunteer_id': 5, 'note': 'Please respond promptly'}, request_only=True)],
    )
    def post(self, request, pk):
        user = request.user
        if not (user.is_superuser or user.role == 'admin'):
            raise PermissionDenied('Only admins can assign volunteers.')

        incident = get_object_or_404(incidents_for_user(user), pk=pk)
        if incident.status == 'CLOSED':
            return Response(
                {'detail': 'Closed incidents are read-only.'},
                status=status.HTTP_400_BAD_REQUEST,
            )
        if incident.status in ('IN_PROGRESS', 'RESOLVED'):
            return Response(
                {'detail': f'Cannot assign or reassign when incident is {incident.status}.'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        serializer = IncidentAssignSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        volunteer_id = serializer.validated_data['volunteer_id']
        note = serializer.validated_data.get('note', '').strip()

        volunteer = User.objects.filter(pk=volunteer_id, role='volunteer', is_active=True).first()
        if volunteer is None:
            return Response(
                {'detail': 'Selected user is not an active volunteer.'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        society_ids = list(
            ResidentFlatMapping.objects.filter(user=incident.resident, is_active=True)
            .values_list('flat__block__society_id', flat=True)
            .distinct()
        )
        valid_assignment = SocietyAssignment.objects.filter(
            user=volunteer,
            society_id__in=society_ids,
            is_active=True,
            is_available=True,
        ).exists()
        if not valid_assignment:
            return Response(
                {'detail': 'Volunteer must be active, available, and assigned to the incident society.'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        now = timezone.now()
        with transaction.atomic():
            was_reassigned = incident.assigned_to_id is not None
            old_status = incident.status

            incident.assigned_to = volunteer
            incident.assigned_at = now
            if not incident.acknowledged_at:
                incident.acknowledged_at = now
            incident.status = 'ASSIGNED'
            incident.save()

            vol_name = volunteer.get_full_name() or volunteer.username
            event_type = 'reassigned' if was_reassigned else 'assigned'
            history_row = IncidentHistory.objects.create(
                incident=incident,
                changed_by=user,
                event_type=event_type,
                from_status=old_status,
                to_status='ASSIGNED',
                note=note or f'{event_type.capitalize()} to {vol_name}',
            )
            transaction.on_commit(
                lambda inc=incident, vol=volunteer, tag=str(history_row.pk):
                _safe_call(notify_incident_assigned, inc, vol, tag)
            )

        refreshed = _incident_queryset(user).get(pk=incident.pk)
        return Response(IncidentSerializer(refreshed, context={'request': request}).data)


class AvailableVolunteersView(generics.ListAPIView):
    """GET /api/volunteers/available/?incident_id= - assignable volunteers (admin only)."""
    serializer_class = AvailableVolunteerSerializer
    permission_classes = [IsAuthenticated]

    def _target_society_ids(self):
        user = self.request.user
        incident_id = self.request.query_params.get('incident_id')
        if incident_id:
            incident = get_object_or_404(incidents_for_user(user), pk=incident_id)
            return list(
                ResidentFlatMapping.objects.filter(user=incident.resident, is_active=True)
                .values_list('flat__block__society_id', flat=True)
                .distinct()
            )
        if user.is_superuser:
            return list(Society.objects.filter(is_active=True).values_list('id', flat=True))
        return list(Society.objects.filter(admin=user, is_active=True).values_list('id', flat=True))

    def get_serializer_context(self):
        ctx = super().get_serializer_context()
        ctx['society_ids'] = getattr(self, '_society_ids_cache', None)
        return ctx

    def get_queryset(self):
        if getattr(self, 'swagger_fake_view', False):
            return User.objects.none()
        user = self.request.user
        if not (user.is_superuser or user.role == 'admin'):
            raise PermissionDenied('Only admins can view available volunteers.')

        society_ids = self._target_society_ids()
        self._society_ids_cache = society_ids

        include_unavailable = self.request.query_params.get('include_unavailable') == 'true'
        assign_filter = Q(
            society_assignments__society_id__in=society_ids,
            society_assignments__is_active=True,
        )
        if not include_unavailable:
            assign_filter &= Q(society_assignments__is_available=True)

        return (
            User.objects.filter(role='volunteer', is_active=True)
            .filter(assign_filter)
            .distinct()
            .annotate(
                open_assignments_count=Count(
                    'assigned_incidents',
                    filter=Q(assigned_incidents__status__in=ACTIVE_STATES),
                    distinct=True,
                )
            )
            .order_by('open_assignments_count', 'first_name', 'username')
        )


class VolunteerIncidentListView(generics.ListAPIView):
    """GET /api/volunteer/incidents/ - incidents assigned to the logged-in volunteer."""
    serializer_class = IncidentSerializer
    permission_classes = [IsAuthenticated]
    filter_backends = [DjangoFilterBackend, filters.OrderingFilter]
    filterset_fields = ['status']
    ordering = ['-created_at']

    def get_queryset(self):
        if getattr(self, 'swagger_fake_view', False):
            return Incident.objects.none()
        user = self.request.user
        if user.role != 'volunteer':
            raise PermissionDenied('Only volunteers can access assigned volunteer incidents.')
        return (
            Incident.objects.filter(assigned_to=user)
            .select_related('resident', 'reported_by', 'assigned_to')
            .prefetch_related(
                'evidence',
                'history',
                'history__changed_by',
                'resident__flat_mappings',
                'resident__flat_mappings__flat',
                'resident__flat_mappings__flat__block',
            )
        )


class VolunteerAvailabilityView(APIView):
    """GET & PATCH /api/volunteer/availability/ - view/toggle availability for volunteer."""
    permission_classes = [IsAuthenticated]

    @extend_schema(
        summary='Get volunteer availability status',
        responses={200: OpenApiTypes.OBJECT},
    )
    def get(self, request):
        user = request.user
        if user.role != 'volunteer':
            raise PermissionDenied('Only volunteers can check availability.')
        assignments = SocietyAssignment.objects.filter(
            user=user, is_active=True
        ).select_related('society')
        is_avail = assignments.filter(is_available=True).exists()
        societies = [
            {
                'society_id': a.society_id,
                'society_name': a.society.name,
                'is_available': a.is_available,
            }
            for a in assignments
        ]
        return Response({'is_available': is_avail, 'societies': societies})

    @extend_schema(
        summary='Toggle volunteer availability',
        request=inline_serializer(
            name='VolunteerAvailabilityToggleRequest',
            fields={'is_available': drf_serializers.BooleanField()},
        ),
        responses={
            200: inline_serializer(
                name='VolunteerAvailabilityToggleResponse',
                fields={
                    'is_available': drf_serializers.BooleanField(),
                    'assignments_updated': drf_serializers.IntegerField(),
                },
            )
        },
    )
    def patch(self, request):
        user = request.user
        if user.role != 'volunteer':
            raise PermissionDenied('Only volunteers can toggle availability.')

        if 'is_available' not in request.data:
            return Response(
                {'detail': 'is_available field is required.'},
                status=status.HTTP_400_BAD_REQUEST,
            )
        raw_val = request.data.get('is_available')
        if not isinstance(raw_val, bool):
            return Response(
                {'detail': 'is_available must be a boolean.'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        updated = SocietyAssignment.objects.filter(user=user, is_active=True).update(
            is_available=raw_val
        )
        return Response({'is_available': raw_val, 'assignments_updated': updated})


class IncidentHistoryView(generics.ListAPIView):
    """GET /api/incidents/<id>/history/ - chronological timeline for authorized viewers."""
    serializer_class = IncidentHistorySerializer
    permission_classes = [IsAuthenticated]

    def get_queryset(self):
        if getattr(self, 'swagger_fake_view', False):
            return IncidentHistory.objects.none()
        incident = get_object_or_404(incidents_for_user(self.request.user), pk=self.kwargs['pk'])
        return IncidentHistory.objects.filter(incident=incident).select_related('changed_by')


class IncidentEvidenceView(APIView):
    """
    GET  /api/incidents/<id>/evidence/ - list uploaded evidence (anyone with incident access)
    POST /api/incidents/<id>/evidence/ - upload evidence image (reporter only, while not CLOSED)
    """
    permission_classes = [IsAuthenticated]
    parser_classes = [MultiPartParser, FormParser]
    serializer_class = IncidentEvidenceSerializer

    @extend_schema(summary='List incident evidence photos', responses={200: IncidentEvidenceSerializer(many=True)})
    def get(self, request, pk):
        incident = get_object_or_404(incidents_for_user(request.user), pk=pk)
        qs = IncidentEvidence.objects.filter(incident=incident).select_related('uploaded_by')
        return Response(
            IncidentEvidenceSerializer(qs, many=True, context={'request': request}).data
        )

    @extend_schema(
        summary='Upload evidence image(s) (Reporter only, non-CLOSED, max 5)',
        request={'multipart/form-data': inline_serializer(name='EvidenceUpload', fields={'image': drf_serializers.ImageField()})},
        responses={201: IncidentEvidenceSerializer},
    )
    def post(self, request, pk):
        user = request.user
        incident = get_object_or_404(incidents_for_user(user), pk=pk)

        reporter_id = incident.reported_by_id or incident.resident_id
        if user.pk != reporter_id and user.pk != incident.resident_id:
            raise PermissionDenied('Only the incident reporter can upload evidence.')

        if incident.status == 'CLOSED':
            return Response(
                {'detail': 'Cannot add evidence to a closed incident.'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        files = request.FILES.getlist('images') or request.FILES.getlist('image')
        if not files:
            return Response(
                {'detail': 'At least one image file is required.'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        existing_count = incident.evidence.count()
        if existing_count + len(files) > IncidentEvidence.MAX_PER_INCIDENT:
            return Response(
                {
                    'detail': (
                        f'Maximum {IncidentEvidence.MAX_PER_INCIDENT} evidence images allowed per incident '
                        f'(currently {existing_count}).'
                    )
                },
                status=status.HTTP_400_BAD_REQUEST,
            )

        from rest_framework.exceptions import ValidationError as DRFValidationError
        for f in files:
            try:
                validate_evidence_image_file(f)
            except DRFValidationError as exc:
                return Response({'image': exc.detail}, status=status.HTTP_400_BAD_REQUEST)

        created = []
        with transaction.atomic():
            for f in files:
                ev = IncidentEvidence.objects.create(
                    incident=incident,
                    uploaded_by=user,
                    image=f,
                )
                created.append(ev)
            IncidentHistory.objects.create(
                incident=incident,
                changed_by=user,
                event_type='evidence_added',
                note=f'{len(created)} evidence image(s) added',
            )
            ev_ids = [ev.pk for ev in created]
            transaction.on_commit(
                lambda inc=incident, ids=ev_ids: _safe_call(notify_evidence_added, inc, ids)
            )

        serializer = IncidentEvidenceSerializer(
            created if len(created) > 1 else created[0],
            many=(len(created) > 1),
            context={'request': request},
        )
        return Response(serializer.data, status=status.HTTP_201_CREATED)


class IncidentEscalateView(APIView):
    """POST /api/incidents/<id>/escalate/ - escalate an active incident and notify admins."""
    permission_classes = [IsAuthenticated]
    serializer_class = IncidentSerializer

    @extend_schema(
        summary='Escalate incident to society admins',
        request=inline_serializer(name='EscalateRequest', fields={'note': drf_serializers.CharField(required=False)}),
        responses={200: IncidentSerializer},
    )
    def post(self, request, pk):
        user = request.user
        incident = get_object_or_404(incidents_for_user(user), pk=pk)
        if incident.status in ('RESOLVED', 'CLOSED'):
            return Response(
                {'detail': 'Cannot escalate a resolved or closed incident.'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        note = (request.data.get('note') or '').strip()
        with transaction.atomic():
            kind = 'manual_resident' if user == incident.resident else 'manual_admin'
            trigger_escalation(incident, kind=kind, triggered_by=user, note=note)
            transaction.on_commit(lambda inc=incident: _safe_call(notify_escalated, inc))

        refreshed = _incident_queryset(user).get(pk=incident.pk)
        return Response(IncidentSerializer(refreshed, context={'request': request}).data)


# ──────────────────────────── Milestone 3 Escalation Views ────────────────────────────

class ResidentEscalationSettingsView(APIView):
    """
    GET  /api/resident/escalation-settings/ - get current escalation settings and preview
    PUT  /api/resident/escalation-settings/ - update escalation settings
    """
    permission_classes = [IsAuthenticated]

    def _get_preview(self, user, settings_obj):
        primary = EmergencyContact.objects.filter(
            resident=user, contact_type='primary_guardian', status='accepted', is_verified=True, is_active=True
        ).first()
        secondary = EmergencyContact.objects.filter(
            resident=user, contact_type='secondary_guardian', status='accepted', is_verified=True, is_active=True
        ).first()

        soc_ids = list(ResidentFlatMapping.objects.filter(user=user, is_active=True).values_list('flat__block__society_id', flat=True).distinct())
        society_has_security = SocietyAssignment.objects.filter(
            society_id__in=soc_ids, user__role='security', is_active=True
        ).exists()

        breakdown = estimate_volunteer_breakdown(user, radius_km=settings_obj.volunteer_radius_km)

        return {
            'has_verified_guardian': primary is not None,
            'primary_guardian': {
                'id': primary.id,
                'name': primary.name,
                'phone': primary.phone,
            } if primary else None,
            'has_secondary_guardian': secondary is not None,
            'secondary_guardian': {
                'id': secondary.id,
                'name': secondary.name,
                'phone': secondary.phone,
            } if secondary else None,
            'security_available': society_has_security,
            'volunteer_breakdown': breakdown,
        }

    def get(self, request):
        if request.user.role != 'resident':
            raise PermissionDenied('Only residents have escalation settings.')
        settings_obj = get_or_create_escalation_settings(request.user)
        ser = ResidentEscalationSettingsSerializer(settings_obj)
        data = ser.data
        data['preview'] = self._get_preview(request.user, settings_obj)
        return Response(data)

    def put(self, request):
        if request.user.role != 'resident':
            raise PermissionDenied('Only residents have escalation settings.')
        settings_obj = get_or_create_escalation_settings(request.user)
        ser = ResidentEscalationSettingsSerializer(settings_obj, data=request.data, partial=True)
        ser.is_valid(raise_exception=True)
        ser.save()
        data = ser.data
        data['preview'] = self._get_preview(request.user, settings_obj)
        return Response(data)

    def patch(self, request):
        return self.put(request)


class GuardianAckView(APIView):
    """
    POST /api/incidents/<pk>/guardian-ack/ - guardian acknowledges SOS ("I'm responding").
    Cancels auto-escalation timer and transitions incident from REPORTED to ACKNOWLEDGED.
    """
    permission_classes = [IsAuthenticated]

    def post(self, request, pk):
        user = request.user
        incident = get_object_or_404(Incident, pk=pk)
        is_guardian = EmergencyContact.objects.filter(
            resident=incident.resident, linked_user=user, is_verified=True, is_active=True
        ).exists() or user.is_superuser or user.role == 'admin'

        if not is_guardian:
            raise PermissionDenied("You are not a verified emergency contact for this resident.")

        success, res = guardian_acknowledge(incident, user)
        if not success:
            return Response({'detail': str(res)}, status=status.HTTP_400_BAD_REQUEST)

        refreshed = _incident_queryset(user).get(pk=incident.pk)
        return Response(IncidentSerializer(refreshed, context={'request': request}).data)


class GuardianHandoffView(APIView):
    """
    POST /api/incidents/<pk>/handoff/ - guardian passes SOS on ("I can't help, pass it on").
    Escalates directly and simultaneously to selected targets.
    """
    permission_classes = [IsAuthenticated]

    def post(self, request, pk):
        user = request.user
        incident = get_object_or_404(Incident, pk=pk)
        is_guardian = EmergencyContact.objects.filter(
            resident=incident.resident, linked_user=user, is_verified=True, is_active=True
        ).exists() or user.is_superuser or user.role == 'admin'

        if not is_guardian:
            raise PermissionDenied("You are not a verified emergency contact for this resident.")

        if incident.status in ('RESOLVED', 'CLOSED'):
            return Response({'detail': 'Cannot hand off a resolved or closed incident.'}, status=status.HTTP_400_BAD_REQUEST)

        serializer = GuardianHandoffSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        targets = serializer.validated_data['targets']
        reason = serializer.validated_data['reason']
        note = serializer.validated_data.get('note', '')
        volunteer_mode = serializer.validated_data.get('volunteer_mode', 'auto')
        volunteer_ids = serializer.validated_data.get('volunteer_ids', [])
        security_guard_ids = serializer.validated_data.get('security_guard_ids', [])

        esc = trigger_escalation(
            incident,
            kind='manual_guardian',
            triggered_by=user,
            targets=targets,
            reason=reason,
            note=note,
            volunteer_ids=volunteer_ids,
            volunteer_mode=volunteer_mode,
            security_guard_ids=security_guard_ids,
        )

        refreshed = _incident_queryset(user).get(pk=incident.pk)
        return Response(IncidentSerializer(refreshed, context={'request': request}).data)


class VolunteerAcceptView(APIView):
    """
    POST /api/incidents/<pk>/accept/ - volunteer accepts an escalated incident.
    Atomic first-come assignment via select_for_update.
    """
    permission_classes = [IsAuthenticated]

    def post(self, request, pk):
        user = request.user
        if user.role != 'volunteer' and not user.is_superuser:
            raise PermissionDenied("Only volunteers can accept incident assignments.")

        vp = getattr(user, 'volunteer_profile', None)
        if vp and vp.approval_status != 'approved':
            return Response(
                {'detail': 'Your volunteer profile is pending admin approval.'},
                status=status.HTTP_403_FORBIDDEN,
            )

        success, http_code, res = volunteer_accept_incident(pk, user)
        if not success:
            return Response({'detail': res}, status=http_code)

        refreshed = _incident_queryset(user).get(pk=pk)
        return Response(IncidentSerializer(refreshed, context={'request': request}).data, status=status.HTTP_200_OK)


class VolunteerLocationView(APIView):
    """
    GET   /api/volunteer/location/ - view volunteer's last reported location
    PATCH /api/volunteer/location/ - update volunteer's live GPS coordinates
    """
    permission_classes = [IsAuthenticated]

    def get(self, request):
        if request.user.role != 'volunteer' and not request.user.is_superuser:
            raise PermissionDenied("Only volunteers can access volunteer location.")
        loc = VolunteerLocation.objects.filter(user=request.user).first()
        if not loc:
            return Response({'latitude': None, 'longitude': None, 'accuracy': None, 'updated_at': None})
        return Response(VolunteerLocationSerializer(loc).data)

    def patch(self, request):
        if request.user.role != 'volunteer' and not request.user.is_superuser:
            raise PermissionDenied("Only volunteers can report volunteer location.")
        serializer = VolunteerLocationSerializer(data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        lat = serializer.validated_data.get('latitude')
        lng = serializer.validated_data.get('longitude')
        acc = serializer.validated_data.get('accuracy')

        loc, _ = VolunteerLocation.objects.get_or_create(
            user=request.user,
            defaults={'latitude': lat, 'longitude': lng, 'accuracy': acc},
        )
        if lat is not None and lng is not None:
            loc.latitude = lat
            loc.longitude = lng
        if acc is not None:
            loc.accuracy = acc
        loc.save()
        return Response(VolunteerLocationSerializer(loc).data)

    def post(self, request):
        return self.patch(request)


class IncidentLocationUpdateView(APIView):
    """
    PATCH /api/incidents/<pk>/location/ - resident updates live GPS coordinates during an incident.
    """
    permission_classes = [IsAuthenticated]

    def patch(self, request, pk):
        incident = get_object_or_404(Incident, pk=pk)
        if incident.resident != request.user and not request.user.is_superuser:
            raise PermissionDenied("Only the reporting resident can update the incident location.")

        if incident.status in ('RESOLVED', 'CLOSED'):
            return Response({'detail': 'Cannot update location of a resolved or closed incident.'}, status=status.HTTP_400_BAD_REQUEST)

        serializer = IncidentLocationUpdateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        lat = serializer.validated_data['latitude']
        lng = serializer.validated_data['longitude']
        acc = serializer.validated_data.get('accuracy')
        now = timezone.now()

        with transaction.atomic():
            incident.latitude = lat
            incident.longitude = lng
            incident.location_accuracy = acc
            incident.location_captured_at = now
            incident.save(update_fields=['latitude', 'longitude', 'location_accuracy', 'location_captured_at', 'updated_at'])

            IncidentLocationUpdate.objects.create(
                incident=incident,
                latitude=lat,
                longitude=lng,
                accuracy=acc,
                updated_by=request.user,
            )

        refreshed = _incident_queryset(request.user).get(pk=incident.pk)
        return Response(IncidentSerializer(refreshed, context={'request': request}).data)


class SecurityAckView(APIView):
    """
    POST /api/incidents/<pk>/security-ack/ - security personnel acknowledges SOS ("I'm going").
    Sets ACKNOWLEDGED, cancels pending auto-escalation, dispatches notifications.
    """
    permission_classes = [IsAuthenticated]

    def post(self, request, pk):
        user = request.user
        if user.role != 'security' and not user.is_superuser and user.role != 'admin':
            if not ResidentSecurityGuard.objects.filter(linked_user=user, is_active=True).exists():
                raise PermissionDenied("Only security staff can acknowledge security alerts.")

        incident = get_object_or_404(Incident, pk=pk)
        if incident.status in ('RESOLVED', 'CLOSED'):
            return Response({'detail': 'Incident is already resolved or closed.'}, status=status.HTTP_400_BAD_REQUEST)

        success, res = security_acknowledge(incident, user)
        if not success:
            return Response({'detail': str(res)}, status=status.HTTP_400_BAD_REQUEST)

        refreshed = _incident_queryset(user).get(pk=incident.pk)
        return Response(IncidentSerializer(refreshed, context={'request': request}).data)


class IncidentNearbyVolunteersView(APIView):
    """
    GET /api/incidents/<pk>/nearby-volunteers/?q=&radius_km=
    List nearby approved active volunteers for guardian handoff selection.
    Excludes phone and exact coordinates for privacy.
    """
    permission_classes = [IsAuthenticated]

    def get(self, request, pk):
        incident = get_object_or_404(Incident, pk=pk)
        user = request.user

        is_guardian = EmergencyContact.objects.filter(
            resident=incident.resident, linked_user=user, is_verified=True, is_active=True
        ).exists() or user.is_superuser or user.role == 'admin' or user == incident.resident

        if not is_guardian:
            raise PermissionDenied("Not authorized to view responder candidates for this incident.")

        q = (request.query_params.get('q') or '').strip().lower()
        try:
            radius_km = float(request.query_params.get('radius_km', 3.0))
        except (ValueError, TypeError):
            radius_km = 3.0

        ref_lat, ref_lng, _ = get_incident_reference_point(incident)
        resident_block_id = get_resident_block_id(incident.resident)
        soc_ids = _resident_society_ids(incident.resident)

        qs = VolunteerProfile.objects.filter(
            approval_status='approved',
            user__is_active=True,
            user__society_assignments__is_active=True,
        ).select_related('user', 'society', 'block', 'user__live_volunteer_location').distinct()

        if soc_ids:
            qs = qs.filter(
                Q(society_id__in=soc_ids) | Q(serves_nearby_societies=True)
            )

        candidates = []
        for vp in qs:
            u = vp.user
            full_name = u.get_full_name() or u.username
            area_label = vp.area_label or (vp.block.name if vp.block else '')

            if q:
                match = (
                    q in u.username.lower()
                    or q in full_name.lower()
                    or q in area_label.lower()
                    or (vp.block and q in vp.block.name.lower())
                )
                if not match:
                    continue

            loc = getattr(u, 'live_volunteer_location', None)
            v_lat = float(loc.latitude) if loc else (float(vp.latitude) if vp.latitude else None)
            v_lng = float(loc.longitude) if loc else (float(vp.longitude) if vp.longitude else None)

            dist = None
            if ref_lat is not None and ref_lng is not None and v_lat is not None and v_lng is not None:
                dist = haversine_km(ref_lat, ref_lng, v_lat, v_lng)
                if radius_km and dist > radius_km:
                    continue

            is_same_block = bool(resident_block_id and vp.block_id == resident_block_id)
            candidates.append({
                'id': u.id,
                'name': full_name,
                'username': u.username,
                'area_label': area_label,
                'block_name': vp.block.name if vp.block else '',
                'same_block': is_same_block,
                'distance_km': round(dist, 1) if dist is not None else None,
                'society_name': vp.society.name if vp.society else '',
            })

        candidates.sort(
            key=lambda x: (not x['same_block'], x['distance_km'] if x['distance_km'] is not None else 9999)
        )
        return Response(candidates, status=status.HTTP_200_OK)


class IncidentEscalationDiagnosticsView(APIView):
    """
    GET /api/incidents/<pk>/escalation-diagnostics/
    Diagnostic breakdown of resident society, guardian, security, and volunteer availability.
    """
    permission_classes = [IsAuthenticated]

    def get(self, request, pk):
        incident = get_object_or_404(Incident, pk=pk)
        res = incident.resident
        soc_ids = _resident_society_ids(res)
        mapping = ResidentFlatMapping.objects.filter(user=res, is_active=True).select_related('flat__block__society').first()

        pri_g = EmergencyContact.objects.filter(resident=res, contact_type='primary_guardian', is_active=True).first()
        sec_g = EmergencyContact.objects.filter(resident=res, contact_type='secondary_guardian', is_active=True).first()

        res_guards = ResidentSecurityGuard.objects.filter(resident=res, is_active=True)
        soc_sec_approved = SecurityProfile.objects.filter(society_id__in=soc_ids, approval_status='approved').count()
        soc_sec_on_duty = SocietyAssignment.objects.filter(
            society_id__in=soc_ids, user__role='security', is_active=True, is_available=True
        ).count()

        settings_obj = getattr(res, 'escalation_settings', None)
        search_radius = settings_obj.volunteer_radius_km if settings_obj else 2.0
        total_vol = VolunteerProfile.objects.filter(society_id__in=soc_ids, approval_status='approved').count()
        avail_vol = VolunteerProfile.objects.filter(
            society_id__in=soc_ids, approval_status='approved', user__society_assignments__is_available=True
        ).distinct().count()

        ref_lat, ref_lng, ref_src = get_incident_reference_point(incident)

        data = {
            'incident_id': incident.pk,
            'resident': {
                'id': res.pk,
                'username': res.username,
                'society_linked': bool(soc_ids),
                'society_name': mapping.flat.block.society.name if mapping and mapping.flat and mapping.flat.block and mapping.flat.block.society else None,
                'block_name': mapping.flat.block.name if mapping and mapping.flat and mapping.flat.block else None,
                'flat_number': mapping.flat.flat_number if mapping and mapping.flat else None,
            },
            'location': {
                'has_coordinates': incident.location_available,
                'latitude': float(incident.latitude) if incident.latitude else None,
                'longitude': float(incident.longitude) if incident.longitude else None,
                'accuracy': incident.location_accuracy,
                'source': ref_src,
            },
            'guardians': {
                'primary': {
                    'configured': pri_g is not None,
                    'verified': bool(pri_g and pri_g.is_verified),
                    'name': pri_g.name if pri_g else None,
                },
                'secondary': {
                    'configured': sec_g is not None,
                    'verified': bool(sec_g and sec_g.is_verified),
                    'name': sec_g.name if sec_g else None,
                },
            },
            'security': {
                'has_security_guard_configured': bool(settings_obj and settings_obj.has_security_guard),
                'resident_guard_count': res_guards.count(),
                'society_security_approved_count': soc_sec_approved,
                'society_security_on_duty_count': soc_sec_on_duty,
                'security_alerted': bool(incident.is_escalated and 'security' in (incident.escalation_plan or {}).get('targets', [])),
            },
            'volunteers': {
                'search_radius_km': search_radius,
                'total_approved_volunteers': total_vol,
                'available_volunteers': avail_vol,
                'volunteers_notified_count': len(incident.escalations.last().volunteer_ids) if incident.escalations.exists() else 0,
            },
            'escalation_status': {
                'is_escalated': incident.is_escalated,
                'escalate_at': incident.escalate_at.isoformat() if incident.escalate_at else None,
                'escalation_trigger': incident.escalation_trigger,
                'plan': incident.escalation_plan,
            },
        }
        return Response(data, status=status.HTTP_200_OK)


class SecurityIncidentListView(generics.ListAPIView):
    """
    GET /api/security/incidents/
    Incidents in security staff's assigned society.
    """
    serializer_class = IncidentSerializer
    permission_classes = [IsAuthenticated]

    def get_queryset(self):
        user = self.request.user
        if user.role != 'security' and not user.is_superuser:
            raise PermissionDenied("Only security staff can access the security incident workspace.")

        soc_ids = list(
            SocietyAssignment.objects.filter(user=user, is_active=True)
            .values_list('society_id', flat=True)
        )
        profile = getattr(user, 'security_profile', None)
        if profile and profile.society_id not in soc_ids:
            soc_ids.append(profile.society_id)

        resident_ids = ResidentFlatMapping.objects.filter(
            flat__block__society_id__in=soc_ids, is_active=True
        ).values_list('user_id', flat=True)

        return Incident.objects.filter(
            resident_id__in=resident_ids
        ).select_related('resident', 'reported_by', 'assigned_to').order_by('-created_at')


class HealthCheckView(APIView):
    """GET /api/health/ - database connectivity health probe."""
    permission_classes = [AllowAny]
    authentication_classes = []

    @extend_schema(
        summary='Database health check',
        responses={
            200: inline_serializer(
                name='HealthCheckResponse',
                fields={'status': drf_serializers.CharField(), 'database': drf_serializers.CharField()},
            )
        },
    )
    def get(self, request):
        try:
            with connection.cursor() as cursor:
                cursor.execute('SELECT 1')
                cursor.fetchone()
            return Response({'status': 'ok', 'database': 'connected'}, status=status.HTTP_200_OK)
        except Exception as exc:
            logger.exception('Health check DB probe failed')
            return Response(
                {'status': 'error', 'database': 'unavailable', 'detail': str(exc)},
                status=status.HTTP_503_SERVICE_UNAVAILABLE,
            )
