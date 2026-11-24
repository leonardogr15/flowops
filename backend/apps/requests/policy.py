"""Who may view a request and who may decide its open task (ADR-0006, design notes A2/A3).

- Eligibility is evaluated at decision time from current memberships, never from a frozen list.
- The requester can never decide a task of their own request, whatever their role.
- If nobody is eligible for the open task right now (approver left, or nobody holds the role), the
  task "needs an administrator": any admin or owner other than the requester may decide it, with a
  mandatory comment, and the decision is recorded as a fallback.
- Viewing is broader than deciding: admins/owners, the requester, anyone who decided a task of the
  request, and anyone who can decide the open task right now.
"""

from __future__ import annotations

from django.db.models import Exists, OuterRef, Q, QuerySet

from apps.organizations.models import ROLE_RANK, Membership, Role

from .models import ApprovalTask, Request, TaskStatus


def roles_at_or_above(role: str) -> list[str]:
    return [r for r, rank in ROLE_RANK.items() if rank >= ROLE_RANK[Role(role)]]


def roles_at_or_below(role: str) -> list[str]:
    return [r for r, rank in ROLE_RANK.items() if rank <= ROLE_RANK[Role(role)]]


def _step_eligible(task: ApprovalTask, membership: Membership) -> bool:
    if task.approver_type == "user":
        return membership.user_id == task.approver_user_id
    return membership.has_role(task.approver_role)


def regular_approvers(task: ApprovalTask) -> QuerySet[Membership]:
    """Members who may decide this task through the step definition (requester excluded)."""
    qs = Membership.objects.filter(organization_id=task.organization_id).exclude(
        user_id=task.request.requester_id
    )
    if task.approver_type == "user":
        return qs.filter(user_id=task.approver_user_id) if task.approver_user_id else qs.none()
    return qs.filter(role__in=roles_at_or_above(task.approver_role))


def needs_admin(task: ApprovalTask) -> bool:
    return task.status == TaskStatus.OPEN and not regular_approvers(task).exists()


def fallback_approvers(task: ApprovalTask) -> QuerySet[Membership]:
    return Membership.objects.filter(
        organization_id=task.organization_id, role__in=roles_at_or_above(Role.ADMIN)
    ).exclude(user_id=task.request.requester_id)


def decision_mode(task: ApprovalTask, membership: Membership) -> str | None:
    """'regular', 'fallback' or None (cannot decide)."""
    if task.status != TaskStatus.OPEN or membership.user_id == task.request.requester_id:
        return None
    if _step_eligible(task, membership):
        return "regular"
    if membership.has_role(Role.ADMIN) and needs_admin(task):
        return "fallback"
    return None


def deciders(task: ApprovalTask) -> QuerySet[Membership]:
    """Everyone who can decide the task right now (used for notifications)."""
    regular = regular_approvers(task)
    return regular if regular.exists() else fallback_approvers(task)


# ----------------------------------------------------------------------------- SQL visibility


def _open_task_eligible_q(membership: Membership) -> Q:
    """Open tasks the member can decide through their step (not counting the admin fallback)."""
    return Q(status=TaskStatus.OPEN) & (
        Q(approver_type="user", approver_user_id=membership.user_id)
        | Q(approver_type="role", approver_role__in=roles_at_or_below(membership.role))
    )


def visible_requests(membership: Membership) -> QuerySet[Request]:
    qs = Request.objects.filter(organization_id=membership.organization_id)
    if membership.has_role(Role.ADMIN):
        return qs
    user_id = membership.user_id
    decided = ApprovalTask.objects.filter(request=OuterRef("pk"), decided_by_id=user_id)
    can_decide_now = ApprovalTask.objects.filter(_open_task_eligible_q(membership), request=OuterRef("pk"))
    return qs.filter(
        Q(requester_id=user_id) | (Exists(decided)) | (Exists(can_decide_now) & ~Q(requester_id=user_id))
    )


def inbox_tasks(membership: Membership) -> QuerySet[ApprovalTask]:
    """Open tasks the member can decide now, including admin fallbacks."""
    org_members = Membership.objects.filter(organization_id=membership.organization_id)
    user_step_member = org_members.filter(user_id=OuterRef("approver_user_id")).exclude(
        user_id=OuterRef("request__requester_id")
    )
    tasks = (
        ApprovalTask.objects.filter(organization_id=membership.organization_id, status=TaskStatus.OPEN)
        .exclude(request__requester_id=membership.user_id)
        .select_related("request", "request__requester", "request__template", "approver_user")
    )
    regular = tasks.filter(_open_task_eligible_q(membership))
    if not membership.has_role(Role.ADMIN):
        return regular.order_by("created_at")
    # Admin fallback: open tasks where nobody can decide through the step definition.
    role_holders = {
        role: org_members.filter(role__in=roles_at_or_above(role)).exclude(
            user_id=OuterRef("request__requester_id")
        )
        for role in Role.values
    }
    no_regular = Q(Q(approver_type="user"), ~Exists(user_step_member))
    for role, holders in role_holders.items():
        no_regular |= Q(Q(approver_type="role", approver_role=role), ~Exists(holders))
    return (regular | tasks.filter(no_regular)).distinct().order_by("created_at")
