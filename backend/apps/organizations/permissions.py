"""Organization role permissions. Deny by default; roles are ordered owner > admin > member.

| Endpoint                  | member | admin | owner |
|---------------------------|:------:|:-----:|:-----:|
| GET   /api/v1/org         |  yes   |  yes  |  yes  |
| PATCH /api/v1/org         |  no    |  yes  |  yes  |
| GET   /api/v1/org/members |  yes   |  yes  |  yes  |

Non-members always receive 404 (see tenancy.py), never 403.
"""

from __future__ import annotations

from typing import Any

from rest_framework.permissions import SAFE_METHODS, BasePermission
from rest_framework.request import Request

from .models import Role
from .tenancy import resolve_membership


class _HasOrgRole(BasePermission):
    minimum: str = Role.OWNER
    message = "Your role in this organization does not allow this action."

    def has_permission(self, request: Request, view: Any) -> bool:
        if not request.user or not request.user.is_authenticated:
            return False
        return resolve_membership(request).has_role(self.minimum)


class IsOrgMember(_HasOrgRole):
    minimum = Role.MEMBER


class IsOrgAdmin(_HasOrgRole):
    minimum = Role.ADMIN


class IsOrgOwner(_HasOrgRole):
    minimum = Role.OWNER


class ReadMemberWriteAdmin(BasePermission):
    """Members may read; admins and owners may write."""

    message = _HasOrgRole.message

    def has_permission(self, request: Request, view: Any) -> bool:
        checker = IsOrgMember() if request.method in SAFE_METHODS else IsOrgAdmin()
        return checker.has_permission(request, view)
