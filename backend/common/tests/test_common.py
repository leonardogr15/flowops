from __future__ import annotations

import json
import logging

import pytest
from django.test import Client

from common.logging import JSONFormatter

pytestmark = pytest.mark.django_db


def test_liveness() -> None:
    response = Client().get("/health/live")
    assert response.status_code == 200
    assert response.json() == {"status": "ok"}


def test_readiness_checks_database_and_cache() -> None:
    response = Client().get("/health/ready")
    assert response.status_code == 200
    assert response.json()["checks"] == {"database": "ok", "cache": "ok"}


def test_request_id_is_generated_and_echoed() -> None:
    response = Client().get("/health/live")
    assert len(response["X-Request-ID"]) == 32


def test_well_formed_incoming_request_id_is_kept_and_malformed_is_replaced() -> None:
    assert Client().get("/health/live", HTTP_X_REQUEST_ID="abc-12345678")["X-Request-ID"] == "abc-12345678"
    assert Client().get("/health/live", HTTP_X_REQUEST_ID="<script>")["X-Request-ID"] != "<script>"


def test_unknown_api_route_returns_404() -> None:
    assert Client().get("/api/v1/does-not-exist").status_code == 404


def test_method_not_allowed_uses_problem_details() -> None:
    client = Client()
    response = client.put("/api/v1/auth/csrf")
    assert response.status_code == 405
    assert response.json()["status"] == 405


def test_json_formatter_emits_one_json_object() -> None:
    record = logging.makeLogRecord({"msg": "request", "levelname": "INFO", "name": "t", "status": 200})
    line = json.loads(JSONFormatter().format(record))
    assert line["event"] == "request"
    assert line["status"] == 200
    assert "request_id" in line


def test_openapi_schema_is_generated() -> None:
    response = Client().get("/api/schema/", HTTP_ACCEPT="application/json")
    assert response.status_code == 200
    paths = json.loads(response.content)["paths"]
    assert "/api/v1/auth/login" in paths
    assert "/api/v1/org/members" in paths
