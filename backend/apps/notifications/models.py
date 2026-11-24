"""In-app notifications (email comes in a later batch)."""

from __future__ import annotations

from django.conf import settings
from django.db import models

from apps.organizations.models import TenantModel


class NotificationKind(models.TextChoices):
    TASK_ASSIGNED = "task_assigned", "A request needs your decision"
    TASK_NEEDS_ADMIN = "task_needs_admin", "A request needs an administrator"
    REQUEST_APPROVED = "request_approved", "Your request was approved"
    REQUEST_REJECTED = "request_rejected", "Your request was rejected"
    COMMENT_ADDED = "comment_added", "New comment on a request"


class Notification(TenantModel):
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="notifications")
    kind = models.CharField(max_length=32, choices=NotificationKind.choices)
    request = models.ForeignKey("requests.Request", on_delete=models.CASCADE, related_name="+")
    read_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ("-created_at",)
        indexes = [models.Index(fields=["user", "organization", "read_at"], name="notif_user_org_read_idx")]

    def __str__(self) -> str:
        return f"{self.kind} for {self.user_id}"
