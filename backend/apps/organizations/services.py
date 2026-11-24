"""Write-side use cases. Every function that writes runs in a single transaction."""

from __future__ import annotations

import secrets

from django.db import IntegrityError, transaction
from django.utils.text import slugify

from apps.accounts.models import User

from .models import Membership, Organization, Role


def _candidate_slug(name: str, attempt: int) -> str:
    base = slugify(name)[:48] or "org"
    return base if attempt == 0 else f"{base}-{secrets.token_hex(3)}"


@transaction.atomic
def create_organization(*, creator: User, name: str) -> Membership:
    """Creates an organization and makes the creator its owner."""
    clean = name.strip()
    for attempt in range(5):
        slug = _candidate_slug(clean, attempt)
        if Organization.objects.filter(slug=slug).exists():
            continue
        try:
            with transaction.atomic():  # savepoint: a concurrent insert of the same slug only retries
                org = Organization.objects.create(name=clean, slug=slug)
            break
        except IntegrityError:
            continue
    else:  # pragma: no cover - five collisions in a row
        raise RuntimeError("could not allocate a unique organization slug")
    return Membership.objects.create(organization=org, user=creator, role=Role.OWNER)


@transaction.atomic
def rename_organization(*, organization: Organization, name: str) -> Organization:
    organization.name = name.strip()
    organization.save(update_fields=["name", "updated_at"])
    return organization
