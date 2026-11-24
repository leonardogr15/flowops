from __future__ import annotations

from typing import Any
from uuid import UUID

from drf_spectacular.utils import extend_schema
from rest_framework import permissions, status
from rest_framework.request import Request
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.organizations.api.views import ORG_HEADER
from apps.organizations.permissions import IsOrgMember
from apps.organizations.tenancy import TenantScopedMixin

from ..selectors import template_detail, templates_for
from ..services import create_template, publish, save_draft, update_details
from .serializers import (
    DraftSerializer,
    TemplateCreateSerializer,
    TemplateDetailSerializer,
    TemplateListSerializer,
    TemplateUpdateSerializer,
    VersionSerializer,
    to_steps,
)

# Read access: any member (published templates only for non-admins).
# Write access: admins and owners, enforced in the services.


@extend_schema(parameters=[ORG_HEADER])
class TemplatesView(TenantScopedMixin, APIView):
    permission_classes = [permissions.IsAuthenticated, IsOrgMember]

    @extend_schema(responses=TemplateListSerializer(many=True), operation_id="workflow_templates_list")
    def get(self, request: Request) -> Response:
        return Response(TemplateListSerializer(templates_for(self.membership), many=True).data)

    @extend_schema(
        request=TemplateCreateSerializer,
        responses={201: TemplateDetailSerializer},
        operation_id="workflow_templates_create",
    )
    def post(self, request: Request) -> Response:
        data = TemplateCreateSerializer(data=request.data)
        data.is_valid(raise_exception=True)
        values: dict[str, Any] = dict(data.validated_data)
        template = create_template(actor=self.membership, steps=to_steps(values.pop("steps")), **values)
        detail = template_detail(self.membership, template.pk)
        return Response(TemplateDetailSerializer(detail).data, status=status.HTTP_201_CREATED)


@extend_schema(parameters=[ORG_HEADER])
class TemplateDetailView(TenantScopedMixin, APIView):
    permission_classes = [permissions.IsAuthenticated, IsOrgMember]

    @extend_schema(responses=TemplateDetailSerializer, operation_id="workflow_templates_retrieve")
    def get(self, request: Request, pk: UUID) -> Response:
        return Response(TemplateDetailSerializer(template_detail(self.membership, pk)).data)

    @extend_schema(
        request=TemplateUpdateSerializer,
        responses=TemplateDetailSerializer,
        operation_id="workflow_templates_update",
    )
    def patch(self, request: Request, pk: UUID) -> Response:
        data = TemplateUpdateSerializer(data=request.data)
        data.is_valid(raise_exception=True)
        update_details(actor=self.membership, template_id=pk, **data.validated_data)
        return Response(TemplateDetailSerializer(template_detail(self.membership, pk)).data)


@extend_schema(parameters=[ORG_HEADER])
class TemplateDraftView(TenantScopedMixin, APIView):
    """Replace the draft's steps; starts a new draft version when only a published one exists."""

    permission_classes = [permissions.IsAuthenticated, IsOrgMember]

    @extend_schema(
        request=DraftSerializer, responses=VersionSerializer, operation_id="workflow_templates_save_draft"
    )
    def put(self, request: Request, pk: UUID) -> Response:
        data = DraftSerializer(data=request.data)
        data.is_valid(raise_exception=True)
        draft = save_draft(
            actor=self.membership, template_id=pk, steps=to_steps(data.validated_data["steps"])
        )
        return Response(VersionSerializer(draft).data)


@extend_schema(parameters=[ORG_HEADER])
class TemplatePublishView(TenantScopedMixin, APIView):
    permission_classes = [permissions.IsAuthenticated, IsOrgMember]

    @extend_schema(request=None, responses=VersionSerializer, operation_id="workflow_templates_publish")
    def post(self, request: Request, pk: UUID) -> Response:
        return Response(VersionSerializer(publish(actor=self.membership, template_id=pk)).data)
