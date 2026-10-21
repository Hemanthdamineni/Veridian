"""
Veridian Scraper - Run Health Reporting

A scrape that exits 0 tells us nothing: the run may have fetched zero pages,
parsed zero products, or silently dropped every record. Operators need a
per-manufacturer answer to "did this run actually collect data, and how much
of it was usable?", so every run produces a machine-readable report with the
counters the operating model depends on:

    pages discovered / attempted / succeeded / failed
    products discovered, SKUs discovered, new SKUs, updated SKUs
    duplicates, rejected records, missing critical fields
    source failures, parser failures, average latency
    last successful run, last failure

The report is written to ``<output_dir>/health/<manufacturer>.json`` and can be
printed as a summary table (``run_scrapers.py --report``).

Two honesty rules are enforced here:

* A run only counts as successful when pages were actually fetched *and*
  parsed (``pages_succeeded > 0``); an empty run is a failure, not a pass.
* "new" and "updated" SKUs are decided by a persisted fingerprint ledger, so
  they describe what Veridian has actually seen before, not a guess.
"""

import json
import logging
from dataclasses import dataclass, field
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional, Tuple

from veridian_db.clock import utcnow

logger = logging.getLogger(__name__)

__all__ = [
    "CRITICAL_PRODUCT_FIELDS",
    "ErrorEntry",
    "RunReport",
    "RecordEvaluation",
    "ScraperHealth",
    "HealthCollector",
    "SkuLedger",
    "evaluate_product",
    "get_collector",
    "reset_collector",
]

# Fields a record must carry to be useful downstream. A record missing any of
# them is counted, not silently accepted.
CRITICAL_PRODUCT_FIELDS: Tuple[str, ...] = ("name", "brand", "canonical_key")

# Failure categories used in the report and in the error log.
SOURCE_FAILURE = "source"
PARSER_FAILURE = "parser"
VALIDATION_FAILURE = "validation"
BLOCKED = "blocked"


def _timestamp() -> str:
    """ISO timestamp used across the report."""
    return utcnow().isoformat()


@dataclass
class ErrorEntry:
    """A single failure recorded during a run."""
    kind: str
    url: str
    message: str
    at: str = field(default_factory=_timestamp)

    def to_dict(self) -> Dict[str, Any]:
        return {
            "kind": self.kind,
            "url": self.url,
            "message": self.message,
            "at": self.at,
        }


@dataclass
class RecordEvaluation:
    """Outcome of checking one scraped record against the critical-field rules."""
    valid: bool
    missing_fields: List[str] = field(default_factory=list)
    errors: List[str] = field(default_factory=list)


def evaluate_product(product: Any) -> RecordEvaluation:
    """Check a scraped product for the fields Veridian cannot work without.

    Accepts either a ``Product`` dataclass or a plain dict so the rule can be
    reused for records that never made it into the model layer.
    """
    missing: List[str] = []
    errors: List[str] = []

    def _get(name: str) -> Any:
        if isinstance(product, dict):
            return product.get(name)
        return getattr(product, name, None)

    for name in CRITICAL_PRODUCT_FIELDS:
        value = _get(name)
        if value is None or (isinstance(value, str) and not value.strip()):
            missing.append(name)

    variants = _get('variants') or []
    if not variants:
        missing.append('variants')

    for variant in variants:
        sku = getattr(variant, 'sku', None) or getattr(variant, 'variant_id', None)
        if not sku:
            errors.append("variant without sku or variant_id")
            break

    price = _get('msrp')
    if price is not None:
        try:
            from veridian_scraper.validators.validator import validate_price_observation
            report = validate_price_observation(price, _get('currency') or 'USD')
            for result in report.errors:
                errors.append(f"{result.field}: {result.message}")
        except Exception as exc:  # pragma: no cover - defensive, validator is stable
            logger.debug("Price validation unavailable: %s", exc)

    return RecordEvaluation(valid=not missing and not errors, missing_fields=missing, errors=errors)


@dataclass
class RunReport:
    """Health counters for one manufacturer (optionally one region)."""
    manufacturer: str
    region: str = ""
    started_at: str = field(default_factory=_timestamp)
    finished_at: Optional[str] = None

    pages_discovered: int = 0
    pages_attempted: int = 0
    pages_succeeded: int = 0
    pages_failed: int = 0

    products_discovered: int = 0
    skus_discovered: int = 0
    new_skus: int = 0
    updated_skus: int = 0

    duplicates: int = 0
    rejected_records: int = 0
    missing_critical_fields: int = 0

    source_failures: int = 0
    parser_failures: int = 0

    total_latency_ms: float = 0.0
    last_successful_run: Optional[str] = None
    last_failure: Optional[str] = None
    blocked_reason: Optional[str] = None

    errors: List[ErrorEntry] = field(default_factory=list)

    @property
    def average_latency_ms(self) -> float:
        """Mean latency of the pages that were fetched successfully."""
        if not self.pages_succeeded:
            return 0.0
        return round(self.total_latency_ms / self.pages_succeeded, 2)

    @property
    def success(self) -> bool:
        """A run succeeded only if pages were fetched and parsed."""
        return self.pages_succeeded > 0 and self.blocked_reason is None

    @property
    def status(self) -> str:
        """Human readable run status."""
        if self.blocked_reason:
            return 'blocked'
        if self.pages_succeeded == 0:
            return 'failed'
        if self.pages_failed:
            return 'partial'
        return 'success'

    def to_dict(self) -> Dict[str, Any]:
        return {
            "manufacturer": self.manufacturer,
            "region": self.region,
            "status": self.status,
            "success": self.success,
            "started_at": self.started_at,
            "finished_at": self.finished_at,
            "pages_discovered": self.pages_discovered,
            "pages_attempted": self.pages_attempted,
            "pages_succeeded": self.pages_succeeded,
            "pages_failed": self.pages_failed,
            "products_discovered": self.products_discovered,
            "skus_discovered": self.skus_discovered,
            "new_skus": self.new_skus,
            "updated_skus": self.updated_skus,
            "duplicates": self.duplicates,
            "rejected_records": self.rejected_records,
            "missing_critical_fields": self.missing_critical_fields,
            "source_failures": self.source_failures,
            "parser_failures": self.parser_failures,
            "average_latency_ms": self.average_latency_ms,
            "last_successful_run": self.last_successful_run,
            "last_failure": self.last_failure,
            "blocked_reason": self.blocked_reason,
            "errors": [e.to_dict() for e in self.errors[-50:]],
        }


def merge_reports(base: RunReport, other: RunReport) -> RunReport:
    """Merge ``other`` into ``base`` (used to combine regions of one maker)."""
    base.pages_discovered += other.pages_discovered
    base.pages_attempted += other.pages_attempted
    base.pages_succeeded += other.pages_succeeded
    base.pages_failed += other.pages_failed
    base.products_discovered += other.products_discovered
    base.skus_discovered += other.skus_discovered
    base.new_skus += other.new_skus
    base.updated_skus += other.updated_skus
    base.duplicates += other.duplicates
    base.rejected_records += other.rejected_records
    base.missing_critical_fields += other.missing_critical_fields
    base.source_failures += other.source_failures
    base.parser_failures += other.parser_failures
    base.total_latency_ms += other.total_latency_ms

    base.started_at = min(base.started_at, other.started_at)
    if other.finished_at:
        base.finished_at = max(base.finished_at or other.finished_at, other.finished_at)
    base.last_successful_run = other.last_successful_run or base.last_successful_run
    base.last_failure = other.last_failure or base.last_failure
    base.blocked_reason = other.blocked_reason or base.blocked_reason
    base.errors.extend(other.errors)
    return base


class SkuLedger:
    """Persistent SKU -> content fingerprint map.

    It is what makes "new SKU" and "updated SKU" meaningful: a SKU seen for the
    first time is new, a SKU whose fingerprint changed is updated, and a SKU
    whose fingerprint is unchanged is neither.
    """

    def __init__(self, path: Path):
        self.path = Path(path)
        self._entries: Dict[str, str] = {}
        self._load()

    def _load(self) -> None:
        if not self.path.exists():
            return
        try:
            with open(self.path, 'r', encoding='utf-8') as handle:
                data = json.load(handle)
            if isinstance(data, dict):
                self._entries = {str(k): str(v) for k, v in data.items()}
        except (OSError, ValueError) as exc:
            logger.warning("Could not read SKU ledger %s: %s", self.path, exc)

    def observe(self, sku: str, fingerprint: str) -> str:
        """Record a SKU observation and return 'new', 'updated' or 'unchanged'."""
        previous = self._entries.get(sku)
        if previous is None:
            status = 'new'
        elif previous != fingerprint:
            status = 'updated'
        else:
            status = 'unchanged'
        self._entries[sku] = fingerprint
        return status

    def save(self) -> None:
        """Persist the ledger so the next run can tell new from updated."""
        self.path.parent.mkdir(parents=True, exist_ok=True)
        tmp = self.path.with_suffix(self.path.suffix + '.tmp')
        with open(tmp, 'w', encoding='utf-8') as handle:
            json.dump(self._entries, handle, indent=2, sort_keys=True)
        tmp.replace(self.path)

    def __len__(self) -> int:
        return len(self._entries)


class ScraperHealth:
    """Mutable counters for one scraper run.

    The scraper and its HTTP client update this object while the run happens;
    :meth:`build_report` freezes it into an immutable :class:`RunReport`.
    """

    def __init__(self, manufacturer: str, region: str = '', ledger: Optional[SkuLedger] = None):
        self.manufacturer = manufacturer
        self.region = region
        self.ledger = ledger
        self.started_at = _timestamp()
        self.finished_at: Optional[str] = None

        self.pages_discovered = 0
        self.pages_attempted = 0
        self.pages_succeeded = 0
        self.pages_failed = 0

        self.products_discovered = 0
        self.skus_discovered = 0
        self.new_skus = 0
        self.updated_skus = 0

        self.duplicates = 0
        self.rejected_records = 0
        self.missing_critical_fields = 0

        self.source_failures = 0
        self.parser_failures = 0

        self.total_latency_ms = 0.0
        self.last_successful_run: Optional[str] = None
        self.last_failure: Optional[str] = None
        self.blocked_reason: Optional[str] = None
        self.errors: List[ErrorEntry] = []

    # -- pages ------------------------------------------------------------

    def record_pages_discovered(self, count: int = 1) -> None:
        """Count pages that were found but not necessarily fetched."""
        self.pages_discovered += count

    def record_page_attempt(self) -> None:
        """Count a request that is about to be made."""
        self.pages_attempted += 1

    def record_page_success(self, latency_ms: float) -> None:
        """Count a page that was fetched and handed to the parser."""
        self.pages_succeeded += 1
        self.total_latency_ms += max(0.0, latency_ms)
        self.last_successful_run = _timestamp()

    def record_page_failure(self, url: str, error: Exception, kind: str = SOURCE_FAILURE) -> None:
        """Count a page that could not be fetched or parsed."""
        self.pages_failed += 1
        self.last_failure = f"{type(error).__name__}: {error}"
        if kind == SOURCE_FAILURE:
            self.source_failures += 1
        elif kind == PARSER_FAILURE:
            self.parser_failures += 1
        self.errors.append(ErrorEntry(kind=kind, url=url, message=str(error)))

    def record_parser_failure(self, url: str, error: Exception) -> None:
        """Count a page that was fetched but could not be parsed."""
        self.record_page_failure(url, error, kind=PARSER_FAILURE)

    def record_blocked(self, reason: str) -> None:
        """Record that the run stopped because the source policy forbids it."""
        self.blocked_reason = reason
        self.last_failure = reason
        self.errors.append(ErrorEntry(kind=BLOCKED, url="", message=reason))

    # -- records ----------------------------------------------------------

    def record_duplicate(self) -> None:
        """Count a product that was dropped because it is a duplicate."""
        self.duplicates += 1

    def record_rejected(self, reason: str = "") -> None:
        """Count a record that was rejected by validation."""
        self.rejected_records += 1
        if reason:
            self.errors.append(ErrorEntry(kind=VALIDATION_FAILURE, url="", message=reason))

    def record_missing_critical_fields(self, fields: Iterable[str]) -> None:
        """Count records that were missing critical fields."""
        missing = list(fields)
        if not missing:
            return
        self.missing_critical_fields += len(missing)
        self.errors.append(ErrorEntry(
            kind=VALIDATION_FAILURE,
            url="",
            message=f"missing critical fields: {', '.join(missing)}",
        ))

    def record_product(self, product: Any) -> RecordEvaluation:
        """Record a scraped product, its SKUs and its validation outcome."""
        self.products_discovered += 1

        variants = getattr(product, 'variants', None) or []
        for variant in variants:
            sku = getattr(variant, 'sku', None) or getattr(variant, 'variant_id', None)
            if not sku:
                continue
            self.skus_discovered += 1
            if self.ledger is not None:
                status = self.ledger.observe(sku, _variant_fingerprint(variant))
                if status == 'new':
                    self.new_skus += 1
                elif status == 'updated':
                    self.updated_skus += 1

        evaluation = evaluate_product(product)
        if evaluation.missing_fields:
            self.record_missing_critical_fields(evaluation.missing_fields)
        if not evaluation.valid:
            self.record_rejected("; ".join(evaluation.errors) or "missing critical fields")
        return evaluation

    # -- output -----------------------------------------------------------

    def build_report(self) -> RunReport:
        """Freeze the counters into a report."""
        self.finished_at = self.finished_at or _timestamp()
        return RunReport(
            manufacturer=self.manufacturer,
            region=self.region,
            started_at=self.started_at,
            finished_at=self.finished_at,
            pages_discovered=self.pages_discovered,
            pages_attempted=self.pages_attempted,
            pages_succeeded=self.pages_succeeded,
            pages_failed=self.pages_failed,
            products_discovered=self.products_discovered,
            skus_discovered=self.skus_discovered,
            new_skus=self.new_skus,
            updated_skus=self.updated_skus,
            duplicates=self.duplicates,
            rejected_records=self.rejected_records,
            missing_critical_fields=self.missing_critical_fields,
            source_failures=self.source_failures,
            parser_failures=self.parser_failures,
            total_latency_ms=self.total_latency_ms,
            last_successful_run=self.last_successful_run,
            last_failure=self.last_failure,
            blocked_reason=self.blocked_reason,
            errors=list(self.errors),
        )


def _variant_fingerprint(variant: Any) -> str:
    """Stable fingerprint of a variant's content, used to detect updates."""
    import hashlib

    specs = getattr(variant, 'specs', None) or {}
    parts: List[str] = []
    for name in sorted(specs):
        spec = specs[name]
        raw = getattr(spec, 'raw', None)
        if raw is None and isinstance(spec, dict):
            raw = spec.get('raw', '')
        parts.append(f"{name}={raw}")
    price = getattr(variant, 'price', None)
    parts.append(f"price={price}")
    return hashlib.sha256("|".join(parts).encode('utf-8')).hexdigest()[:32]


class HealthCollector:
    """Collects the reports of every manufacturer that ran in this process."""

    def __init__(self, output_dir: str = './output/health'):
        self.output_dir = Path(output_dir)
        self._reports: Dict[str, RunReport] = {}

    def register(self, report: RunReport) -> RunReport:
        """Register a run report, merging it into the manufacturer aggregate."""
        existing = self._reports.get(report.manufacturer)
        if existing is None:
            self._reports[report.manufacturer] = report
            return report
        return merge_reports(existing, report)

    def get(self, manufacturer: str) -> Optional[RunReport]:
        return self._reports.get(manufacturer.lower())

    @property
    def reports(self) -> Dict[str, RunReport]:
        return dict(self._reports)

    def reset(self) -> None:
        self._reports.clear()

    def write_all(self) -> List[Path]:
        """Write one JSON report per manufacturer."""
        written: List[Path] = []
        for manufacturer, report in self._reports.items():
            path = self.output_dir / f"{manufacturer}.json"
            path.parent.mkdir(parents=True, exist_ok=True)
            with open(path, 'w', encoding='utf-8') as handle:
                json.dump(report.to_dict(), handle, indent=2)
            written.append(path)
        return written

    def summary_rows(self) -> List[Dict[str, Any]]:
        """Rows for the summary table, one per manufacturer."""
        rows: List[Dict[str, Any]] = []
        for manufacturer in sorted(self._reports):
            report = self._reports[manufacturer]
            rows.append({
                'manufacturer': manufacturer,
                'status': report.status,
                'pages': f"{report.pages_succeeded}/{report.pages_attempted}",
                'products': report.products_discovered,
                'skus': report.skus_discovered,
                'new': report.new_skus,
                'updated': report.updated_skus,
                'rejected': report.rejected_records,
                'avg_ms': report.average_latency_ms,
                'last_success': report.last_successful_run or '-',
                'last_failure': report.last_failure or '-',
            })
        return rows

    def summary_table(self) -> str:
        """Render the per-manufacturer summary as a fixed-width table."""
        rows = self.summary_rows()
        headers = [
            'manufacturer', 'status', 'pages', 'products', 'skus',
            'new', 'updated', 'rejected', 'avg_ms', 'last_success', 'last_failure',
        ]
        if not rows:
            return "No scraper health reports were produced."

        widths = [len(h) for h in headers]
        for row in rows:
            for index, header in enumerate(headers):
                widths[index] = max(widths[index], len(str(row[header])))

        def _line(values: Iterable[Any]) -> str:
            return "  ".join(str(v).ljust(widths[i]) for i, v in enumerate(values)).rstrip()

        lines = [_line(headers), _line("-" * w for w in widths)]
        for row in rows:
            lines.append(_line(row[h] for h in headers))
        return "\n".join(lines)


_COLLECTOR = HealthCollector()


def get_collector() -> HealthCollector:
    """Return the process-wide collector."""
    return _COLLECTOR


def reset_collector() -> None:
    """Clear the process-wide collector (used by tests)."""
    _COLLECTOR.reset()
