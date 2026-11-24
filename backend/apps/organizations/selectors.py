"""Read-side queries. Tenant-owned data is always filtered by organization here."""

from __future__ import annotations

from django.db.models import QuerySet

from apps.accounts.models import User

from .models import Membership, Organization


def memberships_for_user(user: User) -> QuerySet[Membership]:
    return Membership.objects.filter(user=user).select_related("organization").order_by("organization__name")


def membership_for(user: User, org_slug: str) -> Membership | None:
    return (
        Membership.objects.select_related("organization")
        .filter(user=user, organization__slug=org_slug)
        .first()
    )


def members_of(organization: Organization) -> QuerySet[Membership]:
    return Membership.objects.filter(organization=organization).select_related("user")
