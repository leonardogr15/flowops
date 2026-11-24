from __future__ import annotations

from typing import Any

from drf_spectacular.utils import extend_schema_field
from rest_framework import serializers

from apps.accounts.api.serializers import UserSerializer
from apps.organizations.models import Role

from ..models import MAX_STEPS, ApproverType, Category, Step, TemplateVersion, VersionStatus, WorkflowTemplate
from ..selectors import version_by_status
from ..services import StepInput


class StepSerializer(serializers.ModelSerializer[Step]):
    approver_user = UserSerializer(read_only=True, allow_null=True)

    class Meta:
        model = Step
        fields = ("id", "order", "name", "approver_type", "approver_user", "approver_role")
        read_only_fields = fields


class VersionSerializer(serializers.ModelSerializer[TemplateVersion]):
    steps = StepSerializer(many=True, read_only=True)
    published_by = serializers.SerializerMethodField()

    class Meta:
        model = TemplateVersion
        fields = ("id", "number", "status", "published_at", "published_by", "updated_at", "steps")
        read_only_fields = fields

    def get_published_by(self, obj: TemplateVersion) -> str | None:
        return (obj.published_by.full_name or obj.published_by.email) if obj.published_by else None


class VersionSummarySerializer(serializers.ModelSerializer[TemplateVersion]):
    class Meta:
        model = TemplateVersion
        fields = ("number", "status", "published_at")
        read_only_fields = fields


class TemplateListSerializer(serializers.ModelSerializer[WorkflowTemplate]):
    published_version = serializers.SerializerMethodField()
    published_step_count = serializers.SerializerMethodField()
    has_draft = serializers.BooleanField(read_only=True)

    class Meta:
        model = WorkflowTemplate
        fields = (
            "id",
            "name",
            "category",
            "description",
            "published_version",
            "published_step_count",
            "has_draft",
            "updated_at",
        )
        read_only_fields = fields

    def _published(self, obj: WorkflowTemplate) -> Any:
        versions = getattr(obj, "published_versions", [])
        return versions[0] if versions else None

    def get_published_version(self, obj: WorkflowTemplate) -> int | None:
        version = self._published(obj)
        return version.number if version else None

    def get_published_step_count(self, obj: WorkflowTemplate) -> int:
        version = self._published(obj)
        return int(version.step_count) if version else 0


class TemplateDetailSerializer(serializers.ModelSerializer[WorkflowTemplate]):
    published = serializers.SerializerMethodField()
    draft = serializers.SerializerMethodField()
    history = serializers.SerializerMethodField()

    class Meta:
        model = WorkflowTemplate
        fields = (
            "id",
            "name",
            "category",
            "description",
            "created_at",
            "updated_at",
            "published",
            "draft",
            "history",
        )
        read_only_fields = fields

    @extend_schema_field(VersionSerializer(allow_null=True))
    def get_published(self, obj: WorkflowTemplate) -> dict[str, Any] | None:
        version = version_by_status(obj, VersionStatus.PUBLISHED)
        return VersionSerializer(version).data if version else None

    @extend_schema_field(VersionSerializer(allow_null=True))
    def get_draft(self, obj: WorkflowTemplate) -> dict[str, Any] | None:
        version = version_by_status(obj, VersionStatus.DRAFT)  # only present for admins
        return VersionSerializer(version).data if version else None

    @extend_schema_field(VersionSummarySerializer(many=True))
    def get_history(self, obj: WorkflowTemplate) -> list[dict[str, Any]]:
        versions = obj.visible_versions  # type: ignore[attr-defined]
        return list(VersionSummarySerializer(versions, many=True).data)


class StepInputSerializer(serializers.Serializer[None]):
    name = serializers.CharField(max_length=120, min_length=2)
    approver_type = serializers.ChoiceField(choices=ApproverType.choices)
    approver_user = serializers.UUIDField(required=False, allow_null=True, default=None)
    approver_role = serializers.ChoiceField(
        choices=Role.choices, required=False, allow_blank=True, default=""
    )


def to_steps(data: list[dict[str, Any]]) -> list[StepInput]:
    return [StepInput(**item) for item in data]


class TemplateCreateSerializer(serializers.Serializer[None]):
    name = serializers.CharField(max_length=120, min_length=2)
    category = serializers.ChoiceField(choices=Category.choices, default=Category.OTHER)
    description = serializers.CharField(max_length=1000, required=False, allow_blank=True, default="")
    steps = StepInputSerializer(many=True, allow_empty=False, max_length=MAX_STEPS)  # type: ignore[call-arg]


class TemplateUpdateSerializer(serializers.Serializer[None]):
    name = serializers.CharField(max_length=120, min_length=2, required=False)
    category = serializers.ChoiceField(choices=Category.choices, required=False)
    description = serializers.CharField(max_length=1000, required=False, allow_blank=True)


class DraftSerializer(serializers.Serializer[None]):
    steps = StepInputSerializer(many=True, allow_empty=False, max_length=MAX_STEPS)  # type: ignore[call-arg]
