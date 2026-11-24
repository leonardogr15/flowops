"""Requests and their approval tasks (ADR-0006).

A draft references a workflow *template*. On submit, the template's published version at that
moment is pinned and the first step is copied into an approval task. Steps are decided strictly in
order; at most one task is open per request.
"""

from __future__ import annotations

from django.conf import settings
from django.db import models
from django.db.models import Q

from apps.organizations.models import Role, TenantModel
from apps.workflows.models import ApproverType, TemplateVersion, WorkflowTemplate


class RequestStatus(models.TextChoices):
    DRAFT = "draft", "Draft"
    IN_REVIEW = "in_review", "In review"
    APPROVED = "approved", "Approved"
    REJECTED = "rejected", "Rejected"
    CANCELLED = "cancelled", "Cancelled"


TERMINAL = frozenset({RequestStatus.APPROVED, RequestStatus.REJECTED, RequestStatus.CANCELLED})


class Request(TenantModel):
    template = models.ForeignKey(WorkflowTemplate, on_delete=models.PROTECT, related_name="requests")
    template_version = models.ForeignKey(
        TemplateVersion, on_delete=models.PROTECT, null=True, blank=True, related_name="requests"
    )
    requester = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name="+")
    title = models.CharField(max_length=160)
    description = models.TextField(max_length=4000, blank=True)
    amount = models.DecimalField(max_digits=14, decimal_places=2, null=True, blank=True)
    currency = models.CharField(max_length=3, blank=True)
    status = models.CharField(max_length=16, choices=RequestStatus.choices, default=RequestStatus.DRAFT)
    current_step = models.PositiveSmallIntegerField(null=True, blank=True)
    submitted_at = models.DateTimeField(null=True, blank=True)
    closed_at = models.DateTimeField(null=True, blank=True)
    revision = models.PositiveIntegerField(default=1)
    duplicated_from = models.ForeignKey(
        "self", on_delete=models.SET_NULL, null=True, blank=True, related_name="+"
    )

    class Meta:
        ordering = ("-created_at",)
        constraints = [
            models.CheckConstraint(
                condition=Q(status__in=RequestStatus.values), name="requests_status_valid"
            ),
            models.CheckConstraint(
                condition=Q(amount__isnull=True) | Q(amount__gte=0), name="requests_amount_positive"
            ),
            models.CheckConstraint(
                condition=(Q(amount__isnull=True) & Q(currency=""))
                | (Q(amount__isnull=False) & ~Q(currency="")),
                name="requests_amount_and_currency_together",
            ),
            # Submitted requests always know their pinned version; drafts never do.
            models.CheckConstraint(
                condition=Q(status="draft", template_version__isnull=True)
                | Q(status="cancelled")
                | Q(status__in=["in_review", "approved", "rejected"], template_version__isnull=False),
                name="requests_version_pinned_after_submit",
            ),
        ]
        indexes = [
            models.Index(fields=["organization", "status"], name="requests_org_status_idx"),
            models.Index(fields=["organization", "requester"], name="requests_org_requester_idx"),
        ]

    def __str__(self) -> str:
        return self.title


class TaskStatus(models.TextChoices):
    OPEN = "open", "Open"
    APPROVED = "approved", "Approved"
    REJECTED = "rejected", "Rejected"
    CANCELLED = "cancelled", "Cancelled"


class ApprovalTask(TenantModel):
    """One step of a submitted request. The step definition is copied so history stays exact."""

    request = models.ForeignKey(Request, on_delete=models.PROTECT, related_name="tasks")
    step_order = models.PositiveSmallIntegerField()
    step_name = models.CharField(max_length=120)
    approver_type = models.CharField(max_length=8, choices=ApproverType.choices)
    approver_user = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.PROTECT, null=True, blank=True, related_name="+"
    )
    approver_role = models.CharField(max_length=16, choices=Role.choices, blank=True)
    status = models.CharField(max_length=16, choices=TaskStatus.choices, default=TaskStatus.OPEN)
    decided_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.PROTECT, null=True, blank=True, related_name="+"
    )
    decided_at = models.DateTimeField(null=True, blank=True)
    comment = models.TextField(max_length=2000, blank=True)
    fallback = models.BooleanField(
        default=False, help_text="Decided by an admin because no regular approver was eligible."
    )

    class Meta:
        ordering = ("step_order",)
        constraints = [
            models.UniqueConstraint(fields=["request", "step_order"], name="requests_task_step_unique"),
            models.UniqueConstraint(
                fields=["request"], condition=Q(status="open"), name="requests_one_open_task_per_request"
            ),
            models.CheckConstraint(
                condition=Q(status__in=TaskStatus.values), name="requests_task_status_valid"
            ),
            models.CheckConstraint(
                condition=Q(status="open", decided_by__isnull=True)
                | Q(status="cancelled", decided_by__isnull=True)
                | Q(status__in=["approved", "rejected"], decided_by__isnull=False, decided_at__isnull=False),
                name="requests_task_decision_consistent",
            ),
        ]

    def __str__(self) -> str:
        return f"{self.request_id} step {self.step_order} ({self.status})"


class Comment(TenantModel):
    request = models.ForeignKey(Request, on_delete=models.PROTECT, related_name="comments")
    author = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name="+")
    body = models.TextField(max_length=2000)

    class Meta:
        ordering = ("created_at",)

    def __str__(self) -> str:
        return f"Comment by {self.author_id} on {self.request_id}"
