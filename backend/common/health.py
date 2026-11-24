from __future__ import annotations

from django.core.cache import cache
from django.db import connection
from django.http import HttpRequest, JsonResponse
from django.views.decorators.http import require_GET


@require_GET
def live(request: HttpRequest) -> JsonResponse:
    return JsonResponse({"status": "ok"})


@require_GET
def ready(request: HttpRequest) -> JsonResponse:
    checks: dict[str, str] = {}
    try:
        with connection.cursor() as cursor:
            cursor.execute("SELECT 1")
        checks["database"] = "ok"
    except Exception:  # pragma: no cover - exercised manually with the DB stopped
        checks["database"] = "unavailable"
    try:
        cache.set("health:ping", "1", timeout=5)
        checks["cache"] = "ok" if cache.get("health:ping") == "1" else "unavailable"
    except Exception:  # pragma: no cover
        checks["cache"] = "unavailable"
    healthy = all(v == "ok" for v in checks.values())
    return JsonResponse(
        {"status": "ok" if healthy else "degraded", "checks": checks}, status=200 if healthy else 503
    )
