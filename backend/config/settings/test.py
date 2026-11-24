"""Test settings: real PostgreSQL (from env), local-memory cache, fast hashing."""

import os

os.environ.setdefault("DJANGO_SECRET_KEY", "test-only-not-a-secret-" + "x" * 32)
os.environ.setdefault("POSTGRES_PASSWORD", "flowops")
os.environ.setdefault("DJANGO_SECURE_COOKIES", "false")

from .base import *  # noqa: F403

PASSWORD_HASHERS = ["django.contrib.auth.hashers.MD5PasswordHasher"]  # speed only; never in prod
CACHES = {"default": {"BACKEND": "django.core.cache.backends.locmem.LocMemCache"}}
LOGGING = {"version": 1, "disable_existing_loggers": False}
MAILERS = {"default": {"BACKEND": "django.core.mail.backends.locmem.EmailBackend"}}
# Tests assert the production limits, whatever the local environment sets.
REST_FRAMEWORK = {
    **REST_FRAMEWORK,  # noqa: F405
    "DEFAULT_THROTTLE_RATES": {
        "login": "5/min",
        "login_ip": "30/min",
        "invitation": "30/min",
        "comment": "30/min",
        "invitation_create": "30/hour",
        "organization_create": "5/hour",
    },
    "NUM_PROXIES": 0,
}
