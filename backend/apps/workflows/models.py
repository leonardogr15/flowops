"""Workflow templates (FO-020).

A template (e.g. "Purchase over $1,000") has numbered versions. Each version is an ordered list of
approval steps. At most one version is a draft and at most one is published at any time. A
published version is immutable: later requests pin the version they started with, so editing a
template always happens in a new draft.
"""

from __future__ import annotations

from typing import Any

from django.conf import settings
from django.db import models

from apps.organizations.models import Role, TenantModel

MAX_STEPS = 10


class Category(models.TextChoices):
    PURCHASE = "purchase", "Purchase"
    EXPENSE = "expense", "Expense"
    ACCESS = "access", "Access"
    OTHER = "other", "Other"


class VersionStatus(models.TextChoices):
    DRAFT = "draft", "Draft"
    PUBLISHED = "published", "Published"
    ARCHIVED = "archived", "Archived"


class ApproverType(models.TextChoices):
    USER = "user", "Specific person"
    ROLE = "role", "Anyone with a role"


class ImmutableVersionError(Exception):
    """Raised when code tries to change a version that is no longer a draft."""


class WorkflowTemplate(TenantModel):
    name = models.CharField(max_length=120)
    category = models.CharField(max_length=16, choices=Category.choices, default=Category.OTHER)
    description = models.TextField(max_length=1000, blank=True)
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, related_name="+"
    )

    class Meta:
        ordering = ("name",)
        constraints = [
            models.UniqueConstraint(
                fields=["organization", "name"], name="workflows_template_name_unique_per_org"
            )
        ]

    def __str__(self) -> str:
        return self.name


class TemplateVersion(TenantModel):
    template = models.ForeignKey(WorkflowTemplate, on_delete=models.CASCADE, related_name="versions")
    number = models.PositiveIntegerField()
    status = models.CharField(max_length=16, choices=VersionStatus.choices, default=VersionStatus.DRAFT)
    published_at = models.DateTimeField(null=True, blank=True)
    published_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True, related_name="+"
    )

    class Meta:
        ordering = ("-number",)
        constraints = [
            models.UniqueConstraint(fields=["template", "number"], name="workflows_version_number_unique"),
            models.UniqueConstraint(
                fields=["template"],
                condition=models.Q(status="draft"),
                name="workflows_one_draft_per_template",
            ),
            models.UniqueConstraint(
                fields=["template"],
                condition=models.Q(status="published"),
                name="workflows_one_published_per_template",
            ),
        ]

    def __str__(self) -> str:
        return f"{self.template_id} v{self.number} ({self.status})"


class Step(TenantModel):
    version = models.ForeignKey(TemplateVersion, on_delete=models.CASCADE, related_name="steps")
    order = models.PositiveSmallIntegerField()
    name = models.CharField(max_length=120)
    approver_type = models.CharField(max_length=8, choices=ApproverType.choices)
    approver_user = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.PROTECT, null=True, blank=True, related_name="+"
    )
    approver_role = models.CharField(max_length=16, choices=Role.choices, blank=True)

    class Meta:
        ordering = ("order",)
        constraints = [
            models.UniqueConstraint(fields=["version", "order"], name="workflows_step_order_unique"),
            models.CheckConstraint(
                condition=(
                    models.Q(approver_type="user", approver_user__isnull=False, approver_role="")
                    | models.Q(approver_type="role", approver_user__isnull=True) & ~models.Q(approver_role="")
                ),
                name="workflows_step_approver_consistent",
            ),
        ]

    def __str__(self) -> str:
        return f"{self.order}. {self.name}"

    def _ensure_draft(self) -> None:
        status = TemplateVersion.objects.filter(pk=self.version_id).values_list("status", flat=True).first()
        if status is not None and status != VersionStatus.DRAFT:
            raise ImmutableVersionError("Steps of a published or archived version cannot change.")

    def save(self, *args: Any, **kwargs: Any) -> None:
        self._ensure_draft()
        super().save(*args, **kwargs)

    def delete(self, *args: Any, **kwargs: Any) -> tuple[int, dict[str, int]]:
        self._ensure_draft()
        return super().delete(*args, **kwargs)
