"""BE-01: requests whose creator is no longer a member, and tasks left without an approver."""

from __future__ import annotations

from collections.abc import Callable
from decimal import Decimal
from typing import Any

import pytest
from rest_framework.test import APIClient

from apps.accounts.models import User
from apps.audit.models import AuditEvent
from apps.notifications.models import Notification, NotificationKind
from apps.organizations.members import change_role, remove_member
from apps.organizations.models import Membership, Organization, Role
from apps.requests import services
from apps.requests.models import ApprovalTask, Request, RequestStatus, TaskStatus
from common.tests.support import login

from .conftest import Demo, create_via_api
from .test_concurrency import run_together
from .test_requests_api import URL, act

pytestmark = pytest.mark.django_db


def submitted_by_maya(demo: Demo, as_user: Callable[[User], APIClient]) -> str:
    maya = as_user(demo.maya)
    rid: str = create_via_api(maya, demo, title="Monitor arms")["id"]
    assert act(maya, rid, "submit").status_code == 200
    maya.post(f"{URL}/{rid}/comments", {"body": "Needed for the new desks."}, format="json")
    return rid


def remove(demo: Demo, user: User, by: User | None = None) -> None:
    remove_member(actor=demo.m(by or demo.olivia), member_id=demo.m(user).pk)


def cancel(client: APIClient, rid: str, **body: Any) -> Any:
    return client.post(f"{URL}/{rid}/cancel", body, format="json")


def test_admin_cancels_a_former_members_request_with_a_reason_and_history_is_kept(
    demo: Demo, as_user: Callable[[User], APIClient]
) -> None:
    rid = submitted_by_maya(demo, as_user)
    adam = as_user(demo.adam)
    before = adam.get(f"{URL}/{rid}").json()["permissions"]
    assert before["can_cancel"] is False  # Maya is still a member: only she can cancel

    remove(demo, demo.maya)
    detail = adam.get(f"{URL}/{rid}").json()
    assert detail["status"] == "in_review"  # the request survives the removal
    assert detail["permissions"]["can_cancel"] is True
    assert detail["permissions"]["cancel_requires_reason"] is True

    missing = cancel(adam, rid)
    assert missing.status_code == 400
    assert missing.json()["errors"]["reason"]
    assert Request.objects.get(pk=rid).status == RequestStatus.IN_REVIEW

    done = cancel(adam, rid, reason="Maya left the company; the purchase is no longer needed.")
    assert done.status_code == 200
    assert done.json()["status"] == "cancelled"
    assert not ApprovalTask.objects.filter(request_id=rid, status=TaskStatus.OPEN).exists()

    event = AuditEvent.objects.get(target_id=rid, verb="request.cancelled")
    assert event.actor_email == demo.adam.email
    assert event.data["reason"] == "Maya left the company; the purchase is no longer needed."
    assert event.data["requester_left"] is True
    verbs = [e["verb"] for e in adam.get(f"{URL}/{rid}/timeline").json()]
    assert verbs[:2] == ["request.created", "request.submitted"]  # earlier history is untouched
    assert [c["body"] for c in adam.get(f"{URL}/{rid}/comments").json()] == ["Needed for the new desks."]
    assert Request.objects.get(pk=rid).requester_id == demo.maya.pk


@pytest.mark.parametrize("who", ["adam", "olivia"])
def test_admins_cannot_cancel_requests_of_active_members(
    demo: Demo, as_user: Callable[[User], APIClient], who: str
) -> None:
    rid = submitted_by_maya(demo, as_user)
    response = cancel(as_user(getattr(demo, who)), rid, reason="Cleaning up the queue.")
    assert response.status_code == 403
    assert Request.objects.get(pk=rid).status == RequestStatus.IN_REVIEW


def test_members_cannot_use_the_exception_even_when_they_can_see_the_request(
    demo: Demo, as_user: Callable[[User], APIClient]
) -> None:
    rid = submitted_by_maya(demo, as_user)
    remove(demo, demo.maya)
    raj = as_user(demo.raj)  # the step 1 approver can see the request
    assert raj.get(f"{URL}/{rid}").json()["permissions"]["can_cancel"] is False
    assert cancel(raj, rid, reason="Not needed").status_code == 403


def test_only_requests_in_review_can_be_cancelled_for_a_former_member(
    demo: Demo, as_user: Callable[[User], APIClient]
) -> None:
    maya = as_user(demo.maya)
    draft = create_via_api(maya, demo, title="Draft")["id"]
    remove(demo, demo.maya)
    adam = as_user(demo.adam)
    assert adam.get(f"{URL}/{draft}").json()["permissions"]["can_cancel"] is False
    assert cancel(adam, draft, reason="Left").status_code == 409


def test_approvers_keep_deciding_after_the_requester_left(
    demo: Demo, as_user: Callable[[User], APIClient]
) -> None:
    rid = submitted_by_maya(demo, as_user)
    remove(demo, demo.maya)
    assert act(as_user(demo.raj), rid, "approve").status_code == 200
    assert act(as_user(demo.adam), rid, "approve").status_code == 200
    assert act(as_user(demo.olivia), rid, "approve").status_code == 200
    assert Request.objects.get(pk=rid).status == RequestStatus.APPROVED


def test_an_admin_of_another_organization_gets_404(
    demo: Demo,
    as_user: Callable[[User], APIClient],
    make_org: Callable[..., Organization],
    member_of: Callable[..., User],
) -> None:
    rid = submitted_by_maya(demo, as_user)
    remove(demo, demo.maya)
    other = make_org("Kestrel")
    outsider = login(APIClient(enforce_csrf_checks=True), member_of(other, Role.OWNER), other)
    assert cancel(outsider, rid, reason="Not mine").status_code == 404
    assert Request.objects.get(pk=rid).status == RequestStatus.IN_REVIEW


def test_a_demoted_admin_cannot_use_the_exception(demo: Demo, as_user: Callable[[User], APIClient]) -> None:
    rid = submitted_by_maya(demo, as_user)
    remove(demo, demo.maya)
    adam = as_user(demo.adam)
    change_role(actor=demo.m(demo.olivia), member_id=demo.m(demo.adam).pk, role=Role.MEMBER)
    assert cancel(adam, rid, reason="Left").status_code in (403, 404)
    assert Request.objects.get(pk=rid).status == RequestStatus.IN_REVIEW


# --- admins are told when a task loses its approver ------------------------------------------------


def needs_admin_notices(demo: Demo, rid: str) -> list[str]:
    return sorted(
        str(n.user.email)
        for n in Notification.objects.filter(request_id=rid, kind=NotificationKind.TASK_NEEDS_ADMIN)
    )


def test_removing_the_named_approver_notifies_admins_once(
    demo: Demo, as_user: Callable[[User], APIClient], member_of: Callable[..., User]
) -> None:
    rid = submitted_by_maya(demo, as_user)  # step 1 belongs to Raj by name
    assert needs_admin_notices(demo, rid) == []

    remove(demo, demo.raj)
    assert needs_admin_notices(demo, rid) == sorted([demo.adam.email, demo.olivia.email])
    adam_view = as_user(demo.adam).get(f"{URL}/{rid}").json()
    assert adam_view["needs_admin"] is True
    assert adam_view["permissions"]["decision"] == "fallback"

    newcomer = member_of(demo.org, Role.MEMBER)
    remove(demo, newcomer)  # an unrelated change does not announce the same task again
    assert len(needs_admin_notices(demo, rid)) == 2


def test_demotions_that_still_leave_an_approver_do_not_notify(
    demo: Demo, as_user: Callable[[User], APIClient]
) -> None:
    rid = submitted_by_maya(demo, as_user)
    assert act(as_user(demo.raj), rid, "approve").status_code == 200  # now at "any admin or above"
    change_role(actor=demo.m(demo.olivia), member_id=demo.m(demo.adam).pk, role=Role.MEMBER)
    assert needs_admin_notices(demo, rid) == []  # Olivia (owner) can still decide the admin step


@pytest.mark.django_db(transaction=True)
def test_cancel_for_a_former_member_and_a_decision_at_once_keep_one_outcome(
    make_org: Callable[..., Organization], member_of: Callable[..., User]
) -> None:
    org = make_org("Orbital")
    owner = Membership.objects.get(organization=org, user=member_of(org, Role.OWNER))
    admin = Membership.objects.get(organization=org, user=member_of(org, Role.ADMIN))
    maya = Membership.objects.get(organization=org, user=member_of(org, Role.MEMBER))
    from apps.workflows.services import StepInput, create_template, publish

    template = create_template(
        actor=owner,
        name="Owner step",
        category="purchase",
        description="",
        steps=[StepInput(name="Owner approval", approver_type="role", approver_role=Role.OWNER)],
    )
    publish(actor=owner, template_id=template.pk)
    req = services.create_request(
        actor=maya,
        template_id=template.pk,
        fields=services.RequestFields(title="Laptop", amount=Decimal("1500"), currency="USD"),
    )
    services.submit(actor=maya, request_id=req.pk, revision=req.revision)
    remove_member(actor=owner, member_id=maya.pk)

    outcomes = run_together(
        lambda: services.cancel(actor=admin, request_id=req.pk, reason="Requester left"),
        lambda: services.decide(actor=owner, request_id=req.pk, step=1, approve=True),
    )
    final = Request.objects.get(pk=req.pk)
    assert outcomes.count("ok") == 1, outcomes
    assert final.status in (RequestStatus.CANCELLED, RequestStatus.APPROVED)
    closing = AuditEvent.objects.filter(target_id=req.pk, verb__in=["request.cancelled", "request.approved"])
    assert closing.count() == 1
