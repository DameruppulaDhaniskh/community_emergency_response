from django.urls import path
from . import views

urlpatterns = [
    path('', views.SOSAlertListCreateView.as_view(), name='sos-list'),
    path('<int:pk>/', views.SOSAlertDetailView.as_view(), name='sos-detail'),
    path('<int:pk>/cancel/', views.SOSAlertCancelView.as_view(), name='sos-cancel'),
    path('<int:pk>/respond/', views.SOSAlertRespondView.as_view(), name='sos-respond'),
    path('<int:pk>/responses/', views.SOSAlertResponsesView.as_view(), name='sos-responses'),
    path('<int:pk>/delivery/', views.SOSAlertDeliveryView.as_view(), name='sos-delivery'),

    path('notifications/', views.InAppNotificationListView.as_view(), name='notification-list'),
    path('notifications/<int:pk>/read/', views.InAppNotificationReadView.as_view(), name='notification-read'),
]