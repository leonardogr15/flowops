"""Append-only audit log: recording, protection layers and read access."""

from __future__ import annotations

from collections.abc import Callable

import pytest
from django.db import DatabaseError, connection, transaction
from rest_framework.test import APIClient

from apps.accounts.models import User
from apps.audit.models import AuditEvent, AuditEventImmutable
from apps.audit.service import record
from apps.organizations.members import change_role, invite, remove_member, revoke_invitation
from apps.organizations.models import Membership, Organization, Role
from apps.workflows.services import StepInput, create_template, publish, save_draft
from common.tests.support import login

pytestmark = pytest.mark.django_db


@pytest.fixture
def event(make_org: Callable[..., Organization], make_user: Callable[..., User]) -> AuditEvent:
    org = make_org()
    with transaction.atomic():
        return record(
            organization=org, actor=make_user(), verb="test.event", target_type="x", target_id=org.pk
        )


def test_events_are_written_in_the_same_transaction(make_org: Callable[..., Organization]) -> None:
    org = make_org()

    def change_that_fails() -> None:
        with transaction.atomic():
            record(organization=org, actor=None, verb="test.rolled_back", target_type="x", target_id=org.pk)
            raise RuntimeError("the change failed")

    with pytest.raises(RuntimeError):
        change_that_fails()
    assert not AuditEvent.objects.filter(verb="test.rolled_back").exists()


def test_the_model_refuses_updates_and_deletes(event: AuditEvent) -> None:
    event.verb = "tampered"
    with pytest.raises(AuditEventImmutable):
        event.save()
    with pytest.raises(AuditEventImmutable):
        event.delete()


@pytest.mark.parametrize(
    "sql",
    [
        "UPDATE audit_auditevent SET verb = 'tampered' WHERE id = %s",
        "DELETE FROM audit_auditevent WHERE id = %s",
    ],
    ids=["update", "delete"],
)
def test_the_database_trigger_rejects_raw_sql(event: AuditEvent, sql: str) -> None:
    with (
        pytest.raises(DatabaseError, match="append-only"),
        transaction.atomic(),
        connection.cursor() as cursor,
    ):
        cursor.execute(sql, [event.pk])
    event.refresh_from_db()
    assert event.verb == "test.event"


def test_queryset_bulk_changes_are_rejected_too(event: AuditEvent) -> None:
    with pytest.raises(DatabaseError), transaction.atomic():
        AuditEvent.objects.filter(pk=event.pk).update(verb="tampered")
    with pytest.raises(DatabaseError), transaction.atomic():
        AuditEvent.objects.filter(pk=event.pk).delete()


def test_people_and_template_changes_are_recorded_from_now_on(
    make_org: Callable[..., Organization], member_of: Callable[..., User]
) -> None:
    org = make_org()
    owner = Membership.objects.get(organization=org, user=member_of(org, Role.OWNER))
    member = Membership.objects.get(organization=org, user=member_of(org, Role.MEMBER))
    assert not AuditEvent.objects.filter(organization=org).exists()  # nothing invented for existing data

    issued = invite(actor=owner, email="new@example.test", role=Role.MEMBER)
    revoke_invitation(actor=owner, invitation_id=issued.invitation.pk)
    change_role(actor=owner, member_id=member.pk, role=Role.ADMIN)
    remove_member(actor=owner, member_id=member.pk)
    steps = [StepInput(name="Approve", approver_type="role", approver_role=Role.ADMIN)]
    template = create_template(actor=owner, name="Flow", category="other", description="", steps=steps)
    save_draft(actor=owner, template_id=template.pk, steps=steps)
    publish(actor=owner, template_id=template.pk)

    verbs = list(
        AuditEvent.objects.filter(organization=org)
        .order_by("created_at", "id")
        .values_list("verb", flat=True)
    )
    assert verbs == [
        "invitation.sent",
        "invitation.revoked",
        "member.role_changed",
        "member.removed",
        "template.created",
        "template.draft_saved",
        "template.published",
    ]
    role_change = AuditEvent.objects.get(organization=org, verb="member.role_changed")
    assert (role_change.data["from"], role_change.data["to"]) == ("member", "admin")
    sent = AuditEvent.objects.get(organization=org, verb="invitation.sent")
    assert "token" not in str(sent.data).lower()
    assert issued.token not in str(sent.data)


def test_audit_api_is_admin_only_and_filterable(
    make_org: Callable[..., Organization], member_of: Callable[..., User]
) -> None:
    org = make_org()
    admin = member_of(org, Role.ADMIN)
    owner = Membership.objects.get(organization=org, user=member_of(org, Role.OWNER))
    invite(actor=owner, email="a@example.test", role=Role.MEMBER)
    target = Membership.objects.get(organization=org, user=member_of(org, Role.MEMBER))
    change_role(actor=owner, member_id=target.pk, role=Role.ADMIN)

    member_client = login(APIClient(enforce_csrf_checks=True), member_of(org, Role.MEMBER), org)
    assert member_client.get("/api/v1/org/audit-events").status_code == 403

    client = login(APIClient(enforce_csrf_checks=True), admin, org)
    all_events = client.get("/api/v1/org/audit-events").json()["results"]
    assert {e["verb"] for e in all_events} == {"invitation.sent", "member.role_changed"}
    filtered = client.get("/api/v1/org/audit-events?verb=member.").json()["results"]
    assert [e["verb"] for e in filtered] == ["member.role_changed"]
    assert client.get("/api/v1/org/audit-events?from=not-a-date").status_code == 400
    for method in ("post", "patch", "delete"):
        assert getattr(client, method)("/api/v1/org/audit-events", {}, format="json").status_code == 405
