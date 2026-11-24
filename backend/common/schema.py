"""OpenAPI extensions (drf-spectacular)."""

from drf_spectacular.authentication import SessionScheme


class Session401Scheme(SessionScheme):  # type: ignore[no-untyped-call]
    target_class = "common.authentication.SessionAuthentication401"
