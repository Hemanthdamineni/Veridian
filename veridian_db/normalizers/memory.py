"""
RAM / memory spec parser.

Extracts the capacity (in GB) from raw RAM/memory specification text.
"""

import re
from typing import Optional

from .base import NormalizedValue


def parse_memory(clean_value: str, raw_value: str) -> Optional[NormalizedValue]:
    """Parse a RAM capacity from cleaned raw text.

    Returns a ``NormalizedValue`` with the capacity in GB when a GB or MB value
    is found, else ``None``.
    """
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
    return None