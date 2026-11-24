"""Read-only audit log for admins and owners of the active organization."""

from __future__ import annotations

from typing import Any

from django.db.models import QuerySet
from django.urls import path
from django.utils.dateparse import parse_datetime
from drf_spectacular.utils import OpenApiParameter, extend_schema
from rest_framework import generics, permissions, serializers
from rest_framework.exceptions import ValidationError
from rest_framework.pagination import CursorPagination
from rest_framework.request import Request
from rest_framework.response import Response

from apps.organizations.api.views import ORG_HEADER
from apps.organizations.permissions import IsOrgAdmin
from apps.organizations.tenancy import TenantScopedMixin

from .models import AuditEvent


class AuditEventSerializer(serializers.ModelSerializer[AuditEvent]):
    class Meta:
        model = AuditEvent
        fields = (
            "id",
            "verb",
            "actor_id",
            "actor_email",
            "target_type",
            "target_id",
            "data",
            "request_id",
            "created_at",
        )
        read_only_fields = fields


class AuditPagination(CursorPagination):
    page_size = 50
    max_page_size = 200
    page_size_query_param = "page_size"
    ordering = ("-created_at", "-id")


@extend_schema(parameters=[ORG_HEADER])
class AuditEventsView(TenantScopedMixin, generics.ListAPIView[AuditEvent]):
    permission_classes = [permissions.IsAuthenticated, IsOrgAdmin]
    serializer_class = AuditEventSerializer
    pagination_class = AuditPagination

    def get_queryset(self) -> QuerySet[AuditEvent]:
        qs = AuditEvent.objects.filter(organization=self.organization)
        params = self.request.query_params
        if verb := params.get("verb"):
            qs = qs.filter(verb__startswith=verb)
        if actor := params.get("actor"):
            qs = qs.filter(actor_email__iexact=actor)
        if target := params.get("target"):
            qs = qs.filter(target_id=target)
        for name, lookup in (("from", "created_at__gte"), ("to", "created_at__lt")):
            if raw := params.get(name):
                moment = parse_datetime(raw)
                if moment is None:
                    raise ValidationError({name: ["Use an ISO 8601 date and time."]})
                qs = qs.filter(**{lookup: moment})
        return qs

    @extend_schema(
        parameters=[
            OpenApiParameter("verb", str, description="Prefix, e.g. `request.` or `member.role_changed`"),
            OpenApiParameter("actor", str, description="Actor email"),
            OpenApiParameter("target", str, description="Target id (UUID)"),
            OpenApiParameter("from", str, description="ISO 8601, inclusive"),
            OpenApiParameter("to", str, description="ISO 8601, exclusive"),
        ],
        operation_id="audit_events_list",
    )
    def get(self, request: Request, *args: Any, **kwargs: Any) -> Response:
        return super().get(request, *args, **kwargs)


urlpatterns = [path("org/audit-events", AuditEventsView.as_view(), name="audit-events")]
