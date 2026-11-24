"""Use cases for invitations and member management (FO-016, FO-017).

Rules
- Only admins and owners manage people. Only owners manage owners (grant, revoke, remove).
- Nobody can invite with a role above their own; the owner role is never granted by invitation.
- An organization always keeps at least one owner. Owner rows are locked (SELECT ... FOR UPDATE)
  before the check, so two concurrent demotions cannot both succeed.
- Invitation tokens are random 256-bit values; only their SHA-256 hash is stored. An invitation is
  single-use, expires after 7 days, and can only be accepted by the invited email address.
"""

from __future__ import annotations

import hashlib
import logging
import secrets
from dataclasses import dataclass
from datetime import timedelta
from uuid import UUID

from django.conf import settings
from django.contrib.auth.password_validation import validate_password
from django.core.exceptions import ValidationError as DjangoValidationError
from django.core.mail import send_mail
from django.db import IntegrityError, transaction
from django.utils import timezone
from rest_framework.exceptions import NotFound, PermissionDenied
from rest_framework.exceptions import ValidationError as APIValidationError

from apps.accounts.models import User, normalize_email
from apps.audit.service import record
from common.errors import Conflict

from .models import ROLE_RANK, Invitation, Membership, Organization, Role
from .signals import membership_changed

logger = logging.getLogger(__name__)
INVITATION_TTL = timedelta(days=7)


class SignInRequired(Conflict):
    default_detail = "An account already exists for this email. Sign in to accept the invitation."
    default_code = "sign_in_required"


def hash_token(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


def accept_url(token: str) -> str:
    return f"{settings.FRONTEND_URL.rstrip('/')}/invite/{token}"


def _rank(role: str) -> int:
    return ROLE_RANK[Role(role)]


def _require_manager(actor: Membership) -> None:
    if not actor.has_role(Role.ADMIN):
        raise PermissionDenied("Only admins and owners can manage members.")


# --------------------------------------------------------------------------- invitations


@dataclass(frozen=True)
class IssuedInvitation:
    invitation: Invitation
    token: str  # returned once to the inviter; never stored


@transaction.atomic
def invite(*, actor: Membership, email: str, role: str) -> IssuedInvitation:
    _require_manager(actor)
    if _rank(role) > _rank(actor.role) or role == Role.OWNER:
        raise PermissionDenied("You can't invite someone with a role above your own.")
    organization = actor.organization
    email = normalize_email(email)
    if Membership.objects.filter(organization=organization, user__email=email).exists():
        raise Conflict("This person is already a member of the organization.")

    now = timezone.now()
    # Re-inviting replaces any open invitation (its link stops working).
    Invitation.objects.select_for_update().filter(
        organization=organization, email=email, accepted_at__isnull=True, revoked_at__isnull=True
    ).update(revoked_at=now)

    token = secrets.token_urlsafe(32)
    try:
        with transaction.atomic():
            invitation = Invitation.objects.create(
                organization=organization,
                email=email,
                role=role,
                token_hash=hash_token(token),
                invited_by=actor.user,
                expires_at=now + INVITATION_TTL,
            )
    except IntegrityError as exc:  # a concurrent invitation for the same address won
        raise Conflict("An invitation for this address was just sent. Refresh to see it.") from exc
    transaction.on_commit(lambda: _send_invitation_email(invitation, token))
    record(
        organization=organization,
        actor=actor.user,
        verb="invitation.sent",
        target_type="invitation",
        target_id=invitation.pk,
        data={"email": email, "role": role},
    )
    return IssuedInvitation(invitation, token)


def _send_invitation_email(invitation: Invitation, token: str) -> None:
    inviter = invitation.invited_by.full_name if invitation.invited_by else "An administrator"
    try:
        send_mail(
            subject=f"You're invited to {invitation.organization.name} on FlowOps",
            message=(
                f"{inviter} invited you to join {invitation.organization.name} on FlowOps "
                f"as {invitation.get_role_display().lower()}.\n\n"
                f"Accept the invitation: {accept_url(token)}\n\n"
                "The link works once and expires in 7 days."
            ),
            from_email=settings.DEFAULT_FROM_EMAIL,
            recipient_list=[invitation.email],
        )
    except Exception:  # the invitation stays valid; the admin can copy the link instead
        logger.exception("invitation_email_failed", extra={"invitation_id": str(invitation.id)})


@transaction.atomic
def revoke_invitation(*, actor: Membership, invitation_id: UUID) -> Invitation:
    invitation = (
        Invitation.objects.select_for_update()
        .filter(organization=actor.organization, pk=invitation_id)
        .first()
    )
    if invitation is None:  # foreign ids: 404 before any role check
        raise NotFound("Invitation not found.")
    _require_manager(actor)
    if not invitation.is_pending:
        raise Conflict("This invitation was already accepted, revoked or has expired.")
    invitation.revoked_at = timezone.now()
    invitation.save(update_fields=["revoked_at", "updated_at"])
    record(
        organization=actor.organization,
        actor=actor.user,
        verb="invitation.revoked",
        target_type="invitation",
        target_id=invitation.pk,
        data={"email": invitation.email},
    )
    return invitation


def pending_invitations(organization: Organization) -> list[Invitation]:
    return list(
        Invitation.objects.select_related("invited_by").filter(
            organization=organization,
            accepted_at__isnull=True,
            revoked_at__isnull=True,
            expires_at__gt=timezone.now(),
        )
    )


def find_pending_invitation(token: str) -> Invitation:
    invitation = (
        Invitation.objects.select_related("organization", "invited_by")
        .filter(token_hash=hash_token(token))
        .first()
    )
    if invitation is None or not invitation.is_pending:
        raise NotFound("This invitation link is invalid or has expired.")
    return invitation


@dataclass(frozen=True)
class Acceptance:
    membership: Membership
    created_user: User | None


@transaction.atomic
def accept_invitation(
    *, token: str, user: User | None, full_name: str = "", password: str = ""
) -> Acceptance:
    invitation = (
        Invitation.objects.select_for_update()
        .select_related("organization")
        .filter(token_hash=hash_token(token))
        .first()
    )
    if invitation is None or not invitation.is_pending:
        raise NotFound("This invitation link is invalid or has expired.")

    created: User | None = None
    if user is not None:
        if normalize_email(user.email) != invitation.email:
            raise PermissionDenied("This invitation was sent to a different email address.")
    else:
        if User.objects.filter(email=invitation.email).exists():
            raise SignInRequired()
        errors: dict[str, list[str]] = {}
        if len(full_name.strip()) < 2:
            errors["full_name"] = ["Enter your name."]
        try:
            validate_password(password, User(email=invitation.email, full_name=full_name))
        except Exception as exc:  # django ValidationError -> API field error
            errors["password"] = list(getattr(exc, "messages", [str(exc)]))
        if errors:
            raise APIValidationError(errors)
        try:
            with transaction.atomic():
                created = User.objects.create_user(invitation.email, password, full_name=full_name.strip())
        except (IntegrityError, DjangoValidationError) as exc:  # created concurrently
            raise SignInRequired() from exc
        user = created

    if Membership.objects.filter(organization=invitation.organization, user=user).exists():
        raise Conflict("You're already a member of this organization.")
    membership = Membership.objects.create(
        organization=invitation.organization, user=user, role=invitation.role
    )
    invitation.accepted_at = timezone.now()
    invitation.save(update_fields=["accepted_at", "updated_at"])
    record(
        organization=invitation.organization,
        actor=user,
        verb="invitation.accepted",
        target_type="membership",
        target_id=membership.pk,
        data={"email": invitation.email, "role": invitation.role, "new_account": created is not None},
    )
    return Acceptance(membership, created)


# --------------------------------------------------------------------------- members


def _lock_owners(organization: Organization) -> list[Membership]:
    return list(
        Membership.objects.select_for_update()
        .filter(organization=organization, role=Role.OWNER)
        .order_by("pk")
    )


def _lock_actor_and_target(actor: Membership, member_id: UUID) -> tuple[Membership, Membership]:
    """Locks both rows in primary-key order (deadlock-free) and re-reads the actor's current role."""
    rows = {
        m.pk: m
        for m in Membership.objects.select_for_update()
        .select_related("user")
        .filter(organization=actor.organization, pk__in={actor.pk, member_id})
        .order_by("pk")
    }
    current = rows.get(actor.pk)
    if current is None:
        raise PermissionDenied("You are no longer a member of this organization.")
    target = rows.get(member_id)
    if target is None:
        raise NotFound("Member not found.")
    return current, target


@transaction.atomic
def change_role(*, actor: Membership, member_id: UUID, role: str) -> Membership:
    owners = _lock_owners(actor.organization)
    actor, target = _lock_actor_and_target(actor, member_id)
    _require_manager(actor)
    if (target.role == Role.OWNER or role == Role.OWNER) and actor.role != Role.OWNER:
        raise PermissionDenied("Only owners can grant or change the owner role.")
    if target.role == role:
        return target
    if target.role == Role.OWNER and len(owners) <= 1:
        raise Conflict("An organization needs at least one owner. Make someone else an owner first.")
    previous = target.role
    target.role = role
    target.save(update_fields=["role", "updated_at"])
    record(
        organization=actor.organization,
        actor=actor.user,
        verb="member.role_changed",
        target_type="membership",
        target_id=target.pk,
        data={"email": target.user.email, "from": previous, "to": role},
    )
    membership_changed.send(sender=Membership, organization=actor.organization)
    return target


@transaction.atomic
def remove_member(*, actor: Membership, member_id: UUID) -> None:
    owners = _lock_owners(actor.organization)
    actor, target = _lock_actor_and_target(actor, member_id)
    leaving = target.pk == actor.pk
    if not leaving:
        _require_manager(actor)
        if target.role == Role.OWNER and actor.role != Role.OWNER:
            raise PermissionDenied("Only owners can remove an owner.")
    if target.role == Role.OWNER and len(owners) <= 1:
        raise Conflict("An organization needs at least one owner. Make someone else an owner first.")
    record(
        organization=actor.organization,
        actor=actor.user,
        verb="member.left" if leaving else "member.removed",
        target_type="membership",
        target_id=target.pk,
        data={"email": target.user.email, "role": target.role},
    )
    target.delete()
    membership_changed.send(sender=Membership, organization=actor.organization)
