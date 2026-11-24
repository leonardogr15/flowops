"""Concurrent operations against real PostgreSQL (transactional tests, real threads)."""

from __future__ import annotations

import threading
from collections.abc import Callable
from decimal import Decimal

import pytest
from django.db import connection

from apps.accounts.models import User
from apps.audit.models import AuditEvent
from apps.organizations.models import Membership, Organization, Role
from apps.requests import services
from apps.requests.models import ApprovalTask, Request, RequestStatus
from apps.workflows.services import StepInput, create_template, publish

pytestmark = pytest.mark.django_db(transaction=True)


def run_together(*calls: Callable[[], object]) -> list[str]:
    """Runs the calls at the same instant in separate threads; returns 'ok' or the exception name."""
    barrier = threading.Barrier(len(calls))
    results: list[str] = []
    lock = threading.Lock()

    def worker(call: Callable[[], object]) -> None:
        barrier.wait()
        try:
            call()
            outcome = "ok"
        except Exception as exc:
            outcome = type(exc).__name__
        finally:
            connection.close()
        with lock:
            results.append(outcome)

    threads = [threading.Thread(target=worker, args=(c,)) for c in calls]
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    return sorted(results)


@pytest.fixture
def setup(make_org: Callable[..., Organization], member_of: Callable[..., User]) -> dict[str, Membership]:
    org = make_org("Orbital")
    people = {
        "owner": member_of(org, Role.OWNER),
        "admin_a": member_of(org, Role.ADMIN),
        "admin_b": member_of(org, Role.ADMIN),
        "maya": member_of(org, Role.MEMBER),
    }
    ms = {k: Membership.objects.get(organization=org, user=u) for k, u in people.items()}
    template = create_template(
        actor=ms["owner"],
        name="Single admin step",
        category="purchase",
        description="",
        steps=[StepInput(name="Admin approval", approver_type="role", approver_role=Role.ADMIN)],
    )
    publish(actor=ms["owner"], template_id=template.pk)
    req = services.create_request(
        actor=ms["maya"],
        template_id=template.pk,
        fields=services.RequestFields(title="Laptop", amount=Decimal("1500"), currency="USD"),
    )
    ms["request_id"] = req.pk  # type: ignore[assignment]
    return ms


def test_two_approvers_deciding_at_once_produce_exactly_one_decision(setup: dict[str, Membership]) -> None:
    rid = setup["request_id"]
    services.submit(actor=setup["maya"], request_id=rid)  # type: ignore[arg-type]
    outcomes = run_together(
        lambda: services.decide(actor=setup["admin_a"], request_id=rid, approve=True),  # type: ignore[arg-type]
        lambda: services.decide(actor=setup["admin_b"], request_id=rid, approve=True),  # type: ignore[arg-type]
    )
    assert outcomes == ["InvalidTransition", "ok"]  # the loser sees the request already closed (409)
    assert ApprovalTask.objects.filter(request_id=rid, status="approved").count() == 1
    assert AuditEvent.objects.filter(target_id=rid, verb="task.approved").count() == 1
    assert Request.objects.get(pk=rid).status == RequestStatus.APPROVED


def test_approve_and_reject_at_once_keep_a_single_outcome(setup: dict[str, Membership]) -> None:
    rid = setup["request_id"]
    services.submit(actor=setup["maya"], request_id=rid)  # type: ignore[arg-type]
    outcomes = run_together(
        lambda: services.decide(actor=setup["admin_a"], request_id=rid, approve=True),  # type: ignore[arg-type]
        lambda: services.decide(actor=setup["admin_b"], request_id=rid, approve=False, comment="no"),  # type: ignore[arg-type]
    )
    assert outcomes == ["InvalidTransition", "ok"]
    decided = ApprovalTask.objects.filter(request_id=rid).exclude(status="open")
    assert decided.count() == 1
    status = Request.objects.get(pk=rid).status
    assert status == (
        RequestStatus.APPROVED if decided.get().status == "approved" else RequestStatus.REJECTED
    )


def test_double_submit_creates_one_route(setup: dict[str, Membership]) -> None:
    rid = setup["request_id"]
    outcomes = run_together(
        lambda: services.submit(actor=setup["maya"], request_id=rid),  # type: ignore[arg-type]
        lambda: services.submit(actor=setup["maya"], request_id=rid),  # type: ignore[arg-type]
    )
    assert outcomes == ["InvalidTransition", "ok"]
    assert ApprovalTask.objects.filter(request_id=rid).count() == 1
    assert AuditEvent.objects.filter(target_id=rid, verb="request.submitted").count() == 1


def test_cancel_and_approve_at_once_never_mix(setup: dict[str, Membership]) -> None:
    rid = setup["request_id"]
    services.submit(actor=setup["maya"], request_id=rid)  # type: ignore[arg-type]
    outcomes = run_together(
        lambda: services.cancel(actor=setup["maya"], request_id=rid),  # type: ignore[arg-type]
        lambda: services.decide(actor=setup["admin_a"], request_id=rid, approve=True),  # type: ignore[arg-type]
    )
    assert outcomes == ["InvalidTransition", "ok"]
    req = Request.objects.get(pk=rid)
    task = ApprovalTask.objects.get(request_id=rid)
    assert (req.status, task.status) in {
        (RequestStatus.CANCELLED, "cancelled"),
        (RequestStatus.APPROVED, "approved"),
    }
