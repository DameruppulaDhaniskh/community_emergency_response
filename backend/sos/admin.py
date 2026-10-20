from django.contrib import admin
from .models import SOSAlert, NotificationLog, InAppNotification, AlertResponse

admin.site.register(SOSAlert)
admin.site.register(NotificationLog)
admin.site.register(InAppNotification)
admin.site.register(AlertResponse)