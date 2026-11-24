from __future__ import annotations

from drf_spectacular.utils import extend_schema_field
from rest_framework import serializers

from apps.accounts.api.serializers import UserSerializer

from ..models import INVITABLE_ROLE_CHOICES, Invitation, Membership, Organization, Role


class OrganizationSerializer(serializers.ModelSerializer[Organization]):
    class Meta:
        model = Organization
        fields: tuple[str, ...] = ("id", "name", "slug", "created_at")
        read_only_fields = ("id", "slug", "created_at")
        extra_kwargs = {"name": {"min_length": 2, "max_length": 120}}

    def validate_name(self, value: str) -> str:
        value = value.strip()
        if len(value) < 2:
            raise serializers.ValidationError("Name must have at least 2 characters.")
        return value


class MyMembershipSerializer(serializers.ModelSerializer[Membership]):
    """A membership seen from the current user: which organization and with which role."""

    organization = OrganizationSerializer(read_only=True)

    class Meta:
        model = Membership
        fields: tuple[str, ...] = ("id", "role", "organization", "created_at")
        read_only_fields: tuple[str, ...] = fields


class MemberSerializer(serializers.ModelSerializer[Membership]):
    """A membership seen from inside the organization: which user and with which role."""

    user = UserSerializer(read_only=True)

    class Meta:
        model = Membership
        fields = ("id", "role", "user", "created_at")
        read_only_fields = fields


class CurrentOrganizationSerializer(OrganizationSerializer):
    role = serializers.SerializerMethodField()
    member_count = serializers.SerializerMethodField()

    class Meta(OrganizationSerializer.Meta):
        fields = (*OrganizationSerializer.Meta.fields, "role", "member_count")

    @extend_schema_field(serializers.ChoiceField(choices=Role.choices))
    def get_role(self, obj: Organization) -> str:
        return str(self.context["membership"].role)

    def get_member_count(self, obj: Organization) -> int:
        return Membership.objects.filter(organization=obj).count()


class InvitationSerializer(serializers.ModelSerializer[Invitation]):
    invited_by = serializers.SerializerMethodField()

    class Meta:
        model = Invitation
        fields: tuple[str, ...] = ("id", "email", "role", "invited_by", "expires_at", "created_at")
        read_only_fields: tuple[str, ...] = fields

    def get_invited_by(self, obj: Invitation) -> str | None:
        return (obj.invited_by.full_name or obj.invited_by.email) if obj.invited_by else None


class CreateInvitationSerializer(serializers.Serializer[None]):
    email = serializers.EmailField(max_length=254)
    role = serializers.ChoiceField(choices=INVITABLE_ROLE_CHOICES, default=Role.MEMBER)


class IssuedInvitationSerializer(InvitationSerializer):
    accept_url = serializers.CharField(
        read_only=True, help_text="Shown once. Share it if email delivery fails."
    )

    class Meta(InvitationSerializer.Meta):
        fields = (*InvitationSerializer.Meta.fields, "accept_url")
        read_only_fields: tuple[str, ...] = fields


class InvitationPreviewSerializer(serializers.Serializer[None]):
    organization_name = serializers.CharField()
    email = serializers.EmailField()
    role = serializers.ChoiceField(choices=Role.choices)
    invited_by = serializers.CharField(allow_null=True)
    expires_at = serializers.DateTimeField()
    account_exists = serializers.BooleanField()


class AcceptInvitationSerializer(serializers.Serializer[None]):
    full_name = serializers.CharField(max_length=150, required=False, allow_blank=True, default="")
    password = serializers.CharField(
        max_length=128, required=False, allow_blank=True, default="", write_only=True, trim_whitespace=False
    )


class ChangeRoleSerializer(serializers.Serializer[None]):
    role = serializers.ChoiceField(choices=Role.choices)


class AcceptedInvitationSerializer(MyMembershipSerializer):
    """The new membership plus the signed-in user (the account may have just been created)."""

    user = UserSerializer(read_only=True)

    class Meta(MyMembershipSerializer.Meta):
        fields = (*MyMembershipSerializer.Meta.fields, "user")
        read_only_fields = fields
