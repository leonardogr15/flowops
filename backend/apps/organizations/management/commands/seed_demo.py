"""Idempotent demo data: two fictional organizations to demonstrate tenant isolation.

All people and companies are fictional; emails use the reserved ``.test`` domain.
The password comes from DEMO_PASSWORD so no credential lives in the repository.
"""

from __future__ import annotations

import os
from decimal import Decimal
from typing import Any

from django.core.management.base import BaseCommand, CommandError
from django.db import transaction

from apps.accounts.models import User
from apps.organizations.models import Membership, Organization, Role
from apps.workflows.models import WorkflowTemplate
from apps.workflows.services import StepInput, create_template, publish

ORGS = {
    "orbital-supplies": "Orbital Supplies Co.",
    "kestrel-analytics": "Kestrel Analytics",
}
PEOPLE = [
    ("olivia.owner@flowops.test", "Olivia Owner", "orbital-supplies", Role.OWNER),
    ("adam.admin@flowops.test", "Adam Admin", "orbital-supplies", Role.ADMIN),
    ("maya.member@flowops.test", "Maya Member", "orbital-supplies", Role.MEMBER),
    ("raj.approver@flowops.test", "Raj Approver", "orbital-supplies", Role.MEMBER),
    ("kim.owner@flowops.test", "Kim Owner", "kestrel-analytics", Role.OWNER),
    ("raj.approver@flowops.test", "Raj Approver", "kestrel-analytics", Role.ADMIN),
]


class Command(BaseCommand):
    help = "Create or update demo organizations and users (safe to run repeatedly)."

    def handle(self, *args: Any, **options: Any) -> None:
        password = os.environ.get("DEMO_PASSWORD", "")
        if len(password) < 12:
            raise CommandError("Set DEMO_PASSWORD (at least 12 characters) before seeding demo data.")
        with transaction.atomic():
            orgs = {
                slug: Organization.objects.update_or_create(slug=slug, defaults={"name": name})[0]
                for slug, name in ORGS.items()
            }
            for email, full_name, org_slug, role in PEOPLE:
                user, created = User.objects.get_or_create(email=email, defaults={"full_name": full_name})
                if created:
                    user.set_password(password)
                    user.save(update_fields=["password"])
                Membership.objects.update_or_create(
                    organization=orgs[org_slug], user=user, defaults={"role": role}
                )
            self._seed_templates(orgs["orbital-supplies"])
            self._seed_requests(orgs["orbital-supplies"])
        self.stdout.write(
            self.style.SUCCESS(
                f"Demo data ready: {Organization.objects.filter(slug__in=ORGS).count()} organizations, "
                f"{User.objects.filter(email__endswith='@flowops.test').count()} users."
            )
        )

    def _seed_templates(self, org: Organization) -> None:
        """Two templates: one published (members can see it) and one still in draft."""
        if WorkflowTemplate.objects.filter(organization=org).exists():
            return
        admin = Membership.objects.get(organization=org, user__email="adam.admin@flowops.test")
        raj = User.objects.get(email="raj.approver@flowops.test")
        purchase = create_template(
            actor=admin,
            name="Purchase over $1,000",
            category="purchase",
            description="Hardware, software licenses and services above $1,000.",
            steps=[
                StepInput(name="Team lead approval", approver_type="user", approver_user=raj.pk),
                StepInput(name="Finance review", approver_type="role", approver_role=Role.ADMIN),
                StepInput(name="Owner sign-off", approver_type="role", approver_role=Role.OWNER),
            ],
        )
        publish(actor=admin, template_id=purchase.pk)
        create_template(
            actor=admin,
            name="Production access",
            category="access",
            description="Temporary access to production systems.",
            steps=[StepInput(name="Security review", approver_type="role", approver_role=Role.ADMIN)],
        )

    def _seed_requests(self, org: Organization) -> None:
        """Requests in every state, created through the services so audit and notifications are real."""
        from apps.requests import services as requests
        from apps.requests.models import Request

        if Request.objects.filter(organization=org).exists():
            return
        member = {
            key: Membership.objects.get(organization=org, user__email=f"{key}@flowops.test")
            for key in ("maya.member", "raj.approver", "adam.admin", "olivia.owner")
        }
        template = WorkflowTemplate.objects.get(organization=org, name="Purchase over $1,000")

        def new(title: str, amount: str) -> Request:
            fields = requests.RequestFields(title=title, amount=Decimal(amount), currency="USD")
            return requests.create_request(
                actor=member["maya.member"], template_id=template.pk, fields=fields
            )

        approved = new("Laptop for the new designer", "1450.00")
        requests.submit(actor=member["maya.member"], request_id=approved.pk)
        for key in ("raj.approver", "adam.admin", "olivia.owner"):
            requests.decide(actor=member[key], request_id=approved.pk, approve=True)

        in_review = new("Ergonomic chairs for the support team", "2300.00")
        requests.submit(actor=member["maya.member"], request_id=in_review.pk)
        requests.decide(actor=member["raj.approver"], request_id=in_review.pk, approve=True)

        rejected = new("Conference tickets", "1800.00")
        requests.submit(actor=member["maya.member"], request_id=rejected.pk)
        requests.decide(
            actor=member["raj.approver"],
            request_id=rejected.pk,
            approve=False,
            comment="Out of budget this quarter. Let's revisit in Q1.",
        )

        new("Monitor arms", "1120.00")  # stays a draft
