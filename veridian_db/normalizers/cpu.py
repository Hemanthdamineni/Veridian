"""
CPU spec parser.

Extracts a canonical CPU model name from raw specification text.

The CPU branch must run before generic array detection because a CPU spec is a
single model string even when it contains commas. When the spec name is a
CPU-related name this parser always returns a value (falling back to the raw
string) so that downstream generic parsing is never attempted for a CPU field.
"""

import re
from typing import Optional

from .base import NormalizedValue

# Ordered list of CPU model patterns. The first match wins.
CPU_PATTERNS = [
    r'(intel\s+core\s+(?:i\d|ultra)\s+(?:\d\s+)?\d{3,4}[a-z]?)(?=\s+(?:processor|ghz|cache|core|thread|up\sto|\d)|$)',
    r'(amd\s+ryzen\s+(?:ai\s+)?\d?\s*[\w]+\s+\d{3,4}[a-z]?)(?=\s+(?:processor|ghz|cache|core|thread|npU|up\sto|\d)|$)',
    r'(apple\s+m\d[\w\s-]+?)(?=\s+(?:core|cpu|gpu|processor|ghz|cache|up\sto|\d)|$)',
    r'(qualcomm\s+snapdragon\s+(?:x|8\s+gen)\s+[\w\s-]+?)(?=\s+(?:processor|ghz|cache|core|thread|npU|up\sto|\d)|$)',
]


def is_cpu_spec_name(spec_name_lower: str) -> bool:
    """Whether a normalized spec name refers to a CPU / processor."""
    return 'processor' in spec_name_lower or 'cpu' in spec_name_lower


def parse_cpu(clean_value: str, raw_value: str, spec_name_lower: str = "") -> Optional[NormalizedValue]:
    """Parse a CPU model from cleaned raw text.

    Returns a ``NormalizedValue`` carrying the matched model (or the full raw
    string as a fallback) when the spec name is CPU-related, else ``None``.
    """
    if not is_cpu_spec_name(spec_name_lower):
        return None

    for pattern in CPU_PATTERNS:
        match = re.search(pattern, clean_value, re.IGNORECASE)
        if match:
            return NormalizedValue(
                value=match.group(1).strip(),
                unit=None,
                raw_text=raw_value,
                spec_type='string'
            )
    # Fallback: return the raw string
    return NormalizedValue(
        value=raw_value,
        unit=None,
        raw_text=raw_value,
        spec_type='string'
    )