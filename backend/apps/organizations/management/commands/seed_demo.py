"""Idempotent demo data: two fictional organizations to demonstrate tenant isolation.

All people and companies are fictional; emails use the reserved ``.test`` domain.
The password comes from DEMO_PASSWORD so no credential lives in the repository.
"""

from __future__ import annotations

import os
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
