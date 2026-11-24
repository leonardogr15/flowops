from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass
from typing import Any

import pytest
from rest_framework.test import APIClient

from apps.accounts.models import User
from apps.organizations.models import Membership, Organization, Role
from apps.workflows.models import WorkflowTemplate
from apps.workflows.services import StepInput, create_template, publish
from common.tests.support import login


@dataclass
class Demo:
    org: Organization
    olivia: User  # owner
    adam: User  # admin
    maya: User  # member, requester
    raj: User  # member, step 1 approver
    template: WorkflowTemplate

    def m(self, user: User) -> Membership:
        return Membership.objects.get(organization=self.org, user=user)


@pytest.fixture
def demo(make_org: Callable[..., Organization], member_of: Callable[..., User]) -> Demo:
    """The README demo: Raj (person) -> any admin -> any owner."""
    org = make_org("Orbital")
    olivia = member_of(org, Role.OWNER, full_name="Olivia Owner")
    adam = member_of(org, Role.ADMIN, full_name="Adam Admin")
    maya = member_of(org, Role.MEMBER, full_name="Maya Member")
    raj = member_of(org, Role.MEMBER, full_name="Raj Approver")
    admin = Membership.objects.get(organization=org, user=adam)
    template = create_template(
        actor=admin,
        name="Purchase over $1,000",
        category="purchase",
        description="",
        steps=[
            StepInput(name="Team lead approval", approver_type="user", approver_user=raj.pk),
            StepInput(name="Finance review", approver_type="role", approver_role=Role.ADMIN),
            StepInput(name="Owner sign-off", approver_type="role", approver_role=Role.OWNER),
        ],
    )
    publish(actor=admin, template_id=template.pk)
    return Demo(org, olivia, adam, maya, raj, template)


@pytest.fixture
def as_user(demo: Demo) -> Callable[[User], APIClient]:
    def client(user: User) -> APIClient:
        return login(APIClient(enforce_csrf_checks=True), user, demo.org)

    return client


def create_via_api(client: APIClient, demo: Demo, **overrides: Any) -> dict[str, Any]:
    body = {
        "template": str(demo.template.pk),
        "title": "Laptop",
        "amount": "1450.00",
        "currency": "usd",
        **overrides,
    }
    response = client.post("/api/v1/org/requests", body, format="json")
    assert response.status_code == 201, response.content
    data: dict[str, Any] = response.json()
    return data
