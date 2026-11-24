from __future__ import annotations

from typing import Any
from uuid import UUID

from django.db.models import QuerySet
from django.urls import path
from django.utils import timezone
from drf_spectacular.utils import extend_schema, inline_serializer
from rest_framework import generics, permissions, serializers, status
from rest_framework.exceptions import NotFound
from rest_framework.request import Request
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.organizations.api.views import ORG_HEADER
from apps.organizations.permissions import IsOrgMember
from apps.organizations.tenancy import TenantScopedMixin

from .models import Notification


class NotificationSerializer(serializers.ModelSerializer[Notification]):
    request_title = serializers.CharField(source="request.title", read_only=True)

    class Meta:
        model = Notification
        fields = ("id", "kind", "request", "request_title", "read_at", "created_at")
        read_only_fields = fields


def _mine(view: TenantScopedMixin) -> QuerySet[Notification]:
    """Only the caller's notifications in the active organization."""
    return Notification.objects.filter(organization=view.organization, user_id=view.membership.user_id)


@extend_schema(parameters=[ORG_HEADER])
class NotificationsView(TenantScopedMixin, generics.ListAPIView[Notification]):
    permission_classes = [permissions.IsAuthenticated, IsOrgMember]
    serializer_class = NotificationSerializer

    def get_queryset(self) -> QuerySet[Notification]:
        return _mine(self).select_related("request")

    @extend_schema(operation_id="notifications_list")
    def get(self, request: Request, *args: Any, **kwargs: Any) -> Response:
        return super().get(request, *args, **kwargs)


@extend_schema(parameters=[ORG_HEADER])
class UnreadCountView(TenantScopedMixin, APIView):
    permission_classes = [permissions.IsAuthenticated, IsOrgMember]

    @extend_schema(
        responses=inline_serializer("UnreadCount", {"unread": serializers.IntegerField()}),
        operation_id="notifications_unread",
    )
    def get(self, request: Request) -> Response:
        return Response({"unread": _mine(self).filter(read_at__isnull=True).count()})


@extend_schema(parameters=[ORG_HEADER])
class MarkReadView(TenantScopedMixin, APIView):
    permission_classes = [permissions.IsAuthenticated, IsOrgMember]

    @extend_schema(request=None, responses={204: None}, operation_id="notifications_mark_read")
    def post(self, request: Request, pk: UUID) -> Response:
        updated = _mine(self).filter(pk=pk, read_at__isnull=True).update(read_at=timezone.now())
        if not updated and not _mine(self).filter(pk=pk).exists():
            raise NotFound("Notification not found.")
        return Response(status=status.HTTP_204_NO_CONTENT)


urlpatterns = [
    path("org/notifications", NotificationsView.as_view(), name="notifications"),
    path("org/notifications/unread", UnreadCountView.as_view(), name="notifications-unread"),
    path("org/notifications/<uuid:pk>/read", MarkReadView.as_view(), name="notification-read"),
]
