from django.contrib.auth import get_user_model
from django.core.exceptions import ValidationError as DjangoValidationError
from django.db import transaction
from rest_framework import serializers

from incidents.serializers import CoordinateField
from .validators import mask_phone, normalize_phone, validate_username_format

User = get_user_model()


def _validate_unique_username(value: str, instance=None) -> str:
    try:
        cleaned = validate_username_format(value)
    except DjangoValidationError as exc:
        raise serializers.ValidationError(exc.messages[0])

    qs = User.objects.filter(username__iexact=cleaned)
    if instance is not None:
        qs = qs.exclude(pk=instance.pk)
    if qs.exists():
        raise serializers.ValidationError('This username is taken.')
    return cleaned


def _validate_unique_phone(value: str, instance=None) -> str:
    try:
        normalized = normalize_phone(value)
    except ValueError as exc:
        raise serializers.ValidationError(str(exc))
    if not normalized:
        raise serializers.ValidationError('Phone number is required.')

    qs = User.objects.filter(phone=normalized)
    if instance is not None:
        qs = qs.exclude(pk=instance.pk)
    if qs.exists():
        raise serializers.ValidationError('This phone number is already registered.')
    return normalized


class UserRegistrationSerializer(serializers.ModelSerializer):
    """Serializer for registering a new user with role-specific society bindings."""
    username = serializers.CharField(required=True, allow_blank=False, validators=[])
    phone = serializers.CharField(required=True, allow_blank=False)
    password = serializers.CharField(write_only=True, min_length=8)
    confirm_password = serializers.CharField(write_only=True)

    # Resident fields
    society_id = serializers.IntegerField(required=False, allow_null=True)
    block_id = serializers.IntegerField(required=False, allow_null=True)
    flat_id = serializers.IntegerField(required=False, allow_null=True)
    home_latitude = CoordinateField(required=False, allow_null=True)
    home_longitude = CoordinateField(required=False, allow_null=True)
    home_label = serializers.CharField(required=False, allow_blank=True, max_length=100)

    # Volunteer fields
    area_label = serializers.CharField(required=False, allow_blank=True, max_length=100)
    base_latitude = CoordinateField(required=False, allow_null=True)
    base_longitude = CoordinateField(required=False, allow_null=True)
    max_travel_km = serializers.FloatField(required=False, default=3.0)
    serves_nearby_societies = serializers.BooleanField(required=False, default=False)

    # Security fields
    post_label = serializers.CharField(required=False, allow_blank=True, max_length=100)

    class Meta:
        model = User
        fields = [
            'id', 'username', 'email', 'first_name', 'last_name',
            'phone', 'role', 'password', 'confirm_password',
            'society_id', 'block_id', 'flat_id',
            'home_latitude', 'home_longitude', 'home_label',
            'area_label', 'base_latitude', 'base_longitude',
            'max_travel_km', 'serves_nearby_societies',
            'post_label',
        ]
        extra_kwargs = {
            'first_name': {'required': True},
            'last_name': {'required': True},
        }

    def validate_username(self, value):
        return _validate_unique_username(value)

    def validate_phone(self, value):
        return _validate_unique_phone(value)

    def validate_email(self, value):
        cleaned = (value or '').strip().lower()
        if User.objects.filter(email__iexact=cleaned).exists():
            raise serializers.ValidationError('An account with this email already exists.')
        return cleaned

    def validate(self, data):
        if data.get('password') != data.pop('confirm_password', None):
            raise serializers.ValidationError(
                {'confirm_password': 'Passwords do not match.'}
            )

        role = data.get('role', 'resident')
        from society.models import Society, Block, Flat

        if role == 'resident':
            society_id = data.get('society_id')
            block_id = data.get('block_id')
            flat_id = data.get('flat_id')
            errors = {}
            if not society_id:
                errors['society_id'] = ['Society is required for resident registration.']
            if not block_id:
                errors['block_id'] = ['Block is required for resident registration.']
            if not flat_id:
                errors['flat_id'] = ['Flat is required for resident registration.']

            if errors:
                raise serializers.ValidationError(errors)

            try:
                soc = Society.objects.get(id=society_id, is_active=True)
            except Society.DoesNotExist:
                raise serializers.ValidationError({'society_id': ['Selected society does not exist or is inactive.']})

            try:
                blk = Block.objects.get(id=block_id, society=soc)
            except Block.DoesNotExist:
                raise serializers.ValidationError({'block_id': ['Selected block does not belong to the chosen society.']})

            try:
                flt = Flat.objects.get(id=flat_id, block=blk)
            except Flat.DoesNotExist:
                raise serializers.ValidationError({'flat_id': ['Selected flat does not belong to the chosen block.']})

            data['_society_obj'] = soc
            data['_block_obj'] = blk
            data['_flat_obj'] = flt

            home_lat = data.get('home_latitude')
            home_lng = data.get('home_longitude')
            if (home_lat is None and home_lng is not None) or (home_lat is not None and home_lng is None):
                raise serializers.ValidationError({'home_latitude': ['Both home latitude and longitude must be provided together.']})
            if home_lat is not None and home_lng is not None:
                if not (-90 <= float(home_lat) <= 90):
                    raise serializers.ValidationError({'home_latitude': ['Home latitude must be between -90 and 90 degrees.']})
                if not (-180 <= float(home_lng) <= 180):
                    raise serializers.ValidationError({'home_longitude': ['Home longitude must be between -180 and 180 degrees.']})

        elif role == 'volunteer':
            society_id = data.get('society_id')
            if not society_id:
                raise serializers.ValidationError({'society_id': ['Society is required for volunteer registration.']})

            try:
                soc = Society.objects.get(id=society_id, is_active=True)
            except Society.DoesNotExist:
                raise serializers.ValidationError({'society_id': ['Selected society does not exist or is inactive.']})
            data['_society_obj'] = soc

            block_id = data.get('block_id')
            if block_id:
                try:
                    blk = Block.objects.get(id=block_id, society=soc)
                    data['_block_obj'] = blk
                except Block.DoesNotExist:
                    raise serializers.ValidationError({'block_id': ['Selected block does not belong to the chosen society.']})

            base_lat = data.get('base_latitude')
            base_lng = data.get('base_longitude')
            if (base_lat is None and base_lng is not None) or (base_lat is not None and base_lng is None):
                raise serializers.ValidationError({'base_latitude': ['Both base latitude and longitude must be provided together.']})
            if base_lat is not None and base_lng is not None:
                if not (-90 <= float(base_lat) <= 90):
                    raise serializers.ValidationError({'base_latitude': ['Latitude must be between -90 and 90 degrees.']})
                if not (-180 <= float(base_lng) <= 180):
                    raise serializers.ValidationError({'base_longitude': ['Longitude must be between -180 and 180 degrees.']})

            max_travel = data.get('max_travel_km', 3.0)
            if max_travel is not None and float(max_travel) <= 0:
                raise serializers.ValidationError({'max_travel_km': ['Max travel distance must be positive.']})

        elif role == 'security':
            society_id = data.get('society_id')
            if not society_id:
                raise serializers.ValidationError({'society_id': ['Society is required for security personnel registration.']})

            try:
                soc = Society.objects.get(id=society_id, is_active=True)
            except Society.DoesNotExist:
                raise serializers.ValidationError({'society_id': ['Selected society does not exist or is inactive.']})
            data['_society_obj'] = soc
            if not data.get('post_label'):
                data['post_label'] = 'Main Gate'

        return data

    @transaction.atomic
    def create(self, validated_data):
        password = validated_data.pop('password')
        validated_data.pop('society_id', None)
        validated_data.pop('block_id', None)
        validated_data.pop('flat_id', None)
        home_latitude = validated_data.pop('home_latitude', None)
        home_longitude = validated_data.pop('home_longitude', None)
        home_label = validated_data.pop('home_label', '')

        area_label = validated_data.pop('area_label', '')
        base_latitude = validated_data.pop('base_latitude', None)
        base_longitude = validated_data.pop('base_longitude', None)
        max_travel_km = validated_data.pop('max_travel_km', 3.0)
        serves_nearby_societies = validated_data.pop('serves_nearby_societies', False)

        post_label = validated_data.pop('post_label', '')

        soc_obj = validated_data.pop('_society_obj', None)
        blk_obj = validated_data.pop('_block_obj', None)
        flt_obj = validated_data.pop('_flat_obj', None)

        user = User(**validated_data)
        user.set_password(password)
        user.save()

        if user.role == 'resident' and flt_obj:
            from society.models import ResidentFlatMapping
            ResidentFlatMapping.objects.create(
                user=user,
                flat=flt_obj,
                occupancy_type='tenant',
                is_primary_resident=True,
                is_active=True,
                home_latitude=home_latitude,
                home_longitude=home_longitude,
                home_label=home_label,
            )
        elif user.role == 'volunteer' and soc_obj:
            from society.models import VolunteerProfile, SocietyAssignment
            from society.views import check_and_update_far_pin
            vp = VolunteerProfile.objects.create(
                user=user,
                society=soc_obj,
                block=blk_obj,
                latitude=base_latitude,
                longitude=base_longitude,
                pin_label=area_label or '',
                area_label=area_label or '',
                max_travel_km=max_travel_km or 3.0,
                serves_nearby_societies=bool(serves_nearby_societies),
                approval_status='pending',
            )
            check_and_update_far_pin(vp)
            vp.save()

            SocietyAssignment.objects.create(
                user=user,
                society=soc_obj,
                is_active=False,
                is_available=False,
            )
        elif user.role == 'security' and soc_obj:
            from society.models import SecurityProfile, SocietyAssignment
            SecurityProfile.objects.create(
                user=user,
                society=soc_obj,
                post_label=post_label or 'Main Gate',
                approval_status='pending',
            )
            SocietyAssignment.objects.create(
                user=user,
                society=soc_obj,
                is_active=False,
                is_available=False,
            )

        return user


class UserProfileSerializer(serializers.ModelSerializer):
    """Serializer for reading / updating user profile."""
    username = serializers.CharField(required=True, allow_blank=False, validators=[])
    phone = serializers.CharField(required=True, allow_blank=False)
    society_details = serializers.SerializerMethodField(read_only=True)

    class Meta:
        model = User
        fields = [
            'id', 'username', 'email', 'first_name', 'last_name',
            'phone', 'role', 'address', 'profile_image_url',
            'society_details',
        ]
        read_only_fields = ['email', 'role']

    def validate_username(self, value):
        return _validate_unique_username(value, instance=self.instance)

    def validate_phone(self, value):
        return _validate_unique_phone(value, instance=self.instance)

    def get_society_details(self, obj):
        if obj.role == 'resident':
            from society.models import ResidentFlatMapping
            mapping = ResidentFlatMapping.objects.filter(user=obj, is_active=True).select_related('flat__block__society').first()
            if mapping and mapping.flat and mapping.flat.block:
                return {
                    'society_linked': True,
                    'society_id': mapping.flat.block.society_id,
                    'society_name': mapping.flat.block.society.name,
                    'block_id': mapping.flat.block_id,
                    'block_name': mapping.flat.block.name,
                    'flat_id': mapping.flat_id,
                    'flat_number': mapping.flat.flat_number,
                    'home_latitude': float(mapping.home_latitude) if mapping.home_latitude else None,
                    'home_longitude': float(mapping.home_longitude) if mapping.home_longitude else None,
                    'home_label': mapping.home_label,
                }
            return {'society_linked': False}
        elif obj.role == 'volunteer':
            vp = getattr(obj, 'volunteer_profile', None)
            if vp:
                return {
                    'society_linked': True,
                    'society_id': vp.society_id,
                    'society_name': vp.society.name,
                    'block_id': vp.block_id,
                    'block_name': vp.block.name if vp.block else None,
                    'approval_status': vp.approval_status,
                    'area_label': vp.area_label or vp.pin_label,
                    'max_travel_km': vp.max_travel_km,
                }
            return {'society_linked': False}
        elif obj.role == 'security':
            sp = getattr(obj, 'security_profile', None)
            if sp:
                assign = obj.society_assignments.filter(society=sp.society).first()
                return {
                    'society_linked': True,
                    'society_id': sp.society_id,
                    'society_name': sp.society.name,
                    'post_label': sp.post_label,
                    'approval_status': sp.approval_status,
                    'on_duty': bool(assign and assign.is_available),
                }
            return {'society_linked': False}
        return None


class UserLookupResponseSerializer(serializers.Serializer):
    """Privacy-preserving public summary returned by GET /api/users/lookup/."""
    id = serializers.IntegerField(read_only=True)
    name = serializers.CharField(read_only=True)
    username = serializers.CharField(read_only=True)
    masked_phone = serializers.CharField(read_only=True)
    role = serializers.CharField(read_only=True)

    @staticmethod
    def from_user(user):
        return {
            'id': user.pk,
            'name': user.get_full_name() or user.username,
            'username': user.username,
            'masked_phone': mask_phone(user.phone),
            'role': user.role,
        }


class ChangePasswordSerializer(serializers.Serializer):
    """Serializer for changing a user's own password."""
    old_password = serializers.CharField(required=True)
    new_password = serializers.CharField(required=True, min_length=8)

    def validate_old_password(self, value):
        user = self.context['request'].user
        if not user.check_password(value):
            raise serializers.ValidationError('Old password is incorrect.')
        return value
