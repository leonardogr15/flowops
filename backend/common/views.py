from __future__ import annotations

from django.http import HttpRequest, JsonResponse


def csrf_failure(request: HttpRequest, reason: str = "") -> JsonResponse:
    """CSRF failures as RFC 9457 problem details, like every other API error."""
    return JsonResponse(
        {
            "type": "urn:flowops:problem:csrf_failed",
            "title": "Permission denied",
            "status": 403,
            "detail": "CSRF verification failed. Reload the page and try again.",
            "instance": request.path,
        },
        status=403,
        content_type="application/problem+json",
    )
