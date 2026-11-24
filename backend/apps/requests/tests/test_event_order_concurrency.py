"""AUD-01 under real concurrency (PostgreSQL, threads).

Commit order itself comes from the request row lock that every request service already takes
(ADR-0006); this test guards the numbering on top of it: under simultaneous writers the numbers
stay unique and gap-free, and the events of one transaction stay together.
"""

from __future__ import annotations

from collections.abc import Callable
from decimal import Decimal

import pytest

from apps.accounts.models import User
from apps.audit.models import AuditEvent
from apps.organizations.models import Membership, Organization, Role
from apps.requests import services
from apps.requests.models import Request
from apps.workflows.services import StepInput, create_template, publish

from .test_concurrency import run_together

pytestmark = pytest.mark.django_db(transaction=True)


def test_a_decision_and_comments_at_the_same_time_are_numbered_once_each(
    make_org: Callable[..., Organization], member_of: Callable[..., User]
) -> None:
    org = make_org("Orbital")
    owner = Membership.objects.get(organization=org, user=member_of(org, Role.OWNER))
    admin = Membership.objects.get(organization=org, user=member_of(org, Role.ADMIN))
    maya = Membership.objects.get(organization=org, user=member_of(org, Role.MEMBER))
    template = create_template(
        actor=owner,
        name="One admin step",
        category="purchase",
        description="",
        steps=[StepInput(name="Admin approval", approver_type="role", approver_role=Role.ADMIN)],
    )
    publish(actor=owner, template_id=template.pk)
    req = services.create_request(
        actor=maya,
        template_id=template.pk,
        fields=services.RequestFields(title="Laptop", amount=Decimal("1500"), currency="USD"),
    )
    services.submit(actor=maya, request_id=req.pk, revision=req.revision)  # events 1 and 2

    outcomes = run_together(
        lambda: services.decide(actor=admin, request_id=req.pk, step=1, approve=True),
        lambda: services.add_comment(actor=maya, request_id=req.pk, body="first"),
        lambda: services.add_comment(actor=admin, request_id=req.pk, body="second"),
        lambda: services.add_comment(actor=owner, request_id=req.pk, body="third"),
    )
    assert outcomes == ["ok"] * 4

    events = list(
        AuditEvent.objects.filter(target_type="request", target_id=req.pk)
        .order_by("request_seq")
        .values_list("request_seq", "verb")
    )
    numbers = [n for n, _ in events]
    assert numbers == list(range(1, 8))  # 2 earlier + 2 for the decision + 3 comments: unique, no gaps
    assert Request.objects.get(pk=req.pk).event_seq == 7
    verbs = [v for _, v in events]
    # The decision's two events come from one transaction holding the row lock: nothing in between.
    approved = verbs.index("task.approved")
    assert verbs[approved + 1] == "request.approved"
    assert verbs.count("comment.added") == 3
