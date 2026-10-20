"""
Shared clock helpers.

The database stores timestamps in naive ``DateTime`` columns (SQLAlchemy
``DateTime`` without a timezone), so every timestamp written to the database
must be naive UTC. ``datetime.utcnow()`` produced exactly that, but it is
deprecated in Python 3.12+ and scheduled for removal.

``utcnow()`` keeps the identical naive-UTC semantics without the deprecation,
so existing rows and comparisons stay valid.
"""

from datetime import datetime, timezone

__all__ = ["utcnow"]


def utcnow() -> datetime:
    """Return the current UTC time as a naive ``datetime``.

    Naive (no tzinfo) on purpose: it is what the naive ``DateTime`` columns
    expect, and mixing naive and aware datetimes raises at comparison time.
    """
    return datetime.now(timezone.utc).replace(tzinfo=None)
