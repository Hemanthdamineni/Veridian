"""
Shared primitives for the Veridian spec normalizers.

``NormalizedValue`` is the canonical typed container produced by every parser.
Keeping it here (rather than in ``normalizer.py``) lets the dedicated parser
modules import it without creating a circular import back to the orchestrator.
"""

from typing import Any, Optional
from dataclasses import dataclass


@dataclass
class NormalizedValue:
    """A normalized specification value with metadata"""
    value: Any
    unit: Optional[str]
    raw_text: str
    confidence: float = 1.0
    spec_type: str = "number"  # number, string, boolean, array, object


def infer_type(value: Any) -> str:
    """Infer the spec_type string for a normalized value."""
    if isinstance(value, bool):
        return 'boolean'
    elif isinstance(value, (int, float)):
        return 'number'
    elif isinstance(value, list):
        return 'array'
    elif isinstance(value, dict):
        return 'object'
    return 'string'