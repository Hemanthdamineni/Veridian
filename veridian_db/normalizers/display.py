"""
Display spec parser.

Extracts canonical display characteristics (size, refresh rate, brightness,
panel type, response time, contrast ratio, aspect ratio, resolution) from raw
specification text.
"""

import re
from typing import Optional

from .base import NormalizedValue

# Panel type keywords, ordered so that the first match wins.
PANEL_TYPES = ['oled', 'ips', 'va', 'tn', 'mini led', 'micro led', 'qled', 'lcd', 'led']


def _parse_size(clean_value: str, raw_value: str) -> Optional[NormalizedValue]:
    """Extract display size (in mm) from complex display strings."""
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
    return None


def _parse_refresh_rate(clean_value: str, raw_value: str) -> Optional[NormalizedValue]:
    hz_match = re.search(r'(\d+(?:\.\d+)?)\s*(?:Hz|hz)\b', clean_value, re.IGNORECASE)
    if hz_match:
        return NormalizedValue(
            value=float(hz_match.group(1)),
            unit='Hz',
            raw_text=raw_value,
            spec_type='number'
        )
    return None


def _parse_brightness(clean_value: str, raw_value: str) -> Optional[NormalizedValue]:
    nit_match = re.search(r'(\d+(?:\.\d+)?)\s*(?:nits?)\b', clean_value, re.IGNORECASE)
    if nit_match:
        return NormalizedValue(
            value=float(nit_match.group(1)),
            unit='nits',
            raw_text=raw_value,
            spec_type='number'
        )
    return None


def _parse_panel_type(clean_value: str, raw_value: str) -> Optional[NormalizedValue]:
    for panel in PANEL_TYPES:
        if re.search(r'\b' + panel + r'\b', clean_value, re.IGNORECASE):
            return NormalizedValue(
                value=panel.upper(),
                unit=None,
                raw_text=raw_value,
                spec_type='string'
            )
    return None


def _parse_response_time(clean_value: str, raw_value: str) -> Optional[NormalizedValue]:
    ms_match = re.search(r'(\d+(?:\.\d+)?)\s*(?:ms|millisecond)\b', clean_value, re.IGNORECASE)
    if ms_match:
        return NormalizedValue(
            value=float(ms_match.group(1)),
            unit='ms',
            raw_text=raw_value,
            spec_type='number'
        )
    return None


def _parse_contrast(clean_value: str, raw_value: str) -> Optional[NormalizedValue]:
    # Match large ratios like 1000000:1 or 1000:1
    contrast_match = re.search(r'(\d{4,})\s*:\s*(\d+)', clean_value)
    if contrast_match:
        return NormalizedValue(
            value=f"{int(contrast_match.group(1))}:{int(contrast_match.group(2))}",
            unit='ratio',
            raw_text=raw_value,
            spec_type='string'
        )
    return None


def _parse_aspect_ratio(clean_value: str, raw_value: str) -> Optional[NormalizedValue]:
    # Match typical aspect ratios like 16:10, 16:9, 4:3, 3:2, 21:9
    aspect_match = re.search(r'(\d{1,2})\s*:\s*(\d{1,2})\b', clean_value)
    if aspect_match:
        return NormalizedValue(
            value=f"{int(aspect_match.group(1))}:{int(aspect_match.group(2))}",
            unit=None,
            raw_text=raw_value,
            spec_type='string'
        )
    return None


def _parse_resolution(clean_value: str, raw_value: str) -> Optional[NormalizedValue]:
    res_match = re.search(r'(\d+)\s*[x×]\s*(\d+)\b', clean_value, re.IGNORECASE)
    if res_match:
        return NormalizedValue(
            value=(int(res_match.group(1)), int(res_match.group(2))),
            unit='px',
            raw_text=raw_value,
            spec_type='object'
        )
    return None


def is_display_spec_name(spec_name_lower: str) -> bool:
    """Whether a normalized spec name refers to a display characteristic."""
    return any(key in spec_name_lower for key in (
        'size', 'display', 'screen', 'refresh', 'bright', 'nit',
        'panel', 'response', 'contrast', 'aspect', 'resolution',
    ))


def parse_display(clean_value: str, raw_value: str, spec_name_lower: str = "") -> Optional[NormalizedValue]:
    """Parse a display characteristic from cleaned raw text.

    Returns a ``NormalizedValue`` when the spec name is display-related and a
    value can be extracted, else ``None``.
    """
    if not is_display_spec_name(spec_name_lower):
        return None

    # Order matters: a panel-type value should not be swallowed by another rule.
    if 'size' in spec_name_lower or 'display' in spec_name_lower or 'screen' in spec_name_lower:
        result = _parse_size(clean_value, raw_value)
        if result is not None:
            return result

    if 'refresh' in spec_name_lower:
        result = _parse_refresh_rate(clean_value, raw_value)
        if result is not None:
            return result

    if 'bright' in spec_name_lower or 'nit' in spec_name_lower:
        result = _parse_brightness(clean_value, raw_value)
        if result is not None:
            return result

    if 'panel' in spec_name_lower:
        result = _parse_panel_type(clean_value, raw_value)
        if result is not None:
            return result

    if 'response' in spec_name_lower:
        result = _parse_response_time(clean_value, raw_value)
        if result is not None:
            return result

    if 'contrast' in spec_name_lower:
        result = _parse_contrast(clean_value, raw_value)
        if result is not None:
            return result

    if 'aspect' in spec_name_lower:
        result = _parse_aspect_ratio(clean_value, raw_value)
        if result is not None:
            return result

    if 'resolution' in spec_name_lower:
        result = _parse_resolution(clean_value, raw_value)
        if result is not None:
            return result

    return None