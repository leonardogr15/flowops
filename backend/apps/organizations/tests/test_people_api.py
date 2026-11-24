"""FO-016 invitations and FO-017 member management."""

from __future__ import annotations

import threading
from collections.abc import Callable
from datetime import timedelta

import pytest
from django.core import mail
from django.db import connection
from django.utils import timezone
from rest_framework.test import APIClient

from apps.accounts.models import User
from apps.organizations.members import change_role, hash_token
from apps.organizations.models import Invitation, Membership, Organization, Role
from common.tests.support import login

pytestmark = pytest.mark.django_db

NEW_PASSWORD = "a-strong-new-passphrase-42"


def membership(org: Organization, user: User) -> Membership:
    return Membership.objects.get(organization=org, user=user)


def invite_via_api(
    api: APIClient, email: str = "new.person@example.test", role: str = "member"
) -> dict[str, str]:
    response = api.post("/api/v1/org/invitations", {"email": email, "role": role}, format="json")
    assert response.status_code == 201, response.content
    body: dict[str, str] = response.json()
    return body


def token_of(body: dict[str, str]) -> str:
    return body["accept_url"].rsplit("/", 1)[-1]


# --- invitations ---------------------------------------------------------------------------------


def test_admin_invites_and_the_email_contains_a_single_use_link(
    api: APIClient,
    make_org: Callable[..., Organization],
    member_of: Callable[..., User],
    django_capture_on_commit_callbacks: Callable[..., object],
) -> None:
    org = make_org("Orbital")
    login(api, member_of(org, Role.ADMIN), org)
    with django_capture_on_commit_callbacks(execute=True):  # type: ignore[attr-defined]
        body = invite_via_api(api, "New.Person@Example.TEST")
    assert body["email"] == "new.person@example.test"
    token = token_of(body)
    assert len(mail.outbox) == 1
    assert token in mail.outbox[0].body
    assert mail.outbox[0].to == ["new.person@example.test"]
    stored = Invitation.objects.get()
    assert stored.token_hash == hash_token(token)
    assert token not in stored.token_hash  # only the hash is stored
    listed = api.get("/api/v1/org/invitations").json()
    assert [i["email"] for i in listed] == ["new.person@example.test"]
    assert "accept_url" not in listed[0]  # the link is shown once, at creation


def test_new_person_accepts_creates_account_and_is_signed_in(
    api: APIClient, make_org: Callable[..., Organization], member_of: Callable[..., User]
) -> None:
    org = make_org("Orbital")
    login(api, member_of(org, Role.ADMIN), org)
    token = token_of(invite_via_api(api, role="admin"))

    guest = APIClient(enforce_csrf_checks=True)
    preview = guest.get(f"/api/v1/invitations/{token}")
    assert preview.status_code == 200
    assert preview.json()["organization_name"] == "Orbital"
    assert preview.json()["account_exists"] is False

    csrf = guest.get("/api/v1/auth/csrf").json()["csrfToken"]
    accepted = guest.post(
        f"/api/v1/invitations/{token}/accept",
        {"full_name": "New Person", "password": NEW_PASSWORD},
        format="json",
        HTTP_X_CSRFTOKEN=csrf,
    )
    assert accepted.status_code == 201, accepted.content
    assert accepted.json()["role"] == "admin"
    assert guest.get("/api/v1/auth/me").json()["email"] == "new.person@example.test"  # signed in
    # single use (the CSRF token rotates when the new account signs in)
    rotated = guest.cookies["csrftoken"].value
    assert rotated != csrf
    again = guest.post(f"/api/v1/invitations/{token}/accept", {}, format="json", HTTP_X_CSRFTOKEN=rotated)
    assert again.status_code == 404


def test_accepting_requires_csrf(
    api: APIClient, make_org: Callable[..., Organization], member_of: Callable[..., User]
) -> None:
    org = make_org()
    login(api, member_of(org, Role.ADMIN), org)
    token = token_of(invite_via_api(api))
    guest = APIClient(enforce_csrf_checks=True)
    response = guest.post(
        f"/api/v1/invitations/{token}/accept", {"full_name": "X Y", "password": NEW_PASSWORD}, format="json"
    )
    assert response.status_code == 403


def test_weak_password_and_missing_name_are_rejected(
    api: APIClient, make_org: Callable[..., Organization], member_of: Callable[..., User]
) -> None:
    org = make_org()
    login(api, member_of(org, Role.ADMIN), org)
    token = token_of(invite_via_api(api))
    guest = APIClient()
    response = guest.post(
        f"/api/v1/invitations/{token}/accept", {"full_name": "", "password": "123"}, format="json"
    )
    assert response.status_code == 400
    assert set(response.json()["errors"]) == {"full_name", "password"}
    assert not User.objects.filter(email="new.person@example.test").exists()


def test_existing_account_must_sign_in_with_the_invited_email(
    api: APIClient,
    make_org: Callable[..., Organization],
    member_of: Callable[..., User],
    make_user: Callable[..., User],
) -> None:
    org = make_org()
    login(api, member_of(org, Role.ADMIN), org)
    invited = make_user(email="raj@example.test")
    token = token_of(invite_via_api(api, "raj@example.test"))

    anonymous = APIClient().post(f"/api/v1/invitations/{token}/accept", {}, format="json")
    assert anonymous.status_code == 409
    assert anonymous.json()["type"].endswith(":sign_in_required")

    someone_else = login(APIClient(enforce_csrf_checks=True), make_user(email="other@example.test"))
    wrong = someone_else.post(f"/api/v1/invitations/{token}/accept", {}, format="json")
    assert wrong.status_code == 403  # a forwarded link cannot be used by another account

    owner_of_email = login(APIClient(enforce_csrf_checks=True), invited)
    ok = owner_of_email.post(f"/api/v1/invitations/{token}/accept", {}, format="json")
    assert ok.status_code == 201
    assert membership(org, invited).role == Role.MEMBER


@pytest.mark.parametrize("state", ["expired", "revoked", "unknown"])
def test_unusable_links_look_the_same(
    api: APIClient, make_org: Callable[..., Organization], member_of: Callable[..., User], state: str
) -> None:
    org = make_org()
    login(api, member_of(org, Role.ADMIN), org)
    body = invite_via_api(api)
    token = token_of(body)
    if state == "expired":
        Invitation.objects.update(expires_at=timezone.now() - timedelta(seconds=1))
    elif state == "revoked":
        assert api.delete(f"/api/v1/org/invitations/{body['id']}").status_code == 204
    else:
        token = "x" * 43
    response = APIClient().get(f"/api/v1/invitations/{token}")
    assert response.status_code == 404
    assert response.json()["detail"] == "This invitation link is invalid or has expired."


def test_reinviting_replaces_the_previous_link(
    api: APIClient, make_org: Callable[..., Organization], member_of: Callable[..., User]
) -> None:
    org = make_org()
    login(api, member_of(org, Role.ADMIN), org)
    first = token_of(invite_via_api(api))
    second = token_of(invite_via_api(api))
    assert APIClient().get(f"/api/v1/invitations/{first}").status_code == 404
    assert APIClient().get(f"/api/v1/invitations/{second}").status_code == 200


@pytest.mark.parametrize(
    ("inviter_role", "invited_role", "expected"),
    [
        (Role.MEMBER, "member", 403),
        (Role.ADMIN, "member", 201),
        (Role.ADMIN, "admin", 201),
        (Role.ADMIN, "owner", 400),  # owner is not an invitable role
        (Role.OWNER, "admin", 201),
    ],
)
def test_invitation_permissions(
    api: APIClient,
    make_org: Callable[..., Organization],
    member_of: Callable[..., User],
    inviter_role: str,
    invited_role: str,
    expected: int,
) -> None:
    org = make_org()
    login(api, member_of(org, inviter_role), org)
    response = api.post(
        "/api/v1/org/invitations", {"email": "x@example.test", "role": invited_role}, format="json"
    )
    assert response.status_code == expected


def test_cannot_invite_an_existing_member(
    api: APIClient, make_org: Callable[..., Organization], member_of: Callable[..., User]
) -> None:
    org = make_org()
    existing = member_of(org)
    login(api, member_of(org, Role.ADMIN), org)
    response = api.post("/api/v1/org/invitations", {"email": existing.email.upper()}, format="json")
    assert response.status_code == 409


# --- member management ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    ("actor_role", "target_role", "new_role", "expected"),
    [
        (Role.MEMBER, Role.MEMBER, "admin", 403),
        (Role.ADMIN, Role.MEMBER, "admin", 200),
        (Role.ADMIN, Role.ADMIN, "member", 200),
        (Role.ADMIN, Role.MEMBER, "owner", 403),  # only owners grant ownership
        (Role.ADMIN, Role.OWNER, "member", 403),  # only owners change owners
        (Role.OWNER, Role.MEMBER, "owner", 200),
    ],
)
def test_role_change_matrix(
    api: APIClient,
    make_org: Callable[..., Organization],
    member_of: Callable[..., User],
    actor_role: str,
    target_role: str,
    new_role: str,
    expected: int,
) -> None:
    org = make_org()
    member_of(org, Role.OWNER)  # keep an owner around in every scenario
    target = membership(org, member_of(org, target_role))
    login(api, member_of(org, actor_role), org)
    response = api.patch(f"/api/v1/org/members/{target.pk}", {"role": new_role}, format="json")
    assert response.status_code == expected
    target.refresh_from_db()
    assert target.role == (new_role if expected == 200 else target_role)


def test_member_cannot_promote_themselves(
    api: APIClient, make_org: Callable[..., Organization], member_of: Callable[..., User]
) -> None:
    org = make_org()
    me = member_of(org)
    login(api, me, org)
    response = api.patch(f"/api/v1/org/members/{membership(org, me).pk}", {"role": "admin"}, format="json")
    assert response.status_code == 403
    assert membership(org, me).role == Role.MEMBER


def test_last_owner_cannot_be_demoted_or_removed(
    api: APIClient, make_org: Callable[..., Organization], member_of: Callable[..., User]
) -> None:
    org = make_org()
    owner = member_of(org, Role.OWNER)
    login(api, owner, org)
    own = membership(org, owner)
    demote = api.patch(f"/api/v1/org/members/{own.pk}", {"role": "admin"}, format="json")
    assert demote.status_code == 409
    leave = api.delete(f"/api/v1/org/members/{own.pk}")
    assert leave.status_code == 409
    assert membership(org, owner).role == Role.OWNER


def test_owner_can_step_down_once_another_owner_exists(
    api: APIClient, make_org: Callable[..., Organization], member_of: Callable[..., User]
) -> None:
    org = make_org()
    owner = member_of(org, Role.OWNER)
    member_of(org, Role.OWNER)
    login(api, owner, org)
    response = api.patch(f"/api/v1/org/members/{membership(org, owner).pk}", {"role": "admin"}, format="json")
    assert response.status_code == 200


def test_admin_removes_member_and_member_can_leave(
    api: APIClient, make_org: Callable[..., Organization], member_of: Callable[..., User]
) -> None:
    org = make_org()
    member_of(org, Role.OWNER)
    removed = membership(org, member_of(org))
    leaver = member_of(org)
    login(api, member_of(org, Role.ADMIN), org)
    assert api.delete(f"/api/v1/org/members/{removed.pk}").status_code == 204
    other = login(APIClient(enforce_csrf_checks=True), leaver, org)
    assert other.delete(f"/api/v1/org/members/{membership(org, leaver).pk}").status_code == 204
    assert Membership.objects.filter(organization=org).count() == 2


def test_member_cannot_remove_others(
    api: APIClient, make_org: Callable[..., Organization], member_of: Callable[..., User]
) -> None:
    org = make_org()
    victim = membership(org, member_of(org))
    login(api, member_of(org), org)
    assert api.delete(f"/api/v1/org/members/{victim.pk}").status_code == 403


@pytest.mark.django_db(transaction=True)
def test_concurrent_demotions_keep_one_owner(
    make_org: Callable[..., Organization], member_of: Callable[..., User]
) -> None:
    """Two owners demote each other at the same time: row locks let exactly one succeed."""
    org = make_org()
    a, b = membership(org, member_of(org, Role.OWNER)), membership(org, member_of(org, Role.OWNER))
    barrier = threading.Barrier(2)
    results: list[str] = []

    def demote(actor: Membership, target: Membership) -> None:
        barrier.wait()
        try:
            change_role(actor=actor, member_id=target.pk, role=Role.ADMIN)
            results.append("ok")
        except Exception as exc:
            results.append(type(exc).__name__)
        finally:
            connection.close()

    threads = [threading.Thread(target=demote, args=(a, b)), threading.Thread(target=demote, args=(b, a))]
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    assert Membership.objects.filter(organization=org, role=Role.OWNER).count() >= 1
    assert sorted(results) == ["Conflict", "ok"] or sorted(results) == ["PermissionDenied", "ok"]
