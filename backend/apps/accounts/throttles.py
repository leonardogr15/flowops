from __future__ import annotations

import hashlib

from rest_framework.request import Request
from rest_framework.throttling import SimpleRateThrottle
from rest_framework.views import APIView

from .models import normalize_email


class LoginRateThrottle(SimpleRateThrottle):
    """Limits login attempts per (client IP, email) pair to slow down credential stuffing."""

    scope = "login"

    def get_cache_key(self, request: Request, view: APIView) -> str | None:
        email = request.data.get("email", "") if isinstance(request.data, dict) else ""
        # Hashed: bounded key length and no plain email addresses stored in the cache.
        digest = hashlib.sha256(normalize_email(str(email)).encode()).hexdigest()[:32]
        ident = f"{self.get_ident(request)}:{digest}"
        return self.cache_format % {"scope": self.scope, "ident": ident}


class LoginIPRateThrottle(SimpleRateThrottle):
    """Caps attempts from one client IP across all emails (password spraying)."""

    scope = "login_ip"

    def get_cache_key(self, request: Request, view: APIView) -> str | None:
        return self.cache_format % {"scope": self.scope, "ident": self.get_ident(request)}
