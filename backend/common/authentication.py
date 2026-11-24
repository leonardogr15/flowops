from __future__ import annotations

from rest_framework.authentication import SessionAuthentication
from rest_framework.request import Request


class SessionAuthentication401(SessionAuthentication):
    """Session auth that answers unauthenticated requests with 401 instead of 403.

    DRF only emits 401 when the first authenticator provides a WWW-Authenticate value.
    The SPA relies on 401 to redirect to the login page and on 403 for "no permission".
    """

    def authenticate_header(self, request: Request) -> str:
        return 'Session realm="api"'
