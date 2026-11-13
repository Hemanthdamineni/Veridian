"""
Storage spec parser.

Extracts the capacity (in GB) from raw storage specification text.
"""

import re
from typing import Optional

from .base import NormalizedValue


def parse_storage(clean_value: str, raw_value: str) -> Optional[NormalizedValue]:
    """Parse a storage capacity from cleaned raw text.

    Returns a ``NormalizedValue`` with the capacity in GB when a GB or TB value
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
    tb_match = re.search(r'(\d+(?:\.\d+)?)\s*(?:TB|Tb)\b', clean_value, re.IGNORECASE)
    if tb_match:
        return NormalizedValue(
            value=float(tb_match.group(1)) * 1024,
            unit='GB',
            raw_text=raw_value,
            spec_type='number'
        )
    return None