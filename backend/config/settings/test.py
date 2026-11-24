"""Test settings: real PostgreSQL (from env), local-memory cache, fast hashing."""

import os

os.environ.setdefault("DJANGO_SECRET_KEY", "test-only-not-a-secret-" + "x" * 32)
os.environ.setdefault("POSTGRES_PASSWORD", "flowops")
os.environ.setdefault("DJANGO_SECURE_COOKIES", "false")

from .base import *  # noqa: F403

PASSWORD_HASHERS = ["django.contrib.auth.hashers.MD5PasswordHasher"]  # speed only; never in prod
CACHES = {"default": {"BACKEND": "django.core.cache.backends.locmem.LocMemCache"}}
LOGGING = {"version": 1, "disable_existing_loggers": False}
