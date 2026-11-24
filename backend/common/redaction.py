"""Removes credentials that travel in URLs before anything is written to a log."""

from __future__ import annotations

import logging
import re

# Invitation tokens are bearer credentials carried in the path: the API routes
# /api/v1/invitations/<token>[/accept] and the SPA link /invite/<token>.
_TOKEN_IN_PATH = re.compile(r"(/(?:api/v1/invitations|invite)/)(?!\[redacted\])[^/?#\s\"'<>]+")

REDACTED = "[redacted]"


def redact(text: str) -> str:
    """Return ``text`` with every invitation token replaced by ``[redacted]``."""
    return _TOKEN_IN_PATH.sub(rf"\1{REDACTED}", text)


class RedactFilter(logging.Filter):
    """Redacts the rendered message of every record, whatever formatter the handler uses."""

    def filter(self, record: logging.LogRecord) -> bool:
        message = record.getMessage()
        clean = redact(message)
        if clean != message:
            record.msg, record.args = clean, None
        return True
