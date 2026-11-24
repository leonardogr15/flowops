from __future__ import annotations

from drf_spectacular.utils import extend_schema_field
from rest_framework import serializers

from apps.accounts.api.serializers import UserSerializer

from ..models import Membership, Organization, Role


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
        fields = ("id", "role", "organization", "created_at")
        read_only_fields = fields


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
