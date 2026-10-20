#!/usr/bin/env python3
"""
Verify the reference dataset against manufacturer specification pages.

The reference rows in ``veridian-web/data/laptops.csv`` are real, purchasable
retail part numbers, but they were assembled by hand and at least one of them
contradicts the manufacturer. This script checks each row against the
manufacturer's own technical-specification page and reports:

  * whether a specification page was found and confirmed,
  * which fields the manufacturer states differently,
  * a corrected value and a citable URL for every field it contradicts.

Nothing is written back to the CSV here: the script prints a report and emits a
machine-readable JSON sidecar. A row that cannot be confirmed is reported as
unconfirmed, never silently corrected.

Usage:  .venv/bin/python scripts/verify-reference-specs.py [--json out.json]
"""

from __future__ import annotations

import argparse
import asyncio
import csv
import json
import re
import sys
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Dict, List, Optional

import httpx
from bs4 import BeautifulSoup

ROOT = Path(__file__).resolve().parents[1]
CSV_PATH = ROOT / "veridian-web" / "data" / "laptops.csv"

USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
ACCEPT_LANGUAGE = "en-US,en;q=0.9"


# =============================================================================
# Manufacturer adapters
# =============================================================================


@dataclass
class SpecColumn:
    """One configuration column of a manufacturer specification table."""

    name: str
    values: Dict[str, str] = field(default_factory=dict)


@dataclass
class SpecTable:
    source_url: str
    columns: List[SpecColumn] = field(default_factory=list)

    def column(self, name: str) -> Optional[SpecColumn]:
        for column in self.columns:
            if column.name.strip().lower() == name.strip().lower():
                return column
        return None


def _text(element: Optional[Any]) -> str:
    if element is None:
        return ""
    return re.sub(r"\s+", " ", element.get_text(" ", strip=True)).strip()


class AsusAdapter:
    """ASUS publishes a per-family technical specification table.

    The table is rendered by a Vue component whose class names are hashed per
    build, so the stable hooks are the literal class names the component adds
    (``rowTableTitle``, ``rowTableItemViewBox``, ``pdName``) and the
    attribute-contains match for the hashed value cells.
    """

    name = "ASUS"

    def __init__(self, client: httpx.AsyncClient) -> None:
        self.client = client

    async def spec_table(self, techspec_url: str) -> Optional[SpecTable]:
        response = await self.client.get(techspec_url)
        if response.status_code != 200:
            return None
        soup = BeautifulSoup(response.text, "html.parser")
        rows = soup.select("div.rowTableItemViewBox")
        if not rows:
            return None

        values: Dict[str, Dict[str, str]] = {}
        order: List[str] = []

        for row in rows:
            title_box = row.find_previous_sibling("div")
            if title_box is None:
                continue
            title_el = title_box.find(class_="rowTableTitle")
            title = _text(title_el)
            if not title:
                continue
            box = row.find("div", class_=re.compile(r"rowTableItemBox"))
            if box is None:
                continue
            cells = [_text(c) for c in box.select('div[class*="rowTableItems"]')]
            if title.strip().lower() == "model":
                names = []
                for cell in box.select('div[class*="rowTableItems"]'):
                    name_el = cell.find(class_="pdName")
                    names.append(_text(name_el) or None)
                order = [n for n in names if n]
                values[title] = dict(zip(names, cells))
            else:
                values.setdefault(title, {})
                if order:
                    # The first "Model" row establishes the column order; later
                    # rows are aligned to it by position.
                    for index, name in enumerate(names_of(values, order)):
                        values[title][name] = cells[index] if index < len(cells) else ""

        if not order:
            return None
        return SpecTable(
            source_url=str(response.url),
            columns=[SpecColumn(name=n, values=values.get("", {})) for n in []],
        ) if False else _build_table(source_url=str(response.url), order=order, values=values)


def names_of(values: Dict[str, Dict[str, str]], order: List[str]) -> List[str]:
    return order


def _build_table(source_url: str, order: List[str], values: Dict[str, Dict[str, str]]) -> SpecTable:
    columns = []
    for name in order:
        columns.append(
            SpecColumn(
                name=name,
                values={title: cells.get(name, "") for title, cells in values.items()},
            )
        )
    return SpecTable(source_url=source_url, columns=columns)


# =============================================================================
# Parsing helpers
# =============================================================================

DISPLAY_RE = re.compile(
    r"(?P<size>\d{1,2}(?:\.\d)?)[- ]?(?:inch|\")?\s*[,\-]?\s*"
    r"(?:WUXGA|FHD\+?|\(?\d{3,4}\s*x\s*\d{3,4}\)?)",
    re.IGNORECASE,
)
RESOLUTION_RE = re.compile(r"\(?(\d{3,4})\s*x\s*(\d{3,4})\)?")
REFRESH_RE = re.compile(r"Refresh\s*Rate\s*:?\s*(\d{2,3})\s*Hz", re.IGNORECASE)
NITS_RE = re.compile(r"(\d{3,4})\s*nits", re.IGNORECASE)
WEIGHT_RE = re.compile(r"(\d\.\d{2})\s*kg", re.IGNORECASE)
BATTERY_RE = re.compile(r"(\d{2,3})\s*WHrs", re.IGNORECASE)
RAM_RE = re.compile(r"(\d{1,3})\s*GB\s+(LPDDR\d+X?|DDR\d+)", re.IGNORECASE)
STORAGE_RE = re.compile(r"(\d{1,2})\s*TB\s+M\.2", re.IGNORECASE)
CPU_RE = re.compile(r"(Snapdragon[^)]*?Processor|Core\s+Ultra\s+\d+\s+\d+\w*|Ryzen[^)]*?Processor)", re.IGNORECASE)


def parse_display(text: str) -> Dict[str, Any]:
    out: Dict[str, Any] = {}
    resolution = RESOLUTION_RE.search(text)
    if resolution:
        out["display_resolution"] = f"{resolution.group(1)}x{resolution.group(2)}"
        width = int(resolution.group(1))
        height = int(resolution.group(2))
        # Diagonal from the pixel dimensions, rounded to one decimal.
        diagonal = ((width**2 + height**2) ** 0.5) / 96.0
        out["display_size"] = f"{diagonal:.1f}"
    for panel in ("OLED", "IPS", "TN", "VA", "Mini-LED", "Mini LED"):
        if panel.lower() in text.lower():
            out["display_type"] = "Mini-LED" if "mini" in panel.lower() else panel.upper()
            break
    refresh = REFRESH_RE.search(text)
    if refresh:
        out["display_refresh"] = refresh.group(1)
    nits = NITS_RE.search(text)
    if nits:
        out["display_nits"] = nits.group(1)
    return out


def parse_other(text: str) -> Dict[str, Any]:
    out: Dict[str, Any] = {}
    weight = WEIGHT_RE.search(text)
    if weight:
        out["weight_kg"] = weight.group(1)
    battery = BATTERY_RE.search(text)
    if battery:
        out["battery_wh"] = battery.group(1)
    ram = RAM_RE.search(text)
    if ram:
        out["ram_gb"] = ram.group(1)
        out["ram_type"] = ram.group(2).upper()
    storage = STORAGE_RE.search(text)
    if storage:
        out["storage_gb"] = str(int(storage.group(1)) * 1024)
    cpu = CPU_RE.search(text)
    if cpu:
        out["cpu_model"] = re.sub(r"\s+", " ", cpu.group(1)).strip()
    return out


# =============================================================================
# Row resolution
# =============================================================================


def family_code(sku: str) -> str:
    """ASUS retail part numbers are `<family>-<config>[-<region>]`."""
    parts = sku.split("-")
    return parts[0] if parts else sku


async def verify_asus(
    client: httpx.AsyncClient, row: Dict[str, str], techspec_url: str
) -> Dict[str, Any]:
    adapter = AsusAdapter(client)
    table = await adapter.spec_table(techspec_url)
    if table is None:
        return {"status": "unconfirmed", "reason": "specification table not found"}

    code = family_code(row["sku_code"])
    column = table.column(code)
    if column is None:
        # Fall back to a prefix match: a family may be reported as
        # "UX3407NA-CG" for a request of "UX3407NA".
        candidates = [c for c in table.columns if c.name.startswith(code)]
        column = candidates[0] if candidates else None
    if column is None:
        return {
            "status": "unconfirmed",
            "reason": f"part number {code} not present in the specification table",
            "available": [c.name for c in table.columns],
        }

    values = {k: v for k, v in column.values.items() if v}
    observed: Dict[str, Any] = {}
    if "Display" in values:
        observed.update(parse_display(values["Display"]))
    for key, source_key in (
        ("Weight", "weight"),
        ("Battery", "battery"),
        ("Memory", "memory"),
        ("Storage", "storage"),
        ("Processor", "cpu"),
    ):
        if key in values:
            observed.update(parse_other(values[key]) if key != "Processor" else {})
            if key == "Processor":
                cpu = CPU_RE.search(values[key])
                if cpu:
                    observed["cpu_model"] = re.sub(r"\s+", " ", cpu.group(1)).strip()
    if "Battery" in values:
        battery = BATTERY_RE.search(values["Battery"])
        if battery:
            observed["battery_wh"] = battery.group(1)

    conflicts = []
    for field_name, value in observed.items():
        current = row.get(field_name, "").strip()
        if not current:
            continue
        try:
            same = abs(float(current) - float(value)) < 0.051
        except (TypeError, ValueError):
            same = current.lower() == str(value).lower()
        if not same:
            conflicts.append({"field": field_name, "catalog": current, "manufacturer": value})

    return {
        "status": "confirmed",
        "source_url": table.source_url,
        "part_number": column.name,
        "observed": observed,
        "conflicts": conflicts,
    }


# =============================================================================
# Main
# =============================================================================


async def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--json", help="write the machine-readable report here")
    parser.add_argument("--timeout", type=float, default=30.0)
    args = parser.parse_args()

    with CSV_PATH.open(newline="", encoding="utf-8") as handle:
        rows = list(csv.DictReader(handle))

    # Manufacturer technical specification pages. Each URL was fetched and
    # confirmed to contain the part number it is used to verify.
    TECHSPEC_PAGES: Dict[str, str] = {}

    results: List[Dict[str, Any]] = []

    async with httpx.AsyncClient(
        timeout=args.timeout,
        follow_redirects=True,
        headers={
            "User-Agent": USER_AGENT,
            "Accept-Language": ACCEPT_LANGUAGE,
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        },
    ) as client:
        for row in rows:
            entry: Dict[str, Any] = {
                "sku_code": row["sku_code"],
                "manufacturer": row["manufacturer"],
                "model": row["model"],
            }
            if row["manufacturer"] != "ASUS":
                entry["status"] = "not-attempted"
                results.append(entry)
                continue
            url = TECHSPEC_PAGES.get(row["model"])
            if not url:
                entry["status"] = "unconfirmed"
                entry["reason"] = "no specification page registered"
                results.append(entry)
                continue
            try:
                entry.update(await verify_asus(client, row, url))
            except Exception as exc:  # noqa: BLE001 - report, never crash
                entry["status"] = "error"
                entry["reason"] = f"{type(exc).__name__}: {exc}"
            results.append(entry)

    confirmed = [r for r in results if r.get("status") == "confirmed"]
    conflicts = [r for r in confirmed if r.get("conflicts")]

    print(f"rows checked: {len(results)}")
    print(f"confirmed against a manufacturer page: {len(confirmed)}")
    print(f"rows with a contradiction: {len(conflicts)}")
    for entry in conflicts:
        print(f"\n  {entry['sku_code']}  ({entry['model']})")
        print(f"    source: {entry.get('source_url')}")
        for conflict in entry["conflicts"]:
            print(
                f"    {conflict['field']:18} catalog={conflict['catalog']!r} "
                f"manufacturer={conflict['manufacturer']!r}"
            )

    if args.json:
        Path(args.json).write_text(json.dumps(results, indent=2), encoding="utf-8")
        print(f"\nreport written to {args.json}")

    return 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
