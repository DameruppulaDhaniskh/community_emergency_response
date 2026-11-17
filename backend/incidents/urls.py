from django.urls import path
from . import views

urlpatterns = [
    path('', views.IncidentListCreateView.as_view(), name='incident-list-create'),
    path('sos/', views.SOSCreateView.as_view(), name='incident-sos'),
    path('<int:pk>/', views.IncidentDetailView.as_view(), name='incident-detail'),
    path('<int:pk>/status/', views.IncidentStatusView.as_view(), name='incident-status'),
    path('<int:pk>/assign/', views.IncidentAssignView.as_view(), name='incident-assign'),
    path('<int:pk>/history/', views.IncidentHistoryView.as_view(), name='incident-history'),
    path('<int:pk>/evidence/', views.IncidentEvidenceView.as_view(), name='incident-evidence'),
    path('<int:pk>/escalate/', views.IncidentEscalateView.as_view(), name='incident-escalate'),
    path('<int:pk>/guardian-ack/', views.GuardianAckView.as_view(), name='incident-guardian-ack'),
    path('<int:pk>/handoff/', views.GuardianHandoffView.as_view(), name='incident-guardian-handoff'),
    path('<int:pk>/accept/', views.VolunteerAcceptView.as_view(), name='incident-accept'),
    path('<int:pk>/security-ack/', views.SecurityAckView.as_view(), name='incident-security-ack'),
    path('<int:pk>/nearby-volunteers/', views.IncidentNearbyVolunteersView.as_view(), name='incident-nearby-volunteers'),
    path('<int:pk>/escalation-diagnostics/', views.IncidentEscalationDiagnosticsView.as_view(), name='incident-escalation-diagnostics'),
    path('<int:pk>/location/', views.IncidentLocationUpdateView.as_view(), name='incident-location-update'),
]
