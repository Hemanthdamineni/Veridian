"""
Price Tracker

Tracks prices across retailers over time.
Implements append-only price history and rollup calculations.

Based on Veridian-spec.md B.4
"""

import logging
from dataclasses import dataclass, field
from datetime import datetime, timedelta
from typing import Dict, List, Optional, Tuple
from collections import defaultdict


@dataclass
class PricePoint:
    """A single price observation."""
    sku_id: str
    seller_id: str
    seller_name: str
    price: float
    currency: str
    url: str
    scraped_at: datetime
    is_available: bool = True


@dataclass
class PriceRollup:
    """Aggregated price statistics for a SKU at a seller."""
    sku_id: str
    seller_id: str
    seller_name: str
    lowest_ever: float
    highest_ever: float
    avg_30d: float
    avg_90d: float
    current_price: float
    current_discount_pct: float  # vs MSRP
    last_updated: datetime


class PriceTracker:
    """
    Tracks prices and computes rollups.

    In production, this would use PostgreSQL with the price_history
    and price_rollups tables. This implementation provides the logic
    that would be implemented in SQL or a background job.
    """

    def __init__(self):
        self.logger = logging.getLogger(__name__)
        # In-memory storage for demonstration
        # In production, these would be database tables
        self._price_history: List[PricePoint] = []
        self._rollups: Dict[Tuple[str, str], PriceRollup] = {}
        self._msrp_cache: Dict[str, float] = {}  # sku_id -> MSRP

    def add_price_point(self, price_point: PricePoint):
        """Add a new price observation (append-only)."""
        self._price_history.append(price_point)
        self.logger.debug(
            f"Price recorded: {price_point.sku_id} @ {price_point.seller_name} = "
            f"{price_point.price} {price_point.currency}"
        )

    def add_price_points(self, price_points: List[PricePoint]):
        """Add multiple price observations."""
        for pp in price_points:
            self.add_price_point(pp)

    def get_price_history(
        self,
        sku_id: str,
        seller_id: Optional[str] = None,
        days: int = 90
    ) -> List[PricePoint]:
        """Get price history for a SKU."""
        cutoff = datetime.utcnow() - timedelta(days=days)
        results = [
            pp for pp in self._price_history
            if pp.sku_id == sku_id
            and pp.scraped_at >= cutoff
            and (seller_id is None or pp.seller_id == seller_id)
        ]
        return sorted(results, key=lambda x: x.scraped_at)

    def compute_rollups(self, sku_id: str, seller_id: str) -> Optional[PriceRollup]:
        """Compute price rollups for a SKU at a seller."""
        history = self.get_price_history(sku_id, seller_id, days=365)

        if not history:
            return None

        prices = [pp.price for pp in history if pp.is_available]
        if not prices:
            return None

        current_price = prices[-1]
        lowest = min(prices)
        highest = max(prices)

        # 30-day average
        thirty_days_ago = datetime.utcnow() - timedelta(days=30)
        prices_30d = [
            pp.price for pp in history
            if pp.scraped_at >= thirty_days_ago and pp.is_available
        ]
        avg_30d = sum(prices_30d) / len(prices_30d) if prices_30d else current_price

        # 90-day average
        ninety_days_ago = datetime.utcnow() - timedelta(days=90)
        prices_90d = [
            pp.price for pp in history
            if pp.scraped_at >= ninety_days_ago and pp.is_available
        ]
        avg_90d = sum(prices_90d) / len(prices_90d) if prices_90d else current_price

        # Discount vs MSRP
        msrp = self._msrp_cache.get(sku_id, current_price)
        discount_pct = ((msrp - current_price) / msrp * 100) if msrp > 0 else 0

        rollup = PriceRollup(
            sku_id=sku_id,
            seller_id=seller_id,
            seller_name=history[-1].seller_name,
            lowest_ever=lowest,
            highest_ever=highest,
            avg_30d=avg_30d,
            avg_90d=avg_90d,
            current_price=current_price,
            current_discount_pct=discount_pct,
            last_updated=history[-1].scraped_at
        )

        self._rollups[(sku_id, seller_id)] = rollup
        return rollup

    def get_rollups(self, sku_id: str) -> List[PriceRollup]:
        """Get all rollups for a SKU across sellers."""
        return [
            r for (sid, _), r in self._rollups.items()
            if sid == sku_id
        ]

    def get_best_price(self, sku_id: str) -> Optional[PriceRollup]:
        """Get the best current price for a SKU."""
        rollups = self.get_rollups(sku_id)
        if not rollups:
            return None
        return min(rollups, key=lambda r: r.current_price)

    def set_msrp(self, sku_id: str, msrp: float):
        """Set the MSRP for a SKU (used for discount calculations)."""
        self._msrp_cache[sku_id] = msrp

    def detect_price_drops(self, sku_id: str, threshold_pct: float = 10.0) -> List[dict]:
        """Detect recent price drops for a SKU."""
        rollups = self.get_rollups(sku_id)
        drops = []

        for rollup in rollups:
            if rollup.avg_30d > 0:
                drop_pct = (rollup.avg_30d - rollup.current_price) / rollup.avg_30d * 100
                if drop_pct >= threshold_pct:
                    drops.append({
                        "sku_id": sku_id,
                        "seller_id": rollup.seller_id,
                        "seller_name": rollup.seller_name,
                        "previous_avg": rollup.avg_30d,
                        "current_price": rollup.current_price,
                        "drop_pct": drop_pct
                    })

        return drops

    def get_statistics(self) -> dict:
        """Get overall price tracking statistics."""
        return {
            "total_price_points": len(self._price_history),
            "unique_skus": len(set(pp.sku_id for pp in self._price_history)),
            "unique_sellers": len(set(pp.seller_id for pp in self._price_history)),
            "rollups_computed": len(self._rollups),
        }
