from __future__ import annotations

import pytest
from django.core.exceptions import ValidationError
from django.db import IntegrityError

from apps.accounts.models import User

pytestmark = pytest.mark.django_db


def test_email_is_normalized_to_lowercase() -> None:
    user = User.objects.create_user("  Maya.Member@Example.TEST ", "x" * 14)
    assert user.email == "maya.member@example.test"


def test_email_is_unique_case_insensitively() -> None:
    User.objects.create_user("maya@example.test", "x" * 14)
    with pytest.raises(ValidationError):
        User.objects.create_user("MAYA@example.test", "x" * 14)


def test_database_constraint_blocks_case_variants_even_without_model_validation() -> None:
    User.objects.create_user("raj@example.test", "x" * 14)
    with pytest.raises(IntegrityError):
        User.objects.bulk_create([User(email="RAJ@example.test")])  # bypasses save() normalization


def test_passwords_are_hashed_with_argon2_in_production_settings() -> None:
    from django.conf import settings

    from config.settings import base

    assert base.PASSWORD_HASHERS[0].endswith("Argon2PasswordHasher")
    assert settings.AUTH_USER_MODEL == "accounts.User"


def test_user_without_password_cannot_log_in() -> None:
    user = User.objects.create_user("nopass@example.test")
    assert not user.has_usable_password()


def test_superuser_flags() -> None:
    admin = User.objects.create_superuser("root@example.test", "x" * 14)
    assert admin.is_staff
    assert admin.is_superuser
    assert str(admin) == "root@example.test"


def test_email_is_required() -> None:
    with pytest.raises(ValueError, match="Email is required"):
        User.objects.create_user("", "x" * 14)
