"""RFC 9457 Problem Details for every API error."""

from __future__ import annotations

import logging
from typing import Any

from django.core.exceptions import PermissionDenied as DjangoPermissionDenied
from django.http import Http404
from rest_framework import exceptions, status
from rest_framework.response import Response
from rest_framework.views import exception_handler

logger = logging.getLogger(__name__)

TITLES = {
    400: "Bad request",
    401: "Authentication required",
    403: "Permission denied",
    404: "Not found",
    405: "Method not allowed",
    409: "Conflict",
    415: "Unsupported media type",
    422: "Unprocessable content",
    429: "Too many requests",
    500: "Internal server error",
}


class Conflict(exceptions.APIException):
    status_code = status.HTTP_409_CONFLICT
    default_detail = "The request conflicts with the current state of the resource."
    default_code = "conflict"


class TenantRequired(exceptions.APIException):
    status_code = status.HTTP_400_BAD_REQUEST
    default_detail = "Select an organization with the X-Organization header."
    default_code = "organization_required"


def _problem(status_code: int, detail: Any, code: str, instance: str, errors: Any = None) -> dict[str, Any]:
    body: dict[str, Any] = {
        "type": f"urn:flowops:problem:{code}",
        "title": TITLES.get(status_code, "Error"),
        "status": status_code,
        "detail": detail,
        "instance": instance,
    }
    if errors is not None:
        body["errors"] = errors
    return body


def problem_details_handler(exc: Exception, context: dict[str, Any]) -> Response:
    request = context.get("request")
    instance = request.path if request is not None else ""

    if isinstance(exc, Http404):
        exc = exceptions.NotFound()
    elif isinstance(exc, DjangoPermissionDenied):
        exc = exceptions.PermissionDenied()

    response = exception_handler(exc, context)
    if response is None:  # unexpected error: never leak internals
        logger.exception("unhandled_error", extra={"path": instance})
        return Response(
            _problem(500, "An unexpected error occurred.", "internal_error", instance),
            status=500,
            content_type="application/problem+json",
        )

    errors: Any = None
    if isinstance(exc, exceptions.ValidationError):
        detail, errors, code = "One or more fields are invalid.", response.data, "validation_error"
    elif isinstance(exc, exceptions.APIException):
        detail, code = str(exc.detail), str(exc.default_code)
    else:  # pragma: no cover - DRF only returns responses for APIException subclasses
        detail, code = "Error", "error"

    problem = Response(
        _problem(response.status_code, detail, code, instance, errors),
        status=response.status_code,
        content_type="application/problem+json",
    )
    for header, value in response.items():  # keep WWW-Authenticate, Retry-After, Allow, ...
        if header.lower() != "content-type":
            problem[header] = value
    return problem
