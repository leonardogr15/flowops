"""Helpers shared by the test suite."""

from __future__ import annotations

from rest_framework.test import APIClient

from apps.accounts.models import User
from apps.organizations.models import Organization

PASSWORD = "correct-horse-battery-staple"  # fixture credential for test users only


def login(client: APIClient, user: User, organization: Organization | None = None) -> APIClient:
    """Authenticates through the real CSRF + login flow and sets the tenant header."""
    token = client.get("/api/v1/auth/csrf").json()["csrfToken"]
    client.credentials(HTTP_X_CSRFTOKEN=token)
    response = client.post("/api/v1/auth/login", {"email": user.email, "password": PASSWORD}, format="json")
    assert response.status_code == 200, response.content
    headers: dict[str, str] = {"HTTP_X_CSRFTOKEN": client.cookies["csrftoken"].value}  # rotated on login
    if organization is not None:
        headers["HTTP_X_ORGANIZATION"] = organization.slug
    client.credentials(**headers)
    return client
