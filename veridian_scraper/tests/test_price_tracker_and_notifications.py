"""
Tests for the price tracking and notification helpers.

These modules are the alerting side of Veridian: they resolve retailer strings
to canonical SKUs, roll up price history and send notifications. The tests
pin down the behaviour that the rest of the pipeline depends on.
"""

import pytest

from veridian_scraper.notifications.notifier import (
    NotificationChannel,
    NotificationMessage,
    NotificationService,
)
from veridian_scraper.price_tracker.alert_engine import (
    Alert,
    AlertCondition,
    AlertEngine,
)
from veridian_scraper.price_tracker.identity_resolver import IdentityResolver
from veridian_scraper.price_tracker.price_tracker import PricePoint, PriceTracker


def test_the_alert_engine_uses_the_notification_channel_enum():
    """A handler registered with the notifier's enum has to be found."""
    from veridian_scraper.price_tracker import alert_engine

    assert alert_engine.NotificationChannel is NotificationChannel


def test_alert_engine_triggers_and_counts():
    engine = AlertEngine()
    seen = []
    engine.register_notification_handler(NotificationChannel.EMAIL, seen.append)

    alert = Alert(
        id="a1",
        user_id="u1",
        sku_id="s1",
        region="us",
        condition_type=AlertCondition.BELOW_PRICE,
        threshold_value=900.0,
        channel=NotificationChannel.EMAIL,
    )
    engine.register_alert(alert)
    engine.record_price("s1", 1000.0)

    events = engine.evaluate_alerts("s1", 899.0)
    assert len(events) == 1
    assert events[0].current_price == 899.0
    assert seen and seen[0] is events[0]
    assert alert.trigger_count == 1

    stats = engine.get_alert_statistics()
    assert stats['total_alerts'] == 1
    assert stats['triggered_alerts'] == 1


def test_alert_below_the_threshold_does_not_trigger():
    engine = AlertEngine()
    alert = Alert(
        id="a2",
        user_id="u1",
        sku_id="s2",
        region="us",
        condition_type=AlertCondition.BELOW_PRICE,
        threshold_value=500.0,
        channel=NotificationChannel.EMAIL,
    )
    engine.register_alert(alert)
    assert engine.evaluate_alerts("s2", 600.0) == []


def test_notification_service_reports_failures_without_raising():
    service = NotificationService(config={})
    message = NotificationMessage(
        channel=NotificationChannel.EMAIL,
        recipient="alerts@example.com",
        subject="Price drop",
        body="Zenbook is 899 USD",
    )
    # No SMTP configuration, so the send has to fail cleanly.
    assert service.send(message) is False
    assert service.get_statistics()['email'] == 0


def test_notification_message_defaults():
    message = NotificationMessage(
        channel=NotificationChannel.TELEGRAM,
        recipient="123",
        subject="s",
        body="b",
    )
    assert message.metadata == {}
    assert message.created_at is not None


def test_identity_resolver_finds_the_canonical_sku():
    resolver = IdentityResolver([
        {"id": "1", "sku_code": "UX3407QA", "name": "Zenbook UX3407"},
        {"id": "2", "sku_code": "21KC000UUS", "name": "ThinkPad X1 Carbon"},
    ])
    result = resolver.resolve("ASUS Zenbook UX3407QA-QD123WS")
    assert result.resolved_sku_id == "1"
    assert result.match_confidence == 1.0
    assert result.match_method == "exact"


def test_identity_resolver_leaves_unknown_products_unresolved():
    resolver = IdentityResolver([
        {"id": "1", "sku_code": "UX3407QA", "name": "Zenbook UX3407"},
    ])
    result = resolver.resolve("Completely Different Machine 9000XT")
    assert result.resolved_sku_id is None


def test_price_tracker_rollup_uses_the_latest_price():
    from veridian_db.clock import utcnow

    tracker = PriceTracker()
    tracker.set_msrp("1", 999)
    for price in (1200, 950, 899):
        tracker.add_price_point(PricePoint(
            sku_id="1",
            seller_id="1",
            seller_name="Best Buy",
            price=price,
            currency="USD",
            url="",
            scraped_at=utcnow(),
            is_available=True,
        ))
    rollup = tracker.compute_rollups("1", "1")
    assert rollup.current_price == 899
    assert rollup.lowest_ever == 899
    assert rollup.highest_ever == 1200
