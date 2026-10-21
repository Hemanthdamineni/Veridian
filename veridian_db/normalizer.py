"""
Veridian Data Normalizer - Transforms scraped data into canonical entities
Following database-design.md specification exactly
"""

from .clock import utcnow

import re
import hashlib
from typing import Dict, List, Any, Optional, Tuple
from dataclasses import dataclass
from datetime import datetime
from urllib.parse import urlparse

# Import our database models
from veridian_db.models import (
    Brand, Category, Region, ProductFamily, ProductModel, ProductVariant,
    Component, ComponentType, ProductConfiguration, NormalizedSpec,
    ProductRelationship, Seller, PriceListing, PriceHistory,
    BenchmarkDefinition, BenchmarkRun, Review, CommunityReport,
    FieldValidation, SearchIndex, ComparisonMetric, KnowledgeEntry,
    MediaAsset, VerificationStatus, ProductStatus, SourceType
)


@dataclass
class NormalizedValue:
    """A normalized specification value with metadata"""
    value: Any
    unit: Optional[str]
    raw_text: str
    confidence: float = 1.0
    spec_type: str = "number"  # number, string, boolean, array, object


class SpecNormalizer:
    """Normalizes raw specification text into typed, unit-standardized values"""

    # Unit conversion patterns - search patterns for finding values within text
    UNIT_PATTERNS = {
        # Display size
        r'(\d+(?:\.\d+)?)\s*(?:inch\b|in\b|")': ('mm', lambda x: float(x) * 25.4),
        r'(\d+(?:\.\d+)?)\s*cm\b': ('mm', lambda x: float(x) * 10),
        # Weight
        r'(\d+(?:\.\d+)?)\s*(?:kg|kilogram)\b': ('kg', lambda x: float(x)),
        r'(\d+(?:\.\d+)?)\s*(?:lb|lbs|pound)\b': ('kg', lambda x: float(x) * 0.453592),
        r'(\d+(?:\.\d+)?)\s*g\b': ('kg', lambda x: float(x) / 1000),
        # Memory/Storage
        r'(\d+(?:\.\d+)?)\s*(?:GB|Gb)\b': ('GB', lambda x: float(x)),
        r'(\d+(?:\.\d+)?)\s*(?:TB|Tb)\b': ('GB', lambda x: float(x) * 1024),
        r'(\d+(?:\.\d+)?)\s*(?:MB|Mb)\b': ('GB', lambda x: float(x) / 1024),
        # Frequency
        r'(\d+(?:\.\d+)?)\s*(?:GHz|Ghz)\b': ('GHz', lambda x: float(x)),
        r'(\d+(?:\.\d+)?)\s*(?:MHz|Mhz)\b': ('MHz', lambda x: float(x)),
        # Power
        r'(\d+(?:\.\d+)?)\s*(?:W|watt)\b': ('W', lambda x: float(x)),
        r'(\d+(?:\.\d+)?)\s*(?:Wh|watt.hour)\b': ('Wh', lambda x: float(x)),
        r'(\d+(?:\.\d+)?)\s*(?:mAh|mAh)\b': ('mAh', lambda x: float(x)),
        # Refresh rate
        r'(\d+(?:\.\d+)?)\s*(?:Hz|hz)\b': ('Hz', lambda x: float(x)),
        # Resolution - match integer resolutions only (e.g., 1920x1080, 3840x2160)
        r'(\d{3,})\s*[x×]\s*(\d{3,})\b': ('px', lambda x, y: (int(x), int(y))),
        # Brightness (nits)
        r'(\d+(?:\.\d+)?)\s*(?:nits?)\b': ('nits', lambda x: float(x)),
        # Response time (ms)
        r'(\d+(?:\.\d+)?)\s*(?:ms|millisecond)\b': ('ms', lambda x: float(x)),
        # Contrast ratio
        r'(\d{4,})\s*:\s*(\d+)': ('ratio', lambda x, y: f"{int(x)}:{int(y)}"),
    }

    # Spec name normalization map (keys should match normalized form with underscores)
    SPEC_NAME_MAP = {
        # Display
        'display_size': 'size_mm',
        'screen_size': 'size_mm',
        'diagonal': 'size_mm',
        'resolution': 'resolution',
        'screen_resolution': 'resolution',
        'refresh_rate': 'refresh_rate_hz',
        'brightness': 'brightness_nits',
        'nits': 'brightness_nits',
        'contrast': 'contrast_ratio',
        'aspect_ratio': 'aspect_ratio',
        'response_time': 'response_time_ms',
        'panel_type': 'panel_type',
        'color_gamut': 'color_gamut',
        'hdr': 'hdr_support',
        'display': 'size_mm',
        'screen': 'size_mm',
        # Processor
        'processor': 'cpu_model',
        'cpu': 'cpu_model',
        'chip': 'cpu_model',
        'cores': 'cpu_cores',
        'threads': 'cpu_threads',
        'base_clock': 'cpu_base_clock_ghz',
        'boost_clock': 'cpu_boost_clock_ghz',
        'cache': 'cpu_cache_mb',
        'tdp': 'cpu_tdp_w',
        'pl1': 'cpu_pl1_w',
        'pl2': 'cpu_pl2_w',
        'npU': 'npu_tops',
        'npu': 'npu_tops',
        # Graphics
        'graphics': 'gpu_model',
        'gpu': 'gpu_model',
        'video_memory': 'gpu_memory_gb',
        'vram': 'gpu_memory_gb',
        # Memory
        'memory': 'ram_capacity_gb',
        'ram': 'ram_capacity_gb',
        'ddr': 'ram_type',
        'memory_speed': 'ram_speed_mt_s',
        'memory_type': 'ram_type',
        'slots': 'ram_slots',
        'max_memory': 'ram_max_gb',
        # Storage
        'storage': 'storage_capacity_gb',
        'ssd': 'storage_capacity_gb',
        'hdd': 'storage_capacity_gb',
        'storage_type': 'storage_type',
        'interface': 'storage_interface',
        'slots': 'storage_slots',
        # Battery
        'battery': 'battery_capacity_wh',
        'battery_capacity': 'battery_capacity_wh',
        'watt_hours': 'battery_capacity_wh',
        'wh': 'battery_capacity_wh',
        'cells': 'battery_cells',
        # Dimensions
        'weight': 'weight_kg',
        'dimensions': 'dimensions_mm',
        'thickness': 'thickness_mm',
        'height': 'height_mm',
        'width': 'width_mm',
        'depth': 'depth_mm',
        # Ports
        'ports': 'ports',
        'interfaces': 'ports',
        'usb': 'ports',
        'thunderbolt': 'ports',
        'hdmi': 'ports',
        'displayport': 'ports',
        # Camera
        'camera': 'camera_resolution_mp',
        'webcam': 'camera_resolution_mp',
        # Audio
        'speakers': 'speaker_config',
        'audio': 'speaker_config',
        # Wireless
        'wifi': 'wifi_standard',
        'bluetooth': 'bluetooth_version',
        # OS
        'operating_system': 'os',
        'os': 'os',
        # Keyboard
        'keyboard': 'keyboard_type',
        'backlit': 'keyboard_backlit',
        # Fingerprint
        'fingerprint': 'has_fingerprint',
        # Color
        'color': 'color',
        'colour': 'color',
    }

    @classmethod
    def normalize_spec_name(cls, raw_name: str) -> str:
        """Convert raw spec name to canonical form"""
        name = raw_name.lower().strip()
        name = re.sub(r'[^\w\s]', ' ', name)
        name = re.sub(r'\s+', '_', name)
        return cls.SPEC_NAME_MAP.get(name, name)

    @classmethod
    def normalize_value(cls, raw_value: str, spec_name: str = "") -> NormalizedValue:
        """Normalize a raw specification value"""
        raw_value = raw_value.strip()
        # Clean special characters that interfere with pattern matching
        clean_value = re.sub(r'[™®]', '', raw_value)
        spec_name_lower = spec_name.lower()

        # Extract CPU model - MUST be first before array detection
        if 'processor' in spec_name_lower or 'cpu' in spec_name_lower:
            # Try to match common CPU patterns
            cpu_patterns = [
                r'(intel\s+core\s+(?:i\d|ultra)\s+(?:\d\s+)?\d{3,4}[a-z]?)(?=\s+(?:processor|ghz|cache|core|thread|up\sto|\d)|$)',
                r'(amd\s+ryzen\s+(?:ai\s+)?\d?\s*[\w]+\s+\d{3,4}[a-z]?)(?=\s+(?:processor|ghz|cache|core|thread|npU|up\sto|\d)|$)',
                r'(apple\s+m\d[\w\s-]+?)(?=\s+(?:core|cpu|gpu|processor|ghz|cache|up\sto|\d)|$)',
                r'(qualcomm\s+snapdragon\s+(?:x|8\s+gen)\s+[\w\s-]+?)(?=\s+(?:processor|ghz|cache|core|thread|npU|up\sto|\d)|$)',
            ]
            for pattern in cpu_patterns:
                match = re.search(pattern, clean_value, re.IGNORECASE)
                if match:
                    return NormalizedValue(
                        value=match.group(1).strip(),
                        unit=None,
                        raw_text=raw_value,
                        spec_type='string'
                    )
            # Fallback: return raw string
            return NormalizedValue(
                value=raw_value,
                unit=None,
                raw_text=raw_value,
                spec_type='string'
            )

        # Extract GPU model - MUST be before array detection
        if 'graphics' in spec_name_lower or 'gpu' in spec_name_lower:
            gpu_patterns = [
                r'(nvidia\s+geforce\s+rtx\s+\d{4}[a-z]?)(?=\s+(?:laptop|desktop|mobile|gpu|gb|gd|ti)|$)',
                r'(nvidia\s+geforce\s+gtx\s+\d{4}[a-z]?)(?=\s+(?:laptop|desktop|mobile|gpu|gb|gd|ti)|$)',
                r'(nvidia\s+rtx\s+a\d{4})(?=\s+(?:laptop|desktop|mobile|gpu|gb|gd|ti)|$)',
                r'(amd\s+radeon\s+[\w\s]+?)(?=\s+(?:graphics|gpu|gb|gd|processor|ghz)|$)',
                r'(intel\s+(?:arc|iris|uhd|hd)\s+[\w\s]+?)(?=\s+(?:graphics|gpu|gb|gd|processor|ghz)|$)',
                r'(apple\s+gpu\s+[\w\s]+?)(?=\s+(?:core|graphics|gpu|processor|ghz)|$)',
                r'(qualcomm\s+adreno\s+[\w\s]+?)(?=\s+(?:graphics|gpu|processor|ghz)|$)',
            ]
            for pattern in gpu_patterns:
                match = re.search(pattern, clean_value, re.IGNORECASE)
                if match:
                    return NormalizedValue(
                        value=match.group(1).strip(),
                        unit=None,
                        raw_text=raw_value,
                        spec_type='string'
                    )
            # Fallback
            return NormalizedValue(
                value=raw_value,
                unit=None,
                raw_text=raw_value,
                spec_type='string'
            )

        # Spec-name-specific extraction (before array detection)
        # Extract display size from complex display strings
        if 'size' in spec_name_lower or 'display' in spec_name_lower or 'screen' in spec_name_lower:
            # Look for inch pattern (with or without hyphen/space)
            inch_match = re.search(r'(\d+(?:\.\d+)?)[-\s]*(?:inch|"|in)\b', clean_value, re.IGNORECASE)
            if not inch_match:
                # Try "Panel Size (inch) : 26.5" format
                inch_match = re.search(r'panel\s*size\s*\(inch\)\s*[:=]\s*(\d+(?:\.\d+)?)', clean_value, re.IGNORECASE)
            if inch_match:
                return NormalizedValue(
                    value=float(inch_match.group(1)) * 25.4,
                    unit='mm',
                    raw_text=raw_value,
                    spec_type='number'
                )

        # Extract weight from complex strings
        if 'weight' in spec_name_lower:
            kg_match = re.search(r'(\d+(?:\.\d+)?)\s*(?:kg|kilogram)\b', clean_value, re.IGNORECASE)
            if kg_match:
                return NormalizedValue(
                    value=float(kg_match.group(1)),
                    unit='kg',
                    raw_text=raw_value,
                    spec_type='number'
                )
            lb_match = re.search(r'(\d+(?:\.\d+)?)\s*(?:lb|lbs|pound)\b', clean_value, re.IGNORECASE)
            if lb_match:
                return NormalizedValue(
                    value=float(lb_match.group(1)) * 0.453592,
                    unit='kg',
                    raw_text=raw_value,
                    spec_type='number'
                )

        # Extract battery capacity
        if 'battery' in spec_name_lower:
            wh_match = re.search(r'(\d+(?:\.\d+)?)\s*(?:Wh|watt.hour|WHrs?|Whrs?)\b', clean_value, re.IGNORECASE)
            if wh_match:
                return NormalizedValue(
                    value=float(wh_match.group(1)),
                    unit='Wh',
                    raw_text=raw_value,
                    spec_type='number'
                )
            mah_match = re.search(r'(\d+(?:\.\d+)?)\s*(?:mAh)\b', clean_value, re.IGNORECASE)
            if mah_match:
                return NormalizedValue(
                    value=float(mah_match.group(1)),
                    unit='mAh',
                    raw_text=raw_value,
                    spec_type='number'
                )

        # Extract memory
        if 'memory' in spec_name_lower or 'ram' in spec_name_lower:
            gb_match = re.search(r'(\d+(?:\.\d+)?)\s*(?:GB|Gb)\b', clean_value, re.IGNORECASE)
            if gb_match:
                return NormalizedValue(
                    value=float(gb_match.group(1)),
                    unit='GB',
                    raw_text=raw_value,
                    spec_type='number'
                )
            mb_match = re.search(r'(\d+(?:\.\d+)?)\s*(?:MB|Mb)\b', clean_value, re.IGNORECASE)
            if mb_match:
                return NormalizedValue(
                    value=float(mb_match.group(1)) / 1024,
                    unit='GB',
                    raw_text=raw_value,
                    spec_type='number'
                )

        # Extract storage
        if 'storage' in spec_name_lower or 'ssd' in spec_name_lower or 'hdd' in spec_name_lower:
            gb_match = re.search(r'(\d+(?:\.\d+)?)\s*(?:GB|Gb)\b', clean_value, re.IGNORECASE)
            if gb_match:
                return NormalizedValue(
                    value=float(gb_match.group(1)),
                    unit='GB',
                    raw_text=raw_value,
                    spec_type='number'
                )
            tb_match = re.search(r'(\d+(?:\.\d+)?)\s*(?:TB|Tb)\b', clean_value, re.IGNORECASE)
            if tb_match:
                return NormalizedValue(
                    value=float(tb_match.group(1)) * 1024,
                    unit='GB',
                    raw_text=raw_value,
                    spec_type='number'
                )

        # Extract refresh rate
        if 'refresh' in spec_name_lower:
            hz_match = re.search(r'(\d+(?:\.\d+)?)\s*(?:Hz|hz)\b', clean_value, re.IGNORECASE)
            if hz_match:
                return NormalizedValue(
                    value=float(hz_match.group(1)),
                    unit='Hz',
                    raw_text=raw_value,
                    spec_type='number'
                )

        # Extract brightness (nits)
        if 'bright' in spec_name_lower or 'nit' in spec_name_lower:
            nit_match = re.search(r'(\d+(?:\.\d+)?)\s*(?:nits?)\b', clean_value, re.IGNORECASE)
            if nit_match:
                return NormalizedValue(
                    value=float(nit_match.group(1)),
                    unit='nits',
                    raw_text=raw_value,
                    spec_type='number'
                )

        # Extract panel type
        if 'panel' in spec_name_lower:
            panel_types = ['oled', 'ips', 'va', 'tn', 'mini led', 'micro led', 'qled', 'lcd', 'led']
            for panel in panel_types:
                if re.search(r'\b' + panel + r'\b', clean_value, re.IGNORECASE):
                    return NormalizedValue(
                        value=panel.upper(),
                        unit=None,
                        raw_text=raw_value,
                        spec_type='string'
                    )

        # Extract response time
        if 'response' in spec_name_lower:
            ms_match = re.search(r'(\d+(?:\.\d+)?)\s*(?:ms|millisecond)\b', clean_value, re.IGNORECASE)
            if ms_match:
                return NormalizedValue(
                    value=float(ms_match.group(1)),
                    unit='ms',
                    raw_text=raw_value,
                    spec_type='number'
                )

        # Extract contrast ratio
        if 'contrast' in spec_name_lower:
            # Match large ratios like 1000000:1 or 1000:1
            contrast_match = re.search(r'(\d{4,})\s*:\s*(\d+)', clean_value)
            if contrast_match:
                return NormalizedValue(
                    value=f"{int(contrast_match.group(1))}:{int(contrast_match.group(2))}",
                    unit='ratio',
                    raw_text=raw_value,
                    spec_type='string'
                )

        # Extract aspect ratio
        if 'aspect' in spec_name_lower:
            # Match typical aspect ratios like 16:10, 16:9, 4:3, 3:2, 21:9
            aspect_match = re.search(r'(\d{1,2})\s*:\s*(\d{1,2})\b', clean_value)
            if aspect_match:
                return NormalizedValue(
                    value=f"{int(aspect_match.group(1))}:{int(aspect_match.group(2))}",
                    unit=None,
                    raw_text=raw_value,
                    spec_type='string'
                )

        # Extract resolution
        if 'resolution' in spec_name_lower:
            res_match = re.search(r'(\d+)\s*[x×]\s*(\d+)\b', clean_value, re.IGNORECASE)
            if res_match:
                return NormalizedValue(
                    value=(int(res_match.group(1)), int(res_match.group(2))),
                    unit='px',
                    raw_text=raw_value,
                    spec_type='object'
                )

        # Try pattern matching for units - only for values that look like single measurements
        # Skip if value is too long (likely concatenated specs)
        if len(clean_value) < 200:
            for pattern, (unit, converter) in cls.UNIT_PATTERNS.items():
                match = re.search(pattern, clean_value, re.IGNORECASE)
                if match:
                    try:
                        if len(match.groups()) == 1:
                            value = converter(match.group(1))
                        elif len(match.groups()) == 2:
                            value = converter(match.group(1), match.group(2))
                        else:
                            value = match.group(0)
                        return NormalizedValue(
                            value=value,
                            unit=unit,
                            raw_text=raw_value,
                            spec_type=cls._infer_type(value)
                        )
                    except (ValueError, TypeError):
                        pass

        # Boolean detection
        if clean_value.lower() in ('yes', 'no', 'true', 'false', 'enabled', 'disabled', 'supported', 'not supported'):
            bool_map = {'yes': True, 'no': False, 'true': True, 'false': False,
                        'enabled': True, 'disabled': False, 'supported': True, 'not supported': False}
            return NormalizedValue(
                value=bool_map.get(clean_value.lower(), clean_value),
                unit=None,
                raw_text=raw_value,
                spec_type='boolean'
            )

        # Array detection (comma-separated or semicolon) - but only for actual list separators
        # Skip if commas are part of numbers (e.g., "1,000,000:1") or temperature lists like "9300K, 6500K"
        has_list_separator = False
        if ';' in clean_value:
            has_list_separator = True
        elif ',' in clean_value:
            # Check if commas are part of numbers (like 1,000,000) or temperature lists (like 9300K, 6500K)
            # Heuristic: if comma followed by space and 3+ digits/letters (like K), it's likely a list
            # If comma followed by 3 digits and no space (1,000), it's a number
            # Pattern for number commas: digit,digit{3} (no space)
            if re.search(r'\d,\d{3}', clean_value):
                has_list_separator = False
            # Pattern for temperature/size lists: letter/number, space, number+letter
            elif re.search(r'[A-Z\d],\s*\d+[A-Z]', clean_value):
                has_list_separator = False
            else:
                has_list_separator = True

        if has_list_separator:
            separator = ';' if ';' in clean_value else ','
            items = [item.strip() for item in clean_value.split(separator) if item.strip()]
            return NormalizedValue(
                value=items,
                unit=None,
                raw_text=raw_value,
                spec_type='array'
            )

        # Try to parse as number
        try:
            if '.' in raw_value:
                value = float(raw_value)
            else:
                value = int(raw_value)
            return NormalizedValue(
                value=value,
                unit=None,
                raw_text=raw_value,
                spec_type='number'
            )
        except ValueError:
            pass

        # Default to string
        return NormalizedValue(
            value=raw_value,
            unit=None,
            raw_text=raw_value,
            spec_type='string'
        )

    @classmethod
    def _infer_type(cls, value: Any) -> str:
        if isinstance(value, bool):
            return 'boolean'
        elif isinstance(value, (int, float)):
            return 'number'
        elif isinstance(value, list):
            return 'array'
        elif isinstance(value, dict):
            return 'object'
        return 'string'


class ComponentMatcher:
    """Matches scraped component references to canonical components"""

    def __init__(self, session):
        self.session = session
        self._cache = {}

    def match_cpu(self, raw_text: str) -> Optional[Component]:
        """Match CPU from raw text"""
        # Extract manufacturer and model
        manufacturers = ['intel', 'amd', 'apple', 'qualcomm', 'mediatek']
        # Strip non-ASCII characters for matching
        text_lower = ''.join(c for c in raw_text.lower() if ord(c) < 128)

        mfr = None
        for m in manufacturers:
            if m in text_lower:
                mfr = m.title()
                if m == 'intel':
                    mfr = 'Intel'
                elif m == 'amd':
                    mfr = 'AMD'
                elif m == 'apple':
                    mfr = 'Apple'
                elif m == 'qualcomm':
                    mfr = 'Qualcomm'
                break

        if not mfr:
            return None

        # Try to extract model number
        # Intel: Core i7-1365U, Core Ultra 7 155H
        # AMD: Ryzen 7 7840HS, Ryzen 9 7940HX, Ryzen AI 9 HX 370
        # Apple: M3 Pro, M3 Max
        patterns = {
            'intel': [r'(core\s+(?:i\d|ultra)\s+\d+[\w\s-]+?)(?:\s+processor|\s*;|\s*$)', r'(xeon\s+\d[\w\s-]+)'],
            'amd': [r'(ryzen\s+(?:ai\s+)?\d+[\w\s-]+?)(?:\s+processor|\s*;|\s*$)', r'(epyc\s+\d[\w\s-]+)'],
            'apple': [r'(m\d[\w\s-]+)'],
            'qualcomm': [r'(snapdragon\s+(?:x|8\s+gen)\s+[\w\s-]+?)(?:\s+\d|\s*$)'],
        }

        model = None
        mfr_lower = mfr.lower()
        if mfr_lower in patterns:
            for pattern in patterns[mfr_lower]:
                match = re.search(pattern, text_lower)
                if match:
                    model = match.group(1).strip()
                    break

        if not model:
            return None

        # Check cache
        cache_key = f"cpu:{mfr}:{model}"
        if cache_key in self._cache:
            return self._cache[cache_key]

        # Query database
        component = self.session.query(Component).filter(
            Component.type == ComponentType.CPU,
            Component.manufacturer.ilike(mfr),
            Component.name.ilike(f"%{model}%")
        ).first()

        if component:
            self._cache[cache_key] = component
            return component

        # Create new component entity
        from veridian_scraper.scrapers.base import canonicalize_url
        slug = canonicalize_url(model)
        component = Component(
            type=ComponentType.CPU,
            manufacturer=mfr,
            name=model,
            slug=slug,
            specifications={},
            benchmarks={},
            is_active=True
        )
        self.session.add(component)
        self.session.flush()
        self._cache[cache_key] = component
        return component

    def match_gpu(self, raw_text: str) -> Optional[Component]:
        """Match GPU from raw text"""
        manufacturers = ['nvidia', 'amd', 'intel', 'apple', 'qualcomm']
        # Strip non-ASCII characters for matching
        text_lower = ''.join(c for c in raw_text.lower() if ord(c) < 128)

        mfr = None
        for m in manufacturers:
            if m in text_lower:
                mfr = m.title()
                if m == 'intel':
                    mfr = 'Intel'
                elif m == 'amd':
                    mfr = 'AMD'
                elif m == 'apple':
                    mfr = 'Apple'
                elif m == 'qualcomm':
                    mfr = 'Qualcomm'
                elif m == 'nvidia':
                    mfr = 'NVIDIA'
                break

        if not mfr:
            return None

        patterns = [
            r'(rtx\s+\d{4}[a-z]?)',
            r'(gtx\s+\d{4}[a-z]?)',
            r'(radeon\s+(?:rx\s+)?\d{4}[a-z]?)',
            r'(arc\s+(?:pro\s+)?b?\d{3,4})',
            r'(adreno\s+\w+)',
        ]

        model = None
        for pattern in patterns:
            match = re.search(pattern, text_lower)
            if match:
                model = match.group(1).strip().upper()
                break

        if not model and mfr == 'Apple':
            # Apple GPU naming
            match = re.search(r'(gpu\s+\d+[-\w]*)', text_lower)
            if match:
                model = match.group(1).strip().upper()

        if not model:
            return None

        cache_key = f"gpu:{mfr}:{model}"
        if cache_key in self._cache:
            return self._cache[cache_key]

        component = self.session.query(Component).filter(
            Component.type == ComponentType.GPU,
            Component.manufacturer.ilike(mfr),
            Component.name.ilike(f"%{model}%")
        ).first()

        if component:
            self._cache[cache_key] = component
            return component

        # Create new component entity
        from veridian_scraper.scrapers.base import canonicalize_url
        slug = canonicalize_url(model)
        component = Component(
            type=ComponentType.GPU,
            manufacturer=mfr,
            name=model,
            slug=slug,
            specifications={},
            benchmarks={},
            is_active=True
        )
        self.session.add(component)
        self.session.flush()
        self._cache[cache_key] = component
        return component

    def match_display(self, raw_text: str) -> Optional[Component]:
        """Match display from raw text"""
        # Extract size, resolution, panel type
        size_match = re.search(r'(\d+(?:\.\d+)?)\s*(?:inch|"|in)', raw_text, re.IGNORECASE)
        res_match = re.search(r'(\d+)\s*[x×]\s*(\d+)', raw_text)
        # Strip non-ASCII for panel type matching
        text_lower = ''.join(c for c in raw_text.lower() if ord(c) < 128)
        panel_type = None
        for p in ['oled', 'ips', 'va', 'tn', 'mini.led', 'micro.led']:
            if p.replace('.', '-') in text_lower:
                panel_type = p.upper()
                break

        if not size_match:
            return None

        size_inches = float(size_match.group(1))

        cache_key = f"display:{size_inches}:{res_match.group(0) if res_match else ''}:{panel_type or ''}"
        if cache_key in self._cache:
            return self._cache[cache_key]

        component = self.session.query(Component).filter(
            Component.type == ComponentType.DISPLAY,
            Component.display_size_mm == int(size_inches * 25.4)
        ).first()

        if component:
            self._cache[cache_key] = component
            return component

        # Create new component entity
        from veridian_scraper.scrapers.base import canonicalize_url
        slug = canonicalize_url(f"{size_inches}inch-{res_match.group(0) if res_match else 'unknown'}-{panel_type or 'unknown'}")
        component = Component(
            type=ComponentType.DISPLAY,
            manufacturer='Unknown',
            name=f"{size_inches}\" Display {res_match.group(0) if res_match else ''} {panel_type or ''}".strip(),
            slug=slug,
            display_size_mm=int(size_inches * 25.4),
            display_resolution=res_match.group(0) if res_match else None,
            display_panel_type=panel_type,
            is_active=True
        )
        self.session.add(component)
        self.session.flush()
        self._cache[cache_key] = component
        return component

    def match_ram(self, ram_type: str, capacity_gb: float) -> Optional[Component]:
        """Match RAM from type and capacity"""
        if not ram_type:
            return None

        # Normalize RAM type (DDR4, DDR5, LPDDR4X, LPDDR5X, etc.)
        ram_type_lower = ram_type.lower()

        cache_key = f"ram:{ram_type_lower}:{capacity_gb}"
        if cache_key in self._cache:
            return self._cache[cache_key]

        component = self.session.query(Component).filter(
            Component.type == ComponentType.MEMORY,
            Component.memory_type.ilike(f"%{ram_type_lower}%"),
            Component.memory_capacity_gb == int(capacity_gb)
        ).first()

        if component:
            self._cache[cache_key] = component
            return component

        # Create new component entity
        from veridian_scraper.scrapers.base import canonicalize_url
        slug = canonicalize_url(f"{ram_type}-{int(capacity_gb)}gb")
        component = Component(
            type=ComponentType.MEMORY,
            manufacturer='Unknown',
            name=f"{ram_type} {int(capacity_gb)}GB",
            slug=slug,
            memory_type=ram_type,
            memory_capacity_gb=int(capacity_gb),
            is_active=True
        )
        self.session.add(component)
        self.session.flush()
        self._cache[cache_key] = component
        return component

    def match_storage(self, storage_type: str, capacity_gb: float) -> Optional[Component]:
        """Match storage from type and capacity"""
        if not storage_type:
            return None

        # Normalize storage type (SSD, NVMe, HDD, etc.)
        storage_type_lower = storage_type.lower()

        cache_key = f"storage:{storage_type_lower}:{capacity_gb}"
        if cache_key in self._cache:
            return self._cache[cache_key]

        component = self.session.query(Component).filter(
            Component.type == ComponentType.STORAGE,
            Component.storage_type.ilike(f"%{storage_type_lower}%"),
            Component.storage_capacity_gb == int(capacity_gb)
        ).first()

        if component:
            self._cache[cache_key] = component
            return component

        # Create new component entity
        from veridian_scraper.scrapers.base import canonicalize_url
        slug = canonicalize_url(f"{storage_type}-{int(capacity_gb)}gb")
        component = Component(
            type=ComponentType.STORAGE,
            manufacturer='Unknown',
            name=f"{storage_type} {int(capacity_gb)}GB",
            slug=slug,
            storage_type=storage_type,
            storage_capacity_gb=int(capacity_gb),
            is_active=True
        )
        self.session.add(component)
        self.session.flush()
        self._cache[cache_key] = component
        return component


class DataNormalizer:
    """Main data normalizer - transforms scraped products into canonical database"""

    def __init__(self, session):
        self.session = session
        self.spec_normalizer = SpecNormalizer()
        self.component_matcher = ComponentMatcher(session)
        self._region_cache = {}
        self._brand_cache = {}
        self._category_cache = {}
        self._family_cache = {}
        self._model_cache = {}

    def _get_or_create_region(self, code: str) -> Region:
        if code in self._region_cache:
            return self._region_cache[code]

        region = self.session.query(Region).filter(Region.code == code).first()
        if not region:
            region = Region(code=code, name=code.upper(), currency='USD', language='en')
            self.session.add(region)
            self.session.flush()
        self._region_cache[code] = region
        return region

    def _get_or_create_brand(self, manufacturer: str, brand: str) -> Brand:
        key = f"{manufacturer}:{brand}"
        if key in self._brand_cache:
            return self._brand_cache[key]

        br = self.session.query(Brand).filter(Brand.name == brand).first()
        if not br:
            from veridian_scraper.scrapers.base import canonicalize_url
            slug = brand.lower().replace(' ', '-').replace('/', '-')
            br = Brand(name=brand, slug=slug, manufacturer_name=manufacturer)
            self.session.add(br)
            self.session.flush()
        self._brand_cache[key] = br
        return br

    def _get_or_create_category(self, slug: str) -> Category:
        if slug in self._category_cache:
            return self._category_cache[slug]

        cat = self.session.query(Category).filter(Category.slug == slug).first()
        if not cat:
            cat = Category(
                slug=slug,
                name=slug.replace('-', ' ').title(),
                parent_id=None
            )
            self.session.add(cat)
            self.session.flush()
        self._category_cache[slug] = cat
        return cat

    def _get_or_create_family(self, brand: Brand, category: Category, family_name: str) -> ProductFamily:
        key = f"{brand.id}:{family_name}"
        if key in self._family_cache:
            return self._family_cache[key]

        family = self.session.query(ProductFamily).filter(
            ProductFamily.brand_id == brand.id,
            ProductFamily.name == family_name
        ).first()
        if not family:
            family = ProductFamily(
                brand_id=brand.id,
                category_id=category.id,
                name=family_name,
                slug=re.sub(r'[^\w]+', '-', family_name.lower()).strip('-')
            )
            self.session.add(family)
            self.session.flush()
        self._family_cache[key] = family
        return family

    def _get_or_create_model(self, family: ProductFamily, model_name: str, gen: str = None) -> ProductModel:
        key = f"{family.id}:{model_name}"
        if key in self._model_cache:
            return self._model_cache[key]

        model = self.session.query(ProductModel).filter(
            ProductModel.family_id == family.id,
            ProductModel.name == model_name
        ).first()
        if not model:
            model = ProductModel(
                family_id=family.id,
                name=model_name,
                generation=gen or "",
                slug=re.sub(r'[^\w]+', '-', model_name.lower()).strip('-'),
                release_date=utcnow()
            )
            self.session.add(model)
            self.session.flush()
        self._model_cache[key] = model
        return model

    def _get_spec_category(self, spec_name: str) -> str:
        """Map spec name to category"""
        categories = {
            'cpu_model': 'processor',
            'cpu_cores': 'processor',
            'cpu_threads': 'processor',
            'cpu_base_clock_ghz': 'processor',
            'cpu_boost_clock_ghz': 'processor',
            'cpu_cache_mb': 'processor',
            'cpu_tdp_w': 'processor',
            'cpu_pl1_w': 'processor',
            'cpu_pl2_w': 'processor',
            'npu_tops': 'processor',
            'gpu_model': 'graphics',
            'gpu_memory_gb': 'graphics',
            'ram_capacity_gb': 'memory',
            'ram_type': 'memory',
            'ram_speed_mt_s': 'memory',
            'ram_slots': 'memory',
            'ram_max_gb': 'memory',
            'storage_capacity_gb': 'storage',
            'storage_type': 'storage',
            'storage_interface': 'storage',
            'storage_slots': 'storage',
            'battery_capacity_wh': 'battery',
            'battery_cells': 'battery',
            'size_mm': 'display',
            'resolution': 'display',
            'refresh_rate_hz': 'display',
            'brightness_nits': 'display',
            'contrast_ratio': 'display',
            'aspect_ratio': 'display',
            'response_time_ms': 'display',
            'panel_type': 'display',
            'color_gamut': 'display',
            'hdr_support': 'display',
            'weight_kg': 'physical',
            'dimensions_mm': 'physical',
            'thickness_mm': 'physical',
            'height_mm': 'physical',
            'width_mm': 'physical',
            'depth_mm': 'physical',
            'ports': 'connectivity',
            'wifi_standard': 'connectivity',
            'bluetooth_version': 'connectivity',
            'os': 'software',
            'keyboard_type': 'input',
            'keyboard_backlit': 'input',
            'has_fingerprint': 'security',
            'camera_resolution_mp': 'camera',
            'speaker_config': 'audio',
            'color': 'appearance',
        }
        return categories.get(spec_name, 'other')

    def process_scraped_product(self, scraped_product, region_code: str = 'us') -> ProductVariant:
        """Complete pipeline: scraped product -> canonical database entities"""
        region = self._get_or_create_region(region_code)
        brand = self._get_or_create_brand(scraped_product.manufacturer, scraped_product.brand)
        # Handle both string and enum category
        category_value = scraped_product.category.value if hasattr(scraped_product.category, 'value') else str(scraped_product.category)
        category = self._get_or_create_category(category_value.lower())

        # Extract series from product name or use default
        series = scraped_product.series or "Mainstream"

        family = self._get_or_create_family(brand, category, series)
        model = self._get_or_create_model(family, scraped_product.name)

        # Process each variant
        for scraped_variant in scraped_product.variants:
            # Determine effective SKU
            effective_sku = scraped_variant.sku or scraped_variant.variant_id

            # Create or update variant
            variant = self.session.query(ProductVariant).filter(
                ProductVariant.model_id == model.id,
                ProductVariant.region_id == region.id,
                ProductVariant.sku == effective_sku
            ).first()

            if not variant:
                variant = ProductVariant(
                    model_id=model.id,
                    region_id=region.id,
                    sku=effective_sku,
                    name=scraped_variant.name,
                    status=ProductStatus(scraped_variant.status.value) if hasattr(scraped_variant.status, 'value') and scraped_variant.status else ProductStatus.CURRENT,
                    release_date=utcnow(),
                    color=self._spec_raw_text((scraped_variant.specs or {}).get('color')),
                    source_urls=[scraped_variant.source_url] if scraped_variant.source_url else [],
                )
                self.session.add(variant)
                self.session.flush()

            # Process specs
            for spec_name, spec_value in scraped_variant.specs.items():
                self._normalize_spec(variant, spec_name, spec_value, scraped_variant.source_url)

            # Link components
            self._link_components(variant)

            # Update search index
            self.update_search_index(variant)

        self.session.commit()
        return variant

    @staticmethod
    def _spec_raw_text(spec_value) -> Optional[str]:
        """Raw text of a scraped spec value.

        Scrapers produce ``SpecValue`` objects, but older payloads stored plain
        dicts, so both shapes have to be supported.
        """
        if spec_value is None:
            return None
        if hasattr(spec_value, 'raw'):
            return spec_value.raw
        if isinstance(spec_value, dict):
            return spec_value.get('raw')
        return str(spec_value)

    def _normalize_spec(self, variant: ProductVariant, spec_name: str, spec_value_obj, source_url: str = None):
        """Normalize a single spec and store it"""
        norm_name = self.spec_normalizer.normalize_spec_name(spec_name)

        # Extract raw text from spec value object
        raw_text = spec_value_obj.raw if hasattr(spec_value_obj, 'raw') else str(spec_value_obj)
        norm_value = self.spec_normalizer.normalize_value(raw_text, spec_name)
        category = self._get_spec_category(norm_name)

        existing = self.session.query(NormalizedSpec).filter(
            NormalizedSpec.variant_id == variant.id,
            NormalizedSpec.spec_category == category,
            NormalizedSpec.spec_name == norm_name
        ).first()

        # Build spec data including multi-option info
        spec_data = {
            'value': norm_value.value,
            'unit': norm_value.unit,
            'raw': norm_value.raw_text,
            'is_multi_option': getattr(spec_value_obj, 'is_multi_option', False),
            'options': getattr(spec_value_obj, 'options', []),
        }

        if existing:
            existing.spec_value = spec_data
            existing.spec_value_type = norm_value.spec_type
            existing.raw_text = norm_value.raw_text
            existing.source_url = source_url
            existing.confidence = norm_value.confidence
            existing.updated_at = utcnow()
        else:
            norm_spec = NormalizedSpec(
                variant_id=variant.id,
                spec_category=category,
                spec_name=norm_name,
                spec_value=spec_data,
                spec_value_type=norm_value.spec_type,
                raw_text=norm_value.raw_text,
                source_url=source_url,
                confidence=norm_value.confidence,
                verification_status=VerificationStatus.PENDING
            )
            self.session.add(norm_spec)

    def _link_components(self, variant: ProductVariant):
        """Link variant to canonical components"""
        # CPU
        cpu_spec = self.session.query(NormalizedSpec).filter(
            NormalizedSpec.variant_id == variant.id,
            NormalizedSpec.spec_name == 'cpu_model'
        ).first()

        if cpu_spec and cpu_spec.spec_value.get('value'):
            cpu_component = self.component_matcher.match_cpu(cpu_spec.raw_text)
            if cpu_component:
                config = ProductConfiguration(
                    variant_id=variant.id,
                    component_id=cpu_component.id,
                    component_role='primary',
                    configuration=self._extract_cpu_config(variant),
                    source_urls=[cpu_spec.source_url] if cpu_spec.source_url else [],
                    confidence=0.9
                )
                self.session.add(config)

        # GPU
        gpu_spec = self.session.query(NormalizedSpec).filter(
            NormalizedSpec.variant_id == variant.id,
            NormalizedSpec.spec_name == 'gpu_model'
        ).first()

        if gpu_spec and gpu_spec.spec_value.get('value'):
            gpu_component = self.component_matcher.match_gpu(gpu_spec.raw_text)
            if gpu_component:
                config = ProductConfiguration(
                    variant_id=variant.id,
                    component_id=gpu_component.id,
                    component_role='primary',
                    configuration=self._extract_gpu_config(variant),
                    source_urls=[gpu_spec.source_url] if gpu_spec.source_url else [],
                    confidence=0.9
                )
                self.session.add(config)

        # RAM configuration
        ram_spec = self.session.query(NormalizedSpec).filter(
            NormalizedSpec.variant_id == variant.id,
            NormalizedSpec.spec_name == 'ram_capacity_gb'
        ).first()

        if ram_spec and ram_spec.spec_value.get('value'):
            ram_type_spec = self.session.query(NormalizedSpec).filter(
                NormalizedSpec.variant_id == variant.id,
                NormalizedSpec.spec_name == 'ram_type'
            ).first()
            ram_type = ram_type_spec.spec_value.get('value') if ram_type_spec else None
            ram_component = self.component_matcher.match_ram(ram_type, ram_spec.spec_value['value'])
            if ram_component:
                config = ProductConfiguration(
                    variant_id=variant.id,
                    component_id=ram_component.id,
                    component_role='primary',
                    configuration={'capacity_gb': ram_spec.spec_value['value']},
                    source_urls=[ram_spec.source_url] if ram_spec.source_url else [],
                    confidence=0.9
                )
                self.session.add(config)

        # Storage configuration
        storage_spec = self.session.query(NormalizedSpec).filter(
            NormalizedSpec.variant_id == variant.id,
            NormalizedSpec.spec_name == 'storage_capacity_gb'
        ).first()

        if storage_spec and storage_spec.spec_value.get('value'):
            storage_type_spec = self.session.query(NormalizedSpec).filter(
                NormalizedSpec.variant_id == variant.id,
                NormalizedSpec.spec_name == 'storage_type'
            ).first()
            storage_type = storage_type_spec.spec_value.get('value') if storage_type_spec else None
            storage_component = self.component_matcher.match_storage(storage_type, storage_spec.spec_value['value'])
            if storage_component:
                config = ProductConfiguration(
                    variant_id=variant.id,
                    component_id=storage_component.id,
                    component_role='primary',
                    configuration={'capacity_gb': storage_spec.spec_value['value']},
                    source_urls=[storage_spec.source_url] if storage_spec.source_url else [],
                    confidence=0.9
                )
                self.session.add(config)

        # Display configuration
        display_spec = self.session.query(NormalizedSpec).filter(
            NormalizedSpec.variant_id == variant.id,
            NormalizedSpec.spec_name == 'size_mm'
        ).first()

        if display_spec and display_spec.spec_value.get('value'):
            display_component = self.component_matcher.match_display(display_spec.raw_text)
            if display_component:
                config = ProductConfiguration(
                    variant_id=variant.id,
                    component_id=display_component.id,
                    component_role='primary',
                    configuration=self._extract_display_config(variant),
                    source_urls=[display_spec.source_url] if display_spec.source_url else [],
                    confidence=0.9
                )
                self.session.add(config)

    def _extract_cpu_config(self, variant: ProductVariant) -> Dict:
        """Extract CPU configuration from specs"""
        config = {}
        specs_to_check = [
            ('cpu_tdp_w', 'tdp_w'),
            ('cpu_pl1_w', 'pl1_w'),
            ('cpu_pl2_w', 'pl2_w'),
            ('cpu_base_clock_ghz', 'base_clock_ghz'),
            ('cpu_boost_clock_ghz', 'boost_clock_ghz'),
        ]
        for spec_name, config_key in specs_to_check:
            spec = self.session.query(NormalizedSpec).filter(
                NormalizedSpec.variant_id == variant.id,
                NormalizedSpec.spec_name == spec_name
            ).first()
            if spec and spec.spec_value.get('value') is not None:
                config[config_key] = spec.spec_value['value']
        return config

    def _extract_gpu_config(self, variant: ProductVariant) -> Dict:
        """Extract GPU configuration from specs"""
        config = {}
        spec = self.session.query(NormalizedSpec).filter(
            NormalizedSpec.variant_id == variant.id,
            NormalizedSpec.spec_name == 'gpu_memory_gb'
        ).first()
        if spec and spec.spec_value.get('value') is not None:
            config['memory_gb'] = spec.spec_value['value']
        return config

    def _extract_display_config(self, variant: ProductVariant) -> Dict:
        """Extract display configuration from specs"""
        config = {}
        specs_to_check = [
            ('refresh_rate_hz', 'refresh_rate'),
            ('resolution', 'resolution'),
            ('panel_type', 'panel_type'),
            ('brightness_nits', 'brightness_nits'),
            ('contrast_ratio', 'contrast_ratio'),
            ('color_gamut', 'color_gamut'),
            ('hdr_support', 'hdr_support'),
            ('aspect_ratio', 'aspect_ratio'),
            ('response_time_ms', 'response_time_ms'),
        ]
        for spec_name, config_key in specs_to_check:
            spec = self.session.query(NormalizedSpec).filter(
                NormalizedSpec.variant_id == variant.id,
                NormalizedSpec.spec_name == spec_name
            ).first()
            if spec and spec.spec_value.get('value') is not None:
                config[config_key] = spec.spec_value['value']
        return config

    def update_search_index(self, variant: ProductVariant):
        """Update the denormalized search index for this variant"""
        specs = self.session.query(NormalizedSpec).filter(
            NormalizedSpec.variant_id == variant.id
        ).all()

        spec_dict = {}
        for s in specs:
            val = s.spec_value.get('value') if s.spec_value else None
            # Handle multi-option values - take the first option if it's a list
            if isinstance(val, list) and val:
                val = val[0]
            elif isinstance(val, dict):
                val = val.get('raw') or val.get('structured')
            if val is not None:
                spec_dict[s.spec_name] = val

        model = variant.model
        family = model.family if model else None
        brand = family.brand if family else None
        category = family.category if family else None

        price_min = None
        price_max = None
        if variant.launch_price and isinstance(variant.launch_price, dict):
            price_min = variant.launch_price.get('amount')
            price_max = variant.launch_price.get('amount')

        search_index = SearchIndex(
            variant_id=variant.id,
            brand=brand.name if brand else None,
            family=family.name if family else None,
            model=model.name if model else None,
            category=category.slug if category else None,
            series=model.generation if model else None,
            region=variant.region.code if variant.region else None,
            status=variant.status.value if variant.status else None,
            price_min=price_min,
            price_max=price_max,
            cpu_manufacturer=None,
            cpu_model=spec_dict.get('cpu_model'),
            gpu_manufacturer=None,
            gpu_model=spec_dict.get('gpu_model'),
            ram_gb=spec_dict.get('ram_capacity_gb'),
            storage_gb=spec_dict.get('storage_capacity_gb'),
            display_size_mm=spec_dict.get('size_mm'),
            display_refresh_rate=spec_dict.get('refresh_rate_hz'),
            display_is_oled=spec_dict.get('panel_type') == 'oled' if spec_dict.get('panel_type') else None,
            battery_wh=spec_dict.get('battery_capacity_wh'),
            weight_kg=spec_dict.get('weight_kg'),
            thickness_mm=spec_dict.get('thickness_mm'),
            ports=spec_dict.get('ports') if isinstance(spec_dict.get('ports'), list) else None,
            colors=[spec_dict.get('color')] if spec_dict.get('color') else None,
            release_year=model.release_date.year if model and model.release_date else None,
        )

        existing = self.session.query(SearchIndex).filter(SearchIndex.variant_id == variant.id).first()
        if existing:
            for key, value in search_index.__dict__.items():
                if not key.startswith('_'):
                    setattr(existing, key, value)
            existing.updated_at = utcnow()
        else:
            self.session.add(search_index)


def normalize_scraped_data(scraped_products, session, region_code: str = 'us'):
    """Normalize a list of scraped products into the canonical database"""
    normalizer = DataNormalizer(session)

    for product in scraped_products:
        try:
            normalizer.process_scraped_product(product, region_code)
        except Exception as e:
            print(f"Error normalizing {product.name}: {e}")
            session.rollback()
            continue

    session.commit()
    return True