"""Write-side use cases for requests (ADR-0006).

Every function runs in one transaction. Locks are always taken in the same order to avoid
deadlocks: workflow template (submit only) -> request -> open task. Status changes go through
`_transition`, which rejects any move that is not in ALLOWED.
"""

from __future__ import annotations

from dataclasses import dataclass
from decimal import Decimal
from typing import Any
from uuid import UUID

from django.db import IntegrityError, transaction
from django.utils import timezone
from rest_framework.exceptions import NotFound, PermissionDenied
from rest_framework.exceptions import ValidationError as APIValidationError

from apps.audit.service import record
from apps.notifications.models import NotificationKind
from apps.notifications.service import notify
from apps.organizations.models import Membership
from apps.workflows.models import Step, VersionStatus, WorkflowTemplate
from common.errors import Conflict

from . import policy
from .currencies import ISO_4217
from .models import TERMINAL, ApprovalTask, Comment, Request, RequestStatus, TaskStatus

ALLOWED: dict[str, frozenset[str]] = {
    RequestStatus.DRAFT: frozenset({RequestStatus.IN_REVIEW, RequestStatus.CANCELLED}),
    # Moving to the next step is not a status change, so in_review -> in_review is not a transition.
    RequestStatus.IN_REVIEW: frozenset(
        {RequestStatus.APPROVED, RequestStatus.REJECTED, RequestStatus.CANCELLED}
    ),
    RequestStatus.APPROVED: frozenset(),
    RequestStatus.REJECTED: frozenset(),
    RequestStatus.CANCELLED: frozenset(),
}


class InvalidTransition(Conflict):
    default_code = "invalid_transition"


class NoEligibleApprover(APIValidationError):
    status_code = 422
    default_code = "no_eligible_approver"


def _transition(req: Request, target: str) -> None:
    if target not in ALLOWED[RequestStatus(req.status)]:
        raise InvalidTransition(
            f"A request that is {req.get_status_display().lower()} cannot become {target}."
        )
    req.status = target


# ----------------------------------------------------------------------------- loading


def _locked_visible_request(actor: Membership, request_id: UUID) -> Request:
    """Locks the request if the actor may see it; otherwise 404 (no existence leak)."""
    req = (
        policy.visible_requests(actor)
        .select_for_update(of=("self",))
        .select_related("template", "requester")
        .filter(pk=request_id)
        .first()
    )
    if req is None:
        raise NotFound("Request not found.")
    return req


def _require_requester(actor: Membership, req: Request) -> None:
    if req.requester_id != actor.user_id:
        raise PermissionDenied("Only the person who created the request can do this.")


# ----------------------------------------------------------------------------- validation


@dataclass(frozen=True)
class RequestFields:
    title: str
    description: str = ""
    amount: Decimal | None = None
    currency: str = ""


def _clean(fields: RequestFields) -> RequestFields:
    errors: dict[str, list[str]] = {}
    title = fields.title.strip()
    if len(title) < 3:
        errors["title"] = ["Enter a title of at least 3 characters."]
    currency = fields.currency.strip().upper()
    if fields.amount is None and currency:
        errors["amount"] = ["Enter an amount for the selected currency."]
    if fields.amount is not None:
        if fields.amount < 0:
            errors["amount"] = ["The amount cannot be negative."]
        if not currency:
            errors["currency"] = ["Choose a currency for the amount."]
        elif currency not in ISO_4217:
            errors["currency"] = ["Use a valid ISO 4217 currency code, such as USD or EUR."]
    if errors:
        raise APIValidationError(errors)
    return RequestFields(
        title, fields.description.strip(), fields.amount, currency if fields.amount is not None else ""
    )


def _audit(actor: Membership, verb: str, req: Request, **data: Any) -> None:
    record(
        organization=actor.organization,
        actor=actor.user,
        verb=verb,
        target_type="request",
        target_id=req.pk,
        data={"status": req.status, **data},
    )


# ----------------------------------------------------------------------------- drafts


@transaction.atomic
def create_request(*, actor: Membership, template_id: UUID, fields: RequestFields) -> Request:
    template = (
        WorkflowTemplate.objects.filter(organization=actor.organization, pk=template_id)
        .filter(versions__status=VersionStatus.PUBLISHED)
        .first()
    )
    if template is None:  # unknown, foreign or not published: indistinguishable
        raise NotFound("Workflow not found.")
    clean = _clean(fields)
    req = Request.objects.create(
        organization=actor.organization,
        template=template,
        requester=actor.user,
        title=clean.title,
        description=clean.description,
        amount=clean.amount,
        currency=clean.currency,
    )
    _audit(actor, "request.created", req, template=template.name)
    return req


@transaction.atomic
def update_draft(*, actor: Membership, request_id: UUID, revision: int, fields: RequestFields) -> Request:
    req = _locked_visible_request(actor, request_id)
    _require_requester(actor, req)
    if req.status != RequestStatus.DRAFT:
        raise InvalidTransition("Only drafts can be edited.")
    if revision != req.revision:
        raise Conflict("This draft was changed elsewhere. Reload it and apply your changes again.")
    clean = _clean(fields)
    changed = [
        name
        for name in ("title", "description", "amount", "currency")
        if getattr(req, name) != getattr(clean, name)
    ]
    for name in changed:
        setattr(req, name, getattr(clean, name))
    req.revision += 1
    req.save()
    _audit(actor, "request.updated", req, fields=changed)
    return req


@transaction.atomic
def duplicate(*, actor: Membership, request_id: UUID) -> Request:
    source = _locked_visible_request(actor, request_id)
    _require_requester(actor, source)
    if source.status not in TERMINAL:
        raise InvalidTransition("Only closed requests can be duplicated.")
    template_ok = source.template.versions.filter(status=VersionStatus.PUBLISHED).exists()
    if not template_ok:  # pragma: no cover - templates cannot be unpublished today
        raise Conflict("The workflow of this request is no longer published.")
    req = Request.objects.create(
        organization=actor.organization,
        template=source.template,
        requester=actor.user,
        title=source.title,
        description=source.description,
        amount=source.amount,
        currency=source.currency,
        duplicated_from=source,
    )
    _audit(actor, "request.created", req, duplicated_from=str(source.pk))
    return req


# ----------------------------------------------------------------------------- submit


def _task_from_step(req: Request, step: Step) -> ApprovalTask:
    return ApprovalTask.objects.create(
        organization=req.organization,
        request=req,
        step_order=step.order,
        step_name=step.name,
        approver_type=step.approver_type,
        approver_user_id=step.approver_user_id,
        approver_role=step.approver_role,
    )


def _notify_deciders(task: ApprovalTask) -> None:
    deciders = policy.deciders(task)
    kind = NotificationKind.TASK_NEEDS_ADMIN if policy.needs_admin(task) else NotificationKind.TASK_ASSIGNED
    notify(
        organization_id=task.organization_id,
        user_ids=deciders.values_list("user_id", flat=True),
        kind=kind,
        request_id=task.request_id,
    )


@transaction.atomic
def submit(*, actor: Membership, request_id: UUID) -> Request:
    peek = policy.visible_requests(actor).filter(pk=request_id).values_list("template_id", flat=True).first()
    if peek is None:
        raise NotFound("Request not found.")
    # Same lock as publish(): the published version cannot change while we pin it.
    WorkflowTemplate.objects.select_for_update().filter(pk=peek).first()
    req = _locked_visible_request(actor, request_id)
    _require_requester(actor, req)
    _transition(req, RequestStatus.IN_REVIEW)

    version = req.template.versions.filter(status=VersionStatus.PUBLISHED).first()
    if version is None:  # pragma: no cover - defensive; publish never leaves a template without one
        raise Conflict("The workflow has no published version.")
    steps = list(version.steps.order_by("order"))

    # D-B3-2: every step needs at least one possible approver other than the requester right now.
    unreachable = []
    for step in steps:
        probe = ApprovalTask(
            organization=req.organization,
            request=req,
            approver_type=step.approver_type,
            approver_user_id=step.approver_user_id,
            approver_role=step.approver_role,
        )
        if not policy.regular_approvers(probe).exists():
            unreachable.append(step.name)
    if unreachable:
        raise NoEligibleApprover(
            {"steps": [f"No one other than you can approve this step: {name}." for name in unreachable]}
        )

    now = timezone.now()
    req.template_version = version
    req.current_step = steps[0].order
    req.submitted_at = now
    req.revision += 1
    req.save()
    task = _task_from_step(req, steps[0])
    _audit(actor, "request.submitted", req, version=version.number, steps=len(steps))
    _notify_deciders(task)
    return req


# ----------------------------------------------------------------------------- decisions


@transaction.atomic
def decide(*, actor: Membership, request_id: UUID, approve: bool, comment: str = "") -> Request:
    req = _locked_visible_request(actor, request_id)
    if req.status != RequestStatus.IN_REVIEW:
        raise InvalidTransition("This request is not waiting for a decision.")
    task = (
        ApprovalTask.objects.select_for_update()
        .select_related("request")
        .filter(request=req, status=TaskStatus.OPEN)
        .first()
    )
    if task is None or task.step_order != req.current_step:  # pragma: no cover - guarded by constraints
        raise Conflict("This step was already decided.")
    if actor.user_id == req.requester_id:
        raise PermissionDenied("You can't decide your own request.")
    mode = policy.decision_mode(task, actor)
    if mode is None:
        raise PermissionDenied("You're not an approver for the current step of this request.")
    comment = comment.strip()
    if (not approve or mode == "fallback") and not comment:
        raise APIValidationError(
            {
                "comment": [
                    "Add a comment explaining the decision."
                    if approve
                    else "Add a comment explaining the rejection."
                ]
            }
        )

    now = timezone.now()
    task.status = TaskStatus.APPROVED if approve else TaskStatus.REJECTED
    task.decided_by = actor.user
    task.decided_at = now
    task.comment = comment
    task.fallback = mode == "fallback"
    task.save()
    record(
        organization=actor.organization,
        actor=actor.user,
        verb="task.approved" if approve else "task.rejected",
        target_type="request",
        target_id=req.pk,
        data={"step": task.step_order, "step_name": task.step_name, "fallback": task.fallback},
    )

    if not approve:
        _transition(req, RequestStatus.REJECTED)
        req.closed_at = now
        req.save()
        _audit(actor, "request.rejected", req, step=task.step_order)
        notify(
            organization_id=req.organization_id,
            user_ids=[req.requester_id],
            kind=NotificationKind.REQUEST_REJECTED,
            request_id=req.pk,
        )
        return req

    next_step = req.template_version.steps.filter(order__gt=task.step_order).order_by("order").first()  # type: ignore[union-attr]
    if next_step is None:
        _transition(req, RequestStatus.APPROVED)
        req.closed_at = now
        req.save()
        _audit(actor, "request.approved", req)
        notify(
            organization_id=req.organization_id,
            user_ids=[req.requester_id],
            kind=NotificationKind.REQUEST_APPROVED,
            request_id=req.pk,
        )
        return req

    req.current_step = next_step.order
    req.save()
    try:
        with transaction.atomic():
            new_task = _task_from_step(req, next_step)
    except IntegrityError as exc:  # pragma: no cover - only reachable if locking were bypassed
        raise Conflict("This step was already decided.") from exc
    _notify_deciders(new_task)
    return req


@transaction.atomic
def cancel(*, actor: Membership, request_id: UUID) -> Request:
    req = _locked_visible_request(actor, request_id)
    _require_requester(actor, req)
    _transition(req, RequestStatus.CANCELLED)
    ApprovalTask.objects.filter(request=req, status=TaskStatus.OPEN).update(status=TaskStatus.CANCELLED)
    req.closed_at = timezone.now()
    req.save()
    _audit(actor, "request.cancelled", req)
    return req


# ----------------------------------------------------------------------------- comments


@transaction.atomic
def add_comment(*, actor: Membership, request_id: UUID, body: str) -> Comment:
    req = _locked_visible_request(actor, request_id)
    text = body.strip()
    if not text:
        raise APIValidationError({"body": ["Write a comment first."]})
    comment = Comment.objects.create(organization=req.organization, request=req, author=actor.user, body=text)
    record(
        organization=actor.organization,
        actor=actor.user,
        verb="comment.added",
        target_type="request",
        target_id=req.pk,
        data={"comment_id": str(comment.pk)},
    )
    recipients = {req.requester_id} | set(
        ApprovalTask.objects.filter(request=req, decided_by__isnull=False).values_list(
            "decided_by_id", flat=True
        )
    )
    recipients.discard(actor.user_id)
    notify(
        organization_id=req.organization_id,
        user_ids=recipients,
        kind=NotificationKind.COMMENT_ADDED,
        request_id=req.pk,
    )
    return comment
