"""FO-014: cross-tenant isolation harness.

Endpoints are discovered from the URL configuration, so a new API endpoint is covered (or the
suite fails) without anyone remembering to add it here:

1. every ``/api/v1/`` view must declare ``tenant_scoped`` explicitly;
2. every tenant-scoped endpoint is called, for each HTTP method it allows, by an authenticated
   member of organization A using organization B's slug — the answer must be 404 and nothing
   may change in B.
"""

from __future__ import annotations

from collections.abc import Callable, Iterator
from dataclasses import dataclass
from typing import Any
from uuid import UUID

import pytest
from django.urls import URLPattern, URLResolver, get_resolver
from rest_framework.test import APIClient

from apps.accounts.models import User
from apps.audit.models import AuditEvent
from apps.notifications.models import Notification
from apps.organizations.members import invite
from apps.organizations.models import Invitation, Membership, Organization, Role
from apps.requests.models import ApprovalTask, Comment, Request
from apps.workflows.models import Step, TemplateVersion, WorkflowTemplate
from apps.workflows.services import StepInput, create_template, publish
from common.tests.support import login

API_PREFIX = "api/v1/"
# One payload that is *valid* for every tenant endpoint, so a 404 proves authorization, not validation.
SAFE_PAYLOAD: dict[str, Any] = {
    "name": "Renamed by another tenant",
    "email": "intruder@example.test",
    "role": "owner",
    "steps": [{"name": "Hijacked step", "approver_type": "role", "approver_role": "member"}],
    "title": "Hijacked title",
    "revision": 1,
    "body": "Hijacked comment",
    "comment": "Hijacked decision",
}


@dataclass(frozen=True)
class Endpoint:
    path: str
    view: type
    methods: tuple[str, ...]


def _walk(patterns: list[Any], prefix: str = "") -> Iterator[tuple[str, Any]]:
    for p in patterns:
        if isinstance(p, URLResolver):
            yield from _walk(p.url_patterns, prefix + str(p.pattern))
        elif isinstance(p, URLPattern):
            yield prefix + str(p.pattern), p


def api_endpoints() -> list[Endpoint]:
    found = []
    for route, pattern in _walk(get_resolver().url_patterns):
        if not route.startswith(API_PREFIX):
            continue
        view = getattr(pattern.callback, "view_class", None) or getattr(pattern.callback, "cls", None)
        assert view is not None, f"{route} is not a class-based view"
        methods = tuple(
            m.upper() for m in view.http_method_names if hasattr(view, m) and m not in {"options", "head"}
        )
        found.append(Endpoint("/" + route, view, methods))
    return found


def test_every_api_view_declares_tenant_scope() -> None:
    undeclared = [e.path for e in api_endpoints() if not hasattr(e.view, "tenant_scoped")]
    assert not undeclared, f"views must set tenant_scoped = True/False: {undeclared}"


def test_harness_discovers_the_known_tenant_endpoints() -> None:
    scoped = {e.path for e in api_endpoints() if getattr(e.view, "tenant_scoped", False)}
    assert {
        "/api/v1/org",
        "/api/v1/org/members",
        "/api/v1/org/members/<uuid:pk>",
        "/api/v1/org/invitations/<uuid:pk>",
        "/api/v1/org/workflow-templates/<uuid:pk>/publish",
    } <= scoped


# Path parameters: each route with a parameter needs a factory that creates the target object in
# the victim organization. A new parameterized tenant route without a factory fails the suite.
def _victim_member(org: Organization, owner: User) -> UUID:
    return Membership.objects.get(organization=org, user=owner).pk


def _victim_invitation(org: Organization, owner: User) -> UUID:
    actor = Membership.objects.get(organization=org, user=owner)
    return invite(actor=actor, email="pending@example.test", role=Role.MEMBER).invitation.pk


def _victim_template(org: Organization, owner: User) -> UUID:
    actor = Membership.objects.get(organization=org, user=owner)
    steps = [StepInput(name="Owner approval", approver_type="role", approver_role="owner")]
    return create_template(
        actor=actor, name="Victim template", category="other", description="", steps=steps
    ).pk


def _victim_request(org: Organization, owner: User, *, submitted: bool = True) -> UUID:
    from decimal import Decimal

    from apps.requests import services as requests

    actor = Membership.objects.get(organization=org, user=owner)
    other = User.objects.create_user(f"approver-{org.slug}@example.test", "x" * 14)
    Membership.objects.create(organization=org, user=other, role=Role.ADMIN)
    steps = [StepInput(name="Admin approval", approver_type="role", approver_role="admin")]
    template = create_template(actor=actor, name="Victim flow", category="other", description="", steps=steps)
    publish(actor=actor, template_id=template.pk)
    fields = requests.RequestFields(title="Victim request", amount=Decimal("10"), currency="USD")
    req = requests.create_request(actor=actor, template_id=template.pk, fields=fields)
    if submitted:
        requests.submit(actor=actor, request_id=req.pk)
    return req.pk


def _victim_draft(org: Organization, owner: User) -> UUID:
    return _victim_request(org, owner, submitted=False)


def _victim_notification(org: Organization, owner: User) -> UUID:
    from apps.notifications.models import Notification

    _victim_request(org, owner)
    return Notification.objects.filter(organization=org).values_list("pk", flat=True).first()  # type: ignore[return-value]


OBJECT_FACTORIES: dict[str, Callable[[Organization, User], UUID]] = {
    "/api/v1/org/requests/<uuid:pk>": _victim_draft,
    "/api/v1/org/requests/<uuid:pk>/submit": _victim_draft,
    "/api/v1/org/requests/<uuid:pk>/cancel": _victim_request,
    "/api/v1/org/requests/<uuid:pk>/approve": _victim_request,
    "/api/v1/org/requests/<uuid:pk>/reject": _victim_request,
    "/api/v1/org/requests/<uuid:pk>/duplicate": _victim_request,
    "/api/v1/org/requests/<uuid:pk>/comments": _victim_request,
    "/api/v1/org/requests/<uuid:pk>/timeline": _victim_request,
    "/api/v1/org/notifications/<uuid:pk>/read": _victim_notification,
    "/api/v1/org/members/<uuid:pk>": _victim_member,
    "/api/v1/org/invitations/<uuid:pk>": _victim_invitation,
    "/api/v1/org/workflow-templates/<uuid:pk>": _victim_template,
    "/api/v1/org/workflow-templates/<uuid:pk>/draft": _victim_template,
    "/api/v1/org/workflow-templates/<uuid:pk>/publish": _victim_template,
}


def tenant_cases() -> list[Any]:
    cases = []
    for e in api_endpoints():
        if not getattr(e.view, "tenant_scoped", False):
            continue
        if "<" in e.path:
            assert e.path in OBJECT_FACTORIES, f"{e.path}: add an object factory to the isolation harness"
        cases.extend(pytest.param(e.path, m, id=f"{m} {e.path}") for m in e.methods)
    return cases


def victim_state(org: Organization) -> tuple[Any, ...]:
    """Everything an attacker could try to change in the victim organization."""
    org.refresh_from_db()
    return (
        org.name,
        sorted(Membership.objects.filter(organization=org).values_list("user_id", "role")),
        sorted(Invitation.objects.filter(organization=org).values_list("email", "revoked_at", "accepted_at")),
        sorted(WorkflowTemplate.objects.filter(organization=org).values_list("name", "description")),
        sorted(TemplateVersion.objects.filter(organization=org).values_list("number", "status")),
        Step.objects.filter(organization=org).count(),
        sorted(Request.objects.filter(organization=org).values_list("title", "status", "revision")),
        sorted(ApprovalTask.objects.filter(organization=org).values_list("step_order", "status")),
        Comment.objects.filter(organization=org).count(),
        sorted(Notification.objects.filter(organization=org).values_list("pk", "read_at")),
        AuditEvent.objects.filter(organization=org).count(),
    )


@pytest.mark.django_db
@pytest.mark.parametrize(("path", "method"), tenant_cases())
@pytest.mark.parametrize("attacker_role", [Role.MEMBER, Role.OWNER])
@pytest.mark.parametrize("header", ["victim-org", "own-org"])
def test_another_organization_cannot_reach_or_change_victim_data(
    api: APIClient,
    make_org: Callable[..., Organization],
    member_of: Callable[..., User],
    path: str,
    method: str,
    attacker_role: str,
    header: str,
) -> None:
    victim_org, attacker_org = make_org("Victim"), make_org("Attacker")
    victim_owner = member_of(victim_org, Role.OWNER)
    url = path
    if "<uuid:pk>" in path:
        url = path.replace("<uuid:pk>", str(OBJECT_FACTORIES[path](victim_org, victim_owner)))
    elif header == "own-org":
        pytest.skip("own-org header without an object id is the attacker's own data")
    before = victim_state(victim_org)

    attacker = member_of(attacker_org, attacker_role)
    login(api, attacker)  # header passed per request (stored credentials would override it)
    slug = victim_org.slug if header == "victim-org" else attacker_org.slug
    response = getattr(api, method.lower())(url, SAFE_PAYLOAD, format="json", HTTP_X_ORGANIZATION=slug)

    assert response.status_code == 404, (
        f"{method} {url} ({header}) leaked across tenants: {response.status_code}"
    )
    assert victim_state(victim_org) == before
