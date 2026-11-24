"""Recording audit events. Call `record` inside the transaction that makes the change, so an event
exists if and only if the change was committed."""

from __future__ import annotations

from typing import Any
from uuid import UUID

from django.db import connection

from apps.accounts.models import User
from apps.organizations.models import Organization
from common.context import request_id_var

from .models import AuditEvent


def record(
    *,
    organization: Organization,
    actor: User | None,
    verb: str,
    target_type: str,
    target_id: UUID,
    data: dict[str, Any] | None = None,
    request_seq: int | None = None,
) -> AuditEvent:
    if not connection.in_atomic_block:  # pragma: no cover - programming error guard
        raise RuntimeError("audit.record() must run inside the transaction that makes the change")
    if (target_type == "request") != (request_seq is not None):
        # Request events are numbered by apps.requests.services.record_request_event (AUD-01).
        raise RuntimeError("request events need a request_seq, and only request events may have one")
    request_id = request_id_var.get()
    return AuditEvent.objects.create(
        organization=organization,
        actor_id=actor.pk if actor else None,
        actor_email=actor.email if actor else "",
        verb=verb,
        target_type=target_type,
        target_id=target_id,
        data=data or {},
        request_id="" if request_id == "-" else request_id,
        request_seq=request_seq,
    )
