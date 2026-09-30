"""
Tests for Veridian Specification Normalization and Entity Resolution.
Exercises unit normalization, component matching, and real certification payloads.
"""

import pytest
from veridian_db.normalizer import SpecNormalizer, NormalizedValue


class TestSpecNormalizer:
    def test_display_size_normalization(self):
        # 14.0" to mm
        val = SpecNormalizer.normalize_value('14.0"', "display_size")
        assert val is not None
        assert val.unit == "mm"
        assert pytest.approx(val.value, 0.1) == 355.6

        # 15.6 inch
        val2 = SpecNormalizer.normalize_value("15.6 inch", "screen_size")
        assert val2 is not None
        assert pytest.approx(val2.value, 0.1) == 396.24

    def test_resolution_normalization(self):
        val = SpecNormalizer.normalize_value("2880x1800", "resolution")
        assert val is not None
        assert val.value == (2880, 1800)
        assert val.unit == "px"

        val_fhd = SpecNormalizer.normalize_value("1920 x 1080", "screen_resolution")
        assert val_fhd is not None
        assert val_fhd.value == (1920, 1080)

    def test_memory_storage_normalization(self):
        # RAM in GB
        ram16 = SpecNormalizer.normalize_value("16 GB", "ram")
        assert ram16 is not None
        assert ram16.value == 16.0
        assert ram16.unit == "GB"

        # 1TB SSD converted to GB
        storage_1tb = SpecNormalizer.normalize_value("1 TB", "storage")
        assert storage_1tb is not None
        assert storage_1tb.value == 1024.0
        assert storage_1tb.unit == "GB"

    def test_battery_and_weight_normalization(self):
        battery = SpecNormalizer.normalize_value("75 Wh", "battery")
        assert battery is not None
        assert battery.value == 75.0
        assert battery.unit == "Wh"

        weight_kg = SpecNormalizer.normalize_value("1.35 kg", "weight")
        assert weight_kg is not None
        assert pytest.approx(weight_kg.value, 0.01) == 1.35

        weight_lbs = SpecNormalizer.normalize_value("3.0 lbs", "weight")
        assert weight_lbs is not None
        assert pytest.approx(weight_lbs.value, 0.05) == 1.36

    def test_frequency_clock_normalization(self):
        base_clock = SpecNormalizer.normalize_value("2.8 GHz", "base_clock")
        assert base_clock is not None
        assert base_clock.value == 2.8
        assert base_clock.unit == "GHz"

        speed_mhz = SpecNormalizer.normalize_value("5600 MHz", "memory_speed")
        assert speed_mhz is not None
        assert speed_mhz.value == 5600.0
        assert speed_mhz.unit == "MHz"

    def test_cpu_model_normalization(self):
        cpu_ultra = SpecNormalizer.normalize_value("Intel Core Ultra 7 155H 1.4 GHz", "cpu")
        assert cpu_ultra is not None
        assert "Core Ultra 7" in str(cpu_ultra.value)

        cpu_ryzen = SpecNormalizer.normalize_value("AMD Ryzen 7 7840U with Radeon 780M", "cpu")
        assert cpu_ryzen is not None
        assert "Ryzen 7" in str(cpu_ryzen.value)

    def test_energystar_payload_normalization(self):
        """Simulate real Energy Star certification record normalization."""
        record = {
            "brand_name": "Lenovo",
            "model_name": "IdeaPad Vibe 15AKP12",
            "processor_brand": "AMD",
            "processor_name": "Ryzen Al 7 350 w / Radeon 860M",
            "system_memory_ram_gb": "32.0",
            "total_battery_capacity_watt_hours": "65.0",
            "integrated_display_diagonal_screen_size_in": "15.30",
            "integrated_display_resolution_megapixels": "2.92",
            "operating_system_name": "Windows 11",
        }

        # Parse RAM
        ram = SpecNormalizer.normalize_value(f"{record['system_memory_ram_gb']} GB", "ram")
        assert ram is not None
        assert ram.value == 32.0

        # Parse Battery
        battery = SpecNormalizer.normalize_value(f"{record['total_battery_capacity_watt_hours']} Wh", "battery")
        assert battery is not None
        assert battery.value == 65.0

        # Parse Display size (15.30 in)
        display = SpecNormalizer.normalize_value(f"{record['integrated_display_diagonal_screen_size_in']} inch", "display_size")
        assert display is not None
        assert pytest.approx(display.value, 0.1) == 15.30 * 25.4
