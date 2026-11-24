from __future__ import annotations

from django.conf import settings
from django.db import models

from common.models import TimeStampedModel


class Organization(TimeStampedModel):
    name = models.CharField(max_length=120)
    slug = models.SlugField(max_length=64, unique=True)

    class Meta:
        ordering = ("name",)

    def __str__(self) -> str:
        return self.name


class TenantModel(TimeStampedModel):
    """Base for every tenant-owned table (ADR-0001).

    Rows are only reachable through views that scope querysets to the active organization;
    the isolation test harness enforces that for every API endpoint.
    """

    organization = models.ForeignKey(Organization, on_delete=models.CASCADE, related_name="+")

    class Meta:
        abstract = True


class Role(models.TextChoices):
    OWNER = "owner", "Owner"
    ADMIN = "admin", "Admin"
    MEMBER = "member", "Member"


ROLE_RANK = {Role.MEMBER: 1, Role.ADMIN: 2, Role.OWNER: 3}


class Membership(TenantModel):
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="memberships")
    role = models.CharField(max_length=16, choices=Role.choices, default=Role.MEMBER)

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=["organization", "user"], name="organizations_membership_unique"),
            models.CheckConstraint(
                condition=models.Q(role__in=Role.values), name="organizations_membership_role_valid"
            ),
        ]
        indexes = [models.Index(fields=["organization", "role"], name="org_membership_org_role_idx")]

    def __str__(self) -> str:
        return f"{self.user_id} @ {self.organization_id} ({self.role})"

    def has_role(self, minimum: str) -> bool:
        return ROLE_RANK[Role(self.role)] >= ROLE_RANK[Role(minimum)]


INVITABLE_ROLES = (Role.ADMIN, Role.MEMBER)
INVITABLE_ROLE_CHOICES = [(r.value, r.label) for r in INVITABLE_ROLES]


class Invitation(TenantModel):
    """A single-use, expiring invitation. Only a SHA-256 hash of the token is stored."""

    email = models.EmailField(max_length=254)
    role = models.CharField(max_length=16, choices=Role.choices, default=Role.MEMBER)
    token_hash = models.CharField(max_length=64, unique=True)
    invited_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, related_name="+"
    )
    expires_at = models.DateTimeField()
    accepted_at = models.DateTimeField(null=True, blank=True)
    revoked_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ("-created_at",)
        constraints = [
            models.CheckConstraint(
                condition=models.Q(role__in=[r.value for r in INVITABLE_ROLES]),
                name="organizations_invitation_role_invitable",
            ),
            # At most one open invitation per email and organization.
            models.UniqueConstraint(
                fields=["organization", "email"],
                condition=models.Q(accepted_at__isnull=True, revoked_at__isnull=True),
                name="organizations_invitation_one_pending",
            ),
        ]

    def __str__(self) -> str:
        return f"{self.email} -> {self.organization_id} ({self.role})"

    @property
    def is_pending(self) -> bool:
        from django.utils import timezone

        return self.accepted_at is None and self.revoked_at is None and self.expires_at > timezone.now()
