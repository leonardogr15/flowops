"""FO-020 … FO-022: workflow templates, versions and steps."""

from __future__ import annotations

from collections.abc import Callable
from typing import Any

import pytest
from rest_framework.test import APIClient

from apps.accounts.models import User
from apps.organizations.models import Organization, Role
from apps.workflows.models import ImmutableVersionError, Step, TemplateVersion, VersionStatus
from common.tests.support import login

pytestmark = pytest.mark.django_db
URL = "/api/v1/org/workflow-templates"


def role_step(name: str = "Finance review", role: str = "admin") -> dict[str, Any]:
    return {"name": name, "approver_type": "role", "approver_role": role}


def user_step(user: User, name: str = "Manager approval") -> dict[str, Any]:
    return {"name": name, "approver_type": "user", "approver_user": str(user.pk)}


@pytest.fixture
def org(make_org: Callable[..., Organization]) -> Organization:
    return make_org("Orbital")


@pytest.fixture
def admin_api(api: APIClient, org: Organization, member_of: Callable[..., User]) -> APIClient:
    return login(api, member_of(org, Role.ADMIN), org)


def create(api: APIClient, steps: list[dict[str, Any]], name: str = "Purchase over $1,000") -> dict[str, Any]:
    response = api.post(URL, {"name": name, "category": "purchase", "steps": steps}, format="json")
    assert response.status_code == 201, response.content
    body: dict[str, Any] = response.json()
    return body


def test_admin_creates_a_draft_with_ordered_steps(
    admin_api: APIClient, org: Organization, member_of: Callable[..., User]
) -> None:
    approver = member_of(org, full_name="Raj Approver")
    body = create(admin_api, [user_step(approver), role_step()])
    assert body["published"] is None
    draft = body["draft"]
    assert draft["number"] == 1
    assert [(s["order"], s["name"]) for s in draft["steps"]] == [
        (1, "Manager approval"),
        (2, "Finance review"),
    ]
    assert draft["steps"][0]["approver_user"]["full_name"] == "Raj Approver"
    assert draft["steps"][1]["approver_role"] == "admin"


@pytest.mark.parametrize(
    ("steps", "field"),
    [
        ([], "steps"),
        ([role_step(f"Step {i}") for i in range(11)], "steps"),
        ([{"name": "No approver", "approver_type": "user"}], "steps"),
        ([{"name": "No role", "approver_type": "role"}], "steps"),
    ],
    ids=["empty", "too-many", "user-missing", "role-missing"],
)
def test_step_validation(admin_api: APIClient, steps: list[dict[str, Any]], field: str) -> None:
    response = admin_api.post(URL, {"name": "Bad", "steps": steps}, format="json")
    assert response.status_code == 400
    assert field in response.json()["errors"]


def test_approver_must_belong_to_the_same_organization(
    admin_api: APIClient, make_org: Callable[..., Organization], member_of: Callable[..., User]
) -> None:
    outsider = member_of(make_org("Other"))
    response = admin_api.post(URL, {"name": "Cross org", "steps": [user_step(outsider)]}, format="json")
    assert response.status_code == 400
    assert response.json()["errors"]["steps"]["0"]["approver_user"] == [
        "The approver must be a member of this organization."
    ]


def test_template_names_are_unique_per_organization(admin_api: APIClient) -> None:
    create(admin_api, [role_step()], name="Expenses")
    response = admin_api.post(URL, {"name": "Expenses", "steps": [role_step()]}, format="json")
    assert response.status_code == 409


def test_publish_then_edit_creates_a_new_draft_and_keeps_the_published_version(admin_api: APIClient) -> None:
    template = create(admin_api, [role_step("First")])
    tid = template["id"]

    published = admin_api.post(f"{URL}/{tid}/publish")
    assert published.status_code == 200
    assert published.json()["status"] == "published"
    assert admin_api.post(f"{URL}/{tid}/publish").status_code == 409  # nothing left to publish

    draft = admin_api.put(
        f"{URL}/{tid}/draft", {"steps": [role_step("Second"), role_step("Third", "owner")]}, format="json"
    )
    assert draft.status_code == 200
    assert draft.json()["number"] == 2

    detail = admin_api.get(f"{URL}/{tid}").json()
    assert [s["name"] for s in detail["published"]["steps"]] == ["First"]  # unchanged
    assert [s["name"] for s in detail["draft"]["steps"]] == ["Second", "Third"]

    assert admin_api.post(f"{URL}/{tid}/publish").status_code == 200
    history = admin_api.get(f"{URL}/{tid}").json()["history"]
    assert [(v["number"], v["status"]) for v in history] == [(2, "published"), (1, "archived")]


def test_published_steps_are_immutable_at_the_model_level(admin_api: APIClient) -> None:
    tid = create(admin_api, [role_step()])["id"]
    admin_api.post(f"{URL}/{tid}/publish")
    step = Step.objects.get(version__template_id=tid)
    step.name = "Changed afterwards"
    with pytest.raises(ImmutableVersionError):
        step.save()
    with pytest.raises(ImmutableVersionError):
        step.delete()


def test_saving_the_draft_replaces_its_steps(admin_api: APIClient) -> None:
    tid = create(admin_api, [role_step("Old")])["id"]
    admin_api.put(f"{URL}/{tid}/draft", {"steps": [role_step("New A"), role_step("New B")]}, format="json")
    assert list(Step.objects.filter(version__template_id=tid).values_list("name", flat=True)) == [
        "New A",
        "New B",
    ]
    assert TemplateVersion.objects.filter(template_id=tid).count() == 1


def test_rename_and_category(admin_api: APIClient) -> None:
    tid = create(admin_api, [role_step()])["id"]
    response = admin_api.patch(f"{URL}/{tid}", {"name": "Purchases", "category": "expense"}, format="json")
    assert response.status_code == 200
    assert (response.json()["name"], response.json()["category"]) == ("Purchases", "expense")


def test_members_only_see_published_templates_and_cannot_edit(
    admin_api: APIClient, org: Organization, member_of: Callable[..., User]
) -> None:
    draft_only = create(admin_api, [role_step()], name="Draft only")["id"]
    live = create(admin_api, [role_step("Live step")], name="Live")["id"]
    admin_api.post(f"{URL}/{live}/publish")
    admin_api.put(f"{URL}/{live}/draft", {"steps": [role_step("Unpublished change")]}, format="json")

    member = login(APIClient(enforce_csrf_checks=True), member_of(org), org)
    listed = member.get(URL).json()
    assert [t["name"] for t in listed] == ["Live"]
    assert listed[0]["published_step_count"] == 1
    detail = member.get(f"{URL}/{live}").json()
    assert detail["draft"] is None  # drafts are admin-only
    assert [s["name"] for s in detail["published"]["steps"]] == ["Live step"]
    assert member.get(f"{URL}/{draft_only}").status_code == 404

    assert member.post(URL, {"name": "Mine", "steps": [role_step()]}, format="json").status_code == 403
    assert member.put(f"{URL}/{live}/draft", {"steps": [role_step()]}, format="json").status_code == 403
    assert member.post(f"{URL}/{live}/publish").status_code == 403
    assert member.patch(f"{URL}/{live}", {"name": "Renamed"}, format="json").status_code == 403


def test_admin_list_shows_drafts_with_flags(admin_api: APIClient) -> None:
    tid = create(admin_api, [role_step()], name="Only draft")["id"]
    listed = admin_api.get(URL).json()
    assert listed == [
        {
            "id": tid,
            "name": "Only draft",
            "category": "purchase",
            "description": "",
            "published_version": None,
            "published_step_count": 0,
            "has_draft": True,
            "updated_at": listed[0]["updated_at"],
        }
    ]


def test_list_does_not_issue_a_query_per_template(
    admin_api: APIClient, django_assert_max_num_queries: Callable[..., Any]
) -> None:
    for i in range(5):
        tid = create(admin_api, [role_step()], name=f"Template {i}")["id"]
        admin_api.post(f"{URL}/{tid}/publish")
    with django_assert_max_num_queries(8):  # session, user, membership, templates, prefetch
        assert len(admin_api.get(URL).json()) == 5


def test_version_status_constraints() -> None:
    assert {s.value for s in VersionStatus} == {"draft", "published", "archived"}
