"""
Tests for the scraper fleet failure alerting.

The alerting layer compares a scheduled run's reports against the previous
run's stored reports and emits an alert only on a state transition. These
tests construct reports directly so the comparison rules are verified without
hitting the network.
"""

from __future__ import annotations

import json

from veridian_scraper.health import RunReport
from veridian_scraper.health_alerting import (
    Alert,
    AlertSeverity,
    compare_reports,
    dispatch_alerts,
    load_previous_reports,
)
from veridian_scraper.notifications.notifier import NotificationService


def _report(
    manufacturer: str,
    status: str,
    blocked: str = "",
    failure: str = "",
    finished_at: str = "2026-10-21T00:00:00",
) -> RunReport:
    """Build a RunReport whose derived ``status`` matches the requested one.

    ``status`` is a property, not a constructor field, so it is produced by the
    counters and the ``blocked_reason`` that drive it.
    """
    if status == "blocked":
        return RunReport(
            manufacturer=manufacturer,
            pages_attempted=1,
            pages_failed=1,
            blocked_reason=blocked or failure,
            last_failure=failure or blocked,
            finished_at=finished_at,
        )
    if status == "failed":
        return RunReport(
            manufacturer=manufacturer,
            pages_attempted=1,
            pages_failed=1,
            last_failure=failure or "run failed",
            finished_at=finished_at,
        )
    if status == "partial":
        return RunReport(
            manufacturer=manufacturer,
            pages_attempted=2,
            pages_succeeded=1,
            pages_failed=1,
            finished_at=finished_at,
        )
    # success
    return RunReport(
        manufacturer=manufacturer,
        pages_attempted=1,
        pages_succeeded=1,
        finished_at=finished_at,
    )


def test_a_source_that_stops_working_is_critical():
    prev = {"asus": _report("asus", "success")}
    cur = {"asus": _report("asus", "blocked", blocked="robots 403")}
    alerts = compare_reports(prev, cur)
    assert len(alerts) == 1
    assert alerts[0].severity == AlertSeverity.CRITICAL
    assert alerts[0].status == "blocked"
    assert alerts[0].reason == "robots 403"


def test_a_source_blocked_last_run_is_silent_within_the_window():
    prev = {
        "asus": _report("asus", "blocked", blocked="robots 403", finished_at="2026-10-20T23:00:00")
    }
    cur = {"asus": _report("asus", "blocked", blocked="robots 403")}
    alerts = compare_reports(prev, cur, now="2026-10-21T00:00:00")
    assert alerts == []


def test_the_same_failure_alerts_again_once_the_window_has_passed():
    prev = {
        "asus": _report("asus", "blocked", blocked="robots 403", finished_at="2026-10-19T00:00:00")
    }
    cur = {"asus": _report("asus", "blocked", blocked="robots 403")}
    alerts = compare_reports(prev, cur, now="2026-10-21T00:00:00")
    assert len(alerts) == 1
    assert alerts[0].severity == AlertSeverity.WARNING


def test_a_changed_failure_reason_is_news_even_within_the_window():
    prev = {
        "asus": _report("asus", "blocked", blocked="robots 403", finished_at="2026-10-20T23:00:00")
    }
    cur = {"asus": _report("asus", "blocked", blocked="now 429 rate limited")}
    alerts = compare_reports(prev, cur, now="2026-10-21T00:00:00")
    assert len(alerts) == 1
    assert alerts[0].severity == AlertSeverity.WARNING
    assert alerts[0].reason == "now 429 rate limited"


def test_a_source_that_recovers_is_reported_as_recovered():
    prev = {"asus": _report("asus", "blocked", blocked="robots 403")}
    cur = {"asus": _report("asus", "success")}
    alerts = compare_reports(prev, cur)
    assert len(alerts) == 1
    assert alerts[0].severity == AlertSeverity.RECOVERED
    assert alerts[0].status == "success"


def test_a_brand_new_source_is_not_alerted_on_first_run():
    prev = {}
    cur = {"asus": _report("asus", "success")}
    assert compare_reports(prev, cur) == []


def test_a_partial_run_is_not_a_failure_to_alert():
    prev = {"asus": _report("asus", "success")}
    cur = {"asus": _report("asus", "partial")}
    assert compare_reports(prev, cur) == []


def test_load_previous_reports_skips_ledger_files(tmp_path):
    (tmp_path / "asus.json").write_text(
        json.dumps(_report("asus", "blocked", blocked="x").to_dict())
    )
    (tmp_path / "asus.skus.json").write_text("{}")
    reports = load_previous_reports(tmp_path)
    assert list(reports) == ["asus"]


def test_load_previous_reports_rejects_stored_derived_keys(tmp_path):
    # The stored JSON carries derived properties ("status", "success") that are
    # not constructor fields; the loader must filter them rather than crash.
    payload = _report("asus", "blocked", blocked="x").to_dict()
    payload["status"] = "blocked"
    payload["success"] = False
    (tmp_path / "asus.json").write_text(json.dumps(payload))
    reports = load_previous_reports(tmp_path)
    assert reports["asus"].status == "blocked"


def test_dispatch_without_a_recipient_is_a_noop():
    alert = Alert(
        manufacturer="asus",
        severity=AlertSeverity.CRITICAL,
        status="blocked",
        reason="robots 403",
    )
    sent = dispatch_alerts([alert], service=NotificationService(config={}), recipient="")
    assert sent == 0