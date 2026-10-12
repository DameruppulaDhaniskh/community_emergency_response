
from django.urls import path
from . import views

urlpatterns = [
    path('residents/', views.resident_list, name='resident-list'),
    path(
        'residents/<int:pk>/',
        views.resident_detail,
        name='resident-detail'
    ),
]
