from django.shortcuts import get_object_or_404
from django.utils import timezone
from django_filters.rest_framework import DjangoFilterBackend
from drf_spectacular.types import OpenApiTypes
from drf_spectacular.utils import OpenApiParameter, extend_schema, inline_serializer
from rest_framework import generics, serializers as drf_serializers, status
from rest_framework.exceptions import PermissionDenied
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from incidents.access import incidents_for_user
from .models import Notification
from .serializers import NotificationRecordSerializer, NotificationSerializer
from .services import retry_failed


class NotificationListView(generics.ListAPIView):
    """GET /api/notifications/ - notifications addressed to me."""
    serializer_class = NotificationSerializer
    permission_classes = [IsAuthenticated]
    filter_backends = [DjangoFilterBackend]
    filterset_fields = ['is_read', 'channel', 'delivery_status', 'event_type']

    @extend_schema(
        summary='List current user notifications',
        parameters=[
            OpenApiParameter('is_read', OpenApiTypes.BOOL, description='Filter read status'),
            OpenApiParameter('type', OpenApiTypes.STR, description='alerts | updates'),
            OpenApiParameter('channel', OpenApiTypes.STR, description='push | sms | email | in_app'),
        ],
    )
    def get(self, request, *args, **kwargs):
        try:
            from incidents.escalation import opportunistic_check_escalations
            opportunistic_check_escalations()
        except Exception:
            pass
        return super().get(request, *args, **kwargs)

    def get_queryset(self):
        if getattr(self, 'swagger_fake_view', False):
            return Notification.objects.none()
        qs = Notification.objects.filter(recipient=self.request.user)
        notif_type = self.request.query_params.get('type')
        if notif_type == 'alerts':
            qs = qs.filter(
                event_type__in=[
                    'INCIDENT_REPORTED',
                    'ESCALATED',
                    'GUARDIAN_REQUEST',
                    'GUARDIAN_SOS',
                    'ESCALATION_HANDOFF',
                    'ESCALATION_AUTO',
                    'NO_RESPONDER',
                    'ESCALATION_NOTICE',
                ]
            )
        elif notif_type == 'updates':
            qs = qs.filter(
                event_type__in=[
                    'INCIDENT_ASSIGNED',
                    'STATUS_CHANGED',
                    'EVIDENCE_ADDED',
                    'GUARDIAN_ACCEPTED',
                    'GUARDIAN_DECLINED',
                    'ESCALATION_ACCEPTED',
                ]
            )
        return qs


class NotificationDetailView(generics.RetrieveAPIView):
    """GET /api/notifications/<id>/ - 404 if it is not addressed to me."""
    serializer_class = NotificationSerializer
    permission_classes = [IsAuthenticated]

    def get_queryset(self):
        if getattr(self, 'swagger_fake_view', False):
            return Notification.objects.none()
        return Notification.objects.filter(recipient=self.request.user)


class NotificationReadView(APIView):
    """PATCH /api/notifications/<id>/read/ - read status only; delivery status is untouched."""
    permission_classes = [IsAuthenticated]
    serializer_class = NotificationSerializer

    @extend_schema(summary='Mark one in-app notification read', request=None, responses={200: NotificationSerializer})
    def patch(self, request, pk):
        note = get_object_or_404(Notification, pk=pk, recipient=request.user)
        if note.channel != 'in_app':
            return Response(
                {'detail': 'Only in-app notifications can be marked as read.'},
                status=status.HTTP_400_BAD_REQUEST,
            )
        if not note.is_read:
            note.is_read = True
            note.read_at = timezone.now()
            note.save(update_fields=['is_read', 'read_at'])
        return Response(NotificationSerializer(note).data)


class NotificationUnreadCountView(APIView):
    """GET /api/notifications/unread-count/ - count of unread in-app notifications."""
    permission_classes = [IsAuthenticated]

    @extend_schema(
        summary='Get unread in-app notifications count',
        responses={200: inline_serializer(name='UnreadCountResponse', fields={'unread_count': drf_serializers.IntegerField()})},
    )
    def get(self, request):
        count = Notification.objects.filter(
            recipient=request.user,
            channel='in_app',
            is_read=False,
        ).count()
        return Response({'unread_count': count})


class NotificationMarkAllReadView(APIView):
    """POST /api/notifications/read-all/ - mark all unread in-app notifications as read."""
    permission_classes = [IsAuthenticated]

    @extend_schema(
        summary='Mark all unread in-app notifications read',
        request=None,
        responses={200: inline_serializer(name='MarkAllReadResponse', fields={'marked_read': drf_serializers.IntegerField()})},
    )
    def post(self, request):
        updated = Notification.objects.filter(
            recipient=request.user,
            channel='in_app',
            is_read=False,
        ).update(is_read=True, read_at=timezone.now())
        return Response({'marked_read': updated})


class IncidentNotificationListView(generics.ListAPIView):
    """GET /api/incidents/<id>/notifications/ - delivery records for monitoring."""
    serializer_class = NotificationRecordSerializer
    permission_classes = [IsAuthenticated]
    filter_backends = [DjangoFilterBackend]
    filterset_fields = ['delivery_status', 'channel', 'recipient_type', 'event_type']

    def get_queryset(self):
        if getattr(self, 'swagger_fake_view', False):
            return Notification.objects.none()
        user = self.request.user
        if user.role in ('guardian', 'volunteer'):
            raise PermissionDenied('You cannot view notification records for this incident.')
        incident = get_object_or_404(incidents_for_user(user), pk=self.kwargs['pk'])
        return Notification.objects.filter(incident=incident)


class IncidentNotificationRetryView(APIView):
    """POST /api/incidents/<id>/notifications/retry/ - retry failed notifications (staff only)."""
    permission_classes = [IsAuthenticated]

    @extend_schema(
        summary='Retry failed notifications for an incident (Security/Admin)',
        request=None,
        responses={
            200: inline_serializer(
                name='RetryResponse',
                fields={
                    'retried': drf_serializers.IntegerField(),
                    'skipped_max_attempts': drf_serializers.IntegerField(),
                    'skipped_cooldown': drf_serializers.IntegerField(),
                },
            )
        },
    )
    def post(self, request, pk):
        user = request.user
        if not (user.is_superuser or user.role in ('security', 'admin')):
            raise PermissionDenied('Only security staff or admins can retry notifications.')
        incident = get_object_or_404(incidents_for_user(user), pk=pk)
        if incident.status in ('RESOLVED', 'CLOSED'):
            return Response(
                {'detail': 'Cannot retry notifications for a closed incident.'},
                status=status.HTTP_400_BAD_REQUEST,
            )
        return Response(retry_failed(incident))
