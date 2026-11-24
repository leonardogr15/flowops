from __future__ import annotations

from collections.abc import Callable, Iterator
from typing import Any

import pytest
from django.core.cache import cache
from rest_framework.test import APIClient

from apps.accounts.models import User
from apps.organizations.models import Membership, Organization, Role
from common.tests.support import PASSWORD


@pytest.fixture(autouse=True)
def _clear_cache() -> Iterator[None]:
    cache.clear()
    yield
    cache.clear()


@pytest.fixture
def make_user(db: Any) -> Callable[..., User]:
    counter = {"n": 0}

    def factory(email: str | None = None, password: str = PASSWORD, **extra: Any) -> User:
        counter["n"] += 1
        return User.objects.create_user(email or f"user{counter['n']}@example.test", password, **extra)

    return factory


@pytest.fixture
def make_org(db: Any) -> Callable[..., Organization]:
    counter = {"n": 0}

    def factory(name: str | None = None) -> Organization:
        counter["n"] += 1
        return Organization.objects.create(name=name or f"Org {counter['n']}", slug=f"org-{counter['n']}")

    return factory


@pytest.fixture
def member_of(make_user: Callable[..., User]) -> Callable[..., User]:
    def factory(org: Organization, role: str = Role.MEMBER, **kwargs: Any) -> User:
        user = make_user(**kwargs)
        Membership.objects.create(organization=org, user=user, role=role)
        return user

    return factory


@pytest.fixture
def api() -> APIClient:
    """A client that enforces CSRF exactly like a browser session would."""
    return APIClient(enforce_csrf_checks=True)
