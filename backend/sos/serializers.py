from rest_framework import serializers
from .models import SOSAlert, AlertResponse, NotificationLog, InAppNotification


class SOSAlertSerializer(serializers.ModelSerializer):
    resident_name = serializers.SerializerMethodField()

    class Meta:
        model = SOSAlert
        fields = [
            'id', 'resident', 'resident_name', 'category', 'message',
            'latitude', 'longitude', 'location_text', 'status',
            'created_at', 'updated_at', 'resolved_at',
        ]
        read_only_fields = [
            'id', 'resident', 'status', 'created_at', 'updated_at', 'resolved_at',
        ]

    def get_resident_name(self, obj):
        return obj.resident.get_full_name() or obj.resident.username


class AlertResponseSerializer(serializers.ModelSerializer):
    responder_name = serializers.SerializerMethodField()

    class Meta:
        model = AlertResponse
        fields = ['id', 'alert', 'responder', 'responder_name', 'status', 'note', 'created_at']
        read_only_fields = ['id', 'alert', 'responder', 'created_at']

    def get_responder_name(self, obj):
        return obj.responder.get_full_name() or obj.responder.username


class NotificationLogSerializer(serializers.ModelSerializer):
    class Meta:
        model = NotificationLog
        fields = [
            'id', 'recipient_name', 'recipient_type', 'channel',
            'status', 'error_message', 'sent_at', 'created_at',
        ]


class InAppNotificationSerializer(serializers.ModelSerializer):
    class Meta:
        model = InAppNotification
        fields = ['id', 'alert', 'title', 'message', 'is_read', 'created_at']
        read_only_fields = ['id', 'alert', 'title', 'message', 'created_at']