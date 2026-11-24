"""JSON log lines with request correlation; never logs request bodies."""

from __future__ import annotations

import json
import logging
from datetime import UTC, datetime

from .context import request_id_var

_STANDARD = set(vars(logging.makeLogRecord({}))) | {"message", "asctime"}


class JSONFormatter(logging.Formatter):
    def format(self, record: logging.LogRecord) -> str:
        payload: dict[str, object] = {
            "timestamp": datetime.fromtimestamp(record.created, UTC).isoformat(),
            "level": record.levelname.lower(),
            "logger": record.name,
            "event": record.getMessage(),
            "request_id": getattr(record, "request_id", request_id_var.get()),
        }
        payload.update({k: v for k, v in vars(record).items() if k not in _STANDARD and k != "request_id"})
        if record.exc_info:
            payload["exception"] = self.formatException(record.exc_info)
        return json.dumps(payload, default=str)
