"""AUD-01: events of one request keep their logical order, whatever the wall clock does."""

from __future__ import annotations

from collections.abc import Callable
from datetime import timedelta

import pytest
from django.db import IntegrityError, connection, transaction
from django.utils import timezone
from rest_framework.test import APIClient

from apps.accounts.models import User
from apps.audit.models import AuditEvent
from apps.audit.service import record
from apps.organizations.models import Membership, Organization, Role
from apps.requests import services
from apps.requests.models import Request
from apps.workflows.services import StepInput, create_template, publish
from common.tests.support import login

from .conftest import Demo, create_via_api
from .test_requests_api import URL, act

pytestmark = pytest.mark.django_db


def timeline(client: APIClient, rid: str) -> list[str]:
    return [e["verb"] for e in client.get(f"{URL}/{rid}/timeline").json()]


def test_a_backward_clock_step_does_not_reorder_the_timeline(
    demo: Demo, as_user: Callable[[User], APIClient], monkeypatch: pytest.MonkeyPatch
) -> None:
    """Regression: the wall clock stepped back 500 ms (NTP step, VM or WSL2 clock sync)."""
    maya, raj = as_user(demo.maya), as_user(demo.raj)
    rid = create_via_api(maya, demo)["id"]
    act(maya, rid, "submit")
    real_now = timezone.now
    monkeypatch.setattr(timezone, "now", lambda: real_now() - timedelta(milliseconds=500))
    act(raj, rid, "approve")
    maya.post(f"{URL}/{rid}/comments", {"body": "Thanks"}, format="json")
    assert timeline(maya, rid) == ["request.created", "request.submitted", "task.approved", "comment.added"]


# --- numbering ---------------------------------------------------------------------------------------


def numbered(rid: str) -> list[tuple[int | None, str]]:
    return list(
        AuditEvent.objects.filter(target_type="request", target_id=rid)
        .order_by("request_seq")
        .values_list("request_seq", "verb")
    )


def test_every_request_event_is_numbered_consecutively_and_others_are_not(
    demo: Demo, as_user: Callable[[User], APIClient]
) -> None:
    maya, raj, adam, olivia = (as_user(u) for u in (demo.maya, demo.raj, demo.adam, demo.olivia))
    rid = create_via_api(maya, demo)["id"]
    revision = maya.get(f"{URL}/{rid}").json()["revision"]
    assert (
        maya.patch(f"{URL}/{rid}", {"title": "Laptop 2", "revision": revision}, format="json").status_code
        == 200
    )
    act(maya, rid, "submit")
    maya.post(f"{URL}/{rid}/comments", {"body": "Urgent"}, format="json")
    act(raj, rid, "approve")
    act(adam, rid, "approve")
    act(olivia, rid, "reject", comment="Not this quarter")
    copy = maya.post(f"{URL}/{rid}/duplicate", {}, format="json").json()["id"]
    maya.post(f"{URL}/{copy}/cancel", {}, format="json")

    assert numbered(rid) == [
        (1, "request.created"),
        (2, "request.updated"),
        (3, "request.submitted"),
        (4, "comment.added"),
        (5, "task.approved"),
        (6, "task.approved"),
        (7, "task.rejected"),  # two events in one transaction keep the order they were written in
        (8, "request.rejected"),
    ]
    assert numbered(copy) == [(1, "request.created"), (2, "request.cancelled")]  # per request, from 1
    assert Request.objects.get(pk=rid).event_seq == 8
    others = AuditEvent.objects.exclude(target_type="request")
    assert others.exists()  # template events, for example
    assert not others.filter(request_seq__isnull=False).exists()
    assert timeline(maya, rid) == [verb for _, verb in numbered(rid)]


def test_a_stale_save_cannot_rewind_the_counter(demo: Demo, as_user: Callable[[User], APIClient]) -> None:
    maya = as_user(demo.maya)
    rid = create_via_api(maya, demo)["id"]
    act(maya, rid, "submit")
    stale = Request.objects.get(pk=rid)  # event_seq == 2 in memory
    maya.post(f"{URL}/{rid}/comments", {"body": "One"}, format="json")  # the database is now at 3
    stale.description = "edited by an old instance"
    stale.save()  # a full save of the old instance
    assert Request.objects.get(pk=rid).event_seq == 3
    stale.save(update_fields=["description", "event_seq"])  # even when named explicitly
    assert Request.objects.get(pk=rid).event_seq == 3
    stale.refresh_from_db()
    assert stale.event_seq == 3
    assert maya.post(f"{URL}/{rid}/comments", {"body": "Two"}, format="json").status_code == 201
    assert [seq for seq, _ in numbered(rid)] == [1, 2, 3, 4]


def test_a_rolled_back_event_leaves_no_gap(
    demo: Demo, as_user: Callable[[User], APIClient], monkeypatch: pytest.MonkeyPatch
) -> None:
    maya = as_user(demo.maya)
    rid = create_via_api(maya, demo)["id"]
    act(maya, rid, "submit")

    def notify_fails(**kwargs: object) -> int:  # fails after the comment event was numbered
        raise RuntimeError("notifications unavailable")

    monkeypatch.setattr(services, "notify", notify_fails)
    with pytest.raises(RuntimeError):
        services.add_comment(actor=demo.m(demo.maya), request_id=rid, body="Lost")
    monkeypatch.undo()
    assert Request.objects.get(pk=rid).event_seq == 2
    maya.post(f"{URL}/{rid}/comments", {"body": "Kept"}, format="json")
    assert [seq for seq, _ in numbered(rid)] == [1, 2, 3]


def test_historical_events_without_a_number_come_first_in_their_own_time_order(
    demo: Demo, as_user: Callable[[User], APIClient], monkeypatch: pytest.MonkeyPatch
) -> None:
    maya = as_user(demo.maya)
    rid = create_via_api(maya, demo)["id"]
    with connection.cursor() as cursor:  # events written before the migration had no number
        cursor.execute("SET CONSTRAINTS ALL IMMEDIATE")  # flush deferred FK checks before the DDL
        cursor.execute("ALTER TABLE audit_auditevent DROP CONSTRAINT audit_request_event_numbered")
    real_now = timezone.now
    for verb, days in (("legacy.second", 1), ("legacy.first", 2)):
        monkeypatch.setattr(timezone, "now", lambda d=days: real_now() - timedelta(days=d))
        AuditEvent.objects.create(
            organization=demo.org, actor_email="", verb=verb, target_type="request", target_id=rid
        )
    monkeypatch.undo()
    act(maya, rid, "submit")
    assert timeline(maya, rid) == ["legacy.first", "legacy.second", "request.created", "request.submitted"]
    assert AuditEvent.objects.filter(target_id=rid, request_seq__isnull=True).count() == 2  # untouched


def test_the_database_rejects_inconsistent_numbers(demo: Demo, as_user: Callable[[User], APIClient]) -> None:
    rid = create_via_api(as_user(demo.maya), demo)["id"]  # event 1
    base = {"organization": demo.org, "actor_email": "", "verb": "x.y"}
    for bad in (
        {"target_type": "request", "target_id": rid, "request_seq": 1},  # duplicate position
        {"target_type": "membership", "target_id": rid, "request_seq": 9},  # number on a non-request event
        {"target_type": "request", "target_id": rid, "request_seq": None},  # new request event, no number
    ):
        with pytest.raises(IntegrityError), transaction.atomic():
            AuditEvent.objects.create(**base, **bad)
    with pytest.raises(RuntimeError), transaction.atomic():  # and the application refuses it earlier
        record(organization=demo.org, actor=None, verb="x.y", target_type="request", target_id=rid)


def test_numbers_are_per_request_and_timelines_stay_in_their_organization(
    demo: Demo,
    as_user: Callable[[User], APIClient],
    make_org: Callable[..., Organization],
    member_of: Callable[..., User],
) -> None:
    rid = create_via_api(as_user(demo.maya), demo)["id"]
    other = make_org("Kestrel")
    owner = Membership.objects.get(organization=other, user=member_of(other, Role.OWNER))
    member = Membership.objects.get(organization=other, user=member_of(other, Role.MEMBER))
    template = create_template(
        actor=owner,
        name="Other",
        category="other",
        description="",
        steps=[StepInput(name="Owner", approver_type="role", approver_role=Role.OWNER)],
    )
    publish(actor=owner, template_id=template.pk)
    theirs = services.create_request(
        actor=member, template_id=template.pk, fields=services.RequestFields(title="Theirs")
    )
    assert numbered(str(theirs.pk)) == [(1, "request.created")]
    assert numbered(rid) == [(1, "request.created")]
    outsider = login(APIClient(enforce_csrf_checks=True), owner.user, other)
    assert outsider.get(f"{URL}/{rid}/timeline").status_code == 404
