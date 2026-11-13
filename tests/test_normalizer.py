"""Tests for veridian_db.normalizer.

Covers the refactored SpecNormalizer, which delegates CPU, GPU, memory (RAM),
storage, and display spec parsing to dedicated modules under
veridian_db/normalizers/ while preserving prior behavior.
"""
import math

import pytest

from veridian_db.normalizer import SpecNormalizer, NormalizedValue


def _norm(value, spec_name):
    """Shortcut to normalize a raw spec value."""
    return SpecNormalizer.normalize_value(value, spec_name)


# --------------------------------------------------------------------------
# CPU
# --------------------------------------------------------------------------
class TestCpu:
    def test_intel_core_ultra(self):
        r = _norm("Intel Core Ultra 7 155H 1.4 GHz", "cpu")
        assert isinstance(r, NormalizedValue)
        assert "Core Ultra 7" in r.value

    def test_amd_ryzen_with_integrated_graphics(self):
        r = _norm("AMD Ryzen 7 7840U with Radeon 780M", "cpu")
        assert "Ryzen 7" in r.value

    def test_apple_silicon(self):
        r = _norm("Apple M3 Pro 11-core", "cpu")
        assert "M3" in r.value

    def test_unknown_cpu_spec_name_returns_string(self):
        # A 'processor' spec that does not match any known pattern still
        # returns a string NormalizedValue rather than erroring.
        r = _norm("Dual-core 1.8GHz", "processor")
        assert r.spec_type == "string"
        assert r.value is not None


# --------------------------------------------------------------------------
# GPU
# --------------------------------------------------------------------------
class TestGpu:
    def test_nvidia(self):
        r = _norm("NVIDIA GeForce RTX 4060 8GB", "gpu")
        assert "RTX 4060" in r.value

    def test_amd_radeon(self):
        r = _norm("AMD Radeon RX 7700 XT 12GB", "graphics")
        assert "RX 7700" in r.value

    def test_integrated_graphics_spec(self):
        r = _norm("Intel Iris Xe Graphics", "gpu")
        assert "Iris" in r.value


# --------------------------------------------------------------------------
# Memory / RAM
# --------------------------------------------------------------------------
class TestRam:
    def test_gb(self):
        r = _norm("16 GB", "ram")
        assert r.value == 16.0
        assert r.unit == "GB"
        assert r.spec_type == "number"

    def test_mb_converts_to_gb(self):
        r = _norm("16384 MB", "memory")
        assert math.isclose(r.value, 16.0)
        assert r.unit == "GB"

    def test_decimal_gb(self):
        r = _norm("8.5 GB", "ram")
        assert math.isclose(r.value, 8.5)
        assert r.unit == "GB"


# --------------------------------------------------------------------------
# Storage
# --------------------------------------------------------------------------
class TestStorage:
    def test_tb_converts_to_gb(self):
        r = _norm("1 TB", "storage")
        assert r.value == 1024.0
        assert r.unit == "GB"

    def test_gb(self):
        r = _norm("512 GB", "storage")
        assert r.value == 512.0
        assert r.unit == "GB"

    def test_ssd_capacity(self):
        r = _norm("2 TB SSD", "storage")
        assert r.value == 2048.0
        assert r.unit == "GB"


# --------------------------------------------------------------------------
# Display
# --------------------------------------------------------------------------
class TestDisplay:
    def test_size_inches_to_mm(self):
        r = _norm("15.6 inch", "screen_size")
        assert math.isclose(r.value, 396.24, abs_tol=0.01)
        assert r.unit == "mm"

    def test_display_size(self):
        r = _norm("14.0 inch", "display_size")
        assert math.isclose(r.value, 355.6, abs_tol=0.01)
        assert r.unit == "mm"

    def test_resolution_tuple(self):
        r = _norm("2880x1800", "resolution")
        assert r.value == (2880, 1800)
        assert r.unit == "px"
        assert r.spec_type == "object"

    def test_refresh_rate(self):
        r = _norm("144 Hz", "refresh_rate")
        assert r.value == 144.0
        assert r.unit == "Hz"

    def test_brightness(self):
        r = _norm("300 nits", "brightness")
        assert r.value == 300.0
        assert r.unit == "nits"

    def test_panel_type(self):
        r = _norm("OLED", "panel_type")
        assert r.value == "OLED"
        assert r.spec_type == "string"

    def test_response_time(self):
        r = _norm("3 ms", "response_time")
        assert r.value == 3.0
        assert r.unit == "ms"

    def test_contrast_ratio(self):
        r = _norm("1000:1", "contrast_ratio")
        assert r.value == "1000:1"
        assert r.unit == "ratio"

    def test_aspect_ratio(self):
        r = _norm("16:9", "aspect_ratio")
        assert r.value == "16:9"


# --------------------------------------------------------------------------
# Other spec types (clocks, battery, weight) still work via the orchestrator
# --------------------------------------------------------------------------
class TestOther:
    def test_base_clock(self):
        r = _norm("2.8 GHz", "base_clock")
        assert r.value == 2.8
        assert r.unit == "GHz"

    def test_memory_speed(self):
        r = _norm("5600 MHz", "memory_speed")
        assert r.value == 5600.0
        assert r.unit == "MHz"

    def test_battery_wh(self):
        r = _norm("75 Wh", "battery")
        assert r.value == 75.0
        assert r.unit == "Wh"

    def test_weight_kg(self):
        r = _norm("1.35 kg", "weight")
        assert math.isclose(r.value, 1.35)
        assert r.unit == "kg"

    def test_weight_lbs_converts(self):
        r = _norm("3.0 lbs", "weight")
        assert math.isclose(r.value, 1.36, abs_tol=0.01)


# --------------------------------------------------------------------------
# Fallback / type inference
# --------------------------------------------------------------------------
class TestFallback:
    def test_boolean(self):
        r = _norm("Yes", "touchscreen")
        assert r.value is True
        assert r.spec_type == "boolean"

    def test_plain_string(self):
        r = _norm("Wi-Fi 6E", "wifi")
        assert r.value == "Wi-Fi 6E"
        assert r.spec_type == "string"