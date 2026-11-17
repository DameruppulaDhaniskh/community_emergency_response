import logging
from datetime import timedelta
from decimal import Decimal
from django.conf import settings
from django.db import transaction
from django.db.models import Q
from django.shortcuts import get_object_or_404
from django.utils import timezone
from rest_framework import generics, filters, serializers as drf_serializers, status
from rest_framework.exceptions import PermissionDenied, ValidationError
from rest_framework.pagination import PageNumberPagination
from rest_framework.permissions import AllowAny, BasePermission, IsAuthenticated, SAFE_METHODS
from rest_framework.response import Response
from rest_framework.views import APIView
from django_filters.rest_framework import DjangoFilterBackend
from django.contrib.auth import get_user_model

from incidents.matching import haversine_km
from notifications.models import Notification
from notifications.services import dispatch
from users.permissions import IsAdminRole, IsAdminOrReadOnly

from .models import (
    Block,
    Flat,
    ResidentFlatMapping,
    SecurityProfile,
    Society,
    SocietyAlertPolicy,
    SocietyAssignment,
    VolunteerLocation,
    VolunteerProfile,
)
from .serializers import (
    BlockSerializer,
    FlatSerializer,
    PublicBlockSerializer,
    PublicFlatSerializer,
    PublicSocietySerializer,
    ResidentFlatMappingSerializer,
    SecurityAdminListSerializer,
    SocietyAlertPolicySerializer,
    SocietySerializer,
    UnlinkedUserSerializer,
    VolunteerAdminListSerializer,
    VolunteerApprovalActionSerializer,
)

logger = logging.getLogger(__name__)
User = get_user_model()


def check_and_update_far_pin(profile):
    """Compute distance from volunteer's base pin to society coordinates and set warning."""
    threshold_km = float(getattr(settings, 'SOCIETY_PIN_WARN_KM', 3.0))
    soc = profile.society
    if (
        soc
        and soc.latitude is not None
        and soc.longitude is not None
        and profile.latitude is not None
        and profile.longitude is not None
    ):
        dist = haversine_km(soc.latitude, soc.longitude, profile.latitude, profile.longitude)
        profile.pin_distance_from_society_km = Decimal(str(dist)) if dist is not None else None
        profile.pin_far_from_society = bool(dist is not None and dist > threshold_km)
    else:
        profile.pin_distance_from_society_km = None
        profile.pin_far_from_society = False


# ──────────────────────────── Society ────────────────────────────

class SocietyListCreateView(generics.ListCreateAPIView):
    """
    GET  /api/society/          — list all societies (authenticated users)
    POST /api/society/          — register a new society (admin only)
    """
    queryset = Society.objects.filter(is_active=True)
    serializer_class = SocietySerializer
    permission_classes = [IsAuthenticated, IsAdminOrReadOnly]
    filter_backends = [filters.SearchFilter]
    search_fields = ['name', 'city', 'registration_number']


class SocietyDetailView(generics.RetrieveUpdateDestroyAPIView):
    """
    GET    /api/society/<pk>/   — retrieve a society
    PATCH  /api/society/<pk>/   — update (admin only)
    DELETE /api/society/<pk>/   — soft delete by marking is_active=False (admin only)
    """
    queryset = Society.objects.all()
    serializer_class = SocietySerializer
    permission_classes = [IsAuthenticated, IsAdminOrReadOnly]

    def perform_destroy(self, instance):
        instance.is_active = False
        instance.save()


# ──────────────────────────── Block ────────────────────────────

class BlockListCreateView(generics.ListCreateAPIView):
    """
    GET  /api/society/<society_pk>/blocks/   — list blocks
    POST /api/society/<society_pk>/blocks/   — add a block (admin only)
    """
    serializer_class = BlockSerializer
    permission_classes = [IsAuthenticated, IsAdminOrReadOnly]

    def get_queryset(self):
        return Block.objects.filter(society_id=self.kwargs['society_pk'])

    def perform_create(self, serializer):
        society = get_object_or_404(Society, pk=self.kwargs['society_pk'])
        serializer.save(society=society)


class BlockDetailView(generics.RetrieveUpdateDestroyAPIView):
    """
    GET    /api/society/blocks/<pk>/
    PATCH  /api/society/blocks/<pk>/
    DELETE /api/society/blocks/<pk>/
    """
    queryset = Block.objects.all()
    serializer_class = BlockSerializer
    permission_classes = [IsAuthenticated, IsAdminOrReadOnly]


# ──────────────────────────── Flat ────────────────────────────

class FlatListCreateView(generics.ListCreateAPIView):
    """
    GET  /api/society/blocks/<block_pk>/flats/   — list flats in a block
    POST /api/society/blocks/<block_pk>/flats/   — add flat (admin only)
    """
    serializer_class = FlatSerializer
    permission_classes = [IsAuthenticated, IsAdminOrReadOnly]

    def get_queryset(self):
        return Flat.objects.filter(block_id=self.kwargs['block_pk'])

    def perform_create(self, serializer):
        block = get_object_or_404(Block, pk=self.kwargs['block_pk'])
        serializer.save(block=block)


class FlatDetailView(generics.RetrieveUpdateDestroyAPIView):
    """
    GET    /api/society/flats/<pk>/
    PATCH  /api/society/flats/<pk>/
    DELETE /api/society/flats/<pk>/
    """
    queryset = Flat.objects.all()
    serializer_class = FlatSerializer
    permission_classes = [IsAuthenticated, IsAdminOrReadOnly]


# ──────────────────────────── Resident-Flat Mappings ────────────────────────────

class IsAdminOrResidentSelfMapping(BasePermission):
    def has_permission(self, request, view):
        if request.method in SAFE_METHODS:
            return True
        if request.user and request.user.is_authenticated:
            if request.user.role in ('admin', 'resident') or request.user.is_superuser:
                return True
        return False


class ResidentFlatMappingListCreateView(generics.ListCreateAPIView):
    """
    GET  /api/society/mappings/   — list mappings (filter by ?society= or ?user=)
    POST /api/society/mappings/   — map a resident to a flat (admin or resident self-link)
    """
    serializer_class = ResidentFlatMappingSerializer
    permission_classes = [IsAuthenticated, IsAdminOrResidentSelfMapping]

    def get_queryset(self):
        qs = ResidentFlatMapping.objects.filter(is_active=True).select_related(
            'user', 'flat__block__society'
        )
        society_id = self.request.query_params.get('society')
        if society_id:
            qs = qs.filter(flat__block__society_id=society_id)
        user_id = self.request.query_params.get('user')
        if user_id:
            qs = qs.filter(user_id=user_id)
        return qs

    def perform_create(self, serializer):
        flat = serializer.validated_data['flat']
        flat.is_occupied = True
        flat.save()
        user = serializer.validated_data.get('user', self.request.user)
        if self.request.user.role == 'resident':
            user = self.request.user
        serializer.save(user=user)


class ResidentFlatMappingDetailView(generics.RetrieveUpdateDestroyAPIView):
    """
    GET    /api/society/mappings/<pk>/
    PATCH  /api/society/mappings/<pk>/
    DELETE /api/society/mappings/<pk>/
    """
    queryset = ResidentFlatMapping.objects.all()
    serializer_class = ResidentFlatMappingSerializer
    permission_classes = [IsAuthenticated, IsAdminOrReadOnly]

    def perform_destroy(self, instance):
        instance.is_active = False
        instance.move_out_date = timezone.now().date()
        instance.save()
        flat = instance.flat
        if not flat.residents.filter(is_active=True).exists():
            flat.is_occupied = False
            flat.save()


# ──────────────────────────── Society Policy ────────────────────────────

class SocietyPolicyView(APIView):
    """
    GET   /api/society/policy/ - get society alert policy and coordinates for admin's society
    PATCH /api/society/policy/ - update include_neighbour_societies, neighbour_radius_km, and society coordinates
    """
    permission_classes = [IsAuthenticated]

    def _get_society(self, user):
        soc = Society.objects.filter(admin=user, is_active=True).first()
        if not soc:
            if user.is_superuser:
                soc = Society.objects.filter(is_active=True).first()
        if not soc:
            raise PermissionDenied("You do not administer any active society.")
        return soc

    def get(self, request):
        soc = self._get_society(request.user)
        policy, _ = SocietyAlertPolicy.objects.get_or_create(society=soc)
        serializer = SocietyAlertPolicySerializer(policy)
        return Response(serializer.data)

    def patch(self, request):
        soc = self._get_society(request.user)
        policy, _ = SocietyAlertPolicy.objects.get_or_create(society=soc)
        serializer = SocietyAlertPolicySerializer(policy, data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        serializer.save()
        return Response(serializer.data)


# ──────────────────────────── Volunteer Profile & Approvals ────────────────────────────

class VolunteerProfileView(APIView):
    """
    GET   /api/volunteer/profile/ - volunteer views own profile
    PATCH /api/volunteer/profile/ - volunteer edits block, pin, radius, serves_nearby_societies
    """
    permission_classes = [IsAuthenticated]

    def _get_or_create_profile(self, user):
        if user.role != 'volunteer' and not user.is_superuser:
            raise PermissionDenied("Only volunteer users have a volunteer profile.")

        assignment = SocietyAssignment.objects.filter(user=user).select_related('society').first()
        first_soc = Society.objects.filter(is_active=True).first()
        soc = assignment.society if assignment else first_soc
        if not soc:
            raise ValidationError({'detail': 'No society exists to bind volunteer profile.'})

        profile, _ = VolunteerProfile.objects.get_or_create(
            user=user,
            defaults={
                'society': soc,
                'approval_status': 'pending',
                'max_travel_km': 3.0,
            },
        )
        return profile

    def get(self, request):
        profile = self._get_or_create_profile(request.user)
        serializer = VolunteerAdminListSerializer(profile)
        return Response(serializer.data)

    def patch(self, request):
        profile = self._get_or_create_profile(request.user)
        was_approved = (profile.approval_status == 'approved')

        data = request.data
        if 'block' in data:
            block_id = data.get('block')
            if block_id:
                block = get_object_or_404(Block, id=block_id, society=profile.society)
                profile.block = block
            else:
                profile.block = None

        if 'serves_nearby_societies' in data:
            profile.serves_nearby_societies = bool(data.get('serves_nearby_societies'))

        if 'max_travel_km' in data:
            val = float(data.get('max_travel_km') or 3.0)
            if val <= 0:
                raise ValidationError({'max_travel_km': 'Must be greater than 0.'})
            profile.max_travel_km = val

        if 'latitude' in data and 'longitude' in data:
            lat = data.get('latitude')
            lng = data.get('longitude')
            if lat is not None and lng is not None:
                profile.latitude = Decimal(str(lat))
                profile.longitude = Decimal(str(lng))
            else:
                profile.latitude = None
                profile.longitude = None

        if 'pin_label' in data:
            profile.pin_label = (data.get('pin_label') or '').strip()
        if 'area_label' in data:
            profile.area_label = (data.get('area_label') or '').strip()
            if not profile.pin_label:
                profile.pin_label = profile.area_label

        check_and_update_far_pin(profile)

        if was_approved and profile.pin_far_from_society:
            profile.approval_status = 'pending'
            dist_txt = f"{profile.pin_distance_from_society_km} km" if profile.pin_distance_from_society_km else "unknown"
            profile.approval_note = f"Base pin was moved far from society center ({dist_txt}). Re-approval required."

            SocietyAssignment.objects.filter(user=request.user, society=profile.society).update(is_active=False)

            Notification.objects.create(
                event_type='STATUS_CHANGED',
                recipient=request.user,
                recipient_type='volunteer',
                recipient_name=request.user.get_full_name() or request.user.username,
                channel='in_app',
                title='Volunteer Location Under Review',
                message=profile.approval_note,
                dedupe_key=f"VOL_REPEND:{request.user.pk}:{timezone.now().timestamp()}",
            )

        profile.save()
        return Response(VolunteerAdminListSerializer(profile).data)


class VolunteerPagination(PageNumberPagination):
    page_size = 20
    page_size_query_param = 'page_size'
    max_page_size = 100


class AdminVolunteerListView(generics.ListAPIView):
    """
    GET /api/admin/volunteers/?status=pending|approved|rejected&search=
    Admin of that society only; lists volunteers with approval status, distance, far-pin flag.
    """
    serializer_class = VolunteerAdminListSerializer
    permission_classes = [IsAuthenticated]
    pagination_class = VolunteerPagination

    def get_queryset(self):
        user = self.request.user
        if not user.is_superuser and user.role != 'admin':
            raise PermissionDenied("Only society administrators can view volunteer approvals.")

        administered_ids = list(Society.objects.filter(admin=user).values_list('id', flat=True))
        if user.is_superuser and not administered_ids:
            administered_ids = list(Society.objects.values_list('id', flat=True))

        qs = VolunteerProfile.objects.filter(society_id__in=administered_ids).select_related('user', 'society', 'block')

        status_param = self.request.query_params.get('status')
        if status_param in ('pending', 'approved', 'rejected'):
            qs = qs.filter(approval_status=status_param)

        search_param = self.request.query_params.get('search')
        if search_param:
            qs = qs.filter(
                Q(user__first_name__icontains=search_param)
                | Q(user__last_name__icontains=search_param)
                | Q(user__username__icontains=search_param)
                | Q(user__phone__icontains=search_param)
                | Q(pin_label__icontains=search_param)
                | Q(area_label__icontains=search_param)
            )

        return qs.order_by('-created_at')


class AdminVolunteerApproveView(APIView):
    """POST /api/admin/volunteers/<pk>/approve/ - admin approves volunteer."""
    permission_classes = [IsAuthenticated]

    def post(self, request, pk):
        user = request.user
        if not user.is_superuser and user.role != 'admin':
            raise PermissionDenied("Only society administrators can approve volunteers.")

        profile = get_object_or_404(VolunteerProfile, pk=pk)
        if not user.is_superuser and profile.society.admin_id != user.id:
            raise PermissionDenied("You are not the administrator of this volunteer's society.")

        with transaction.atomic():
            profile.approval_status = 'approved'
            profile.approval_reviewed_by = user
            profile.approval_reviewed_at = timezone.now()
            profile.approval_note = ''
            profile.save(update_fields=['approval_status', 'approval_reviewed_by', 'approval_reviewed_at', 'approval_note', 'updated_at'])

            SocietyAssignment.objects.filter(user=profile.user, society=profile.society).update(is_active=True)

            note, _ = Notification.objects.get_or_create(
                incident=None,
                dedupe_key=f"VOL_APPROVED:{profile.user.pk}:{timezone.now().timestamp()}",
                defaults={
                    'event_type': 'STATUS_CHANGED',
                    'recipient': profile.user,
                    'recipient_type': 'volunteer',
                    'recipient_name': profile.user.get_full_name() or profile.user.username,
                    'recipient_phone': profile.user.phone or '',
                    'recipient_email': profile.user.email or '',
                    'channel': 'in_app',
                    'title': 'Volunteer Application Approved',
                    'message': f"Your volunteer application for {profile.society.name} has been approved. You will now receive local emergency alerts.",
                },
            )
            dispatch(note)

        return Response(VolunteerAdminListSerializer(profile).data)


class AdminVolunteerRejectView(APIView):
    """POST /api/admin/volunteers/<pk>/reject/ - admin rejects volunteer with reason."""
    permission_classes = [IsAuthenticated]

    def post(self, request, pk):
        user = request.user
        if not user.is_superuser and user.role != 'admin':
            raise PermissionDenied("Only society administrators can reject volunteers.")

        profile = get_object_or_404(VolunteerProfile, pk=pk)
        if not user.is_superuser and profile.society.admin_id != user.id:
            raise PermissionDenied("You are not the administrator of this volunteer's society.")

        reason = (request.data.get('reason') or '').strip()
        if not reason:
            return Response({'reason': ['A reason is required to reject a volunteer application.']}, status=status.HTTP_400_BAD_REQUEST)

        with transaction.atomic():
            profile.approval_status = 'rejected'
            profile.approval_reviewed_by = user
            profile.approval_reviewed_at = timezone.now()
            profile.approval_note = reason
            profile.save(update_fields=['approval_status', 'approval_reviewed_by', 'approval_reviewed_at', 'approval_note', 'updated_at'])

            SocietyAssignment.objects.filter(user=profile.user, society=profile.society).update(is_active=False)

            note, _ = Notification.objects.get_or_create(
                incident=None,
                dedupe_key=f"VOL_REJECTED:{profile.user.pk}:{timezone.now().timestamp()}",
                defaults={
                    'event_type': 'STATUS_CHANGED',
                    'recipient': profile.user,
                    'recipient_type': 'volunteer',
                    'recipient_name': profile.user.get_full_name() or profile.user.username,
                    'recipient_phone': profile.user.phone or '',
                    'recipient_email': profile.user.email or '',
                    'channel': 'in_app',
                    'title': 'Volunteer Application Rejected',
                    'message': f"Your volunteer application for {profile.society.name} was rejected: {reason}",
                },
            )
            dispatch(note)

        return Response(VolunteerAdminListSerializer(profile).data)


# ──────────────────────────── Public Registration Endpoints ────────────────────────────

class PublicSocietyListView(generics.ListAPIView):
    """
    GET /api/public/societies/
    Unauthenticated public listing of active societies for user registration.
    """
    permission_classes = [AllowAny]
    serializer_class = PublicSocietySerializer
    queryset = Society.objects.filter(is_active=True).order_by('name')
    filter_backends = [filters.SearchFilter]
    search_fields = ['name', 'city']
    pagination_class = None


class PublicBlockListView(generics.ListAPIView):
    """
    GET /api/public/societies/<society_id>/blocks/
    Unauthenticated public listing of blocks belonging to a society.
    """
    permission_classes = [AllowAny]
    serializer_class = PublicBlockSerializer
    pagination_class = None

    def get_queryset(self):
        society_id = self.kwargs.get('society_id')
        return Block.objects.filter(society_id=society_id).order_by('name')


class PublicFlatListView(generics.ListAPIView):
    """
    GET /api/public/blocks/<block_id>/flats/
    Unauthenticated public listing of flats belonging to a block.
    """
    permission_classes = [AllowAny]
    serializer_class = PublicFlatSerializer
    pagination_class = None

    def get_queryset(self):
        block_id = self.kwargs.get('block_id')
        return Flat.objects.filter(block_id=block_id).order_by('floor', 'flat_number')


# ──────────────────────────── Admin Staff: Security Approvals ────────────────────────────

class AdminSecurityListView(generics.ListAPIView):
    """
    GET /api/admin/security/
    Admin lists security guard profiles for administered societies.
    """
    permission_classes = [IsAuthenticated]
    serializer_class = SecurityAdminListSerializer

    def get_queryset(self):
        user = self.request.user
        if not user.is_superuser and user.role != 'admin':
            raise PermissionDenied("Only society administrators can review security personnel.")

        administered_ids = list(Society.objects.filter(admin=user, is_active=True).values_list('id', flat=True))
        if user.is_superuser and not administered_ids:
            administered_ids = list(Society.objects.filter(is_active=True).values_list('id', flat=True))

        qs = SecurityProfile.objects.filter(society_id__in=administered_ids).select_related('user', 'society')

        status_param = self.request.query_params.get('status')
        if status_param in ('pending', 'approved', 'rejected'):
            qs = qs.filter(approval_status=status_param)

        search_param = self.request.query_params.get('search')
        if search_param:
            qs = qs.filter(
                Q(user__first_name__icontains=search_param)
                | Q(user__last_name__icontains=search_param)
                | Q(user__username__icontains=search_param)
                | Q(user__phone__icontains=search_param)
                | Q(post_label__icontains=search_param)
            )

        return qs.order_by('-created_at')


class AdminSecurityApproveView(APIView):
    """POST /api/admin/security/<pk>/approve/ - admin approves security guard."""
    permission_classes = [IsAuthenticated]

    def post(self, request, pk):
        user = request.user
        if not user.is_superuser and user.role != 'admin':
            raise PermissionDenied("Only society administrators can approve security guards.")

        profile = get_object_or_404(SecurityProfile, pk=pk)
        if not user.is_superuser and profile.society.admin_id != user.id:
            raise PermissionDenied("You are not the administrator of this guard's society.")

        with transaction.atomic():
            profile.approval_status = 'approved'
            profile.approval_reviewed_by = user
            profile.approval_reviewed_at = timezone.now()
            profile.approval_note = ''
            profile.save(update_fields=['approval_status', 'approval_reviewed_by', 'approval_reviewed_at', 'approval_note', 'updated_at'])

            SocietyAssignment.objects.filter(user=profile.user, society=profile.society).update(is_active=True)

            note, _ = Notification.objects.get_or_create(
                incident=None,
                dedupe_key=f"SEC_APPROVED:{profile.user.pk}:{timezone.now().timestamp()}",
                defaults={
                    'event_type': 'STATUS_CHANGED',
                    'recipient': profile.user,
                    'recipient_type': 'security',
                    'recipient_name': profile.user.get_full_name() or profile.user.username,
                    'recipient_phone': profile.user.phone or '',
                    'recipient_email': profile.user.email or '',
                    'channel': 'in_app',
                    'title': 'Security Guard Profile Approved',
                    'message': f"Your security guard profile for {profile.society.name} ({profile.post_label}) has been approved.",
                },
            )
            dispatch(note)

        return Response(SecurityAdminListSerializer(profile).data)


class AdminSecurityRejectView(APIView):
    """POST /api/admin/security/<pk>/reject/ - admin rejects security guard with reason."""
    permission_classes = [IsAuthenticated]

    def post(self, request, pk):
        user = request.user
        if not user.is_superuser and user.role != 'admin':
            raise PermissionDenied("Only society administrators can reject security guards.")

        profile = get_object_or_404(SecurityProfile, pk=pk)
        if not user.is_superuser and profile.society.admin_id != user.id:
            raise PermissionDenied("You are not the administrator of this guard's society.")

        reason = (request.data.get('reason') or '').strip()
        if not reason:
            return Response({'reason': ['A reason is required to reject a security profile.']}, status=status.HTTP_400_BAD_REQUEST)

        with transaction.atomic():
            profile.approval_status = 'rejected'
            profile.approval_reviewed_by = user
            profile.approval_reviewed_at = timezone.now()
            profile.approval_note = reason
            profile.save(update_fields=['approval_status', 'approval_reviewed_by', 'approval_reviewed_at', 'approval_note', 'updated_at'])

            SocietyAssignment.objects.filter(user=profile.user, society=profile.society).update(is_active=False)

            note, _ = Notification.objects.get_or_create(
                incident=None,
                dedupe_key=f"SEC_REJECTED:{profile.user.pk}:{timezone.now().timestamp()}",
                defaults={
                    'event_type': 'STATUS_CHANGED',
                    'recipient': profile.user,
                    'recipient_type': 'security',
                    'recipient_name': profile.user.get_full_name() or profile.user.username,
                    'recipient_phone': profile.user.phone or '',
                    'recipient_email': profile.user.email or '',
                    'channel': 'in_app',
                    'title': 'Security Guard Profile Rejected',
                    'message': f"Your security guard application for {profile.society.name} was rejected: {reason}",
                },
            )
            dispatch(note)

        return Response(SecurityAdminListSerializer(profile).data)


# ──────────────────────────── Security On-Duty Switch ────────────────────────────

class SecurityDutyView(APIView):
    """
    GET   /api/security/duty/   - returns current on-duty state
    PATCH /api/security/duty/   - toggles or sets on-duty state (is_available)
    """
    permission_classes = [IsAuthenticated]

    def get(self, request):
        if request.user.role != 'security':
            raise PermissionDenied("Only security personnel have duty controls.")

        assign = SocietyAssignment.objects.filter(user=request.user, is_active=True).select_related('society').first()
        profile = getattr(request.user, 'security_profile', None)

        return Response({
            'on_duty': bool(assign and assign.is_available),
            'since': assign.created_at.isoformat() if assign else None,
            'society_id': assign.society_id if assign else (profile.society_id if profile else None),
            'society_name': assign.society.name if assign else (profile.society.name if profile else None),
            'post_label': profile.post_label if profile else '',
            'approval_status': profile.approval_status if profile else 'pending',
            'is_approved': bool(profile and profile.approval_status == 'approved'),
        })

    def patch(self, request):
        if request.user.role != 'security':
            raise PermissionDenied("Only security personnel have duty controls.")

        profile = getattr(request.user, 'security_profile', None)
        if not profile or profile.approval_status != 'approved':
            return Response(
                {'detail': 'Only approved security staff can change duty status.'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        assign = SocietyAssignment.objects.filter(user=request.user, society=profile.society).first()
        if not assign:
            assign = SocietyAssignment.objects.create(
                user=request.user,
                society=profile.society,
                is_active=True,
                is_available=True,
            )

        new_val = request.data.get('on_duty')
        if new_val is None:
            assign.is_available = not assign.is_available
        else:
            assign.is_available = bool(new_val)

        assign.is_active = True
        assign.save(update_fields=['is_available', 'is_active'])

        return Response({
            'on_duty': assign.is_available,
            'since': assign.created_at.isoformat(),
            'society_id': assign.society_id,
            'society_name': assign.society.name,
            'post_label': profile.post_label,
            'approval_status': profile.approval_status,
            'is_approved': True,
        })


# ──────────────────────────── Admin Unlinked Users ────────────────────────────

class AdminUnlinkedUserListView(APIView):
    """
    GET /api/admin/unlinked-users/
    Lists residents without society/flat mapping, and unapproved/unlinked staff.
    """
    permission_classes = [IsAuthenticated]

    def get(self, request):
        user = request.user
        if not user.is_superuser and user.role != 'admin':
            raise PermissionDenied("Only administrators can view unlinked users.")

        unlinked = []
        for u in User.objects.filter(is_active=True).order_by('role', 'id'):
            if u.role == 'resident':
                has_flat = ResidentFlatMapping.objects.filter(user=u, is_active=True).exists()
                if not has_flat:
                    u.missing_reason = 'No home society, block or flat mapped.'
                    unlinked.append(u)
            elif u.role == 'security':
                has_prof = SecurityProfile.objects.filter(user=u).exists()
                has_assign = SocietyAssignment.objects.filter(user=u, is_active=True).exists()
                if not has_prof or not has_assign:
                    u.missing_reason = 'No active security profile or assignment.'
                    unlinked.append(u)
            elif u.role == 'volunteer':
                has_prof = VolunteerProfile.objects.filter(user=u).exists()
                has_assign = SocietyAssignment.objects.filter(user=u, is_active=True).exists()
                if not has_prof or not has_assign:
                    u.missing_reason = 'No active volunteer profile or assignment.'
                    unlinked.append(u)

        return Response(UnlinkedUserSerializer(unlinked, many=True).data)


class AdminUnlinkedUserAssignView(APIView):
    """
    POST /api/admin/unlinked-users/<pk>/assign/
    Assigns society, block, flat to an unlinked user.
    """
    permission_classes = [IsAuthenticated]

    def post(self, request, pk):
        admin_user = request.user
        if not admin_user.is_superuser and admin_user.role != 'admin':
            raise PermissionDenied("Only administrators can link users.")

        target_user = get_object_or_404(User, pk=pk)
        data = request.data

        society_id = data.get('society_id')
        if not society_id:
            return Response({'society_id': ['This field is required.']}, status=status.HTTP_400_BAD_REQUEST)

        society = get_object_or_404(Society, pk=society_id, is_active=True)
        if not admin_user.is_superuser and society.admin_id != admin_user.id:
            raise PermissionDenied("You can only assign users to your own society.")

        with transaction.atomic():
            if target_user.role == 'resident':
                block_id = data.get('block_id')
                flat_id = data.get('flat_id')
                if not block_id:
                    return Response({'block_id': ['Block is required for resident.']}, status=status.HTTP_400_BAD_REQUEST)
                if not flat_id:
                    return Response({'flat_id': ['Flat is required for resident.']}, status=status.HTTP_400_BAD_REQUEST)

                block = get_object_or_404(Block, pk=block_id, society=society)
                flat = get_object_or_404(Flat, pk=flat_id, block=block)

                mapping, _ = ResidentFlatMapping.objects.update_or_create(
                    user=target_user,
                    flat=flat,
                    defaults={
                        'occupancy_type': data.get('occupancy_type', 'tenant'),
                        'is_primary_resident': True,
                        'is_active': True,
                        'home_latitude': data.get('home_latitude'),
                        'home_longitude': data.get('home_longitude'),
                        'home_label': data.get('home_label', ''),
                    },
                )
                return Response({'detail': f'Resident mapped to Flat {flat.flat_number}, {block.name}, {society.name}.'})

            elif target_user.role == 'security':
                post_label = data.get('post_label', 'Main Gate')
                profile, _ = SecurityProfile.objects.update_or_create(
                    user=target_user,
                    defaults={
                        'society': society,
                        'post_label': post_label,
                        'approval_status': 'approved',
                        'approval_reviewed_by': admin_user,
                        'approval_reviewed_at': timezone.now(),
                    },
                )
                SocietyAssignment.objects.update_or_create(
                    user=target_user,
                    society=society,
                    defaults={'is_active': True, 'is_available': True},
                )
                return Response({'detail': f'Security guard approved and assigned to {society.name} ({post_label}).'})

            elif target_user.role == 'volunteer':
                block_id = data.get('block_id')
                block = Block.objects.filter(pk=block_id, society=society).first() if block_id else None
                area_label = data.get('area_label', data.get('pin_label', ''))
                lat = data.get('base_latitude', data.get('latitude'))
                lng = data.get('base_longitude', data.get('longitude'))
                max_travel = float(data.get('max_travel_km', 3.0))

                vp, _ = VolunteerProfile.objects.update_or_create(
                    user=target_user,
                    defaults={
                        'society': society,
                        'block': block,
                        'latitude': lat,
                        'longitude': lng,
                        'pin_label': area_label,
                        'area_label': area_label,
                        'max_travel_km': max_travel,
                        'serves_nearby_societies': bool(data.get('serves_nearby_societies', False)),
                        'approval_status': 'approved',
                        'approval_reviewed_by': admin_user,
                        'approval_reviewed_at': timezone.now(),
                    },
                )
                check_and_update_far_pin(vp)
                vp.save()

                SocietyAssignment.objects.update_or_create(
                    user=target_user,
                    society=society,
                    defaults={'is_active': True, 'is_available': True},
                )
                return Response({'detail': f'Volunteer approved and assigned to {society.name}.'})

        return Response({'detail': f'User {target_user.username} updated.'})
