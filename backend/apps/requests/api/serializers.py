from __future__ import annotations

from typing import Any

from drf_spectacular.utils import extend_schema_field
from rest_framework import serializers

from apps.accounts.api.serializers import UserSerializer
from apps.audit.models import AuditEvent

from .. import policy, services
from ..models import ApprovalTask, Comment, Request
from ..services import RequestFields


class RequestInputSerializer(serializers.Serializer[None]):
    title = serializers.CharField(max_length=160)
    description = serializers.CharField(max_length=4000, required=False, allow_blank=True, default="")
    amount = serializers.DecimalField(
        max_digits=14, decimal_places=2, required=False, allow_null=True, default=None
    )
    currency = serializers.CharField(max_length=3, required=False, allow_blank=True, default="")

    def to_fields(self) -> RequestFields:
        return RequestFields(
            **{k: self.validated_data[k] for k in ("title", "description", "amount", "currency")}
        )


class CreateRequestSerializer(RequestInputSerializer):
    template = serializers.UUIDField()


class UpdateRequestSerializer(RequestInputSerializer):
    revision = serializers.IntegerField(min_value=1)


class DecisionSerializer(serializers.Serializer[None]):
    step = serializers.IntegerField(min_value=1, help_text="The step being decided, as shown to the user.")
    comment = serializers.CharField(max_length=2000, required=False, allow_blank=True, default="")


class SubmitSerializer(serializers.Serializer[None]):
    revision = serializers.IntegerField(min_value=1, help_text="Revision of the draft the user reviewed.")


class CancelSerializer(serializers.Serializer[None]):
    reason = serializers.CharField(
        max_length=2000,
        required=False,
        allow_blank=True,
        default="",
        help_text="Required only when an admin cancels the request of someone who is no longer a member.",
    )


class CommentInputSerializer(serializers.Serializer[None]):
    body = serializers.CharField(max_length=2000)


class TemplateRefSerializer(serializers.Serializer[None]):
    id = serializers.UUIDField()
    name = serializers.CharField()


class RequestListSerializer(serializers.ModelSerializer[Request]):
    requester = UserSerializer(read_only=True)
    template = TemplateRefSerializer(read_only=True)
    step_count = serializers.SerializerMethodField()

    class Meta:
        model = Request
        fields: tuple[str, ...] = (
            "id",
            "title",
            "status",
            "template",
            "amount",
            "currency",
            "requester",
            "current_step",
            "step_count",
            "submitted_at",
            "closed_at",
            "created_at",
            "updated_at",
        )
        read_only_fields: tuple[str, ...] = fields

    def get_step_count(self, obj: Request) -> int | None:
        count = getattr(obj, "step_count", None)
        return int(count) if count is not None else None


class TaskSerializer(serializers.ModelSerializer[ApprovalTask]):
    approver_user = UserSerializer(read_only=True, allow_null=True)
    decided_by = UserSerializer(read_only=True, allow_null=True)

    class Meta:
        model = ApprovalTask
        fields = (
            "id",
            "step_order",
            "step_name",
            "approver_type",
            "approver_user",
            "approver_role",
            "status",
            "decided_by",
            "decided_at",
            "comment",
            "fallback",
        )
        read_only_fields = fields


class CommentSerializer(serializers.ModelSerializer[Comment]):
    author = UserSerializer(read_only=True)

    class Meta:
        model = Comment
        fields = ("id", "author", "body", "created_at")
        read_only_fields = fields


class TimelineEventSerializer(serializers.ModelSerializer[AuditEvent]):
    class Meta:
        model = AuditEvent
        fields = ("id", "verb", "actor_email", "data", "created_at")
        read_only_fields = fields


class PermissionsSerializer(serializers.Serializer[None]):
    can_edit = serializers.BooleanField()
    can_submit = serializers.BooleanField()
    can_cancel = serializers.BooleanField()
    cancel_requires_reason = serializers.BooleanField(
        help_text="An admin may cancel because the requester left; a reason is required."
    )
    can_duplicate = serializers.BooleanField()
    decision = serializers.ChoiceField(choices=["regular", "fallback"], allow_null=True)


class PendingStepSerializer(serializers.Serializer[None]):
    order = serializers.IntegerField()
    name = serializers.CharField()
    approver_type = serializers.CharField()
    approver_user = UserSerializer(allow_null=True)
    approver_role = serializers.CharField()


class RequestDetailSerializer(RequestListSerializer):
    description = serializers.CharField(read_only=True)
    version = serializers.SerializerMethodField()
    tasks = TaskSerializer(many=True, read_only=True)
    upcoming_steps = serializers.SerializerMethodField()
    needs_admin = serializers.SerializerMethodField()
    revision = serializers.IntegerField(read_only=True)
    permissions = serializers.SerializerMethodField()
    duplicated_from = serializers.UUIDField(source="duplicated_from_id", read_only=True, allow_null=True)

    class Meta(RequestListSerializer.Meta):
        fields = (
            *RequestListSerializer.Meta.fields,
            "description",
            "version",
            "revision",
            "tasks",
            "upcoming_steps",
            "needs_admin",
            "permissions",
            "duplicated_from",
        )
        read_only_fields = fields

    def get_version(self, obj: Request) -> int | None:
        return obj.template_version.number if obj.template_version else None

    def _open_task(self, obj: Request) -> ApprovalTask | None:
        return next((t for t in obj.tasks.all() if t.status == "open"), None)

    @extend_schema_field(PendingStepSerializer(many=True))
    def get_upcoming_steps(self, obj: Request) -> list[dict[str, Any]]:
        """Steps not reached yet: of the pinned version, or of the current published version for drafts."""
        version = obj.template_version or obj.template.versions.filter(status="published").first()
        if version is None:  # pragma: no cover
            return []
        reached = max((t.step_order for t in obj.tasks.all()), default=0)
        if obj.status in ("approved", "rejected", "cancelled"):
            return []
        return [
            {
                "order": s.order,
                "name": s.name,
                "approver_type": s.approver_type,
                "approver_user": UserSerializer(s.approver_user).data if s.approver_user else None,
                "approver_role": s.approver_role,
            }
            for s in version.steps.select_related("approver_user").order_by("order")
            if s.order > reached
        ]

    def get_needs_admin(self, obj: Request) -> bool:
        task = self._open_task(obj)
        return bool(task and policy.needs_admin(task))

    @extend_schema_field(PermissionsSerializer)
    def get_permissions(self, obj: Request) -> dict[str, Any]:
        membership = self.context["membership"]
        mine = obj.requester_id == membership.user_id
        task = self._open_task(obj)
        for_former_member = (
            not mine
            and obj.status == "in_review"
            and membership.has_role("admin")
            and not services.requester_is_member(obj)
        )
        return {
            "can_edit": mine and obj.status == "draft",
            "can_submit": mine and obj.status == "draft",
            "can_cancel": (mine and obj.status in ("draft", "in_review")) or for_former_member,
            "cancel_requires_reason": for_former_member,
            "can_duplicate": mine and obj.status in ("approved", "rejected", "cancelled"),
            "decision": policy.decision_mode(task, membership) if task else None,
        }


class InboxItemSerializer(serializers.ModelSerializer[ApprovalTask]):
    request = RequestListSerializer(read_only=True)
    needs_admin = serializers.SerializerMethodField()

    class Meta:
        model = ApprovalTask
        fields = (
            "id",
            "step_order",
            "step_name",
            "approver_type",
            "approver_role",
            "created_at",
            "needs_admin",
            "request",
        )
        read_only_fields = fields

    def get_needs_admin(self, obj: ApprovalTask) -> bool:
        return self.context["membership"].user_id != obj.approver_user_id and not (
            obj.approver_type == "role" and self.context["membership"].has_role(obj.approver_role)
        )


class InboxSerializer(serializers.Serializer[None]):
    count = serializers.IntegerField(help_text="All open tasks waiting for you, including those not listed.")
    results = InboxItemSerializer(many=True, help_text="The oldest tasks first, at most `limit`.")
    limit = serializers.IntegerField()
