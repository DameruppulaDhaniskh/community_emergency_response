import logging

from django.db import transaction
from django.shortcuts import get_object_or_404
from django.utils import timezone
from drf_spectacular.types import OpenApiTypes
from drf_spectacular.utils import OpenApiParameter, extend_schema
from rest_framework import generics, status
from rest_framework.exceptions import PermissionDenied
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.throttling import UserRateThrottle
from rest_framework.views import APIView

from incidents.access import ACTIVE_STATES
from incidents.models import Incident
from notifications.services import (
    notify_guardian_accepted,
    notify_guardian_declined,
    notify_guardian_request,
)
from society.models import ResidentFlatMapping, SecurityProfile

from .models import EmergencyContact, ResidentSecurityGuard
from .serializers import (
    EmergencyContactSerializer,
    GuardianDependentSerializer,
    GuardianRequestSerializer,
    ResidentSecurityGuardSerializer,
    SocietySecurityStaffSerializer,
)

logger = logging.getLogger(__name__)


class ContactResendThrottle(UserRateThrottle):
    scope = 'contact_resend'


def _safe_guardian_notify(fn, *args, **kwargs):
    try:
        fn(*args, **kwargs)
    except Exception:
        logger.exception('Guardian notification dispatch failed')


def _require_guardian(user):
    if user.role != 'guardian' and not user.is_superuser:
        raise PermissionDenied('Only guardian accounts can access guardian requests and dependents.')


class EmergencyContactListCreateView(generics.ListCreateAPIView):
    """
    GET  /api/contacts/ - list active emergency contacts & guardian requests
    POST /api/contacts/ - add guardian by identifier (username/phone) or emergency contact
    """
    serializer_class = EmergencyContactSerializer
    permission_classes = [IsAuthenticated]

    def get_queryset(self):
        if getattr(self, 'swagger_fake_view', False):
            return EmergencyContact.objects.none()
        user = self.request.user
        if user.role == 'admin':
            return EmergencyContact.objects.filter(is_active=True).select_related('linked_user', 'resident')
        qs = EmergencyContact.objects.filter(
            resident=user,
            is_active=True,
        ).select_related('linked_user', 'resident')
        req_status = self.request.query_params.get('status')
        if req_status and req_status != 'all':
            qs = qs.filter(status=req_status)
        elif not req_status:
            qs = qs.exclude(status='cancelled')
        return qs.order_by('priority', '-created_at')

    def perform_create(self, serializer):
        with transaction.atomic():
            contact = serializer.save(resident=self.request.user)
            if contact.linked_user_id and contact.contact_type in ('primary_guardian', 'secondary_guardian'):
                transaction.on_commit(
                    lambda c=contact: _safe_guardian_notify(notify_guardian_request, c, 'initial')
                )


class EmergencyContactDetailView(generics.RetrieveUpdateDestroyAPIView):
    """
    GET    /api/contacts/<pk>/ - retrieve a contact
    PATCH  /api/contacts/<pk>/ - update contact metadata
    DELETE /api/contacts/<pk>/ - soft-delete (set is_active=False)
    """
    serializer_class = EmergencyContactSerializer
    permission_classes = [IsAuthenticated]

    def get_queryset(self):
        if getattr(self, 'swagger_fake_view', False):
            return EmergencyContact.objects.none()
        user = self.request.user
        if user.role == 'admin':
            return EmergencyContact.objects.all()
        return EmergencyContact.objects.filter(resident=user, is_active=True)

    def perform_destroy(self, instance):
        instance.is_active = False
        instance.save(update_fields=['is_active', 'updated_at'])


class ContactCancelView(APIView):
    """
    POST /api/contacts/<pk>/cancel/
    Resident cancels their pending guardian request.
    """
    permission_classes = [IsAuthenticated]
    serializer_class = EmergencyContactSerializer

    @extend_schema(request=None, responses={200: EmergencyContactSerializer})
    def post(self, request, pk):
        contact = get_object_or_404(
            EmergencyContact,
            pk=pk,
            resident=request.user,
            is_active=True,
        )
        if contact.contact_type not in ('primary_guardian', 'secondary_guardian'):
            return Response(
                {'detail': 'Only guardian requests can be cancelled.'},
                status=status.HTTP_400_BAD_REQUEST,
            )
        if contact.status != 'pending':
            return Response(
                {'detail': f'Cannot cancel a request with status "{contact.status}".'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        contact.status = 'cancelled'
        contact.is_verified = False
        contact.responded_at = timezone.now()
        contact.save()
        return Response(EmergencyContactSerializer(contact).data, status=status.HTTP_200_OK)


class ContactResendView(APIView):
    """
    POST /api/contacts/<pk>/resend/
    Resident re-notifies a pending guardian request (rate-limited) or creates a fresh
    request from a declined contact.
    """
    permission_classes = [IsAuthenticated]
    throttle_classes = [ContactResendThrottle]
    serializer_class = EmergencyContactSerializer

    @extend_schema(request=None, responses={200: EmergencyContactSerializer, 201: EmergencyContactSerializer})
    def post(self, request, pk):
        contact = get_object_or_404(
            EmergencyContact,
            pk=pk,
            resident=request.user,
            is_active=True,
        )
        if contact.contact_type not in ('primary_guardian', 'secondary_guardian') or not contact.linked_user_id:
            return Response(
                {'detail': 'Only guardian requests linked to an account can be resent.'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        now = timezone.now()
        if contact.status == 'pending':
            if contact.last_reminded_at and (now - contact.last_reminded_at).total_seconds() < 30:
                return Response(
                    {'detail': 'Please wait 30 seconds before sending another reminder.'},
                    status=status.HTTP_429_TOO_MANY_REQUESTS,
                )
            with transaction.atomic():
                contact.last_reminded_at = now
                contact.save(update_fields=['last_reminded_at', 'updated_at'])
                tag = f'rem-{int(now.timestamp() * 1000)}'
                transaction.on_commit(
                    lambda c=contact, t=tag: _safe_guardian_notify(notify_guardian_request, c, t)
                )
            return Response(EmergencyContactSerializer(contact).data, status=status.HTTP_200_OK)

        if contact.status == 'declined':
            target = contact.linked_user
            if not target or not target.is_active or target.role != 'guardian':
                return Response(
                    {'detail': 'That guardian account is no longer active.'},
                    status=status.HTTP_400_BAD_REQUEST,
                )
            slot_taken = EmergencyContact.objects.filter(
                resident=request.user,
                contact_type=contact.contact_type,
                is_active=True,
                status__in=['pending', 'accepted'],
            ).exists()
            if slot_taken:
                label = dict(EmergencyContact.CONTACT_TYPES)[contact.contact_type]
                return Response(
                    {'detail': f'You already have an active {label}. Remove or cancel it first.'},
                    status=status.HTTP_400_BAD_REQUEST,
                )

            with transaction.atomic():
                # Deactivate the old declined row so the Safety Circle shows the new pending request cleanly
                contact.is_active = False
                contact.save(update_fields=['is_active', 'updated_at'])

                fresh = EmergencyContact.objects.create(
                    resident=request.user,
                    linked_user=target,
                    contact_type=contact.contact_type,
                    relationship=contact.relationship,
                    name=target.get_full_name() or target.username,
                    phone=target.phone,
                    email=target.email,
                    priority=contact.priority,
                    status='pending',
                    is_verified=False,
                    last_reminded_at=now,
                )
                transaction.on_commit(
                    lambda c=fresh: _safe_guardian_notify(notify_guardian_request, c, 'initial')
                )
            return Response(EmergencyContactSerializer(fresh).data, status=status.HTTP_201_CREATED)

        return Response(
            {'detail': f'Cannot resend a request with status "{contact.status}".'},
            status=status.HTTP_400_BAD_REQUEST,
        )


class ContactVerifyView(APIView):
    """
    POST /api/contacts/<pk>/verify/ - REMOVED (410 Gone).
    Residents can no longer verify guardians themselves; guardians must accept requests.
    """
    permission_classes = [IsAuthenticated]

    @extend_schema(exclude=True)
    def post(self, request, pk):
        return Response(
            {
                'detail': 'Resident self-verification has been removed. Guardians must accept the request from their SafeCircle account.',
            },
            status=status.HTTP_410_GONE,
        )


class ResendVerificationView(APIView):
    """
    POST /api/contacts/<pk>/resend-verification/ - REMOVED (410 Gone).
    """
    permission_classes = [IsAuthenticated]

    @extend_schema(exclude=True)
    def post(self, request, pk):
        return Response(
            {
                'detail': 'Legacy verification tokens have been removed. Use POST /api/contacts/<id>/resend/ instead.',
            },
            status=status.HTTP_410_GONE,
        )


class GuardianRequestListView(APIView):
    """
    GET /api/guardian/requests/?status=pending
    Incoming guardian requests addressed to the logged-in guardian.
    """
    permission_classes = [IsAuthenticated]
    serializer_class = GuardianRequestSerializer

    @extend_schema(
        summary='List incoming guardian requests for logged-in guardian',
        parameters=[
            OpenApiParameter('status', OpenApiTypes.STR, description='pending | accepted | declined | all (default pending)')
        ],
        responses={200: GuardianRequestSerializer(many=True)},
    )
    def get(self, request):
        _require_guardian(request.user)
        status_param = (request.query_params.get('status') or 'pending').strip().lower()
        qs = EmergencyContact.objects.filter(
            linked_user=request.user,
            is_active=True,
            contact_type__in=('primary_guardian', 'secondary_guardian'),
        ).select_related('resident').order_by('-created_at')

        if status_param != 'all':
            qs = qs.filter(status=status_param)

        payload = [GuardianRequestSerializer.from_contact(c) for c in qs]
        return Response(payload, status=status.HTTP_200_OK)


class GuardianRequestAcceptView(APIView):
    """
    POST /api/guardian/requests/<pk>/accept/
    Guardian accepts an incoming guardian request (404 for anyone else).
    """
    permission_classes = [IsAuthenticated]
    serializer_class = GuardianRequestSerializer

    @extend_schema(request=None, responses={200: GuardianRequestSerializer})
    def post(self, request, pk):
        _require_guardian(request.user)
        contact = get_object_or_404(
            EmergencyContact.objects.select_related('resident', 'linked_user'),
            pk=pk,
            linked_user=request.user,
            is_active=True,
            contact_type__in=('primary_guardian', 'secondary_guardian'),
        )
        if contact.status == 'accepted':
            return Response(GuardianRequestSerializer.from_contact(contact), status=status.HTTP_200_OK)
        if contact.status != 'pending':
            return Response(
                {'detail': f'Cannot accept a request that is already {contact.status}.'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        with transaction.atomic():
            now = timezone.now()
            contact.status = 'accepted'
            contact.is_verified = True
            contact.verified_at = now
            contact.responded_at = now
            contact.save()
            transaction.on_commit(lambda c=contact: _safe_guardian_notify(notify_guardian_accepted, c))

        return Response(GuardianRequestSerializer.from_contact(contact), status=status.HTTP_200_OK)


class GuardianRequestDeclineView(APIView):
    """
    POST /api/guardian/requests/<pk>/decline/
    Guardian declines an incoming guardian request (404 for anyone else).
    """
    permission_classes = [IsAuthenticated]
    serializer_class = GuardianRequestSerializer

    @extend_schema(request=None, responses={200: GuardianRequestSerializer})
    def post(self, request, pk):
        _require_guardian(request.user)
        contact = get_object_or_404(
            EmergencyContact.objects.select_related('resident', 'linked_user'),
            pk=pk,
            linked_user=request.user,
            is_active=True,
            contact_type__in=('primary_guardian', 'secondary_guardian'),
        )
        if contact.status == 'declined':
            return Response(GuardianRequestSerializer.from_contact(contact), status=status.HTTP_200_OK)
        if contact.status != 'pending':
            return Response(
                {'detail': f'Cannot decline a request that is already {contact.status}.'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        with transaction.atomic():
            now = timezone.now()
            contact.status = 'declined'
            contact.is_verified = False
            contact.verified_at = None
            contact.responded_at = now
            contact.save()
            transaction.on_commit(lambda c=contact: _safe_guardian_notify(notify_guardian_declined, c))

        return Response(GuardianRequestSerializer.from_contact(contact), status=status.HTTP_200_OK)


class GuardianDependentsListView(APIView):
    """
    GET /api/guardian/dependents/
    List accepted dependent residents protected by the logged-in guardian.
    """
    permission_classes = [IsAuthenticated]
    serializer_class = GuardianDependentSerializer

    @extend_schema(responses={200: GuardianDependentSerializer(many=True)})
    def get(self, request):
        _require_guardian(request.user)
        contacts = (
            EmergencyContact.objects.filter(
                linked_user=request.user,
                is_active=True,
                status='accepted',
                is_verified=True,
            )
            .select_related('resident')
            .order_by('priority', '-verified_at')
        )

        # Deduplicate per resident keeping highest priority guardian entry
        by_res = {}
        for c in contacts:
            if c.resident_id not in by_res:
                by_res[c.resident_id] = c

        results = []
        for c in by_res.values():
            res = c.resident
            mapping = (
                ResidentFlatMapping.objects.filter(user=res, is_active=True)
                .select_related('flat__block__society')
                .first()
            )
            if mapping and mapping.flat:
                blk = mapping.flat.block
                flat_str = f"Block {blk.name} · Flat {mapping.flat.flat_number}" if blk else f"Flat {mapping.flat.flat_number}"
                soc_str = blk.society.name if blk and blk.society else ''
            else:
                flat_str = res.address or 'Resident Unit'
                soc_str = ''

            active_inc = (
                Incident.objects.filter(resident=res, status__in=ACTIVE_STATES)
                .order_by('-created_at')
                .first()
            )
            results.append({
                'id': res.pk,
                'contact_id': c.pk,
                'name': res.get_full_name() or res.username,
                'phone': res.phone,
                'flat': flat_str,
                'society': soc_str,
                'contact_type': c.contact_type,
                'relationship': c.relationship,
                'verified_at': c.verified_at,
                'has_active_incident': active_inc is not None,
                'active_incident_id': active_inc.pk if active_inc else None,
            })

        return Response(results, status=status.HTTP_200_OK)


class ResidentSecurityGuardListCreateView(generics.ListCreateAPIView):
    """
    GET  /api/resident/security-guards/ - list resident's active guards
    POST /api/resident/security-guards/ - add security guard
    """
    serializer_class = ResidentSecurityGuardSerializer
    permission_classes = [IsAuthenticated]

    def get_queryset(self):
        if getattr(self, 'swagger_fake_view', False):
            return ResidentSecurityGuard.objects.none()
        return ResidentSecurityGuard.objects.filter(
            resident=self.request.user,
            is_active=True,
        ).select_related('linked_user', 'resident')

    def perform_create(self, serializer):
        from incidents.escalation import get_or_create_escalation_settings
        guard = serializer.save(resident=self.request.user)
        settings_obj = get_or_create_escalation_settings(self.request.user)
        if not settings_obj.has_security_guard:
            settings_obj.has_security_guard = True
            settings_obj.save(update_fields=['has_security_guard'])


class ResidentSecurityGuardDetailView(generics.RetrieveUpdateDestroyAPIView):
    """
    GET    /api/resident/security-guards/<pk>/
    PATCH  /api/resident/security-guards/<pk>/
    DELETE /api/resident/security-guards/<pk>/ - soft delete
    """
    serializer_class = ResidentSecurityGuardSerializer
    permission_classes = [IsAuthenticated]

    def get_queryset(self):
        if getattr(self, 'swagger_fake_view', False):
            return ResidentSecurityGuard.objects.none()
        return ResidentSecurityGuard.objects.filter(
            resident=self.request.user,
            is_active=True,
        ).select_related('linked_user', 'resident')

    def perform_destroy(self, instance):
        instance.is_active = False
        instance.save(update_fields=['is_active', 'updated_at'])


class ResidentSocietySecurityListView(APIView):
    """
    GET /api/resident/society-security/
    List approved security staff from resident's society, including on-duty status.
    """
    permission_classes = [IsAuthenticated]
    serializer_class = SocietySecurityStaffSerializer

    @extend_schema(responses={200: SocietySecurityStaffSerializer(many=True)})
    def get(self, request):
        user = request.user
        soc_ids = list(
            ResidentFlatMapping.objects.filter(user=user, is_active=True)
            .values_list('flat__block__society_id', flat=True)
            .distinct()
        )
        if not soc_ids:
            return Response([], status=status.HTTP_200_OK)

        profiles = SecurityProfile.objects.filter(
            society_id__in=soc_ids,
            approval_status='approved',
            user__is_active=True,
        ).select_related('user', 'society').order_by('user__username')

        serializer = SocietySecurityStaffSerializer(profiles, many=True)
        return Response(serializer.data, status=status.HTTP_200_OK)
