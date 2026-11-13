"""
GPU spec parser.

Extracts a canonical GPU model name from raw specification text.

Like the CPU parser, the GPU branch runs before generic array detection. When
the spec name is a graphics/GPU-related name this parser always returns a value
(so downstream generic parsing is never attempted for a GPU field).
"""

import re
from typing import Optional

from .base import NormalizedValue

# Ordered list of GPU model patterns. The first match wins.
GPU_PATTERNS = [
    r'(nvidia\s+geforce\s+rtx\s+\d{4}[a-z]?)(?=\s+(?:laptop|desktop|mobile|gpu|gb|gd|ti)|$)',
    r'(nvidia\s+geforce\s+gtx\s+\d{4}[a-z]?)(?=\s+(?:laptop|desktop|mobile|gpu|gb|gd|ti)|$)',
    r'(nvidia\s+rtx\s+a\d{4})(?=\s+(?:laptop|desktop|mobile|gpu|gb|gd|ti)|$)',
    r'(amd\s+radeon\s+[\w\s]+?)(?=\s+(?:graphics|gpu|gb|gd|processor|ghz)|$)',
    r'(intel\s+(?:arc|iris|uhd|hd)\s+[\w\s]+?)(?=\s+(?:graphics|gpu|gb|gd|processor|ghz)|$)',
    r'(apple\s+gpu\s+[\w\s]+?)(?=\s+(?:core|graphics|gpu|processor|ghz)|$)',
    r'(qualcomm\s+adreno\s+[\w\s]+?)(?=\s+(?:graphics|gpu|processor|ghz)|$)',
]


def is_gpu_spec_name(spec_name_lower: str) -> bool:
    """Whether a normalized spec name refers to a GPU / graphics device."""
    return 'graphics' in spec_name_lower or 'gpu' in spec_name_lower


def parse_gpu(clean_value: str, raw_value: str, spec_name_lower: str = "") -> Optional[NormalizedValue]:
    """Parse a GPU model from cleaned raw text.

    Returns a ``NormalizedValue`` carrying the matched model (or the full raw
    string as a fallback) when the spec name is GPU-related, else ``None``.
    """
    if not is_gpu_spec_name(spec_name_lower):
        return None

    for pattern in GPU_PATTERNS:
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