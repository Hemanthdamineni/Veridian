"""
Tests for the reference-verification path (scripts/verify-reference-specs.py).

The script compares catalog rows against a manufacturer's own pagemore. Apple
publishes a family page, not a per-SKU sheet, so the Apple adapter must confirm
only the family-level fields it can actually read and must report the
SKU-specific fields (part number, CPU, weight) as unconfirmable rather than
silently calling the row verified.
"""

from __future__ import annotations

import asyncio
import importlib.util
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]

APPLE_SPECS_FIXTURE = Path(__file__).parent / "fixtures" / "apple_macbook_air_specs.html"
VERIFY_MODULE = ROOT / "scripts" / "verify-reference-specs.py"


def _load_verify_module():
    spec = importlib.util.spec_from_file_location("vrs", str(VERIFY_MODULE))
    mod = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = mod
    spec.loader.exec_module(mod)
    return mod


class _Response:
    status_code = 200
    url = "https://www.apple.com/macbook-air/specs/"

    def __init__(self, text: str) -> None:
        self.text = text


class _FixtureClient:
    def __init__(self, text: str) -> None:
        self.text = text

    async def get(self, url: str) -> _Response:
        return _Response(self.text)


def _verify_apple_row(row: dict) -> dict:
    mod = _load_verify_module()
    html = APPLE_SPECS_FIXTURE.read_text(encoding="utf-8")
    return asyncio.run(mod._verify_apple_row(_FixtureClient(html), row, APPLE_SPECS_FIXTURE.name))


def test_fixture_is_committed():
    assert APPLE_SPECS_FIXTURE.exists(), "the Apple spec fixture must be committed"


def test_apple_reports_the_sku_specific_fields_as_unconfirmable():
    row = {
        "sku_code": "MRXN3LL/A",
        "manufacturer": "Apple",
        "model": "MacBook Air 13 (M4)",
        "cpu_model": "M4",
        "cpu_brand": "Apple",
        "cpu_cores": "10",
        "gpu_model": "Apple M4 GPU",
        "weight_kg": "1.24",
    }
    out = _verify_apple_row(row)
    # The family page does not publish the retailer part number or the CPU.
    assert out["sku_published_on_page"] is False
    fields = out["unconfirmable"]["fields"]
    assert "cpu_model" in fields
    assert "weight_kg" in fields


def test_apple_confirms_only_the_family_level_fields_it_can_read():
    row = {
        "sku_code": "MRXN3LL/A",
        "manufacturer": "Apple",
        "model": "MacBook Air 13 (M4)",
        "display_size": "13.6",
        "display_type": "Liquid Retina",
        "ram_gb": "16",
        "storage_gb": "512",
        "cpu_model": "M4",
    }
    out = _verify_apple_row(row)
    # The fixture is the real Air family page: it lists both 13.6" and 15.3"
    # and several RAM/storage options, so no family-level field is stated once.
    # An ambiguous page can never confirm a row, so the status is unconfirmed.
    assert out["status"] == "unconfirmed"
    assert out["observed"] == {}


def test_apple_always_flags_the_sku_specific_fields_it_is_given():
    row = {
        "sku_code": "MRXN3LL/A",
        "manufacturer": "Apple",
        "model": "MacBook Air 13 (M4)",
        "cpu_model": "M4",
        "cpu_brand": "Apple",
        "cpu_cores": "10",
        "gpu_model": "Apple M4 GPU",
        "weight_kg": "1.24",
    }
    out = _verify_apple_row(row)
    # The SKU-specific fields the page cannot state are always flagged.
    fields = out["unconfirmable"]["fields"]
    assert "cpu_model" in fields
    assert "weight_kg" in fields
    assert out["sku_published_on_page"] is False