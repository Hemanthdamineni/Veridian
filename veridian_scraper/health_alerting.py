"""
Scraper Fleet Failure Alerting.

A scheduled scrape run writes one ``<manufacturer>.json`` health report per
manufacturer into ``output/health/``. A run that exits 0 tells an operator
nothing by itself: the run may have fetched zero pages, or a source that used
to work may have started returning 403. Operators need to be told when a
source *changes state* — not every time it fails.

This module compares the current run's reports against the previous run's
stored reports and emits an alert for every state transition that matters:

* **new failure** — a source that worked last run now failed or was blocked.
* **still failing** — a source is failing again, but only after a
  configurable silence window (default: 24 h), so a persistent block is not
  re-reported on every scheduled run.
* **recovery** — a source that failed last run now works.

It dispatches through the existing :class:`NotificationService`, so a failure
can reach a Discord webhook, Telegram, email or Web Push exactly as the price
alert engine already does. Nothing is invented: every alert is derived from a
previous and a current report, and the reason comes from the report's own
``blocked_reason`` / ``last_failure`` fields.

Silence and deduplication are decided by the previous run's ``finished_at``
timestamp, which is stored in every report. A source that is reported in the
previous run with the same reason and within the silence window is skipped.
"""

from __future__ import annotations

import json
import logging
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional, Tuple

from veridian_db.clock import utcnow
from veridian_scraper.health import RunReport
from veridian_scraper.notifications.notifier import (
    NotificationChannel,
    NotificationMessage,
    NotificationService,
)

logger = logging.getLogger(__name__)

__all__ = [
    "Alert",
    "AlertSeverity",
    "compare_reports",
    "load_previous_report",
    "load_previous_reports",
    "dispatch_alerts",
    "ALERTABLE_STATUSES",
]

# A source is only alertable when it did not succeed. A partial run
# (pages_succeeded > 0 but some pages failed) is a working source and is not
# treated as a failure worth a page every run.
ALERTABLE_STATUSES = frozenset({"failed", "blocked"})

# Default silence window: how long the same failure is allowed to persist
# before it is reported again, in seconds.
DEFAULT_SILENCE_SECONDS = 24 * 60 * 60


class AlertSeverity:
    """Severity levels used in the notification body."""

    CRITICAL = "CRITICAL"
    WARNING = "WARNING"
    RECOVERED = "RECOVERED"


@dataclass
class Alert:
    """One alertable event derived from the health reports."""

    manufacturer: str
    severity: str
    status: str
    reason: str
    previous_status: Optional[str] = None
    previous_reason: Optional[str] = None
    at: str = field(default_factory=lambda: utcnow().isoformat())

    def to_dict(self) -> Dict[str, Any]:
        return {
            "manufacturer": self.manufacturer,
            "severity": self.severity,
            "status": self.status,
            "reason": self.reason,
            "previous_status": self.previous_status,
            "previous_reason": self.previous_reason,
            "at": self.at,
        }


def load_previous_report(health_dir: Path, manufacturer: str) -> Optional[RunReport]:
    """Load the previous run's stored report for a manufacturer, if any.

    Returns ``None`` when there is no previous report (a fresh source or a
    first run in this environment), when the file cannot be read, or when the
    payload is not a report-shaped object. A missing previous report means
    "unknown", so the caller treats it as no state transition to report.
    """
    path = health_dir / f"{manufacturer}.json"
    if not path.exists():
        return None
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        logger.warning("Could not read previous health report %s", path)
        return None
    if not isinstance(payload, dict):
        return None
    # The stored payload includes derived keys ("status", "success",
    # "average_latency_ms") that are properties, not constructor fields, so
    # pass through only the dataclass fields and let the properties recompute.
    fields = RunReport.__dataclass_fields__
    known = {k: v for k, v in payload.items() if k in fields}
    # A schema change that dropped a required field surfaces here as a
    # TypeError, which we treat as "previous state unknown".
    try:
        return RunReport(**known)
    except TypeError:
        logger.warning("Stored health report %s does not match the schema", path)
        return None


def load_previous_reports(health_dir: Path) -> Dict[str, RunReport]:
    """Load every stored report in a health directory, keyed by manufacturer.

    This must be called **before** the new run writes its own reports into the
    same directory, because a run overwrites the previous one. The scheduled
    job takes the snapshot first, runs the fleet, then compares.
    """
    reports: Dict[str, RunReport] = {}
    if not health_dir.is_dir():
        return reports
    for path in sorted(health_dir.glob("*.json")):
        # SKU ledgers share the directory but are state, not reports.
        if path.name.endswith(".skus.json"):
            continue
        report = load_previous_report(health_dir, path.stem)
        if report is not None:
            reports[path.stem] = report
    return reports


def _same_failure(previous: RunReport, current: RunReport) -> bool:
    """True when the current run is the same failure the previous one was."""
    if previous.status != current.status:
        return False
    if previous.blocked_reason or previous.last_failure:
        return previous.blocked_reason == current.blocked_reason and (
            previous.last_failure == current.last_failure
        )
    return True


def _within_silence(previous: RunReport, now: str, silence_seconds: int) -> bool:
    """True when the previous failure is recent enough to stay silent."""
    if not previous.finished_at:
        return False
    try:
        previous_ts = float(previous.finished_at)
        now_ts = float(now)
        return (now_ts - previous_ts) < silence_seconds
    except (TypeError, ValueError):
        # finished_at is ISO (e.g. 2026-10-21T08:12:04.655184), not a float.
        # Compare chronologically when both are ISO strings.
        if isinstance(previous.finished_at, str) and isinstance(now, str):
            return now <= _shift(previous.finished_at, silence_seconds)
        return False


def _shift(iso: str, seconds: int) -> str:
    """Add ``seconds`` to an ISO timestamp and return ISO, for silence windows."""
    from datetime import datetime, timedelta, timezone

    try:
        dt = datetime.fromisoformat(iso)
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return (dt + timedelta(seconds=seconds)).isoformat()
    except ValueError:
        return iso


def compare_reports(
    previous: Dict[str, RunReport],
    current: Dict[str, RunReport],
    now: Optional[str] = None,
    silence_seconds: int = DEFAULT_SILENCE_SECONDS,
) -> List[Alert]:
    """Compare previous and current run reports and return the alerts.

    ``previous`` and ``current`` are keyed by manufacturer. A manufacturer that
    is only present in ``current`` is a new source, not a failure, so it is
    not alerted on first run. The meaningful transitions are:

    * working -> failing/blocked  : CRITICAL, always
    * failing -> failing (again)  : WARNING, only after the silence window
    * failing/blocked -> working  : RECOVERED
    """
    alerts: List[Alert] = []
    now = now or utcnow().isoformat()

    for manufacturer in sorted(current):
        cur = current[manufacturer]
        prev = previous.get(manufacturer)

        # A new manufacturer with no previous report is not an alertable event.
        if prev is None:
            continue

        prev_status = prev.status
        cur_status = cur.status
        cur_reason = cur.blocked_reason or cur.last_failure or ""

        if prev_status not in ALERTABLE_STATUSES and cur_status in ALERTABLE_STATUSES:
            # The source used to work and now does not: always worth reporting.
            alerts.append(
                Alert(
                    manufacturer=manufacturer,
                    severity=AlertSeverity.CRITICAL,
                    status=cur_status,
                    reason=cur_reason,
                    previous_status=prev_status,
                    previous_reason=prev.blocked_reason or prev.last_failure,
                )
            )
        elif prev_status in ALERTABLE_STATUSES and cur_status in ALERTABLE_STATUSES:
            # Still failing. Only alert again after the silence window, and
            # only when the reason actually changed — a different 403 is news.
            same = _same_failure(prev, cur)
            if not same:
                alerts.append(
                    Alert(
                        manufacturer=manufacturer,
                        severity=AlertSeverity.WARNING,
                        status=cur_status,
                        reason=cur_reason,
                        previous_status=prev_status,
                        previous_reason=prev.blocked_reason or prev.last_failure,
                    )
                )
            elif not _within_silence(prev, now, silence_seconds):
                alerts.append(
                    Alert(
                        manufacturer=manufacturer,
                        severity=AlertSeverity.WARNING,
                        status=cur_status,
                        reason=cur_reason,
                        previous_status=prev_status,
                        previous_reason=prev.blocked_reason or prev.last_failure,
                    )
                )
        elif prev_status in ALERTABLE_STATUSES and cur_status not in ALERTABLE_STATUSES:
            # Recovered: a source that failed now works again.
            alerts.append(
                Alert(
                    manufacturer=manufacturer,
                    severity=AlertSeverity.RECOVERED,
                    status=cur_status,
                    reason="source is fetching and parsing pages again",
                    previous_status=prev_status,
                    previous_reason=prev.blocked_reason or prev.last_failure,
                )
            )

    return alerts


def dispatch_alerts(
    alerts: Iterable[Alert],
    service: Optional[NotificationService] = None,
    config: Optional[Dict[str, str]] = None,
    recipient: Optional[str] = None,
) -> int:
    """Dispatch the alerts through the notification service.

    The recipient is the configured Discord webhook URL, Telegram chat id,
    email address or push subscription identifier for the operator channel.
    When no recipient is configured nothing is sent and ``0`` is returned, so
    alerting degrades to a no-op rather than a crash when the environment has
    no channel configured — exactly as the rest of the notification layer
    behaves.

    Returns the number of alerts successfully delivered.
    """
    config = config or {}
    if recipient is None and not config.get("ALERT_RECIPIENT"):
        logger.info("No alert recipient configured; skipping dispatch")
        return 0

    service = service or NotificationService(config)
    sent = 0
    for alert in alerts:
        channel = NotificationChannel.DISCORD
        to = recipient or config.get("ALERT_RECIPIENT") or ""
        if not to:
            continue
        message = NotificationMessage(
            channel=channel,
            recipient=to,
            subject=f"[Veridian {alert.severity}] {alert.manufacturer}: {alert.status}",
            body=_alert_body(alert),
        )
        if service.send(message):
            sent += 1
    return sent


def _alert_body(alert: Alert) -> str:
    lines = [
        f"**Manufacturer:** {alert.manufacturer}",
        f"**Status:** {alert.status}",
        f"**Reason:** {alert.reason or 'no reason recorded'}",
    ]
    if alert.previous_status:
        lines.append(
            f"**Previous:** {alert.previous_status}"
            f"{(' — ' + alert.previous_reason) if alert.previous_reason else ''}"
        )
    lines.append(f"**At:** {alert.at}")
    return "\n".join(lines)