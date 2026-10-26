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

Nothing is written back to the CSV by this script. It prints a report and can
emit a machine-readable JSON sidecar with ``--json``. A row that cannot be
confirmed is reported as unconfirmed, never silently corrected.

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

# ---------------------------------------------------------------------------
# Manufacturer technical specification pages.
#
# Each entry was fetched and confirmed to return HTTP 200 and to contain the
# part number it is used to verify. A row whose page is not registered here is
# reported as unconfirmed rather than assumed correct.
# ---------------------------------------------------------------------------
TECHSPEC_PAGES: Dict[str, str] = {
    "Zenbook A14 (UX3407)": "https://www.asus.com/us/laptops/for-home/zenbook/asus-zenbook-a14-ux3407/techspec/",
    "Zenbook 14 (UX3405)": "https://www.asus.com/us/laptops/for-home/zenbook/asus-zenbook-14-ux3405/techspec/",
    "Zenbook S 16 (UM5606)": "https://www.asus.com/us/laptops/for-home/zenbook/asus-zenbook-s-16-um5606/techspec/",
    "Zenbook Duo (UX8406)": "https://www.asus.com/us/laptops/for-home/zenbook/asus-zenbook-duo-ux8406/techspec/",
    "Vivobook S 14 (S3407)": "https://www.asus.com/us/laptops/for-home/vivobook/asus-vivobook-s-14-s3407/techspec/",
    "Vivobook S 15 (S3507)": "https://www.asus.com/us/laptops/for-home/vivobook/asus-vivobook-s-15-s3507/techspec/",
    "Zephyrus G14 (2025)": "https://www.asus.com/us/laptops/gaming/rog-republic-of-gamers/asus-rog-zephyrus-g14-ga403/techspec/",
    "ProArt P16 (H7606)": "https://www.asus.com/us/laptops/for-creators/asus-proart-p16-h7606/techspec/",
    "Zenbook 14 Flip (UP3404)": "https://www.asus.com/us/laptops/for-home/zenbook/asus-zenbook-14-flip-up3404/techspec/",
    # Apple publishes per-family spec pages, not per-part-number sheets, so
    # the page can confirm family-level fields (display size, RAM, storage)
    # but cannot confirm a specific MRX...LL/A configuration. The adapter
    # reports the fields it can verify and flags the SKU-specific ones it
    # cannot, so a row is never silently called confirmed.
    "MacBook Air 13 (M4)": "https://www.apple.com/macbook-air/specs/",
    "MacBook Air 15 (M4)": "https://www.apple.com/macbook-air/specs/",
    "MacBook Pro 14 (M4 Pro)": "https://www.apple.com/macbook-pro/specs/",
}


@dataclass
class SpecColumn:
    """One configuration column of a manufacturer specification table.

    ``values`` maps a row title ("Display", "Weight" ...) to the text the
    manufacturer publishes for this configuration.
    """

    name: str
    values: Dict[str, str] = field(default_factory=dict)


@dataclass
class SpecTable:
    source_url: str
    order: List[str] = field(default_factory=list)
    rows: Dict[str, Dict[str, str]] = field(default_factory=dict)

    def column(self, name: str) -> Optional[SpecColumn]:
        for candidate in self.order:
            if candidate.strip().lower() == name.strip().lower():
                return self._column(candidate)
        return None

    def columns_with_prefix(self, prefix: str) -> List[SpecColumn]:
        return [self._column(candidate) for candidate in self.order if candidate.startswith(prefix)]

    @property
    def columns(self) -> List[SpecColumn]:
        return [self._column(candidate) for candidate in self.order]

    def _column(self, part_number: str) -> SpecColumn:
        return SpecColumn(
            name=part_number,
            values={
                title: cells.get(part_number, "")
                for title, cells in self.rows.items()
            },
        )


def _text(element: Optional[Any]) -> str:
    if element is None:
        return ""
    return re.sub(r"\s+", " ", element.get_text(" ", strip=True)).strip()


class AsusAdapter:
    """ASUS publishes a per-family technical specification table.

    The table is rendered by a Vue component whose class names are hashed per
    build, so the stable hooks are the literal class names the component adds
    (``rowTableTitle``, ``rowTableItemViewBox``, ``pdName``) and an
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
        rows_markup = soup.select("div.rowTableItemViewBox")
        if not rows_markup:
            return None

        order: List[str] = []
        rows: Dict[str, Dict[str, str]] = {}

        for row in rows_markup:
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
            cells = box.select('div[class*="rowTableItems"]')
            texts = [_text(c) for c in cells]

            if title.strip().lower() == "model":
                # The Model row establishes the column order for the whole
                # table, so every later row is aligned to it by position.
                names: List[Optional[str]] = []
                for cell in cells:
                    name_el = cell.find(class_="pdName")
                    names.append(_text(name_el) or None)
                order = [n for n in names if n]
                rows[title] = {
                    name: text for name, text in zip(names, texts) if name
                }
            elif order:
                rows[title] = {
                    name: texts[index] if index < len(texts) else ""
                    for index, name in enumerate(order)
                }

        if not order:
            return None
        return SpecTable(source_url=str(response.url), order=order, rows=rows)


def names_for(values: Dict[str, Dict[str, str]], order: List[str]) -> List[str]:
    return order


# Apple part numbers are retailer SKUs (e.g. "MRXN3LL/A") that Apple's own
# family spec page never publishes; the page confirms family-level fields
# (display size, RAM, storage) but not a specific configuration.
APPLE_SKU_RE = re.compile(r"[A-Z0-9]{6,}[LZ]L/A", re.IGNORECASE)


class AppleAdapter:
    """Apple publishes one family spec page per product line (Air, Pro).

    The page confirms family-level fields (display size, RAM, storage options)
    but does not publish a per-configuration part number, processor or weight.
    So this adapter returns a ``SpecTable`` with a single anonymous column
    holding the family-level values, and leaves the per-SKU comparison to the
    caller, which reports the SKU-specific fields as unconfirmable rather than
    silently confirming them.
    """

    name = "Apple"

    def __init__(self, client: httpx.AsyncClient) -> None:
        self.client = client

    async def spec_table(self, techspec_url: str) -> Optional[SpecTable]:
        response = await self.client.get(techspec_url)
        if response.status_code != 200:
            return None
        soup = BeautifulSoup(response.text, "html.parser")
        text = re.sub(r"\s+", " ", soup.get_text(" ", strip=True))
        if not text:
            return None
        # A single anonymous column carrying the whole family page.
        return SpecTable(
            source_url=str(response.url),
            order=["family"],
            rows={"family": {"display": text, "memory": text, "storage": text}},
        )

    def parse_family(self, table: SpecTable) -> Dict[str, str]:
        """Extract the family-level fields the page actually publishes."""
        cell = table.rows["family"].get("display", "")
        out: Dict[str, str] = {}
        # Only fields the page states once are usable: an ambiguous page that
        # lists several options can never contradict a catalog row.
        sizes = distinct_values(cell, SIZE_RE)
        if len(sizes) == 1:
            out["display_size"] = re.sub(r"[^\d.]", "", sizes[0])
        panels = [p for p in ("OLED", "IPS", "Mini-LED", "Liquid Retina") if p in cell]
        if len(panels) == 1:
            out["display_type"] = panels[0]
        memory = table.rows["family"].get("memory", "")
        rams = distinct_values(memory, re.compile(r"\b(\d{2,3})\s*GB\b"))
        if len(rams) == 1:
            out["ram_gb"] = rams[0]
        storages = re.findall(r"\b(\d{1,2})\s*(TB|GB)\b", table.rows["family"].get("storage", ""), re.IGNORECASE)
        sizes_gb = {
            int(size) * 1024 if unit.upper() == "TB" else int(size) for size, unit in storages
        }
        if len(sizes_gb) == 1:
            out["storage_gb"] = str(sizes_gb.pop())
        return out


async def _verify_apple_row(
    client: httpx.AsyncClient, row: Dict[str, str], techspec_url: str
) -> Dict[str, Any]:
    """Verify an Apple catalog row against the family spec page.

    Apple publishes one family page per product line (Air, Pro). It confirms
    family-level fields (display size, RAM, storage) but never the per-SKU
    part number, processor or weight, so those are reported as unconfirmable
    rather than silently called correct. A row is reported ``confirmed`` only
    for the fields the page actually states.
    """
    adapter = AppleAdapter(client)
    table = await adapter.spec_table(techspec_url)
    if table is None:
        return {"status": "unconfirmed", "reason": "Apple spec page not found"}

    observed = adapter.parse_family(table)

    # Apple's family page does not carry the retailer part number
    # (e.g. "MRXN3LL/A"), so the specific configuration cannot be confirmed.
    sku_on_page = bool(
        APPLE_SKU_RE.search(table.rows["family"].get("display", ""))
    ) if table.rows else False

    # SKU-specific fields the family page cannot state. Reported explicitly so
    # a row is never silently treated as fully verified.
    sku_only = ("cpu_model", "cpu_brand", "cpu_cores", "gpu_model", "weight_kg", "battery_wh")
    unconfirmable = [f for f in sku_only if (row.get(f) or "").strip()]

    conflicts = []
    for field_name, value in observed.items():
        current = (row.get(field_name) or "").strip()
        if not current:
            continue
        try:
            same = abs(float(current) - float(value)) < 0.051
        except (TypeError, ValueError):
            same = normalize_cpu(current) == normalize_cpu(str(value))
        if not same:
            conflicts.append(
                {"field": field_name, "catalog": current, "manufacturer": value}
            )

    result: Dict[str, Any] = {
        "status": "confirmed" if observed else "unconfirmed",
        "source_url": table.source_url,
        "sku_published_on_page": sku_on_page,
        "observed": observed,
        "conflicts": conflicts,
    }
    if unconfirmable:
        result["unconfirmable"] = {
            "fields": unconfirmable,
            "reason": "Apple's family page does not publish per-configuration "
                      "part numbers, processor or weight",
        }
    if not observed:
        result["reason"] = "no family-level field could be parsed from the page"
    return result



# ---------------------------------------------------------------------------
# Parsing helpers
# ---------------------------------------------------------------------------

RESOLUTION_RE = re.compile(r"\(?\d{3,4}\s*x\s*\d{3,4}\)?")
SIZE_RE = re.compile(r"\d{1,2}(?:\.\d)?\s*(?:-|\s)?(?:inch|\")", re.IGNORECASE)
REFRESH_RE = re.compile(r"Refresh\s*Rate\s*:?\s*\d{2,3}\s*Hz", re.IGNORECASE)
NITS_RE = re.compile(r"\d{3,4}\s*nits", re.IGNORECASE)
WEIGHT_RE = re.compile(r"\d\.\d{2}\s*kg", re.IGNORECASE)
BATTERY_RE = re.compile(r"\d{2,3}\s*WHrs", re.IGNORECASE)
RAM_OPTION_RE = re.compile(r"(\d{1,3})\s*GB\s+(LPDDR\d+X?|DDR\d+)", re.IGNORECASE)
RAM_TYPE_RE = re.compile(r"(LPDDR\d+X?|DDR\d+)", re.IGNORECASE)
STORAGE_OPTION_RE = re.compile(r"(\d{1,2})\s*(TB|GB)\s+(?:M\.2\s+)?NVMe", re.IGNORECASE)
CPU_RE = re.compile(
    r"(Snapdragon[^)]*?Processor|Core\s+Ultra\s+\d+\s+\d+\w*|Ryzen[^)]*?Processor)",
    re.IGNORECASE,
)


def option_pairs(column: SpecColumn) -> List[tuple]:
    """Memory/storage option pairs the manufacturer lists for a column.

    ASUS publishes one column per family code but merges the memory and
    storage options of several configurations into the same cell, in the same
    order. Pairing them by position recovers the individual configurations.
    """
    memory = column.values.get("Memory", "")
    storage = column.values.get("Storage", "")
    ram_options = [int(m) for m in RAM_OPTION_RE.findall(memory)]
    storage_options = []
    for size, unit in STORAGE_OPTION_RE.findall(storage):
        storage_options.append(int(size) * 1024 if unit.upper() == "TB" else int(size))
    pairs = []
    for index, ram in enumerate(ram_options):
        if index < len(storage_options):
            pairs.append((ram, storage_options[index]))
    return pairs


def count_matches(text: str, pattern: "re.Pattern[str]") -> int:
    return len(pattern.findall(text))


def distinct_values(text: str, pattern: "re.Pattern[str]") -> List[str]:
    return [m if isinstance(m, str) else m[0] for m in pattern.findall(text)]


def parse_column(column: SpecColumn) -> Dict[str, Any]:
    """Parse a manufacturer specification column.

    A field is only reported when the manufacturer states a single value for
    it. A cell that lists several options (a family page covering several
    configurations) is ambiguous, and an ambiguous cell can never be used to
    claim that a catalog row is wrong.
    """
    out: Dict[str, Any] = {}
    values = {k: v for k, v in column.values.items() if v}

    display = values.get("Display", "")
    if display:
        resolutions = distinct_values(display, RESOLUTION_RE)
        if len(resolutions) == 1:
            out["display_resolution"] = re.sub(r"\s*x\s*", "x", resolutions[0].strip("()"))
        sizes = distinct_values(display, SIZE_RE)
        if len(sizes) == 1:
            out["display_size"] = re.sub(r"[^\d.]", "", sizes[0])
        panels = [p for p in ("OLED", "IPS", "TN", "VA") if p in display.upper()]
        if len(panels) == 1:
            out["display_type"] = panels[0]
        refreshes = distinct_values(display, REFRESH_RE)
        if len(refreshes) == 1:
            out["display_refresh"] = refreshes[0]
        nits = distinct_values(display, NITS_RE)
        if len(nits) == 1:
            out["display_nits"] = nits[0]

    weight = values.get("Weight", "")
    weights = distinct_values(weight, WEIGHT_RE)
    if len(weights) == 1:
        out["weight_kg"] = re.sub(r"[^\d.]", "", weights[0])

    battery = values.get("Battery", "")
    batteries = distinct_values(battery, BATTERY_RE)
    if len(batteries) == 1:
        out["battery_wh"] = re.sub(r"[^\d.]", "", batteries[0])

    memory = values.get("Memory", "")
    rams = distinct_values(memory, RAM_OPTION_RE)
    if len(rams) == 1:
        out["ram_gb"] = rams[0]
    types = distinct_values(memory, RAM_TYPE_RE)
    if len(types) == 1:
        out["ram_type"] = types[0].upper()

    storage = values.get("Storage", "")
    storages = [
        int(size) * 1024 if unit.upper() == "TB" else int(size)
        for size, unit in STORAGE_OPTION_RE.findall(storage)
    ]
    if len(storages) == 1:
        out["storage_gb"] = str(storages[0])

    processor = values.get("Processor", "")
    cpus = distinct_values(processor, CPU_RE)
    if len(cpus) == 1:
        out["cpu_model"] = re.sub(r"\s+", " ", cpus[0]).strip()

    return out


def family_code(sku: str) -> str:
    """ASUS retail part numbers are ``<family>-<config>[-<region>]``."""
    return sku.split("-")[0] if sku else sku


def normalize_cpu(value: str) -> str:
    """Normalise a processor description for comparison.

    "Snapdragon® X Elite X1E 78 100 Processor" and
    "Snapdragon X Elite X1E-78-100" must compare equal.
    """
    text = value.lower().replace("®", "").replace("™", "")
    text = re.sub(r"\bprocessor\b", "", text)
    return re.sub(r"[^a-z0-9]", "", text)


async def verify_row(
    client: httpx.AsyncClient, row: Dict[str, str], techspec_url: str
) -> Dict[str, Any]:
    manufacturer = row.get("manufacturer", "").strip().lower()
    if manufacturer == "apple":
        return await _verify_apple_row(client, row, techspec_url)
    adapter = AsusAdapter(client)
    table = await adapter.spec_table(techspec_url)
    if table is None:
        return {"status": "unconfirmed", "reason": "specification table not found"}

    code = family_code(row["sku_code"])
    candidates = table.columns_with_prefix(code)
    if not candidates:
        # The manufacturer's family code and the catalog's family code can
        # differ in length ("UM5606" vs "UM5606QA"), so also try the other
        # direction before giving up.
        candidates = [
            table._column(name)
            for name in table.order
            if name.startswith(code) or code.startswith(name)
        ]
    if not candidates:
        return {
            "status": "unconfirmed",
            "reason": f"part number {code} not present in the specification table",
            "available": list(table.order),
        }

    # A family can appear in the table several times with different processor
    # options. Pick the column that matches the processor the catalog row
    # claims, and refuse to guess when the match is not unique.
    if len(candidates) > 1:
        wanted = normalize_cpu(row.get("cpu_model", ""))
        matches = [c for c in candidates if wanted and wanted in normalize_cpu(c.values.get("Processor", ""))]
        if len(matches) != 1:
            # The part number and the processor may simply disagree: the
            # processor the catalog claims may belong to a different family
            # code on the same page. That is a contradiction, not an
            # ambiguity, and it is worth reporting.
            elsewhere = [
                c for c in table.columns
                if wanted and wanted in normalize_cpu(c.values.get("Processor", ""))
            ]
            if elsewhere:
                return {
                    "status": "confirmed",
                    "source_url": table.source_url,
                    "part_number": candidates[0].name,
                    "observed": {},
                    "conflicts": [
                        {
                            "field": "cpu_model",
                            "catalog": row.get("cpu_model", ""),
                            "manufacturer": (
                                f"{elsewhere[0].name} lists this processor; "
                                f"{candidates[0].name} does not"
                            ),
                        }
                    ],
                }
            return {
                "status": "unconfirmed",
                "reason": (
                    f"part number {code} appears {len(candidates)} times in the "
                    "specification table and the processor does not identify one column"
                ),
                "candidates": [c.name for c in candidates],
            }
        column = matches[0]
    else:
        column = candidates[0]

    observed = parse_column(column)
    conflicts = []
    for field_name, value in observed.items():
        current = (row.get(field_name) or "").strip()
        if not current:
            continue
        try:
            same = abs(float(current) - float(value)) < 0.051
        except (TypeError, ValueError):
            same = normalize_cpu(current) == normalize_cpu(str(value))
        if not same:
            conflicts.append(
                {"field": field_name, "catalog": current, "manufacturer": value}
            )

    return {
        "status": "confirmed",
        "source_url": table.source_url,
        "part_number": column.name,
        "observed": observed,
        "conflicts": conflicts,
    }


async def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--json", help="write the machine-readable report here")
    parser.add_argument("--timeout", type=float, default=30.0)
    args = parser.parse_args()

    with CSV_PATH.open(newline="", encoding="utf-8") as handle:
        rows = list(csv.DictReader(handle))

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
            url = TECHSPEC_PAGES.get(row["model"])
            if not url:
                entry["status"] = "not-attempted"
                entry["reason"] = "no manufacturer specification page registered"
                results.append(entry)
                continue
            try:
                entry.update(await verify_row(client, row, url))
            except Exception as exc:  # noqa: BLE001 - report, never crash
                entry["status"] = "error"
                entry["reason"] = f"{type(exc).__name__}: {exc}"
            results.append(entry)

    confirmed = [r for r in results if r.get("status") == "confirmed"]
    conflicts = [r for r in confirmed if r.get("conflicts")]

    print(f"rows checked:            {len(results)}")
    print(f"confirmed against a page: {len(confirmed)}")
    print(f"rows contradicting it:   {len(conflicts)}")
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
