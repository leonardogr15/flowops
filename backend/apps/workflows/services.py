"""Write-side use cases for workflow templates (FO-021, FO-022). All writes are transactional."""

from __future__ import annotations

from dataclasses import dataclass
from uuid import UUID

from django.db import IntegrityError, transaction
from django.db.models import Max
from django.utils import timezone
from rest_framework.exceptions import NotFound, PermissionDenied
from rest_framework.exceptions import ValidationError as APIValidationError

from apps.organizations.models import Membership, Role
from common.errors import Conflict

from .models import MAX_STEPS, ApproverType, Step, TemplateVersion, VersionStatus, WorkflowTemplate


@dataclass(frozen=True)
class StepInput:
    name: str
    approver_type: str
    approver_user: UUID | None = None
    approver_role: str = ""


def _require_admin(actor: Membership) -> None:
    if not actor.has_role(Role.ADMIN):
        raise PermissionDenied("Only admins and owners can manage workflow templates.")


def _validate_steps(actor: Membership, steps: list[StepInput]) -> None:
    if not 1 <= len(steps) <= MAX_STEPS:
        raise APIValidationError({"steps": [f"A workflow needs between 1 and {MAX_STEPS} approval steps."]})
    member_ids = set(
        Membership.objects.filter(
            organization=actor.organization, user_id__in=[s.approver_user for s in steps if s.approver_user]
        ).values_list("user_id", flat=True)
    )
    errors: dict[str, dict[str, list[str]]] = {}
    for index, step in enumerate(steps):
        problems: dict[str, list[str]] = {}
        if step.approver_type == ApproverType.USER:
            if step.approver_user is None:
                problems["approver_user"] = ["Choose who approves this step."]
            elif step.approver_user not in member_ids:
                problems["approver_user"] = ["The approver must be a member of this organization."]
        elif step.approver_type == ApproverType.ROLE and step.approver_role not in Role.values:
            problems["approver_role"] = ["Choose the role that approves this step."]
        if problems:
            errors[str(index)] = problems
    if errors:
        raise APIValidationError({"steps": errors})


def _create_steps(version: TemplateVersion, steps: list[StepInput]) -> None:
    Step.objects.bulk_create(
        [
            Step(
                organization=version.organization,
                version=version,
                order=index + 1,
                name=step.name.strip(),
                approver_type=step.approver_type,
                approver_user_id=step.approver_user if step.approver_type == ApproverType.USER else None,
                approver_role=step.approver_role if step.approver_type == ApproverType.ROLE else "",
            )
            for index, step in enumerate(steps)
        ]
    )


def _locked_template(actor: Membership, template_id: UUID) -> WorkflowTemplate:
    template = (
        WorkflowTemplate.objects.select_for_update()
        .filter(organization=actor.organization, pk=template_id)
        .first()
    )
    if template is None:
        raise NotFound("Workflow template not found.")
    if (
        not actor.has_role(Role.ADMIN)
        and not template.versions.filter(status=VersionStatus.PUBLISHED).exists()
    ):
        raise NotFound("Workflow template not found.")  # drafts are invisible to members (same as reads)
    return template


@transaction.atomic
def create_template(
    *, actor: Membership, name: str, category: str, description: str, steps: list[StepInput]
) -> WorkflowTemplate:
    _require_admin(actor)
    _validate_steps(actor, steps)
    try:
        with transaction.atomic():
            template = WorkflowTemplate.objects.create(
                organization=actor.organization,
                name=name.strip(),
                category=category,
                description=description.strip(),
                created_by=actor.user,
            )
    except IntegrityError as exc:
        raise Conflict("A workflow template with this name already exists.") from exc
    version = TemplateVersion.objects.create(organization=actor.organization, template=template, number=1)
    _create_steps(version, steps)
    return template


@transaction.atomic
def update_details(*, actor: Membership, template_id: UUID, **fields: str) -> WorkflowTemplate:
    template = _locked_template(actor, template_id)  # foreign ids: 404 before any role check
    _require_admin(actor)
    for field in ("name", "category", "description"):
        if field in fields:
            setattr(template, field, fields[field].strip())
    try:
        with transaction.atomic():
            template.save()
    except IntegrityError as exc:
        raise Conflict("A workflow template with this name already exists.") from exc
    return template


@transaction.atomic
def save_draft(*, actor: Membership, template_id: UUID, steps: list[StepInput]) -> TemplateVersion:
    """Replaces the draft's steps, starting a new draft version if none exists."""
    template = _locked_template(actor, template_id)  # foreign ids: 404 before any role check
    _require_admin(actor)
    _validate_steps(actor, steps)
    draft = template.versions.filter(status=VersionStatus.DRAFT).first()
    if draft is None:
        last = template.versions.aggregate(n=Max("number"))["n"] or 0
        draft = TemplateVersion.objects.create(
            organization=template.organization, template=template, number=last + 1
        )
    else:
        draft.steps.all().delete()  # draft only: published versions are never touched here
    _create_steps(draft, steps)
    draft.save(update_fields=["updated_at"])
    return draft


@transaction.atomic
def publish(*, actor: Membership, template_id: UUID) -> TemplateVersion:
    template = _locked_template(actor, template_id)  # foreign ids: 404 before any role check
    _require_admin(actor)
    draft = template.versions.filter(status=VersionStatus.DRAFT).first()
    if draft is None:
        raise Conflict("There is no draft to publish. Edit the steps to start a new version.")
    if not draft.steps.exists():
        raise Conflict("Add at least one approval step before publishing.")
    # Membership may have changed since the draft was saved: approvers must still belong to the org.
    _validate_steps(
        actor,
        [
            StepInput(s.name, s.approver_type, s.approver_user_id, s.approver_role)
            for s in draft.steps.order_by("order")
        ],
    )
    template.versions.filter(status=VersionStatus.PUBLISHED).update(status=VersionStatus.ARCHIVED)
    draft.status = VersionStatus.PUBLISHED
    draft.published_at = timezone.now()
    draft.published_by = actor.user
    draft.save(update_fields=["status", "published_at", "published_by", "updated_at"])
    return draft
