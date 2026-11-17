from django.urls import path
from . import views

urlpatterns = [
    # Emergency contacts CRUD & lifecycle actions
    path('', views.EmergencyContactListCreateView.as_view(), name='contact-list'),
    path('<int:pk>/', views.EmergencyContactDetailView.as_view(), name='contact-detail'),
    path('<int:pk>/cancel/', views.ContactCancelView.as_view(), name='contact-cancel'),
    path('<int:pk>/resend/', views.ContactResendView.as_view(), name='contact-resend'),

    # Legacy endpoints explicitly retired (410 Gone)
    path('<int:pk>/verify/', views.ContactVerifyView.as_view(), name='contact-verify'),
    path('<int:pk>/resend-verification/', views.ResendVerificationView.as_view(), name='contact-resend-verification'),
]
