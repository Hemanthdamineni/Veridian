"""
Price Tracking System for Veridian.

Tracks prices across retailers, resolves product identity, and triggers alerts.
"""

from .identity_resolver import IdentityResolver, MatchResult
from .price_tracker import PriceTracker, PricePoint
from .alert_engine import AlertEngine, AlertCondition

__all__ = [
    "IdentityResolver",
    "MatchResult",
    "PriceTracker",
    "PricePoint",
    "AlertEngine",
    "AlertCondition",
]
