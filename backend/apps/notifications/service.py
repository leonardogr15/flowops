"""Creates in-app notifications inside the caller's transaction (rolled back together)."""

from __future__ import annotations

from collections.abc import Iterable
from uuid import UUID

from .models import Notification


def notify(*, organization_id: UUID, user_ids: Iterable[UUID], kind: str, request_id: UUID) -> int:
    unique = sorted(set(user_ids))
    Notification.objects.bulk_create(
        [
            Notification(organization_id=organization_id, user_id=u, kind=kind, request_id=request_id)
            for u in unique
        ]
    )
    return len(unique)
