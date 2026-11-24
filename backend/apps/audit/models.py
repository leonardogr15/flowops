"""Append-only audit log (ADR-0007).

Protection layers (none of them is cryptographic):
1. the model refuses updates and deletes;
2. a PostgreSQL trigger rejects UPDATE and DELETE on the table, even from raw SQL;
3. the API is read-only and limited to admins and owners of the organization.

A database superuser can still disable the trigger; separating database roles is out of scope.
"""

from __future__ import annotations

import uuid
from typing import Any

from django.db import models

from apps.organizations.models import Organization


class AuditEventImmutable(Exception):
    """Raised when code tries to change or delete an audit event."""


class AuditEvent(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid7, editable=False)
    # PROTECT: an organization with audit history cannot be deleted by cascade.
    organization = models.ForeignKey(Organization, on_delete=models.PROTECT, related_name="+")
    # Actor is copied, not referenced, so deleting a user never needs to rewrite history.
    actor_id = models.UUIDField(null=True, blank=True)
    actor_email = models.EmailField(max_length=254, blank=True)
    verb = models.CharField(max_length=64)
    target_type = models.CharField(max_length=32)
    target_id = models.UUIDField()
    data = models.JSONField(default=dict, blank=True)
    request_id = models.CharField(max_length=64, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    # Position of the event within its request (1, 2, 3...), assigned under the request's row lock
    # (AUD-01, ADR-0007). Only for target_type "request"; NULL for events written before it existed.
    request_seq = models.PositiveIntegerField(null=True, blank=True, editable=False)

    class Meta:
        ordering = ("-created_at", "-id")
        constraints = [
            models.UniqueConstraint(
                fields=["target_id", "request_seq"],
                condition=models.Q(request_seq__isnull=False),
                name="audit_request_seq_unique",
            ),
            models.CheckConstraint(
                condition=models.Q(request_seq__isnull=True) | models.Q(target_type="request"),
                name="audit_request_seq_only_for_requests",
            ),
        ]
        indexes = [
            models.Index(fields=["organization", "-created_at"], name="audit_org_created_idx"),
            models.Index(fields=["organization", "target_type", "target_id"], name="audit_org_target_idx"),
        ]

    def __str__(self) -> str:
        return f"{self.verb} {self.target_type}:{self.target_id}"

    def save(self, *args: Any, **kwargs: Any) -> None:
        if not self._state.adding:
            raise AuditEventImmutable("Audit events cannot be changed.")
        super().save(*args, **kwargs)

    def delete(self, *args: Any, **kwargs: Any) -> tuple[int, dict[str, int]]:
        raise AuditEventImmutable("Audit events cannot be deleted.")
