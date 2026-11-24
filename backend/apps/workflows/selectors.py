"""Read-side queries for workflow templates. Always scoped to one organization."""

from __future__ import annotations

from uuid import UUID

from django.db.models import Count, Exists, OuterRef, Prefetch, QuerySet
from rest_framework.exceptions import NotFound

from apps.organizations.models import Membership, Role

from .models import Step, TemplateVersion, VersionStatus, WorkflowTemplate


def _published_exists() -> Exists:
    return Exists(TemplateVersion.objects.filter(template=OuterRef("pk"), status=VersionStatus.PUBLISHED))


def templates_for(membership: Membership) -> QuerySet[WorkflowTemplate]:
    """Admins see every template; members only see templates with a published version."""
    qs = (
        WorkflowTemplate.objects.filter(organization=membership.organization)
        .annotate(
            is_published=_published_exists(),
            has_draft=Exists(
                TemplateVersion.objects.filter(template=OuterRef("pk"), status=VersionStatus.DRAFT)
            ),
        )
        .prefetch_related(
            Prefetch(
                "versions",
                queryset=TemplateVersion.objects.filter(status=VersionStatus.PUBLISHED).annotate(
                    step_count=Count("steps")
                ),
                to_attr="published_versions",
            )
        )
        .order_by("name")
    )
    if not membership.has_role(Role.ADMIN):
        qs = qs.filter(is_published=True)
    return qs


def template_detail(membership: Membership, template_id: UUID) -> WorkflowTemplate:
    steps = Prefetch("steps", queryset=Step.objects.select_related("approver_user"))
    versions = TemplateVersion.objects.prefetch_related(steps).select_related("published_by")
    if not membership.has_role(Role.ADMIN):
        versions = versions.filter(status=VersionStatus.PUBLISHED)
    template = (
        WorkflowTemplate.objects.filter(organization=membership.organization, pk=template_id)
        .prefetch_related(Prefetch("versions", queryset=versions, to_attr="visible_versions"))
        .first()
    )
    if template is None or not template.visible_versions:
        raise NotFound("Workflow template not found.")
    return template


def version_by_status(template: WorkflowTemplate, status: str) -> TemplateVersion | None:
    return next((v for v in template.visible_versions if v.status == status), None)  # type: ignore[attr-defined]
