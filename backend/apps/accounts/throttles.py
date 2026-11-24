from __future__ import annotations

from rest_framework.request import Request
from rest_framework.throttling import SimpleRateThrottle
from rest_framework.views import APIView

from .models import normalize_email


class LoginRateThrottle(SimpleRateThrottle):
    """Limits login attempts per (client IP, email) pair to slow down credential stuffing."""

    scope = "login"

    def get_cache_key(self, request: Request, view: APIView) -> str | None:
        email = request.data.get("email", "") if isinstance(request.data, dict) else ""
        ident = f"{self.get_ident(request)}:{normalize_email(str(email))}"
        return self.cache_format % {"scope": self.scope, "ident": ident}
