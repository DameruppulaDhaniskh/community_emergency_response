from django.conf import settings
from django.contrib import admin
from django.urls import include, path, re_path
from django.views.static import serve
from drf_spectacular.views import (
    SpectacularAPIView,
    SpectacularRedocView,
    SpectacularSwaggerView,
)

from contacts.views import (
    GuardianDependentsListView,
    GuardianRequestAcceptView,
    GuardianRequestDeclineView,
    GuardianRequestListView,
    ResidentSecurityGuardDetailView,
    ResidentSecurityGuardListCreateView,
    ResidentSocietySecurityListView,
)
from incidents.views import (
    AvailableVolunteersView,
    HealthCheckView,
    ResidentEscalationSettingsView,
    ResidentIncidentListView,
    SecurityIncidentListView,
    VolunteerAvailabilityView,
    VolunteerIncidentListView,
    VolunteerLocationView,
)
from notifications.views import (
    IncidentNotificationListView,
    IncidentNotificationRetryView,
)
from society.views import (
    AdminSecurityApproveView,
    AdminSecurityListView,
    AdminSecurityRejectView,
    AdminUnlinkedUserAssignView,
    AdminUnlinkedUserListView,
    AdminVolunteerApproveView,
    AdminVolunteerListView,
    AdminVolunteerRejectView,
    PublicBlockListView,
    PublicFlatListView,
    PublicSocietyListView,
    SecurityDutyView,
    VolunteerProfileView,
)

urlpatterns = [
    path('admin/', admin.site.urls),

    # Health check
    path('api/health/', HealthCheckView.as_view(), name='health-check'),

    # OpenAPI / Swagger UI
    path('api/schema/', SpectacularAPIView.as_view(), name='schema'),
    path('api/docs/', SpectacularSwaggerView.as_view(url_name='schema'), name='swagger-ui'),
    path('api/redoc/', SpectacularRedocView.as_view(url_name='schema'), name='redoc'),

    # Public registration endpoints
    path('api/public/societies/', PublicSocietyListView.as_view(), name='public-societies'),
    path('api/public/societies/<int:society_id>/blocks/', PublicBlockListView.as_view(), name='public-blocks'),
    path('api/public/blocks/<int:block_id>/flats/', PublicFlatListView.as_view(), name='public-flats'),

    # User auth, lookup & management
    path('api/', include('users.urls')),

    # Society management: /api/society/...
    path('api/society/', include('society.urls')),

    # Emergency contacts & guardian requests
    path('api/contacts/', include('contacts.urls')),
    path('api/guardian/requests/', GuardianRequestListView.as_view(), name='guardian-requests'),
    path('api/guardian/requests/<int:pk>/accept/', GuardianRequestAcceptView.as_view(), name='guardian-request-accept'),
    path('api/guardian/requests/<int:pk>/decline/', GuardianRequestDeclineView.as_view(), name='guardian-request-decline'),
    path('api/guardian/dependents/', GuardianDependentsListView.as_view(), name='guardian-dependents'),

    # Incidents & workflows
    path('api/incidents/', include('incidents.urls')),
    path('api/resident/incidents/', ResidentIncidentListView.as_view(), name='resident-incidents'),
    path('api/resident/escalation-settings/', ResidentEscalationSettingsView.as_view(), name='resident-escalation-settings'),
    path('api/resident/security-guards/', ResidentSecurityGuardListCreateView.as_view(), name='resident-security-guards'),
    path('api/resident/security-guards/<int:pk>/', ResidentSecurityGuardDetailView.as_view(), name='resident-security-guard-detail'),
    path('api/resident/society-security/', ResidentSocietySecurityListView.as_view(), name='resident-society-security'),

    # Volunteers
    path('api/volunteers/available/', AvailableVolunteersView.as_view(), name='volunteers-available'),
    path('api/volunteer/incidents/', VolunteerIncidentListView.as_view(), name='volunteer-incidents'),
    path('api/volunteer/availability/', VolunteerAvailabilityView.as_view(), name='volunteer-availability'),
    path('api/volunteer/location/', VolunteerLocationView.as_view(), name='volunteer-location'),
    path('api/volunteer/profile/', VolunteerProfileView.as_view(), name='volunteer-profile'),

    # Admin staff approvals (Volunteers & Security)
    path('api/admin/volunteers/', AdminVolunteerListView.as_view(), name='admin-volunteer-list'),
    path('api/admin/volunteers/<int:pk>/approve/', AdminVolunteerApproveView.as_view(), name='admin-volunteer-approve'),
    path('api/admin/volunteers/<int:pk>/reject/', AdminVolunteerRejectView.as_view(), name='admin-volunteer-reject'),
    path('api/admin/security/', AdminSecurityListView.as_view(), name='admin-security-list'),
    path('api/admin/security/<int:pk>/approve/', AdminSecurityApproveView.as_view(), name='admin-security-approve'),
    path('api/admin/security/<int:pk>/reject/', AdminSecurityRejectView.as_view(), name='admin-security-reject'),

    # Security duty and incidents
    path('api/security/duty/', SecurityDutyView.as_view(), name='security-duty'),
    path('api/security/incidents/', SecurityIncidentListView.as_view(), name='security-incidents'),

    # Admin unlinked users
    path('api/admin/unlinked-users/', AdminUnlinkedUserListView.as_view(), name='admin-unlinked-users'),
    path('api/admin/unlinked-users/<int:pk>/assign/', AdminUnlinkedUserAssignView.as_view(), name='admin-unlinked-users-assign'),

    # Notifications
    path('api/notifications/', include('notifications.urls')),
    path('api/incidents/<int:pk>/notifications/', IncidentNotificationListView.as_view(), name='incident-notifications'),
    path('api/incidents/<int:pk>/notifications/retry/', IncidentNotificationRetryView.as_view(), name='incident-notifications-retry'),
]

if not getattr(settings, 'USE_CLOUDINARY', False):
    urlpatterns += [
        re_path(r'^media/(?P<path>.*)$', serve, {'document_root': settings.MEDIA_ROOT}),
    ]
