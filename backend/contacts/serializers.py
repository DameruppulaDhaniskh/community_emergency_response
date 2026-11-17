from rest_framework import serializers

from users.validators import mask_phone, normalize_phone
from users.views import resolve_active_user_by_identifier

from .models import EmergencyContact, ResidentSecurityGuard


class EmergencyContactSerializer(serializers.ModelSerializer):
    resident_name = serializers.SerializerMethodField(read_only=True)
    linked_username = serializers.SerializerMethodField(read_only=True)
    masked_phone = serializers.SerializerMethodField(read_only=True)
    identifier = serializers.CharField(required=False, allow_blank=True, write_only=True)
    name = serializers.CharField(required=False, allow_blank=True, max_length=100)
    phone = serializers.CharField(required=False, allow_blank=True, max_length=20)

    class Meta:
        model = EmergencyContact
        fields = [
            'id', 'resident', 'resident_name',
            'linked_user', 'linked_username',
            'identifier',
            'contact_type', 'relationship',
            'name', 'phone', 'masked_phone', 'email', 'address',
            'priority',
            'status', 'is_verified', 'verified_at', 'responded_at',
            'is_active',
            'created_at', 'updated_at',
        ]
        read_only_fields = [
            'resident', 'linked_user', 'status', 'is_verified',
            'verified_at', 'responded_at', 'created_at', 'updated_at',
        ]

    def get_resident_name(self, obj) -> str:
        return obj.resident.get_full_name() or obj.resident.username

    def get_linked_username(self, obj) -> str | None:
        return obj.linked_user.username if obj.linked_user else None

    def get_masked_phone(self, obj) -> str:
        return mask_phone(obj.phone)

    def _validate_create(self, data, request):
        contact_type = data.get('contact_type', 'emergency_contact')
        identifier = (data.pop('identifier', '') or '').strip()

        if contact_type in ('primary_guardian', 'secondary_guardian'):
            if not identifier:
                raise serializers.ValidationError({
                    'identifier': "Please enter the guardian's username or phone number.",
                })

            target = resolve_active_user_by_identifier(identifier)
            if not target:
                raise serializers.ValidationError({
                    'identifier': 'No active account found with that username or phone.',
                })
            if target.pk == request.user.pk:
                raise serializers.ValidationError({
                    'identifier': 'You cannot add yourself as a guardian.',
                })
            if target.role != 'guardian':
                raise serializers.ValidationError({
                    'identifier': 'This account is not a guardian account. Only users registered as Guardians can be added.',
                })

            slot_taken = EmergencyContact.objects.filter(
                resident=request.user,
                contact_type=contact_type,
                is_active=True,
                status__in=['pending', 'accepted'],
            ).exists()
            if slot_taken:
                label = dict(EmergencyContact.CONTACT_TYPES)[contact_type]
                raise serializers.ValidationError({
                    'contact_type': f'You already have an active {label}. Remove or cancel it first.',
                })

            dup_person = EmergencyContact.objects.filter(
                resident=request.user,
                linked_user=target,
                is_active=True,
                status__in=['pending', 'accepted'],
            ).exists()
            if dup_person:
                raise serializers.ValidationError({
                    'identifier': 'This user is already an active contact in your safety circle.',
                })

            # Always overwrite identity fields from server user record
            data['linked_user'] = target
            data['name'] = target.get_full_name() or target.username
            data['phone'] = target.phone
            data['email'] = target.email
            data['status'] = 'pending'
            data['is_verified'] = False
            return data

        # General emergency_contact branch
        if identifier:
            target = resolve_active_user_by_identifier(identifier)
            if not target:
                raise serializers.ValidationError({
                    'identifier': 'No active account found with that username or phone.',
                })
            if target.pk == request.user.pk:
                raise serializers.ValidationError({
                    'identifier': 'You cannot add yourself as an emergency contact.',
                })
            dup_person = EmergencyContact.objects.filter(
                resident=request.user,
                linked_user=target,
                is_active=True,
                status__in=['pending', 'accepted'],
            ).exists()
            if dup_person:
                raise serializers.ValidationError({
                    'identifier': 'This user is already an active contact in your safety circle.',
                })

            data['linked_user'] = target
            data['name'] = target.get_full_name() or target.username
            data['phone'] = target.phone
            data['email'] = target.email
            data['status'] = 'accepted'
            data['is_verified'] = True
            return data

        # Non-registered plain contact
        name = (data.get('name') or '').strip()
        raw_phone = (data.get('phone') or '').strip()
        if not name:
            raise serializers.ValidationError({'name': 'Name is required for non-registered contacts.'})
        if not raw_phone:
            raise serializers.ValidationError({'phone': 'Phone number is required.'})
        try:
            normalized = normalize_phone(raw_phone)
        except ValueError as exc:
            raise serializers.ValidationError({'phone': str(exc)})

        data['linked_user'] = None
        data['name'] = name
        data['phone'] = normalized
        data['status'] = 'pending'
        data['is_verified'] = False
        return data

    def _validate_update(self, data):
        instance = self.instance
        data.pop('identifier', None)

        requested_type = data.get('contact_type')
        if requested_type and requested_type != instance.contact_type:
            raise serializers.ValidationError({
                'contact_type': 'Cannot change contact role directly. Remove or cancel this contact and send a new request.',
            })

        if instance.linked_user_id is not None:
            # Identity stays synced to linked user account
            for locked in ('name', 'phone', 'email'):
                data.pop(locked, None)
        elif 'phone' in data:
            raw_phone = (data.get('phone') or '').strip()
            if not raw_phone:
                raise serializers.ValidationError({'phone': 'Phone number is required.'})
            try:
                data['phone'] = normalize_phone(raw_phone)
            except ValueError as exc:
                raise serializers.ValidationError({'phone': str(exc)})

        return data

    def validate(self, data):
        request = self.context.get('request')
        if self.instance is None:
            return self._validate_create(data, request)
        return self._validate_update(data)


class GuardianRequestSerializer(serializers.Serializer):
    """Incoming guardian link request visible to the addressed guardian."""
    id = serializers.IntegerField(read_only=True)
    contact_id = serializers.IntegerField(read_only=True)
    resident_id = serializers.IntegerField(read_only=True)
    resident_name = serializers.CharField(read_only=True)
    resident_phone = serializers.CharField(read_only=True)
    flat = serializers.CharField(read_only=True)
    block = serializers.CharField(read_only=True)
    society = serializers.CharField(read_only=True)
    contact_type = serializers.CharField(read_only=True)
    relationship = serializers.CharField(read_only=True)
    priority = serializers.IntegerField(read_only=True)
    status = serializers.CharField(read_only=True)
    created_at = serializers.DateTimeField(read_only=True)
    responded_at = serializers.DateTimeField(read_only=True, allow_null=True)

    @classmethod
    def from_contact(cls, contact):
        from society.models import ResidentFlatMapping

        res = contact.resident
        mapping = (
            ResidentFlatMapping.objects.filter(user=res, is_active=True)
            .select_related('flat__block__society')
            .first()
        )
        if mapping and mapping.flat:
            flat_label = mapping.flat.flat_number
            block_label = mapping.flat.block.name if mapping.flat.block else ''
            society_label = mapping.flat.block.society.name if mapping.flat.block and mapping.flat.block.society else ''
        else:
            flat_label = res.address or 'Resident'
            block_label = ''
            society_label = ''

        return {
            'id': contact.pk,
            'contact_id': contact.pk,
            'resident_id': res.pk,
            'resident_name': res.get_full_name() or res.username,
            'resident_phone': res.phone,
            'flat': flat_label,
            'block': block_label,
            'society': society_label,
            'contact_type': contact.contact_type,
            'relationship': contact.relationship,
            'priority': contact.priority,
            'status': contact.status,
            'created_at': contact.created_at,
            'responded_at': contact.responded_at,
        }


class GuardianDependentSerializer(serializers.Serializer):
    """Verified dependent resident visible to their accepted guardian."""
    id = serializers.IntegerField(read_only=True)
    contact_id = serializers.IntegerField(read_only=True)
    name = serializers.CharField(read_only=True)
    phone = serializers.CharField(read_only=True)
    flat = serializers.CharField(read_only=True)
    society = serializers.CharField(read_only=True)
    contact_type = serializers.CharField(read_only=True)
    relationship = serializers.CharField(read_only=True)
    verified_at = serializers.DateTimeField(read_only=True, allow_null=True)
    has_active_incident = serializers.BooleanField(read_only=True)
    active_incident_id = serializers.IntegerField(read_only=True, allow_null=True)


class ResidentSecurityGuardSerializer(serializers.ModelSerializer):
    resident_name = serializers.SerializerMethodField(read_only=True)
    linked_user_name = serializers.SerializerMethodField(read_only=True)
    linked_username = serializers.SerializerMethodField(read_only=True)
    masked_phone = serializers.SerializerMethodField(read_only=True)

    class Meta:
        model = ResidentSecurityGuard
        fields = [
            'id', 'resident', 'resident_name',
            'name', 'phone', 'masked_phone',
            'guard_type',
            'linked_user', 'linked_user_name', 'linked_username',
            'post_label', 'is_active',
            'created_at', 'updated_at',
        ]
        read_only_fields = ['resident', 'created_at', 'updated_at']

    def get_resident_name(self, obj) -> str:
        return obj.resident.get_full_name() or obj.resident.username

    def get_linked_user_name(self, obj) -> str | None:
        if obj.linked_user:
            return obj.linked_user.get_full_name() or obj.linked_user.username
        return None

    def get_linked_username(self, obj) -> str | None:
        return obj.linked_user.username if obj.linked_user else None

    def get_masked_phone(self, obj) -> str:
        return mask_phone(obj.phone)

    def validate(self, attrs):
        guard_type = attrs.get('guard_type', getattr(self.instance, 'guard_type', 'society_security'))
        if guard_type == 'society_security':
            linked_user = attrs.get('linked_user', getattr(self.instance, 'linked_user', None))
            if not linked_user:
                raise serializers.ValidationError({'linked_user': 'Society security requires selecting a security staff user.'})
            if linked_user.role != 'security':
                raise serializers.ValidationError({'linked_user': 'The selected user is not a security staff member.'})
            if not attrs.get('name'):
                attrs['name'] = linked_user.get_full_name() or linked_user.username
            if not attrs.get('phone'):
                attrs['phone'] = linked_user.phone
        elif guard_type == 'building_guard':
            name = (attrs.get('name') or (self.instance.name if self.instance else '')).strip()
            phone = (attrs.get('phone') or (self.instance.phone if self.instance else '')).strip()
            if not name:
                raise serializers.ValidationError({'name': 'Name is required for building guards.'})
            if not phone:
                raise serializers.ValidationError({'phone': 'Phone number is required for building guards.'})
            try:
                attrs['phone'] = normalize_phone(phone)
            except ValueError as exc:
                raise serializers.ValidationError({'phone': str(exc)})
            attrs['linked_user'] = None
        return attrs


class SocietySecurityStaffSerializer(serializers.Serializer):
    id = serializers.IntegerField(source='user.id', read_only=True)
    user_id = serializers.IntegerField(source='user.id', read_only=True)
    name = serializers.SerializerMethodField(read_only=True)
    username = serializers.CharField(source='user.username', read_only=True)
    phone = serializers.CharField(source='user.phone', read_only=True)
    masked_phone = serializers.SerializerMethodField(read_only=True)
    post_label = serializers.CharField(read_only=True)
    is_on_duty = serializers.SerializerMethodField(read_only=True)
    society_id = serializers.IntegerField(source='society.id', read_only=True)
    society_name = serializers.CharField(source='society.name', read_only=True)

    def get_name(self, obj) -> str:
        return obj.user.get_full_name() or obj.user.username

    def get_masked_phone(self, obj) -> str:
        return mask_phone(obj.user.phone)

    def get_is_on_duty(self, obj) -> bool:
        return obj.user.society_assignments.filter(
            society=obj.society, is_active=True, is_available=True
        ).exists()
