"""Signals other apps can react to without this app depending on them."""

from __future__ import annotations

from django.dispatch import Signal

# Sent inside the transaction, after a member was removed, left, or changed role.
# Keyword argument: organization. Receivers run in the same transaction.
membership_changed = Signal()
