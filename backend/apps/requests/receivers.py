"""Reactions to changes in other apps (connected in RequestsConfig.ready)."""

from __future__ import annotations

from typing import Any

from django.dispatch import receiver

from apps.organizations.models import Organization
from apps.organizations.signals import membership_changed

from . import services


@receiver(membership_changed, dispatch_uid="requests.escalate_unreachable_tasks")
def escalate_after_membership_change(sender: Any, organization: Organization, **kwargs: Any) -> None:
    services.escalate_unreachable_tasks(organization_id=organization.pk)
