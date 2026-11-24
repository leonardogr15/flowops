from __future__ import annotations

from typing import Any
from uuid import UUID

from django.db.models import Count, Prefetch, QuerySet
from drf_spectacular.utils import OpenApiParameter, extend_schema
from rest_framework import generics, permissions, status
from rest_framework.exceptions import NotFound
from rest_framework.request import Request as HttpRequest
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.audit.models import AuditEvent
from apps.organizations.api.views import ORG_HEADER
from apps.organizations.models import Membership
from apps.organizations.permissions import IsOrgMember
from apps.organizations.tenancy import TenantScopedMixin

from .. import policy, services
from ..models import ApprovalTask, Comment, Request, RequestStatus
from .serializers import (
    CommentInputSerializer,
    CommentSerializer,
    CreateRequestSerializer,
    DecisionSerializer,
    InboxItemSerializer,
    RequestDetailSerializer,
    RequestListSerializer,
    TimelineEventSerializer,
    UpdateRequestSerializer,
)


def _detail_queryset(qs: QuerySet[Request]) -> QuerySet[Request]:
    tasks = ApprovalTask.objects.select_related("approver_user", "decided_by").order_by("step_order")
    return qs.select_related("template", "template_version", "requester").prefetch_related(
        Prefetch("tasks", queryset=tasks)
    )


def detail_response(membership: Membership, request_id: UUID, code: int = status.HTTP_200_OK) -> Response:
    req = _detail_queryset(policy.visible_requests(membership)).filter(pk=request_id).first()
    if req is None:
        raise NotFound("Request not found.")
    return Response(RequestDetailSerializer(req, context={"membership": membership}).data, status=code)


class _RequestViewBase(TenantScopedMixin, APIView):
    permission_classes = [permissions.IsAuthenticated, IsOrgMember]

    def detail(self, request_id: UUID, code: int = status.HTTP_200_OK) -> Response:
        return detail_response(self.membership, request_id, code)


@extend_schema(parameters=[ORG_HEADER])
class RequestsView(TenantScopedMixin, generics.ListAPIView[Request]):
    """Requests visible to the caller. `scope=mine` (default for everyone) or `scope=all` (all visible)."""

    permission_classes = [permissions.IsAuthenticated, IsOrgMember]
    serializer_class = RequestListSerializer

    def get_queryset(self) -> QuerySet[Request]:
        qs = policy.visible_requests(self.membership).select_related("template", "requester")
        qs = qs.annotate(step_count=Count("template_version__steps", distinct=True))
        if self.request.query_params.get("scope", "mine") == "mine":
            qs = qs.filter(requester_id=self.membership.user_id)
        state = self.request.query_params.get("status")
        if state in RequestStatus.values:
            qs = qs.filter(status=state)
        return qs

    @extend_schema(
        parameters=[
            OpenApiParameter("scope", str, enum=["mine", "all"], description="mine (default) or all visible"),
            OpenApiParameter("status", str, enum=RequestStatus.values),
        ],
        operation_id="requests_list",
    )
    def get(self, request: HttpRequest, *args: Any, **kwargs: Any) -> Response:
        return super().get(request, *args, **kwargs)

    @extend_schema(
        request=CreateRequestSerializer,
        responses={201: RequestDetailSerializer},
        operation_id="requests_create",
    )
    def post(self, request: HttpRequest) -> Response:
        data = CreateRequestSerializer(data=request.data)
        data.is_valid(raise_exception=True)
        req = services.create_request(
            actor=self.membership, template_id=data.validated_data["template"], fields=data.to_fields()
        )
        return detail_response(self.membership, req.pk, status.HTTP_201_CREATED)


@extend_schema(parameters=[ORG_HEADER])
class RequestDetailView(_RequestViewBase):
    @extend_schema(responses=RequestDetailSerializer, operation_id="requests_retrieve")
    def get(self, request: HttpRequest, pk: UUID) -> Response:
        return self.detail(pk)

    @extend_schema(
        request=UpdateRequestSerializer, responses=RequestDetailSerializer, operation_id="requests_update"
    )
    def patch(self, request: HttpRequest, pk: UUID) -> Response:
        data = UpdateRequestSerializer(data=request.data)
        data.is_valid(raise_exception=True)
        services.update_draft(
            actor=self.membership,
            request_id=pk,
            revision=data.validated_data["revision"],
            fields=data.to_fields(),
        )
        return self.detail(pk)


def _action(name: str, operation_id: str, request_serializer: Any = None) -> type[_RequestViewBase]:
    @extend_schema(parameters=[ORG_HEADER])
    class ActionView(_RequestViewBase):
        @extend_schema(
            request=request_serializer, responses=RequestDetailSerializer, operation_id=operation_id
        )
        def post(self, request: HttpRequest, pk: UUID) -> Response:
            if name in ("approve", "reject"):
                data = DecisionSerializer(data=request.data)
                data.is_valid(raise_exception=True)
                services.decide(
                    actor=self.membership,
                    request_id=pk,
                    approve=name == "approve",
                    comment=data.validated_data["comment"],
                )
                return self.detail(pk)
            if name == "duplicate":
                new = services.duplicate(actor=self.membership, request_id=pk)
                return self.detail(new.pk, status.HTTP_201_CREATED)
            getattr(services, name)(actor=self.membership, request_id=pk)
            return self.detail(pk)

    ActionView.__name__ = ActionView.__qualname__ = f"Request{name.title()}View"
    return ActionView


SubmitView = _action("submit", "requests_submit")
CancelView = _action("cancel", "requests_cancel")
ApproveView = _action("approve", "requests_approve", DecisionSerializer)
RejectView = _action("reject", "requests_reject", DecisionSerializer)
DuplicateView = _action("duplicate", "requests_duplicate")


@extend_schema(parameters=[ORG_HEADER])
class CommentsView(_RequestViewBase):
    @extend_schema(responses=CommentSerializer(many=True), operation_id="requests_comments_list")
    def get(self, request: HttpRequest, pk: UUID) -> Response:
        if not policy.visible_requests(self.membership).filter(pk=pk).exists():
            raise NotFound("Request not found.")
        comments = Comment.objects.filter(request_id=pk, organization=self.organization).select_related(
            "author"
        )
        return Response(CommentSerializer(comments, many=True).data)

    @extend_schema(
        request=CommentInputSerializer,
        responses={201: CommentSerializer},
        operation_id="requests_comments_create",
    )
    def post(self, request: HttpRequest, pk: UUID) -> Response:
        data = CommentInputSerializer(data=request.data)
        data.is_valid(raise_exception=True)
        comment = services.add_comment(actor=self.membership, request_id=pk, body=data.validated_data["body"])
        return Response(CommentSerializer(comment).data, status=status.HTTP_201_CREATED)


@extend_schema(parameters=[ORG_HEADER])
class TimelineView(_RequestViewBase):
    """Audit events of one request, for anyone who can see the request."""

    @extend_schema(responses=TimelineEventSerializer(many=True), operation_id="requests_timeline")
    def get(self, request: HttpRequest, pk: UUID) -> Response:
        if not policy.visible_requests(self.membership).filter(pk=pk).exists():
            raise NotFound("Request not found.")
        events = AuditEvent.objects.filter(
            organization=self.organization, target_type="request", target_id=pk
        ).order_by("created_at", "id")
        return Response(TimelineEventSerializer(events, many=True).data)


@extend_schema(parameters=[ORG_HEADER])
class InboxView(TenantScopedMixin, APIView):
    permission_classes = [permissions.IsAuthenticated, IsOrgMember]

    @extend_schema(responses=InboxItemSerializer(many=True), operation_id="inbox_list")
    def get(self, request: HttpRequest) -> Response:
        tasks = policy.inbox_tasks(self.membership)[:200]
        return Response(InboxItemSerializer(tasks, many=True, context={"membership": self.membership}).data)
