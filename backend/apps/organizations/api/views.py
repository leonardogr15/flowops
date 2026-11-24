from __future__ import annotations

from typing import Any

from django.db.models import QuerySet
from drf_spectacular.utils import OpenApiParameter, extend_schema
from rest_framework import generics, permissions, status
from rest_framework.request import Request
from rest_framework.response import Response

from ..models import Membership
from ..permissions import IsOrgMember, ReadMemberWriteAdmin
from ..selectors import members_of, memberships_for_user
from ..services import create_organization, rename_organization
from ..tenancy import HEADER, TenantScopedMixin
from .serializers import (
    CurrentOrganizationSerializer,
    MemberSerializer,
    MyMembershipSerializer,
    OrganizationSerializer,
)

ORG_HEADER = OpenApiParameter(
    HEADER, str, OpenApiParameter.HEADER, required=True, description="Slug of the active organization."
)


class MyOrganizationsView(generics.ListCreateAPIView[Membership]):
    """Organizations the current user belongs to (not tenant-scoped: it is how a tenant is chosen)."""

    tenant_scoped = False
    permission_classes = [permissions.IsAuthenticated]
    pagination_class = None
    serializer_class = MyMembershipSerializer

    def get_queryset(self) -> QuerySet[Membership]:
        return memberships_for_user(self.request.user)  # type: ignore[arg-type]

    @extend_schema(request=OrganizationSerializer, responses={201: MyMembershipSerializer})
    def post(self, request: Request, *args: Any, **kwargs: Any) -> Response:
        data = OrganizationSerializer(data=request.data)
        data.is_valid(raise_exception=True)
        membership = create_organization(creator=request.user, name=data.validated_data["name"])  # type: ignore[arg-type]
        return Response(MyMembershipSerializer(membership).data, status=status.HTTP_201_CREATED)


@extend_schema(parameters=[ORG_HEADER])
class CurrentOrganizationView(TenantScopedMixin, generics.GenericAPIView[Any]):
    """The active organization. Members read; admins and owners rename."""

    permission_classes = [permissions.IsAuthenticated, ReadMemberWriteAdmin]
    serializer_class = CurrentOrganizationSerializer

    def get_serializer_context(self) -> dict[str, Any]:
        return {**super().get_serializer_context(), "membership": self.membership}

    def get(self, request: Request) -> Response:
        return Response(self.get_serializer(self.organization).data)

    def patch(self, request: Request) -> Response:
        data = OrganizationSerializer(self.organization, data=request.data)  # name is required
        data.is_valid(raise_exception=True)
        org = rename_organization(organization=self.organization, name=data.validated_data["name"])
        return Response(self.get_serializer(org).data)


@extend_schema(parameters=[ORG_HEADER])
class MembersView(TenantScopedMixin, generics.ListAPIView[Membership]):
    permission_classes = [permissions.IsAuthenticated, IsOrgMember]
    serializer_class = MemberSerializer

    def get_queryset(self) -> QuerySet[Membership]:
        return members_of(self.organization)
