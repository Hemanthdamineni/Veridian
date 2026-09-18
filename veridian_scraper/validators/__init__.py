"""
Data Quality Validation Layer for Veridian Scrapers.

Provides validation rules to reject impossible values and flag outliers.
"""

from .validator import (
    ValidationResult,
    ValidationSeverity,
    SpecValidator,
    ProductValidator,
    validate_spec_value,
    validate_product,
)

__all__ = [
    "ValidationResult",
    "ValidationSeverity",
    "SpecValidator",
    "ProductValidator",
    "validate_spec_value",
    "validate_product",
]
