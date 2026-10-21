"""
Alert Engine

Monitors price changes and triggers notifications when conditions are met.

Based on Veridian-spec.md B.4
"""

from veridian_db.clock import utcnow

import logging
from dataclasses import dataclass, field
from datetime import datetime
from enum import Enum
from typing import Callable, Dict, List, Optional

from ..notifications.notifier import NotificationChannel


class AlertCondition(Enum):
    """Types of alert conditions."""
    BELOW_PRICE = "below_price"           # Price drops below threshold
    LOWEST_EVER = "lowest_ever"           # Price hits all-time low
    PCT_OFF_MSRP = "pct_off_msrp"         # Discount percentage vs MSRP


@dataclass
class Alert:
    """A user alert configuration."""
    id: str
    user_id: str
    sku_id: str
    region: str
    condition_type: AlertCondition
    threshold_value: float
    channel: NotificationChannel
    active: bool = True
    created_at: datetime = field(default_factory=utcnow)
    last_triggered: Optional[datetime] = None
    trigger_count: int = 0


@dataclass
class AlertEvent:
    """An alert that was triggered."""
    alert: Alert
    current_price: float
    message: str
    triggered_at: datetime = field(default_factory=utcnow)


class AlertEngine:
    """
    Evaluates alerts against current prices and triggers notifications.

    In production, this would run as a background job after each scrape batch.
    """

    def __init__(self):
        self.logger = logging.getLogger(__name__)
        self._alerts: Dict[str, Alert] = {}
        self._notification_handlers: Dict[NotificationChannel, Callable] = {}
        self._price_history: Dict[str, List[float]] = {}  # sku_id -> prices

    def register_alert(self, alert: Alert):
        """Register a new alert."""
        self._alerts[alert.id] = alert
        self.logger.info(f"Alert registered: {alert.id} for SKU {alert.sku_id}")

    def unregister_alert(self, alert_id: str):
        """Remove an alert."""
        if alert_id in self._alerts:
            del self._alerts[alert_id]

    def get_user_alerts(self, user_id: str) -> List[Alert]:
        """Get all alerts for a user."""
        return [a for a in self._alerts.values() if a.user_id == user_id]

    def get_sku_alerts(self, sku_id: str) -> List[Alert]:
        """Get all alerts for a SKU."""
        return [a for a in self._alerts.values() if a.sku_id == sku_id]

    def register_notification_handler(
        self,
        channel: NotificationChannel,
        handler: Callable[[AlertEvent], None]
    ):
        """Register a handler for a notification channel."""
        self._notification_handlers[channel] = handler

    def evaluate_alerts(self, sku_id: str, current_price: float) -> List[AlertEvent]:
        """
        Evaluate all alerts for a SKU against the current price.

        Args:
            sku_id: The SKU to evaluate
            current_price: The current price

        Returns:
            List of triggered alert events
        """
        triggered = []
        sku_alerts = self.get_sku_alerts(sku_id)

        for alert in sku_alerts:
            if not alert.active:
                continue

            event = self._evaluate_alert(alert, current_price)
            if event:
                triggered.append(event)
                self._trigger_alert(event)

        return triggered

    def _evaluate_alert(self, alert: Alert, current_price: float) -> Optional[AlertEvent]:
        """Evaluate a single alert condition."""
        if alert.condition_type == AlertCondition.BELOW_PRICE:
            if current_price <= alert.threshold_value:
                return AlertEvent(
                    alert=alert,
                    current_price=current_price,
                    message=f"Price dropped to {current_price} (below {alert.threshold_value})"
                )

        elif alert.condition_type == AlertCondition.LOWEST_EVER:
            history = self._price_history.get(alert.sku_id, [])
            if history and current_price <= min(history):
                return AlertEvent(
                    alert=alert,
                    current_price=current_price,
                    message=f"New lowest price: {current_price} (was {min(history)})"
                )

        elif alert.condition_type == AlertCondition.PCT_OFF_MSRP:
            history = self._price_history.get(alert.sku_id, [])
            if history:
                # Use the highest price as proxy for MSRP
                msrp = max(history) if history else current_price
                if msrp > 0:
                    discount_pct = (msrp - current_price) / msrp * 100
                    if discount_pct >= alert.threshold_value:
                        return AlertEvent(
                            alert=alert,
                            current_price=current_price,
                            message=f"{discount_pct:.1f}% off (threshold: {alert.threshold_value}%)"
                        )

        return None

    def _trigger_alert(self, event: AlertEvent):
        """Trigger an alert notification."""
        alert = event.alert
        alert.last_triggered = utcnow()
        alert.trigger_count += 1

        handler = self._notification_handlers.get(alert.channel)
        if handler:
            try:
                handler(event)
            except Exception as e:
                self.logger.error(f"Notification failed for alert {alert.id}: {e}")
        else:
            self.logger.warning(f"No handler for channel {alert.channel.value}")

    def record_price(self, sku_id: str, price: float):
        """Record a price for historical tracking."""
        if sku_id not in self._price_history:
            self._price_history[sku_id] = []
        self._price_history[sku_id].append(price)

    def get_alert_statistics(self) -> dict:
        """Get alert statistics."""
        total = len(self._alerts)
        active = sum(1 for a in self._alerts.values() if a.active)
        triggered = sum(1 for a in self._alerts.values() if a.trigger_count > 0)

        return {
            "total_alerts": total,
            "active_alerts": active,
            "triggered_alerts": triggered,
            "total_triggers": sum(a.trigger_count for a in self._alerts.values()),
        }
