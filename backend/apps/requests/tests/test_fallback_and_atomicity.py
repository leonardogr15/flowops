"""Fallback decisions never allow self-approval; state changes and audit events commit together."""

from __future__ import annotations

from collections.abc import Callable
from decimal import Decimal

import pytest
from rest_framework.test import APIClient

from apps.accounts.models import User
from apps.audit.models import AuditEvent
from apps.organizations.models import Membership, Organization, Role
from apps.requests import services
from apps.requests.models import ApprovalTask, Request, RequestStatus
from apps.workflows.services import StepInput, create_template, publish
from common.tests.support import login

pytestmark = pytest.mark.django_db
URL = "/api/v1/org/requests"


def _setup(make_org: Callable[..., Organization], member_of: Callable[..., User], *, extra_admin: bool):
    """Raj (member) must approve; the requester is the organization's admin and owner."""
    org = make_org("Solo")
    boss = member_of(org, Role.OWNER, full_name="Boss Owner")
    raj = member_of(org, Role.MEMBER, full_name="Raj Approver")
    other_admin = member_of(org, Role.ADMIN, full_name="Other Admin") if extra_admin else None
    actor = Membership.objects.get(organization=org, user=boss)
    flow = create_template(
        actor=actor,
        name="Raj approves",
        category="purchase",
        description="",
        steps=[StepInput(name="Raj decides", approver_type="user", approver_user=raj.pk)],
    )
    publish(actor=actor, template_id=flow.pk)
    req = services.create_request(
        actor=actor,
        template_id=flow.pk,
        fields=services.RequestFields(title="Owner's purchase", amount=Decimal("5000"), currency="USD"),
    )
    services.submit(actor=actor, request_id=req.pk, revision=req.revision)
    Membership.objects.filter(organization=org, user=raj).delete()  # the only approver leaves
    return org, boss, other_admin, req


def _post(client: APIClient, rid: object, action: str, comment: str = "") -> object:
    return client.post(f"{URL}/{rid}/{action}", {"step": 1, "comment": comment}, format="json")


def test_fallback_never_lets_the_requester_decide_even_as_owner(
    make_org: Callable[..., Organization], member_of: Callable[..., User]
) -> None:
    org, boss, other_admin, req = _setup(make_org, member_of, extra_admin=True)
    owner_client = login(APIClient(enforce_csrf_checks=True), boss, org)
    for action in ("approve", "reject"):
        response = _post(owner_client, req.pk, action, comment="I approve my own purchase")
        assert response.status_code == 403  # type: ignore[attr-defined]
    assert owner_client.get("/api/v1/org/inbox").json()["results"] == []
    detail = owner_client.get(f"{URL}/{req.pk}").json()
    assert (detail["needs_admin"], detail["permissions"]["decision"]) == (True, None)

    assert other_admin is not None
    admin_client = login(APIClient(enforce_csrf_checks=True), other_admin, org)
    assert admin_client.get(f"{URL}/{req.pk}").json()["permissions"]["decision"] == "fallback"
    decided = _post(admin_client, req.pk, "approve", comment="Raj left; approved by finance admin")
    assert decided.json()["status"] == "approved"  # type: ignore[attr-defined]
    event = AuditEvent.objects.get(target_id=req.pk, verb="task.approved")
    assert (event.actor_id, event.data["fallback"]) == (other_admin.pk, True)
    assert ApprovalTask.objects.get(request=req).fallback is True


def test_without_another_admin_the_task_waits_and_only_cancel_is_possible(
    make_org: Callable[..., Organization], member_of: Callable[..., User]
) -> None:
    org, boss, _, req = _setup(make_org, member_of, extra_admin=False)
    client = login(APIClient(enforce_csrf_checks=True), boss, org)
    assert _post(client, req.pk, "approve", comment="no one else is left").status_code == 403  # type: ignore[attr-defined]
    assert Request.objects.get(pk=req.pk).status == RequestStatus.IN_REVIEW
    assert ApprovalTask.objects.get(request=req).status == "open"
    assert client.post(f"{URL}/{req.pk}/cancel", {}, format="json").json()["status"] == "cancelled"


def test_a_failed_audit_write_rolls_back_the_decision(
    make_org: Callable[..., Organization], member_of: Callable[..., User], monkeypatch: pytest.MonkeyPatch
) -> None:
    org, _, other_admin, req = _setup(make_org, member_of, extra_admin=True)
    assert other_admin is not None
    actor = Membership.objects.get(organization=org, user=other_admin)
    before = AuditEvent.objects.count()

    def audit_fails(*args: object, **kwargs: object) -> None:  # fails after task.approved was written
        raise RuntimeError("audit store unavailable")

    monkeypatch.setattr(services, "_audit", audit_fails)
    with pytest.raises(RuntimeError):
        services.decide(actor=actor, request_id=req.pk, step=1, approve=True, comment="fallback")
    req.refresh_from_db()
    task = ApprovalTask.objects.get(request=req)
    assert (req.status, task.status, task.decided_by_id) == (RequestStatus.IN_REVIEW, "open", None)
    assert AuditEvent.objects.count() == before  # the task.approved event was rolled back too
