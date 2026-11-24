"""Tenant context resolution (ADR-0001).

The active organization comes from the ``X-Organization`` header (organization slug) and is
accepted only when the authenticated user is a member. Unknown organizations and organizations
the user does not belong to are indistinguishable: both return 404.
"""

from __future__ import annotations

from typing import Any

from rest_framework.exceptions import NotFound
from rest_framework.request import Request

from common.errors import TenantRequired

from .models import Membership, Organization
from .selectors import membership_for

HEADER = "X-Organization"


def resolve_membership(request: Request) -> Membership:
    cached: Membership | None = getattr(request, "_tenant_membership", None)
    if cached is not None:
        return cached
    slug = request.headers.get(HEADER, "").strip()
    if not slug:
        raise TenantRequired()
    membership = membership_for(request.user, slug)  # type: ignore[arg-type]
    if membership is None:
        raise NotFound("Organization not found.")
    request._tenant_membership = membership  # type: ignore[attr-defined]
    return membership


class TenantScopedMixin:
    """Mixin for API views that operate inside one organization."""

    tenant_scoped = True

    @property
    def membership(self) -> Membership:
        return resolve_membership(self.request)  # type: ignore[attr-defined]

    @property
    def organization(self) -> Organization:
        return self.membership.organization

    def get_serializer_context(self) -> dict[str, Any]:
        context: dict[str, Any] = super().get_serializer_context()  # type: ignore[misc]
        context["organization"] = self.organization
        return context
