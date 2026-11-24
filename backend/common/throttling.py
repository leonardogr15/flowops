"""Throttles shared by several apps."""

from __future__ import annotations

from typing import Any

from rest_framework.request import Request
from rest_framework.throttling import ScopedRateThrottle


class CreateRateThrottle(ScopedRateThrottle):
    """A scoped, per-user limit on POST only; reading the same endpoint is not limited."""

    def allow_request(self, request: Request, view: Any) -> bool:
        return request.method != "POST" or super().allow_request(request, view)
