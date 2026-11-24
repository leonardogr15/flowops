from __future__ import annotations

from collections.abc import Callable

import pytest
from rest_framework.test import APIClient

from apps.accounts.models import User
from apps.organizations.models import Membership, Organization, Role
from apps.organizations.services import create_organization
from common.tests.support import login

pytestmark = pytest.mark.django_db


# --- FO-012: organizations & memberships --------------------------------------------------------


def test_creating_an_organization_makes_the_creator_owner(make_user: Callable[..., User]) -> None:
    user = make_user()
    membership = create_organization(creator=user, name="  Orbital Supplies  ")
    assert membership.role == Role.OWNER
    assert membership.organization.name == "Orbital Supplies"
    assert membership.organization.slug == "orbital-supplies"


def test_slugs_stay_unique_for_identical_names(make_user: Callable[..., User]) -> None:
    a = create_organization(creator=make_user(), name="Acme")
    b = create_organization(creator=make_user(), name="Acme")
    assert a.organization.slug != b.organization.slug
    assert b.organization.slug.startswith("acme-")


def test_membership_is_unique_per_user_and_org(
    make_org: Callable[..., Organization], member_of: Callable[..., User]
) -> None:
    org = make_org()
    user = member_of(org)
    with pytest.raises(Exception, match="organizations_membership_unique"):
        Membership.objects.create(organization=org, user=user, role=Role.ADMIN)


def test_create_and_list_my_organizations(api: APIClient, make_user: Callable[..., User]) -> None:
    login(api, make_user())
    created = api.post("/api/v1/organizations", {"name": "Kestrel Analytics"}, format="json")
    assert created.status_code == 201
    assert created.json()["role"] == "owner"
    listed = api.get("/api/v1/organizations").json()
    assert [m["organization"]["slug"] for m in listed] == ["kestrel-analytics"]


def test_organization_name_is_validated(api: APIClient, make_user: Callable[..., User]) -> None:
    login(api, make_user())
    response = api.post("/api/v1/organizations", {"name": " x "}, format="json")
    assert response.status_code == 400
    assert "name" in response.json()["errors"]


def test_my_organizations_only_lists_mine(
    api: APIClient, make_org: Callable[..., Organization], member_of: Callable[..., User]
) -> None:
    mine, other = make_org(), make_org()
    member_of(other)
    login(api, member_of(mine))
    assert [m["organization"]["slug"] for m in api.get("/api/v1/organizations").json()] == [mine.slug]


# --- FO-013: tenant context resolution -----------------------------------------------------------


def test_current_organization_with_valid_header(
    api: APIClient, make_org: Callable[..., Organization], member_of: Callable[..., User]
) -> None:
    org = make_org()
    member_of(org)
    login(api, member_of(org, Role.ADMIN), org)
    body = api.get("/api/v1/org").json()
    assert body["slug"] == org.slug
    assert body["role"] == "admin"
    assert body["member_count"] == 2


def test_missing_organization_header_is_400(
    api: APIClient, make_org: Callable[..., Organization], member_of: Callable[..., User]
) -> None:
    login(api, member_of(make_org()))
    response = api.get("/api/v1/org")
    assert response.status_code == 400
    assert response.json()["type"].endswith(":organization_required")


@pytest.mark.parametrize("target", ["foreign", "nonexistent"])
def test_foreign_and_unknown_organizations_are_indistinguishable_404(
    api: APIClient, make_org: Callable[..., Organization], member_of: Callable[..., User], target: str
) -> None:
    mine, foreign = make_org(), make_org()
    member_of(foreign, Role.OWNER)
    login(api, member_of(mine))
    slug = foreign.slug if target == "foreign" else "does-not-exist"
    response = api.get("/api/v1/org", HTTP_X_ORGANIZATION=slug)
    assert response.status_code == 404
    assert response.json()["detail"] == "Organization not found."


def test_unauthenticated_requests_are_401_not_404(
    api: APIClient, make_org: Callable[..., Organization]
) -> None:
    response = api.get("/api/v1/org", HTTP_X_ORGANIZATION=make_org().slug)
    assert response.status_code == 401


# --- FO-015: role-based permissions --------------------------------------------------------------


@pytest.mark.parametrize(
    ("role", "expected"),
    [(Role.MEMBER, 403), (Role.ADMIN, 200), (Role.OWNER, 200)],
)
def test_rename_organization_permission_matrix(
    api: APIClient,
    make_org: Callable[..., Organization],
    member_of: Callable[..., User],
    role: str,
    expected: int,
) -> None:
    org = make_org("Before")
    login(api, member_of(org, role), org)
    response = api.patch("/api/v1/org", {"name": "After"}, format="json")
    assert response.status_code == expected
    org.refresh_from_db()
    assert org.name == ("After" if expected == 200 else "Before")


def test_member_cannot_rename_even_with_extra_fields(
    api: APIClient, make_org: Callable[..., Organization], member_of: Callable[..., User]
) -> None:
    org = make_org()
    login(api, member_of(org), org)
    response = api.patch("/api/v1/org", {"name": "Hijack", "role": "owner"}, format="json")
    assert response.status_code == 403
    assert response.json()["detail"] == "Your role in this organization does not allow this action."


def test_slug_is_read_only(
    api: APIClient, make_org: Callable[..., Organization], member_of: Callable[..., User]
) -> None:
    org = make_org()
    login(api, member_of(org, Role.OWNER), org)
    response = api.patch("/api/v1/org", {"name": "Renamed", "slug": "hijacked"}, format="json")
    assert response.status_code == 200
    assert response.json()["slug"] == org.slug


def test_members_list_is_scoped_and_paginated(
    api: APIClient, make_org: Callable[..., Organization], member_of: Callable[..., User]
) -> None:
    org, other = make_org(), make_org()
    for _ in range(3):
        member_of(org)
    member_of(other)
    login(api, member_of(org), org)
    body = api.get("/api/v1/org/members?page_size=2").json()
    assert len(body["results"]) == 2
    assert body["next"]
    rest = api.get(body["next"]).json()
    assert len(body["results"]) + len(rest["results"]) == 4  # 3 + the caller; never the other org's member


def test_role_rank_helper() -> None:
    m = Membership(role=Role.ADMIN)
    assert m.has_role(Role.MEMBER)
    assert m.has_role(Role.ADMIN)
    assert not m.has_role(Role.OWNER)
