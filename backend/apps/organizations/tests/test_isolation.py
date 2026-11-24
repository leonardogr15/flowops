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

import pytest
from django.urls import URLPattern, URLResolver, get_resolver
from rest_framework.test import APIClient

from apps.accounts.models import User
from apps.organizations.models import Membership, Organization, Role
from common.tests.support import login

API_PREFIX = "api/v1/"
SAFE_PAYLOAD: dict[str, Any] = {"name": "Renamed by another tenant"}


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
    assert {"/api/v1/org", "/api/v1/org/members"} <= scoped


def tenant_cases() -> list[Any]:
    cases = []
    for e in api_endpoints():
        if not getattr(e.view, "tenant_scoped", False):
            continue
        assert "<" not in e.path, (
            f"{e.path}: add object fixtures for path parameters to the isolation harness"
        )
        cases.extend(pytest.param(e.path, m, id=f"{m} {e.path}") for m in e.methods)
    return cases


@pytest.mark.django_db
@pytest.mark.parametrize(("path", "method"), tenant_cases())
@pytest.mark.parametrize("attacker_role", [Role.MEMBER, Role.OWNER])
def test_member_of_another_organization_gets_404(
    api: APIClient,
    make_org: Callable[..., Organization],
    member_of: Callable[..., User],
    path: str,
    method: str,
    attacker_role: str,
) -> None:
    victim_org, attacker_org = make_org("Victim"), make_org("Attacker")
    member_of(victim_org, Role.OWNER)
    attacker = member_of(attacker_org, attacker_role)
    login(api, attacker)  # header passed per request below (stored credentials would override it)

    response = getattr(api, method.lower())(
        path, SAFE_PAYLOAD, format="json", HTTP_X_ORGANIZATION=victim_org.slug
    )

    assert response.status_code == 404, f"{method} {path} leaked across tenants: {response.status_code}"
    victim_org.refresh_from_db()
    assert victim_org.name == "Victim"
    assert Membership.objects.filter(organization=victim_org).count() == 1
