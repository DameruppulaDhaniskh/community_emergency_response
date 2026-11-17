import re
from django.contrib.auth import get_user_model
from drf_spectacular.types import OpenApiTypes
from drf_spectacular.utils import OpenApiParameter, extend_schema
from rest_framework import generics, status
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.response import Response
from rest_framework.throttling import UserRateThrottle
from rest_framework.views import APIView

from .permissions import IsAdminOrSelf
from .serializers import (
    ChangePasswordSerializer,
    UserLookupResponseSerializer,
    UserProfileSerializer,
    UserRegistrationSerializer,
)
from .validators import try_normalize_phone

User = get_user_model()


class UserLookupThrottle(UserRateThrottle):
    scope = 'user_lookup'


class RegisterView(generics.CreateAPIView):
    """
    POST /api/auth/register/
    Register a new user (any role). No authentication required.
    """
    queryset = User.objects.all()
    serializer_class = UserRegistrationSerializer
    permission_classes = [AllowAny]


class UserProfileView(generics.RetrieveUpdateAPIView):
    """
    GET   /api/auth/profile/  - view your own profile
    PATCH /api/auth/profile/  - update your own profile
    """
    serializer_class = UserProfileSerializer
    permission_classes = [IsAuthenticated]

    def get_object(self):
        return self.request.user


class ChangePasswordView(APIView):
    """
    POST /api/auth/change-password/
    Change logged-in user's password.
    """
    permission_classes = [IsAuthenticated]
    serializer_class = ChangePasswordSerializer

    @extend_schema(request=ChangePasswordSerializer, responses={200: OpenApiTypes.OBJECT})
    def post(self, request):
        serializer = ChangePasswordSerializer(
            data=request.data, context={'request': request}
        )
        if serializer.is_valid():
            request.user.set_password(serializer.validated_data['new_password'])
            request.user.save()
            return Response(
                {'detail': 'Password changed successfully.'},
                status=status.HTTP_200_OK,
            )
        return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)


def resolve_active_user_by_identifier(identifier: str):
    """
    Resolve an active user by exact case-insensitive username OR normalized phone number.
    Returns User or None. Never performs substring matching.
    """
    raw = (identifier or '').strip()
    if not raw:
        return None

    user = User.objects.filter(is_active=True, username__iexact=raw).first()
    if user:
        return user

    # Only try phone lookup when input has no alphabetic characters
    if not re.search(r'[A-Za-z]', raw):
        norm_phone = try_normalize_phone(raw)
        if norm_phone:
            return User.objects.filter(is_active=True, phone=norm_phone).first()
    return None


class UserLookupView(APIView):
    """
    GET /api/users/lookup/?identifier=<username or phone>
    Exact-match lookup returning id, display name, username, masked phone, and role.
    """
    permission_classes = [IsAuthenticated]
    throttle_classes = [UserLookupThrottle]
    serializer_class = UserLookupResponseSerializer

    @extend_schema(
        summary='Exact user lookup by username or phone number',
        parameters=[
            OpenApiParameter(
                'identifier',
                OpenApiTypes.STR,
                required=True,
                description='Exact username (case-insensitive) or phone number',
            )
        ],
        responses={200: UserLookupResponseSerializer, 404: OpenApiTypes.OBJECT},
    )
    def get(self, request):
        identifier = (request.query_params.get('identifier') or '').strip()
        if not identifier:
            return Response(
                {'identifier': ['Please enter a username or phone number.']},
                status=status.HTTP_400_BAD_REQUEST,
            )

        target = resolve_active_user_by_identifier(identifier)
        if not target:
            return Response(
                {'detail': 'No account found with that username or phone.'},
                status=status.HTTP_404_NOT_FOUND,
            )

        return Response(UserLookupResponseSerializer.from_user(target), status=status.HTTP_200_OK)


class UserListView(generics.ListAPIView):
    """
    GET /api/users/
    List all users - admin only (others see only themselves).
    """
    queryset = User.objects.all().order_by('date_joined')
    serializer_class = UserProfileSerializer
    permission_classes = [IsAuthenticated]

    def get_queryset(self):
        if getattr(self, 'swagger_fake_view', False):
            return User.objects.none()
        if self.request.user.role == 'admin':
            return User.objects.all().order_by('date_joined')
        return User.objects.filter(pk=self.request.user.pk)


class UserDetailView(generics.RetrieveUpdateDestroyAPIView):
    """
    GET    /api/users/<pk>/  - retrieve a user
    PATCH  /api/users/<pk>/  - update a user (admin or self)
    DELETE /api/users/<pk>/  - delete a user (admin only)
    """
    queryset = User.objects.all()
    serializer_class = UserProfileSerializer
    permission_classes = [IsAuthenticated, IsAdminOrSelf]
