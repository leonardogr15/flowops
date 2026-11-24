"""Invitation and member-management endpoints (FO-016, FO-017)."""

from __future__ import annotations

from typing import Any
from uuid import UUID

from django.contrib.auth import login
from django.utils.decorators import method_decorator
from django.views.decorators.csrf import csrf_protect
from drf_spectacular.utils import extend_schema
from rest_framework import generics, permissions, status
from rest_framework.request import Request
from rest_framework.response import Response
from rest_framework.throttling import ScopedRateThrottle
from rest_framework.views import APIView

from apps.accounts.api.serializers import UserSerializer
from apps.accounts.models import User
from common.throttling import CreateRateThrottle

from ..members import (
    accept_invitation,
    accept_url,
    change_role,
    find_pending_invitation,
    invite,
    pending_invitations,
    remove_member,
    revoke_invitation,
)
from ..permissions import IsOrgAdmin, IsOrgMember
from ..tenancy import TenantScopedMixin
from .serializers import (
    AcceptedInvitationSerializer,
    AcceptInvitationSerializer,
    ChangeRoleSerializer,
    CreateInvitationSerializer,
    InvitationPreviewSerializer,
    InvitationSerializer,
    IssuedInvitationSerializer,
    MemberSerializer,
    MyMembershipSerializer,
)
from .views import ORG_HEADER


@extend_schema(parameters=[ORG_HEADER])
class InvitationsView(TenantScopedMixin, generics.GenericAPIView[Any]):
    """Pending invitations of the active organization (admins and owners)."""

    permission_classes = [permissions.IsAuthenticated, IsOrgAdmin]
    serializer_class = InvitationSerializer
    pagination_class = None  # bounded: one open invitation per email
    throttle_classes = [CreateRateThrottle]  # sending invitations only (SEC-02)
    throttle_scope = "invitation_create"

    @extend_schema(responses=InvitationSerializer(many=True))
    def get(self, request: Request) -> Response:
        return Response(InvitationSerializer(pending_invitations(self.organization), many=True).data)

    @extend_schema(request=CreateInvitationSerializer, responses={201: IssuedInvitationSerializer})
    def post(self, request: Request) -> Response:
        data = CreateInvitationSerializer(data=request.data)
        data.is_valid(raise_exception=True)
        issued = invite(actor=self.membership, **data.validated_data)
        body = InvitationSerializer(issued.invitation).data | {"accept_url": accept_url(issued.token)}
        return Response(body, status=status.HTTP_201_CREATED)


@extend_schema(parameters=[ORG_HEADER])
class InvitationDetailView(TenantScopedMixin, APIView):
    permission_classes = [permissions.IsAuthenticated, IsOrgMember]  # role checked after the scoped lookup

    @extend_schema(responses={204: None}, operation_id="org_invitations_revoke")
    def delete(self, request: Request, pk: UUID) -> Response:
        revoke_invitation(actor=self.membership, invitation_id=pk)
        return Response(status=status.HTTP_204_NO_CONTENT)


@extend_schema(parameters=[ORG_HEADER])
class MemberDetailView(TenantScopedMixin, APIView):
    """Change a member's role or remove them. Members may remove themselves (leave)."""

    permission_classes = [permissions.IsAuthenticated, IsOrgMember]

    @extend_schema(
        request=ChangeRoleSerializer, responses=MemberSerializer, operation_id="org_members_change_role"
    )
    def patch(self, request: Request, pk: UUID) -> Response:
        data = ChangeRoleSerializer(data=request.data)
        data.is_valid(raise_exception=True)
        membership = change_role(actor=self.membership, member_id=pk, role=data.validated_data["role"])
        return Response(MemberSerializer(membership).data)

    @extend_schema(responses={204: None}, operation_id="org_members_remove")
    def delete(self, request: Request, pk: UUID) -> Response:
        remove_member(actor=self.membership, member_id=pk)
        return Response(status=status.HTTP_204_NO_CONTENT)


class InvitationPreviewView(APIView):
    """What an invitation link is for. The token itself is the credential."""

    tenant_scoped = False
    permission_classes = [permissions.AllowAny]
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = "invitation"

    @extend_schema(responses=InvitationPreviewSerializer, operation_id="invitations_preview")
    def get(self, request: Request, token: str) -> Response:
        invitation = find_pending_invitation(token)
        inviter = invitation.invited_by
        return Response(
            {
                "organization_name": invitation.organization.name,
                "email": invitation.email,
                "role": invitation.role,
                "invited_by": (inviter.full_name or inviter.email) if inviter else None,
                "expires_at": invitation.expires_at,
                "account_exists": User.objects.filter(email=invitation.email).exists(),
            }
        )


@method_decorator(csrf_protect, name="dispatch")  # anonymous accept also creates a session
class AcceptInvitationView(APIView):
    tenant_scoped = False
    permission_classes = [permissions.AllowAny]
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = "invitation"

    @extend_schema(
        request=AcceptInvitationSerializer,
        responses={201: AcceptedInvitationSerializer},
        operation_id="invitations_accept",
        description="Signed-in users accept with an empty body. New users send full_name and password; "
        "the account is created and signed in.",
    )
    def post(self, request: Request, token: str) -> Response:
        data = AcceptInvitationSerializer(data=request.data)
        data.is_valid(raise_exception=True)
        current = request.user if request.user and request.user.is_authenticated else None
        result = accept_invitation(token=token, user=current, **data.validated_data)
        if result.created_user is not None:
            login(request._request, result.created_user, backend="django.contrib.auth.backends.ModelBackend")
        return Response(
            MyMembershipSerializer(result.membership).data
            | {"user": UserSerializer(result.membership.user).data},
            status=status.HTTP_201_CREATED,
        )
