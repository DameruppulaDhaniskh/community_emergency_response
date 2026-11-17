from rest_framework import serializers
from .models import Society, Block, Flat, ResidentFlatMapping, SocietyAlertPolicy, VolunteerProfile, VolunteerLocation
from django.contrib.auth import get_user_model

User = get_user_model()


class SocietySerializer(serializers.ModelSerializer):
    admin_name = serializers.SerializerMethodField(read_only=True)

    class Meta:
        model = Society
        fields = [
            'id', 'name', 'registration_number', 'address',
            'city', 'state', 'pincode',
            'contact_email', 'contact_phone',
            'admin', 'admin_name', 'latitude', 'longitude', 'is_active',
            'created_at', 'updated_at',
        ]
        read_only_fields = ['created_at', 'updated_at']

    def get_admin_name(self, obj):
        if obj.admin:
            return obj.admin.get_full_name() or obj.admin.username
        return None


class BlockSerializer(serializers.ModelSerializer):
    society_name = serializers.ReadOnlyField(source='society.name')
    flat_count = serializers.SerializerMethodField()

    class Meta:
        model = Block
        fields = [
            'id', 'society', 'society_name', 'name',
            'total_floors', 'description', 'flat_count', 'created_at',
        ]
        read_only_fields = ['created_at']

    def get_flat_count(self, obj):
        return obj.flats.count()


class FlatSerializer(serializers.ModelSerializer):
    block_name = serializers.ReadOnlyField(source='block.name')
    society_name = serializers.ReadOnlyField(source='block.society.name')

    class Meta:
        model = Flat
        fields = [
            'id', 'block', 'block_name', 'society_name',
            'flat_number', 'floor', 'area_sqft',
            'is_occupied', 'created_at',
        ]
        read_only_fields = ['created_at', 'is_occupied']


class ResidentFlatMappingSerializer(serializers.ModelSerializer):
    user = serializers.PrimaryKeyRelatedField(
        queryset=get_user_model().objects.all(), required=False
    )
    user_name = serializers.SerializerMethodField(read_only=True)
    user_email = serializers.ReadOnlyField(source='user.email')
    flat_number = serializers.ReadOnlyField(source='flat.flat_number')
    block_name = serializers.ReadOnlyField(source='flat.block.name')
    society_name = serializers.ReadOnlyField(source='flat.block.society.name')

    class Meta:
        model = ResidentFlatMapping
        fields = [
            'id', 'user', 'user_name', 'user_email',
            'flat', 'flat_number', 'block_name', 'society_name',
            'occupancy_type', 'is_primary_resident',
            'move_in_date', 'move_out_date',
            'is_active', 'created_at',
        ]
        read_only_fields = ['created_at']

    def get_user_name(self, obj):
        return obj.user.get_full_name() or obj.user.username

    def validate(self, data):
        # Ensure the same user is not mapped to the same flat twice
        user = data.get('user', getattr(self.instance, 'user', None))
        flat = data.get('flat', getattr(self.instance, 'flat', None))
        qs = ResidentFlatMapping.objects.filter(user=user, flat=flat)
        if self.instance:
            qs = qs.exclude(pk=self.instance.pk)
        if qs.exists():
            raise serializers.ValidationError(
                'This resident is already mapped to this flat.'
            )
        return data


class SocietyAlertPolicySerializer(serializers.ModelSerializer):
    society_name = serializers.CharField(source='society.name', read_only=True)
    latitude = serializers.DecimalField(source='society.latitude', max_digits=9, decimal_places=6, required=False, allow_null=True)
    longitude = serializers.DecimalField(source='society.longitude', max_digits=9, decimal_places=6, required=False, allow_null=True)

    class Meta:
        model = SocietyAlertPolicy
        fields = [
            'id', 'society', 'society_name',
            'notify_community', 'include_neighbour_societies',
            'neighbour_radius_km', 'latitude', 'longitude',
            'updated_at',
        ]
        read_only_fields = ['id', 'society', 'society_name', 'updated_at']

    def validate_neighbour_radius_km(self, value):
        if not (0.5 <= value <= 10.0):
            raise serializers.ValidationError("neighbour_radius_km must be between 0.5 and 10.0.")
        return value

    def update(self, instance, validated_data):
        soc_data = validated_data.pop('society', {})
        if 'latitude' in soc_data:
            instance.society.latitude = soc_data['latitude']
        if 'longitude' in soc_data:
            instance.society.longitude = soc_data['longitude']
        if 'latitude' in soc_data or 'longitude' in soc_data:
            instance.society.save(update_fields=['latitude', 'longitude', 'updated_at'])

        return super().update(instance, validated_data)


class VolunteerAdminListSerializer(serializers.ModelSerializer):
    name = serializers.SerializerMethodField()
    phone = serializers.CharField(source='user.phone', read_only=True)
    email = serializers.CharField(source='user.email', read_only=True)
    society_name = serializers.CharField(source='society.name', read_only=True)
    block_name = serializers.CharField(source='block.name', read_only=True, default='')
    is_available = serializers.SerializerMethodField()

    class Meta:
        model = VolunteerProfile
        fields = [
            'id', 'name', 'phone', 'email', 'society', 'society_name',
            'block', 'block_name', 'latitude', 'longitude', 'pin_label', 'area_label',
            'max_travel_km', 'serves_nearby_societies', 'approval_status',
            'is_available', 'approval_reviewed_at', 'approval_note',
            'pin_far_from_society', 'pin_distance_from_society_km',
            'created_at',
        ]

    def get_name(self, obj) -> str:
        return obj.user.get_full_name() or obj.user.username

    def get_is_available(self, obj) -> bool:
        assign = obj.user.society_assignments.filter(society=obj.society).first()
        return bool(assign and assign.is_available)


class VolunteerApprovalActionSerializer(serializers.Serializer):
    reason = serializers.CharField(max_length=500, required=False, allow_blank=True, default='')


class PublicSocietySerializer(serializers.ModelSerializer):
    class Meta:
        model = Society
        fields = ['id', 'name', 'city', 'address', 'latitude', 'longitude']


class PublicBlockSerializer(serializers.ModelSerializer):
    class Meta:
        model = Block
        fields = ['id', 'name', 'description']


class PublicFlatSerializer(serializers.ModelSerializer):
    class Meta:
        model = Flat
        fields = ['id', 'flat_number', 'floor']


class SecurityAdminListSerializer(serializers.ModelSerializer):
    name = serializers.SerializerMethodField()
    phone = serializers.CharField(source='user.phone', read_only=True)
    email = serializers.CharField(source='user.email', read_only=True)
    society_name = serializers.CharField(source='society.name', read_only=True)
    is_available = serializers.SerializerMethodField()

    class Meta:
        from .models import SecurityProfile
        model = SecurityProfile
        fields = [
            'id', 'name', 'phone', 'email', 'society', 'society_name',
            'post_label', 'approval_status', 'is_available',
            'approval_reviewed_at', 'approval_note', 'created_at',
        ]

    def get_name(self, obj) -> str:
        return obj.user.get_full_name() or obj.user.username

    def get_is_available(self, obj) -> bool:
        assign = obj.user.society_assignments.filter(society=obj.society).first()
        return bool(assign and assign.is_available)


class UnlinkedUserSerializer(serializers.ModelSerializer):
    name = serializers.SerializerMethodField()
    missing_reason = serializers.CharField(read_only=True)

    class Meta:
        model = User
        fields = [
            'id', 'username', 'email', 'name', 'first_name', 'last_name',
            'phone', 'role', 'missing_reason', 'date_joined',
        ]

    def get_name(self, obj) -> str:
        return obj.get_full_name() or obj.username

