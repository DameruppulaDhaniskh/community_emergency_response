import logging

from django.shortcuts import get_object_or_404
from django.utils import timezone
from django_filters.rest_framework import DjangoFilterBackend
from rest_framework import generics, status
from rest_framework.exceptions import PermissionDenied
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from .models import SOSAlert, AlertResponse, NotificationLog, InAppNotification
from .notifications import route_alert
from .serializers import (
    SOSAlertSerializer, AlertResponseSerializer,
    NotificationLogSerializer, InAppNotificationSerializer,
)

logger = logging.getLogger(__name__)


def alerts_for_user(user):
    """Which alerts this user is allowed to see."""
    if user.role in ('admin', 'security'):
        return SOSAlert.objects.all()
    if user.role == 'guardian':
        return SOSAlert.objects.filter(
            resident__emergency_contacts__linked_user=user
        ).distinct()
    if user.role == 'volunteer':
        return SOSAlert.objects.filter(status__in=['active', 'acknowledged', 'escalated'])
    return SOSAlert.objects.filter(resident=user)


class SOSAlertListCreateView(generics.ListCreateAPIView):
    """
    POST /api/sos/   - trigger an SOS (residents only)
    GET  /api/sos/   - list alerts you are allowed to see
    """
    serializer_class = SOSAlertSerializer
    permission_classes = [IsAuthenticated]
    filter_backends = [DjangoFilterBackend]
    filterset_fields = ['status', 'category']

    def get_queryset(self):
        return alerts_for_user(self.request.user)

    def perform_create(self, serializer):
        if self.request.user.role != 'resident':
            raise PermissionDenied('Only residents can trigger an SOS.')
        alert = serializer.save(resident=self.request.user)
        try:
            route_alert(alert)
        except Exception:
            logger.exception('Alert routing failed for SOS %s', alert.pk)


class SOSAlertDetailView(generics.RetrieveAPIView):
    """GET /api/sos/<pk>/"""
    serializer_class = SOSAlertSerializer
    permission_classes = [IsAuthenticated]

    def get_queryset(self):
        return alerts_for_user(self.request.user)


class SOSAlertCancelView(APIView):
    """POST /api/sos/<pk>/cancel/ - resident cancels their own active alert"""
    permission_classes = [IsAuthenticated]

    def post(self, request, pk):
        try:
            alert = SOSAlert.objects.get(pk=pk, resident=request.user)
        except SOSAlert.DoesNotExist:
            return Response({'detail': 'Alert not found.'}, status=status.HTTP_404_NOT_FOUND)
        if alert.status != 'active':
            return Response(
                {'detail': 'Only active alerts can be cancelled.'},
                status=status.HTTP_400_BAD_REQUEST,
            )
        alert.status = 'cancelled'
        alert.save()
        return Response(SOSAlertSerializer(alert).data)


class SOSAlertRespondView(APIView):
    """POST /api/sos/<pk>/respond/ - guardian/security/volunteer updates the response"""
    permission_classes = [IsAuthenticated]

    def post(self, request, pk):
        user = request.user
        if user.role == 'resident':
            raise PermissionDenied('Residents cannot respond to alerts.')
        alert = get_object_or_404(alerts_for_user(user), pk=pk)
        if alert.status in ('resolved', 'cancelled'):
            return Response(
                {'detail': 'This alert is already closed.'},
                status=status.HTTP_400_BAD_REQUEST,
            )
        serializer = AlertResponseSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        new_status = serializer.validated_data['status']
        if new_status == 'resolved' and user.role == 'volunteer':
            raise PermissionDenied('Volunteers cannot resolve alerts.')

        serializer.save(alert=alert, responder=user)

        if new_status == 'resolved':
            alert.status = 'resolved'
            alert.resolved_at = timezone.now()
        elif alert.status == 'active':
            alert.status = 'acknowledged'
        alert.save()
        return Response(serializer.data, status=status.HTTP_201_CREATED)


class SOSAlertResponsesView(generics.ListAPIView):
    """GET /api/sos/<pk>/responses/ - who responded and when"""
    serializer_class = AlertResponseSerializer
    permission_classes = [IsAuthenticated]

    def get_queryset(self):
        alert = get_object_or_404(alerts_for_user(self.request.user), pk=self.kwargs['pk'])
        return alert.responses.all()


class SOSAlertDeliveryView(APIView):
    """GET /api/sos/<pk>/delivery/ - notification delivery tracking"""
    permission_classes = [IsAuthenticated]

    def get(self, request, pk):
        alert = get_object_or_404(SOSAlert, pk=pk)
        if request.user.role not in ('admin', 'security') and alert.resident != request.user:
            raise PermissionDenied('You cannot view delivery details for this alert.')
        logs = NotificationLog.objects.filter(alert=alert)
        return Response({
            'alert_id': alert.pk,
            'alert_status': alert.status,
            'total': logs.count(),
            'sent': logs.filter(status='sent').count(),
            'failed': logs.filter(status='failed').count(),
            'notifications': NotificationLogSerializer(logs, many=True).data,
        })


class InAppNotificationListView(generics.ListAPIView):
    """GET /api/sos/notifications/?is_read=false - my notification center"""
    serializer_class = InAppNotificationSerializer
    permission_classes = [IsAuthenticated]
    filter_backends = [DjangoFilterBackend]
    filterset_fields = ['is_read']

    def get_queryset(self):
        return InAppNotification.objects.filter(user=self.request.user)


class InAppNotificationReadView(APIView):
    """POST /api/sos/notifications/<pk>/read/"""
    permission_classes = [IsAuthenticated]

    def post(self, request, pk):
        note = get_object_or_404(InAppNotification, pk=pk, user=request.user)
        note.is_read = True
        note.save()
        return Response(InAppNotificationSerializer(note).data)