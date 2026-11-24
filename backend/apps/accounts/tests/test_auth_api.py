from __future__ import annotations

from collections.abc import Callable

import pytest
from rest_framework.test import APIClient

from apps.accounts.models import User
from common.tests.support import PASSWORD, login

pytestmark = pytest.mark.django_db


def csrf(client: APIClient) -> str:
    token: str = client.get("/api/v1/auth/csrf").json()["csrfToken"]
    return token


def post_login(client: APIClient, email: str, password: str, token: str | None = None) -> object:
    headers = {"HTTP_X_CSRFTOKEN": token} if token else {}
    return client.post("/api/v1/auth/login", {"email": email, "password": password}, format="json", **headers)


def test_login_me_logout_flow(api: APIClient, make_user: Callable[..., User]) -> None:
    user = make_user(email="maya@example.test", full_name="Maya")
    login(api, user)

    me = api.get("/api/v1/auth/me")
    assert me.status_code == 200
    assert me.json()["email"] == "maya@example.test"
    assert "password" not in me.json()

    assert api.post("/api/v1/auth/logout").status_code == 204
    assert api.get("/api/v1/auth/me").status_code == 401


def test_login_accepts_email_in_any_case(api: APIClient, make_user: Callable[..., User]) -> None:
    make_user(email="maya@example.test")
    response = post_login(api, "MAYA@Example.test", PASSWORD, csrf(api))
    assert response.status_code == 200  # type: ignore[attr-defined]


def test_login_without_csrf_token_is_rejected(api: APIClient, make_user: Callable[..., User]) -> None:
    user = make_user()
    response = post_login(api, user.email, PASSWORD)
    assert response.status_code == 403  # type: ignore[attr-defined]


def test_logout_without_csrf_token_is_rejected(api: APIClient, make_user: Callable[..., User]) -> None:
    login(api, make_user())
    api.credentials()  # drop the CSRF header, keep the session cookie
    assert api.post("/api/v1/auth/logout").status_code == 403


@pytest.mark.parametrize(
    ("email", "password"),
    [("maya@example.test", "wrong-password-123"), ("nobody@example.test", PASSWORD)],
    ids=["wrong-password", "unknown-email"],
)
def test_bad_credentials_get_one_generic_error(
    api: APIClient, make_user: Callable[..., User], email: str, password: str
) -> None:
    make_user(email="maya@example.test")
    response = post_login(api, email, password, csrf(api))
    assert response.status_code == 401  # type: ignore[attr-defined]
    body = response.json()  # type: ignore[attr-defined]
    assert body["detail"] == "Invalid email or password."
    assert response["Content-Type"] == "application/problem+json"  # type: ignore[index]


def test_inactive_user_gets_the_same_generic_error(api: APIClient, make_user: Callable[..., User]) -> None:
    user = make_user(is_active=False)
    response = post_login(api, user.email, PASSWORD, csrf(api))
    assert response.status_code == 401  # type: ignore[attr-defined]
    assert response.json()["detail"] == "Invalid email or password."  # type: ignore[attr-defined]


def test_login_validates_payload(api: APIClient) -> None:
    response = post_login(api, "not-an-email", "", csrf(api))
    assert response.status_code == 400  # type: ignore[attr-defined]
    body = response.json()  # type: ignore[attr-defined]
    assert set(body["errors"]) == {"email", "password"}
    assert body["type"].endswith(":validation_error")


def test_login_is_throttled_per_ip_and_email(api: APIClient, make_user: Callable[..., User]) -> None:
    user = make_user()
    token = csrf(api)
    statuses = [post_login(api, user.email, "wrong-password-123", token).status_code for _ in range(6)]  # type: ignore[attr-defined]
    assert statuses[:5] == [401] * 5
    assert statuses[5] == 429
    # another account from the same IP is not locked out by the first one's failures
    other = make_user()
    assert post_login(api, other.email, PASSWORD, token).status_code == 200  # type: ignore[attr-defined]


def test_session_key_rotates_on_login(api: APIClient, make_user: Callable[..., User]) -> None:
    user = make_user()
    api.get("/api/v1/auth/csrf")
    api.session.save()
    before = api.cookies.get("sessionid")
    login(api, user)
    assert api.cookies["sessionid"].value != (before.value if before else None)


def test_session_cookie_is_http_only(api: APIClient, make_user: Callable[..., User]) -> None:
    login(api, make_user())
    assert api.cookies["sessionid"]["httponly"]
    assert api.cookies["sessionid"]["samesite"] == "Lax"


def test_spoofed_forwarded_for_does_not_bypass_the_throttle(
    api: APIClient, make_user: Callable[..., User]
) -> None:
    """Behind one trusted proxy, only the address that proxy appended identifies the client."""
    from rest_framework.settings import api_settings

    original = api_settings.NUM_PROXIES
    api_settings.NUM_PROXIES = 1  # type: ignore[misc]
    try:
        user = make_user()
        token = csrf(api)
        statuses = []
        for i in range(6):
            forwarded = f"10.0.0.{i}, 203.0.113.7"  # attacker-controlled prefix, proxy-appended suffix
            statuses.append(
                api.post(
                    "/api/v1/auth/login",
                    {"email": user.email, "password": "wrong-password-123"},
                    format="json",
                    HTTP_X_CSRFTOKEN=token,
                    HTTP_X_FORWARDED_FOR=forwarded,
                ).status_code
            )
        assert statuses[5] == 429
    finally:
        api_settings.NUM_PROXIES = original  # type: ignore[misc]


def test_one_ip_cannot_spray_many_accounts(api: APIClient, make_user: Callable[..., User]) -> None:
    token = csrf(api)
    statuses = [
        post_login(api, f"victim{i}@example.test", "wrong-password-123", token).status_code  # type: ignore[attr-defined]
        for i in range(31)
    ]
    assert statuses[:30] == [401] * 30
    assert statuses[30] == 429


def test_very_long_email_is_rejected_cleanly(api: APIClient) -> None:
    response = post_login(api, "a" * 5000 + "@example.test", "x", csrf(api))
    assert response.status_code == 400  # type: ignore[attr-defined]
