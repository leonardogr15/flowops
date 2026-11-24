"""Batch 3a: requests, approvals, visibility, version pinning and fallback decisions."""

from __future__ import annotations

from collections.abc import Callable
from typing import Any

import pytest
from rest_framework.test import APIClient

from apps.accounts.models import User
from apps.audit.models import AuditEvent
from apps.notifications.models import Notification
from apps.organizations.models import Membership, Role
from apps.requests.models import ApprovalTask, Request, RequestStatus
from apps.workflows.models import VersionStatus
from apps.workflows.services import StepInput, create_template, publish, save_draft

from .conftest import Demo, create_via_api

pytestmark = pytest.mark.django_db
URL = "/api/v1/org/requests"


def act(client: APIClient, rid: str, action: str, **body: Any) -> Any:
    return client.post(f"{URL}/{rid}/{action}", body, format="json")


# --- the demo flow -----------------------------------------------------------------------------


def test_full_flow_maya_raj_adam_olivia(demo: Demo, as_user: Callable[[User], APIClient]) -> None:
    maya, raj, adam, olivia = (as_user(u) for u in (demo.maya, demo.raj, demo.adam, demo.olivia))
    rid = create_via_api(maya, demo)["id"]
    submitted = act(maya, rid, "submit").json()
    assert (submitted["status"], submitted["current_step"], submitted["version"]) == ("in_review", 1, 1)

    assert act(raj, rid, "approve").json()["current_step"] == 2
    assert act(adam, rid, "approve").json()["current_step"] == 3
    final = act(olivia, rid, "approve", comment="Approved for Q4").json()
    assert final["status"] == "approved"
    assert [(t["step_order"], t["status"], t["decided_by"]["email"]) for t in final["tasks"]] == [
        (1, "approved", demo.raj.email),
        (2, "approved", demo.adam.email),
        (3, "approved", demo.olivia.email),
    ]

    timeline = [e["verb"] for e in maya.get(f"{URL}/{rid}/timeline").json()]
    assert timeline == [
        "request.created",
        "request.submitted",
        "task.approved",
        "task.approved",
        "task.approved",
        "request.approved",
    ]
    assert Notification.objects.filter(user=demo.maya, kind="request_approved", request_id=rid).count() == 1
    assert Notification.objects.filter(user=demo.raj, kind="task_assigned", request_id=rid).count() == 1


def test_rejection_closes_the_request_and_requires_a_comment(
    demo: Demo, as_user: Callable[[User], APIClient]
) -> None:
    maya, raj = as_user(demo.maya), as_user(demo.raj)
    rid = create_via_api(maya, demo)["id"]
    act(maya, rid, "submit")
    missing = act(raj, rid, "reject")
    assert missing.status_code == 400
    assert "comment" in missing.json()["errors"]
    rejected = act(raj, rid, "reject", comment="Out of budget")
    assert rejected.json()["status"] == "rejected"
    assert act(as_user(demo.adam), rid, "approve").status_code == 409  # closed
    assert Notification.objects.filter(user=demo.maya, kind="request_rejected").count() == 1

    # D-B3-3: a rejected request is duplicated, never reopened
    copy = act(maya, rid, "duplicate")
    assert copy.status_code == 201
    assert (copy.json()["status"], copy.json()["duplicated_from"], copy.json()["title"]) == (
        "draft",
        rid,
        "Laptop",
    )
    assert Request.objects.get(pk=rid).status == RequestStatus.REJECTED


# --- self-approval and step order ---------------------------------------------------------------


@pytest.mark.parametrize("requester_role", [Role.ADMIN, Role.OWNER])
def test_nobody_approves_their_own_request_whatever_their_role(
    demo: Demo, as_user: Callable[[User], APIClient], member_of: Callable[..., User], requester_role: str
) -> None:
    requester = demo.adam if requester_role == Role.ADMIN else demo.olivia
    if requester_role == Role.OWNER:  # step 3 needs an owner other than the requester (D-B3-2)
        member_of(demo.org, Role.OWNER, full_name="Second Owner")
    client = as_user(requester)
    rid = create_via_api(client, demo)["id"]
    assert act(client, rid, "submit").status_code == 200
    act(as_user(demo.raj), rid, "approve")  # step 1 done by Raj
    for action in ("approve", "reject"):
        response = act(client, rid, action, comment="mine")
        assert response.status_code == 403
        assert response.json()["detail"] == "You can't decide your own request."
    assert ApprovalTask.objects.get(request_id=rid, step_order=2).status == "open"


def test_submit_fails_with_422_when_only_the_requester_could_approve(
    demo: Demo, as_user: Callable[[User], APIClient]
) -> None:
    flow = create_template(
        actor=demo.m(demo.adam),
        name="Raj only",
        category="other",
        description="",
        steps=[StepInput(name="Raj decides", approver_type="user", approver_user=demo.raj.pk)],
    )
    publish(actor=demo.m(demo.adam), template_id=flow.pk)
    raj = as_user(demo.raj)
    rid = create_via_api(raj, demo, template=str(flow.pk))["id"]
    response = act(raj, rid, "submit")
    assert response.status_code == 422
    assert response.json()["errors"]["steps"] == ["No one other than you can approve this step: Raj decides."]
    assert Request.objects.get(pk=rid).status == RequestStatus.DRAFT


def test_steps_cannot_be_skipped(demo: Demo, as_user: Callable[[User], APIClient]) -> None:
    maya = as_user(demo.maya)
    rid = create_via_api(maya, demo)["id"]
    act(maya, rid, "submit")
    # Adam and Olivia are approvers of later steps, not of step 1 (Raj is still eligible).
    for user in (demo.adam, demo.olivia):
        assert act(as_user(user), rid, "approve").status_code == 403
    assert Request.objects.get(pk=rid).current_step == 1


def test_a_decided_step_cannot_be_decided_again(demo: Demo, as_user: Callable[[User], APIClient]) -> None:
    maya, raj = as_user(demo.maya), as_user(demo.raj)
    rid = create_via_api(maya, demo)["id"]
    act(maya, rid, "submit")
    assert act(raj, rid, "approve").status_code == 200
    again = act(raj, rid, "approve")
    assert again.status_code == 403  # step 2 is not Raj's; step 1 is closed
    assert ApprovalTask.objects.filter(request_id=rid, status="approved").count() == 1


# --- state machine -------------------------------------------------------------------------------


@pytest.mark.parametrize(
    ("setup", "action", "expected"),
    [
        ("draft", "approve", 409),
        ("draft", "reject", 409),
        ("draft", "duplicate", 409),
        ("in_review", "submit", 409),
        ("approved", "cancel", 409),
        ("approved", "submit", 409),
        ("rejected", "cancel", 409),
        ("cancelled", "submit", 409),
        ("cancelled", "cancel", 409),
        ("draft", "cancel", 200),
        ("in_review", "cancel", 200),
    ],
)
def test_actions_by_state(
    demo: Demo, as_user: Callable[[User], APIClient], setup: str, action: str, expected: int
) -> None:
    maya, raj, adam, olivia = (as_user(u) for u in (demo.maya, demo.raj, demo.adam, demo.olivia))
    rid = create_via_api(maya, demo)["id"]
    if setup in ("in_review", "approved", "rejected"):
        act(maya, rid, "submit")
    if setup == "approved":
        for client in (raj, adam, olivia):
            act(client, rid, "approve")
    if setup == "rejected":
        act(raj, rid, "reject", comment="no")
    if setup == "cancelled":
        act(maya, rid, "cancel")
    # Deciders: Adam can see drafts (admin) so the state check, not visibility, answers.
    actor = maya if action in ("submit", "cancel", "duplicate") else (adam if setup == "draft" else raj)
    response = act(actor, rid, action, comment="c")
    assert response.status_code == expected, response.content


def test_transition_table_is_exhaustive() -> None:
    from apps.requests.services import ALLOWED, InvalidTransition, _transition

    for source in RequestStatus.values:
        for target in RequestStatus.values:
            req = Request(status=source)
            if target in ALLOWED[RequestStatus(source)]:
                _transition(req, target)
                assert req.status == target
            else:
                with pytest.raises(InvalidTransition):
                    _transition(req, target)


def test_cancel_closes_the_open_task(demo: Demo, as_user: Callable[[User], APIClient]) -> None:
    maya = as_user(demo.maya)
    rid = create_via_api(maya, demo)["id"]
    act(maya, rid, "submit")
    assert act(maya, rid, "cancel").json()["status"] == "cancelled"
    assert list(ApprovalTask.objects.filter(request_id=rid).values_list("status", flat=True)) == ["cancelled"]
    assert act(as_user(demo.raj), rid, "approve").status_code in (403, 404, 409)


# --- drafts, validation and optimistic locking ---------------------------------------------------


@pytest.mark.parametrize(
    ("overrides", "field"),
    [
        ({"amount": "10.00", "currency": ""}, "currency"),
        ({"amount": "10.00", "currency": "XYZ"}, "currency"),
        ({"amount": None, "currency": "USD"}, "amount"),
        ({"amount": "-1.00", "currency": "USD"}, "amount"),
        ({"title": "a"}, "title"),
    ],
)
def test_amount_currency_and_title_validation(
    demo: Demo, as_user: Callable[[User], APIClient], overrides: dict[str, Any], field: str
) -> None:
    body = {
        "template": str(demo.template.pk),
        "title": "Valid title",
        "amount": "1.00",
        "currency": "USD",
        **overrides,
    }
    response = as_user(demo.maya).post(URL, body, format="json")
    assert response.status_code == 400
    assert field in response.json()["errors"]


def test_amount_is_optional_and_currency_normalized(demo: Demo, as_user: Callable[[User], APIClient]) -> None:
    no_amount = create_via_api(as_user(demo.maya), demo, amount=None, currency="")
    assert (no_amount["amount"], no_amount["currency"]) == (None, "")
    lower = create_via_api(as_user(demo.maya), demo, currency="eur")
    assert lower["currency"] == "EUR"


def test_only_published_workflows_can_be_used(demo: Demo, as_user: Callable[[User], APIClient]) -> None:
    draft_only = create_template(
        actor=demo.m(demo.adam),
        name="Draft only",
        category="other",
        description="",
        steps=[StepInput(name="x step", approver_type="role", approver_role=Role.ADMIN)],
    )
    response = as_user(demo.maya).post(URL, {"template": str(draft_only.pk), "title": "Nope"}, format="json")
    assert response.status_code == 404


def test_concurrent_draft_edits_use_the_revision(demo: Demo, as_user: Callable[[User], APIClient]) -> None:
    maya = as_user(demo.maya)
    draft = create_via_api(maya, demo)
    first = maya.patch(
        f"{URL}/{draft['id']}", {"title": "New title", "revision": draft["revision"]}, format="json"
    )
    assert first.status_code == 200
    assert first.json()["revision"] == draft["revision"] + 1
    stale = maya.patch(
        f"{URL}/{draft['id']}", {"title": "Other title", "revision": draft["revision"]}, format="json"
    )
    assert stale.status_code == 409
    assert Request.objects.get(pk=draft["id"]).title == "New title"


def test_only_the_requester_edits_or_submits(demo: Demo, as_user: Callable[[User], APIClient]) -> None:
    draft = create_via_api(as_user(demo.maya), demo)
    adam = as_user(demo.adam)  # admins can see the draft...
    assert adam.get(f"{URL}/{draft['id']}").status_code == 200
    assert (
        adam.patch(f"{URL}/{draft['id']}", {"title": "Mine now", "revision": 1}, format="json").status_code
        == 403
    )
    assert act(adam, draft["id"], "submit").status_code == 403  # ...but not act on it


# --- A1: version pinning -------------------------------------------------------------------------


def _republish(demo: Demo) -> None:
    save_draft(
        actor=demo.m(demo.adam),
        template_id=demo.template.pk,
        steps=[StepInput(name="Single admin step", approver_type="role", approver_role=Role.ADMIN)],
    )
    publish(actor=demo.m(demo.adam), template_id=demo.template.pk)


def test_draft_is_submitted_with_the_version_published_at_submit_time(
    demo: Demo, as_user: Callable[[User], APIClient]
) -> None:
    maya = as_user(demo.maya)
    rid = create_via_api(maya, demo)["id"]
    _republish(demo)  # v2 has a single admin step
    submitted = act(maya, rid, "submit").json()
    assert submitted["version"] == 2
    assert [t["step_name"] for t in submitted["tasks"]] == ["Single admin step"]


def test_publishing_a_new_version_does_not_change_requests_in_review(
    demo: Demo, as_user: Callable[[User], APIClient]
) -> None:
    maya = as_user(demo.maya)
    rid = create_via_api(maya, demo)["id"]
    act(maya, rid, "submit")
    _republish(demo)
    req = Request.objects.get(pk=rid)
    assert req.template_version.number == 1  # type: ignore[union-attr]
    assert req.template_version.status == VersionStatus.ARCHIVED  # type: ignore[union-attr]
    act(as_user(demo.raj), rid, "approve")
    assert ApprovalTask.objects.get(request_id=rid, step_order=2).step_name == "Finance review"  # v1 route


# --- A2: approver leaves or changes role --------------------------------------------------------


def test_designated_approver_leaving_hands_the_step_to_admins(
    demo: Demo, as_user: Callable[[User], APIClient]
) -> None:
    maya, adam = as_user(demo.maya), as_user(demo.adam)
    rid = create_via_api(maya, demo)["id"]
    act(maya, rid, "submit")
    Membership.objects.filter(organization=demo.org, user=demo.raj).delete()

    detail = adam.get(f"{URL}/{rid}").json()
    assert detail["needs_admin"] is True
    assert detail["permissions"]["decision"] == "fallback"
    assert [i["request"]["id"] for i in adam.get("/api/v1/org/inbox").json()] == [rid]
    assert act(maya, rid, "approve").status_code == 403  # still not the requester
    without_reason = act(adam, rid, "approve")
    assert without_reason.status_code == 400
    assert "comment" in without_reason.json()["errors"]
    done = act(adam, rid, "approve", comment="Raj left the company; approving as finance lead")
    assert done.json()["current_step"] == 2
    task = ApprovalTask.objects.get(request_id=rid, step_order=1)
    assert (task.fallback, task.decided_by_id) == (True, demo.adam.pk)
    event = AuditEvent.objects.get(target_id=rid, verb="task.approved")
    assert event.data["fallback"] is True


def test_role_changes_are_evaluated_at_decision_time(
    demo: Demo, as_user: Callable[[User], APIClient]
) -> None:
    maya = as_user(demo.maya)
    rid = create_via_api(maya, demo)["id"]
    act(maya, rid, "submit")
    act(as_user(demo.raj), rid, "approve")
    Membership.objects.filter(organization=demo.org, user=demo.adam).update(role=Role.MEMBER)  # demoted
    assert act(as_user(demo.adam), rid, "approve").status_code == 404  # no longer sees it
    detail = as_user(demo.olivia).get(f"{URL}/{rid}").json()
    assert (detail["needs_admin"], detail["permissions"]["decision"]) == (False, "regular")  # owner >= admin
    assert act(as_user(demo.olivia), rid, "approve").status_code == 200


# --- A3: viewing versus deciding -----------------------------------------------------------------


def test_visibility_rules(
    demo: Demo, as_user: Callable[[User], APIClient], member_of: Callable[..., User]
) -> None:
    outsider = member_of(demo.org, Role.MEMBER)
    future = member_of(demo.org, Role.MEMBER, full_name="Zoe Later")
    flow = create_template(
        actor=demo.m(demo.adam),
        name="Two people",
        category="other",
        description="",
        steps=[
            StepInput(name="Raj first", approver_type="user", approver_user=demo.raj.pk),
            StepInput(name="Zoe second", approver_type="user", approver_user=future.pk),
        ],
    )
    publish(actor=demo.m(demo.adam), template_id=flow.pk)
    maya = as_user(demo.maya)
    rid = create_via_api(maya, demo, template=str(flow.pk))["id"]

    raj, zoe, other = as_user(demo.raj), as_user(future), as_user(outsider)
    assert raj.get(f"{URL}/{rid}").status_code == 404  # draft: only requester and admins
    act(maya, rid, "submit")
    assert raj.get(f"{URL}/{rid}").status_code == 200  # can decide now
    assert zoe.get(f"{URL}/{rid}").status_code == 404  # future step: not yet
    act(raj, rid, "approve")
    assert raj.get(f"{URL}/{rid}").json()["permissions"]["decision"] is None  # participated: view only
    assert act(raj, rid, "approve").status_code == 403
    assert zoe.get(f"{URL}/{rid}").status_code == 200  # reached Zoe
    for path in ("", "/timeline", "/comments"):
        assert other.get(f"{URL}/{rid}{path}").status_code == 404
    assert other.post(f"{URL}/{rid}/comments", {"body": "hi"}, format="json").status_code == 404
    assert [r["id"] for r in other.get(f"{URL}?scope=all").json()["results"]] == []
    assert rid in [r["id"] for r in as_user(demo.adam).get(f"{URL}?scope=all").json()["results"]]


def test_list_scopes(demo: Demo, as_user: Callable[[User], APIClient]) -> None:
    maya = as_user(demo.maya)
    mine = create_via_api(maya, demo)["id"]
    act(maya, mine, "submit")
    other = create_via_api(as_user(demo.adam), demo, title="Adam's request")["id"]
    act(as_user(demo.adam), other, "submit")
    raj = as_user(demo.raj)
    assert raj.get(URL).json()["results"] == []  # scope=mine by default
    assert {r["id"] for r in raj.get(f"{URL}?scope=all").json()["results"]} == {mine, other}  # both need Raj
    assert [r["id"] for r in maya.get(f"{URL}?scope=all&status=in_review").json()["results"]] == [mine]


# --- comments and notifications ------------------------------------------------------------------


def test_comments_are_plain_text_and_notify_participants(
    demo: Demo, as_user: Callable[[User], APIClient]
) -> None:
    maya, raj = as_user(demo.maya), as_user(demo.raj)
    rid = create_via_api(maya, demo)["id"]
    act(maya, rid, "submit")
    act(raj, rid, "approve")
    posted = raj.post(f"{URL}/{rid}/comments", {"body": "<b>See quote</b>"}, format="json")
    assert posted.status_code == 201
    assert (
        maya.get(f"{URL}/{rid}/comments").json()[0]["body"] == "<b>See quote</b>"
    )  # stored as text, escaped by UI
    assert Notification.objects.filter(user=demo.maya, kind="comment_added").count() == 1
    assert raj.post(f"{URL}/{rid}/comments", {"body": "   "}, format="json").status_code == 400


def test_notifications_are_private(demo: Demo, as_user: Callable[[User], APIClient]) -> None:
    maya = as_user(demo.maya)
    rid = create_via_api(maya, demo)["id"]
    act(maya, rid, "submit")
    raj = as_user(demo.raj)
    mine = raj.get("/api/v1/org/notifications").json()["results"]
    assert [n["kind"] for n in mine] == ["task_assigned"]
    assert raj.get("/api/v1/org/notifications/unread").json() == {"unread": 1}
    assert maya.post(f"/api/v1/org/notifications/{mine[0]['id']}/read").status_code == 404  # not Maya's
    assert raj.post(f"/api/v1/org/notifications/{mine[0]['id']}/read").status_code == 204
    assert raj.get("/api/v1/org/notifications/unread").json() == {"unread": 0}


def test_inbox_lists_decidable_tasks_without_n_plus_one(
    demo: Demo, as_user: Callable[[User], APIClient], django_assert_max_num_queries: Callable[..., Any]
) -> None:
    maya = as_user(demo.maya)
    for i in range(4):
        rid = create_via_api(maya, demo, title=f"Request {i}")["id"]
        act(maya, rid, "submit")
    raj = as_user(demo.raj)
    with django_assert_max_num_queries(8):
        items = raj.get("/api/v1/org/inbox").json()
    assert len(items) == 4
    assert all(i["needs_admin"] is False for i in items)
    assert as_user(demo.adam).get("/api/v1/org/inbox").json() == []  # step 1 belongs to Raj
