"""SEC-01: invitation tokens never reach the logs.

SEC-02: creating invitations and organizations is rate limited.
"""

from __future__ import annotations

import logging
from collections.abc import Callable

import pytest
from rest_framework.test import APIClient

from apps.accounts.models import User
from apps.organizations.models import Organization, Role
from common.logging import JSONFormatter
from common.redaction import RedactFilter, redact
from common.tests.support import PASSWORD, login

pytestmark = pytest.mark.django_db


def _formatted(caplog: pytest.LogCaptureFixture) -> str:
    formatter = JSONFormatter()
    return "\n".join(formatter.format(record) for record in caplog.records)


def test_redact_hides_tokens_in_api_paths_spa_links_and_reprs_only() -> None:
    token = "tok_" + "A1b2C3d4" * 5
    assert redact(f"/api/v1/invitations/{token}") == "/api/v1/invitations/[redacted]"
    assert redact(f"/api/v1/invitations/{token}/accept") == "/api/v1/invitations/[redacted]/accept"
    assert (
        redact(f"https://flowops.example/invite/{token}?x=1")
        == "https://flowops.example/invite/[redacted]?x=1"
    )
    assert (
        redact(f"<WSGIRequest: GET '/api/v1/invitations/{token}'>")
        == "<WSGIRequest: GET '/api/v1/invitations/[redacted]'>"
    )
    assert redact("/api/v1/org/invitations/0b3e8c52-6a3e-4f43-9d55-5c4b3a6c1a01") == (
        "/api/v1/org/invitations/0b3e8c52-6a3e-4f43-9d55-5c4b3a6c1a01"  # admin route by id: not a credential
    )
    assert redact("/api/v1/invitations/[redacted]") == "/api/v1/invitations/[redacted]"


def test_plain_text_handlers_are_redacted_too() -> None:
    """Handlers that don't use the JSON formatter (e.g. Django's DEBUG console) get the filter."""
    token = "tok_" + "Z9y8X7w6" * 5
    record = logging.LogRecord(
        "django.request",
        logging.WARNING,
        __file__,
        1,
        "Not Found: %s",
        (f"/api/v1/invitations/{token}",),
        None,
    )
    assert RedactFilter().filter(record) is True
    assert record.getMessage() == "Not Found: /api/v1/invitations/[redacted]"


def test_django_loggers_use_the_redacting_handler() -> None:
    from config.settings import base

    django_logger = base.LOGGING["loggers"]["django"]
    assert django_logger == {"handlers": ["console"], "level": "INFO", "propagate": False}
    assert base.LOGGING["loggers"]["django.server"]["handlers"] == ["console"]  # runserver lines too
    assert base.LOGGING["handlers"]["console"]["filters"] == ["redact"]
    assert base.LOGGING["handlers"]["console"]["formatter"] == "json"


def test_invitation_tokens_never_appear_in_log_output(
    api: APIClient,
    make_org: Callable[..., Organization],
    member_of: Callable[..., User],
    caplog: pytest.LogCaptureFixture,
) -> None:
    org = make_org("Orbital")
    login(api, member_of(org, Role.ADMIN), org)
    issued = api.post("/api/v1/org/invitations", {"email": "new.person@example.test"}, format="json")
    assert issued.status_code == 201
    token = issued.json()["accept_url"].rsplit("/", 1)[-1]
    unknown = "never-issued-" + "x" * 30

    caplog.set_level(logging.INFO)
    anonymous = APIClient()
    csrf = anonymous.get("/api/v1/auth/csrf").json()["csrfToken"]
    anonymous.credentials(HTTP_X_CSRFTOKEN=csrf)
    assert anonymous.get(f"/api/v1/invitations/{token}").status_code == 200
    assert anonymous.get(f"/api/v1/invitations/{unknown}").status_code == 404  # logged as a warning by Django
    accepted = anonymous.post(
        f"/api/v1/invitations/{token}/accept",
        {"full_name": "New Person", "password": PASSWORD},
        format="json",
    )
    assert accepted.status_code in (200, 201), accepted.content
    assert anonymous.post(f"/api/v1/invitations/{token}/accept", {}, format="json").status_code >= 400

    output = _formatted(caplog)
    assert "/api/v1/invitations/[redacted]" in output  # the requests were logged...
    assert token not in output  # ...but never the credential
    assert unknown not in output
    for record in caplog.records:
        assert token not in str(getattr(record, "path", ""))


def _issue(api: APIClient, n: int) -> int:
    return api.post(
        "/api/v1/org/invitations", {"email": f"person{n}@example.test"}, format="json"
    ).status_code


def test_sending_invitations_is_limited_per_user_and_listing_is_not(
    api: APIClient, make_org: Callable[..., Organization], member_of: Callable[..., User]
) -> None:
    org = make_org("Orbital")
    login(api, member_of(org, Role.ADMIN), org)
    assert [_issue(api, n) for n in range(30)] == [201] * 30

    blocked = api.post("/api/v1/org/invitations", {"email": "one.more@example.test"}, format="json")
    assert blocked.status_code == 429
    assert blocked["Content-Type"] == "application/problem+json"
    assert int(blocked["Retry-After"]) > 0
    assert blocked.json()["status"] == 429
    assert api.get("/api/v1/org/invitations").status_code == 200  # reading is never throttled

    other = APIClient()
    login(other, member_of(org, Role.ADMIN), org)
    assert _issue(other, 99) == 201  # the limit is per person, not per organization


def test_creating_organizations_is_limited_per_user(make_user: Callable[..., User]) -> None:
    api = login(APIClient(), make_user())
    created = [
        api.post("/api/v1/organizations", {"name": f"Venture {n}"}, format="json").status_code
        for n in range(5)
    ]
    assert created == [201] * 5

    blocked = api.post("/api/v1/organizations", {"name": "Venture 6"}, format="json")
    assert blocked.status_code == 429
    assert blocked["Content-Type"] == "application/problem+json"
    assert int(blocked["Retry-After"]) > 0
    assert api.get("/api/v1/organizations").status_code == 200

    someone_else = login(APIClient(), make_user())
    assert (
        someone_else.post("/api/v1/organizations", {"name": "Their venture"}, format="json").status_code
        == 201
    )
