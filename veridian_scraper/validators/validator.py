"""
Data Quality Validator

Validates scraped data to reject impossible values and flag outliers.
Implements the validation rules from database-design.md (Section 1.3).
"""

from dataclasses import dataclass, field
from enum import Enum
from typing import Any, Dict, List, Optional, Tuple


class ValidationSeverity(Enum):
    """Severity levels for validation issues."""
    ERROR = "error"       # Reject - value is impossible
    WARNING = "warning"   # Flag for review - value is suspicious
    INFO = "info"         # Note - value is unusual but possible


@dataclass
class ValidationResult:
    """Result of a validation check."""
    field: str
    value: Any
    severity: ValidationSeverity
    message: str
    suggestion: Optional[str] = None


@dataclass
class ValidationReport:
    """Complete validation report for a product or spec."""
    results: List[ValidationResult] = field(default_factory=list)

    @property
    def has_errors(self) -> bool:
        return any(r.severity == ValidationSeverity.ERROR for r in self.results)

    @property
    def has_warnings(self) -> bool:
        return any(r.severity == ValidationSeverity.WARNING for r in self.results)

    @property
    def errors(self) -> List[ValidationResult]:
        return [r for r in self.results if r.severity == ValidationSeverity.ERROR]

    @property
    def warnings(self) -> List[ValidationResult]:
        return [r for r in self.results if r.severity == ValidationSeverity.WARNING]

    def add(self, field: str, value: Any, severity: ValidationSeverity, message: str, suggestion: Optional[str] = None):
        self.results.append(ValidationResult(field, value, severity, message, suggestion))


# =============================================================================
# VALIDATION RANGES
# These define plausible ranges for laptop specifications.
# Values outside these ranges are flagged as errors or warnings.
# =============================================================================

# Price observations - reject impossible or unsafe values before persistence.
PRICE_RANGE = (0.01, 1_000_000)
SUPPORTED_CURRENCIES = {"USD", "EUR", "GBP", "INR", "CAD", "AUD", "JPY"}

# Battery capacity (Wh) - ultrabooks typically 40-100 Wh
BATTERY_WH_RANGE = (20, 200)  # Error if outside
BATTERY_WH_WARNING = (30, 120)  # Warning if outside

# Weight (kg) - ultrabooks typically 0.8-2.5 kg
WEIGHT_KG_RANGE = (0.3, 5.0)
WEIGHT_KG_WARNING = (0.7, 3.0)

# RAM (GB) - laptops typically 4-128 GB
RAM_GB_RANGE = (1, 256)
RAM_GB_WARNING = (4, 128)

# Storage (GB) - laptops typically 32-4096 GB
STORAGE_GB_RANGE = (8, 8192)
STORAGE_GB_WARNING = (64, 4096)

# Display size (inches) - laptops typically 10-18 inches
DISPLAY_SIZE_RANGE = (7, 25)
DISPLAY_SIZE_WARNING = (10, 18)

# CPU cores - typically 2-64
CPU_CORES_RANGE = (1, 128)
CPU_CORES_WARNING = (2, 64)

# Display refresh rate (Hz) - typically 30-480
REFRESH_RATE_RANGE = (1, 1000)
REFRESH_RATE_WARNING = (30, 480)

# Display brightness (nits) - typically 150-2000
DISPLAY_NITS_RANGE = (50, 5000)
DISPLAY_NITS_WARNING = (150, 1500)

# NPU TOPS - typically 0-200
NPU_TOPS_RANGE = (0, 500)
NPU_TOPS_WARNING = (0, 200)

# Battery life claimed (hours) - typically 2-48
BATTERY_LIFE_RANGE = (1, 72)
BATTERY_LIFE_WARNING = (2, 48)


def validate_range(
    field: str,
    value: float,
    error_range: Tuple[float, float],
    warning_range: Tuple[float, float],
    unit: str = ""
) -> Optional[ValidationResult]:
    """Validate a numeric value falls within expected ranges."""
    if value is None:
        return None

    # Check error range
    if value < error_range[0] or value > error_range[1]:
        return ValidationResult(
            field=field,
            value=value,
            severity=ValidationSeverity.ERROR,
            message=f"{field} = {value}{unit} is outside plausible range [{error_range[0]}-{error_range[1]}{unit}]",
            suggestion=f"Verify this value is correct. If accurate, check unit conversion."
        )

    # Check warning range
    if value < warning_range[0] or value > warning_range[1]:
        return ValidationResult(
            field=field,
            value=value,
            severity=ValidationSeverity.WARNING,
            message=f"{field} = {value}{unit} is outside typical range [{warning_range[0]}-{warning_range[1]}{unit}]",
            suggestion=f"Double-check this value for accuracy."
        )

    return None


class SpecValidator:
    """Validates individual specification values."""

    def __init__(self):
        self.report = ValidationReport()

    def validate_battery_wh(self, value: Optional[float]) -> ValidationReport:
        result = validate_range("battery_wh", value, BATTERY_WH_RANGE, BATTERY_WH_WARNING, " Wh")
        if result:
            self.report.results.append(result)
        return self.report

    def validate_weight_kg(self, value: Optional[float]) -> ValidationReport:
        result = validate_range("weight_kg", value, WEIGHT_KG_RANGE, WEIGHT_KG_WARNING, " kg")
        if result:
            self.report.results.append(result)
        return self.report

    def validate_ram_gb(self, value: Optional[int]) -> ValidationReport:
        result = validate_range("ram_gb", value, RAM_GB_RANGE, RAM_GB_WARNING, " GB")
        if result:
            self.report.results.append(result)
        return self.report

    def validate_storage_gb(self, value: Optional[int]) -> ValidationReport:
        result = validate_range("storage_gb", value, STORAGE_GB_RANGE, STORAGE_GB_WARNING, " GB")
        if result:
            self.report.results.append(result)
        return self.report

    def validate_display_size(self, value: Optional[float]) -> ValidationReport:
        result = validate_range("display_size_in", value, DISPLAY_SIZE_RANGE, DISPLAY_SIZE_WARNING, "\"")
        if result:
            self.report.results.append(result)
        return self.report

    def validate_cpu_cores(self, value: Optional[int]) -> ValidationReport:
        result = validate_range("cpu_cores", value, CPU_CORES_RANGE, CPU_CORES_WARNING)
        if result:
            self.report.results.append(result)
        return self.report

    def validate_refresh_rate(self, value: Optional[int]) -> ValidationReport:
        result = validate_range("display_refresh_hz", value, REFRESH_RATE_RANGE, REFRESH_RATE_WARNING, " Hz")
        if result:
            self.report.results.append(result)
        return self.report

    def validate_display_nits(self, value: Optional[int]) -> ValidationReport:
        result = validate_range("display_nits", value, DISPLAY_NITS_RANGE, DISPLAY_NITS_WARNING, " nits")
        if result:
            self.report.results.append(result)
        return self.report

    def validate_npu_tops(self, value: Optional[float]) -> ValidationReport:
        result = validate_range("npu_tops", value, NPU_TOPS_RANGE, NPU_TOPS_WARNING, " TOPS")
        if result:
            self.report.results.append(result)
        return self.report

    def validate_battery_life(self, value: Optional[float]) -> ValidationReport:
        result = validate_range("battery_life_hours", value, BATTERY_LIFE_RANGE, BATTERY_LIFE_WARNING, " hours")
        if result:
            self.report.results.append(result)
        return self.report


class ProductValidator:
    """Validates a complete product with all its specs."""

    def __init__(self):
        self.spec_validator = SpecValidator()
        self.report = ValidationReport()

    def validate_product(self, product_data: Dict[str, Any]) -> ValidationReport:
        """
        Validate a product dictionary.

        Expected keys:
        - battery_wh, weight_kg, ram_gb, storage_gb, display_size_in,
          cpu_cores, display_refresh_hz, display_nits, npu_tops, battery_life_hours
        """
        self.report = ValidationReport()

        # Validate each field
        validators = [
            ("battery_wh", self.spec_validator.validate_battery_wh),
            ("weight_kg", self.spec_validator.validate_weight_kg),
            ("ram_gb", self.spec_validator.validate_ram_gb),
            ("storage_gb", self.spec_validator.validate_storage_gb),
            ("display_size_in", self.spec_validator.validate_display_size),
            ("cpu_cores", self.spec_validator.validate_cpu_cores),
            ("display_refresh_hz", self.spec_validator.validate_refresh_rate),
            ("display_nits", self.spec_validator.validate_display_nits),
            ("npu_tops", self.spec_validator.validate_npu_tops),
            ("battery_life_hours", self.spec_validator.validate_battery_life),
        ]

        for field_name, validator_func in validators:
            value = product_data.get(field_name)
            if value is not None:
                try:
                    # Convert to appropriate type
                    if field_name in ("ram_gb", "storage_gb", "cpu_cores", "display_refresh_hz", "display_nits"):
                        value = int(value)
                    else:
                        value = float(value)
                    validator_func(value)
                except (ValueError, TypeError) as e:
                    self.report.add(
                        field_name,
                        value,
                        ValidationSeverity.ERROR,
                        f"Invalid numeric value for {field_name}: {e}"
                    )

        # Cross-field validations
        self._validate_cross_fields(product_data)

        return self.report

    def _validate_cross_fields(self, product_data: Dict[str, Any]):
        """Validate relationships between fields."""
        # Battery life vs battery capacity
        battery_wh = product_data.get("battery_wh")
        battery_life = product_data.get("battery_life_hours")
        if battery_wh and battery_life:
            try:
                wh = float(battery_wh)
                hours = float(battery_life)
                if wh > 0 and hours > 0:
                    # Typical efficiency: 5-20 Wh per hour for ultrabooks
                    efficiency = wh / hours
                    if efficiency < 3:
                        self.report.add(
                            "battery_efficiency",
                            efficiency,
                            ValidationSeverity.WARNING,
                            f"Unusually low power consumption: {efficiency:.1f} Wh/hour",
                            "Verify battery life claim is realistic"
                        )
                    elif efficiency > 30:
                        self.report.add(
                            "battery_efficiency",
                            efficiency,
                            ValidationSeverity.WARNING,
                            f"Unusually high power consumption: {efficiency:.1f} Wh/hour",
                            "Verify battery life claim is realistic"
                        )
            except (ValueError, TypeError, ZeroDivisionError):
                pass

        # Weight vs display size
        weight = product_data.get("weight_kg")
        display_size = product_data.get("display_size_in")
        if weight and display_size:
            try:
                w = float(weight)
                d = float(display_size)
                if d > 0:
                    # Typical: 0.1-0.2 kg per inch for ultrabooks
                    ratio = w / d
                    if ratio < 0.05:
                        self.report.add(
                            "weight_per_inch",
                            ratio,
                            ValidationSeverity.WARNING,
                            f"Unusually light for {d}\" display: {w} kg",
                            "Verify weight is accurate"
                        )
                    elif ratio > 0.3:
                        self.report.add(
                            "weight_per_inch",
                            ratio,
                            ValidationSeverity.WARNING,
                            f"Unusually heavy for {d}\" display: {w} kg",
                            "Verify weight is accurate"
                        )
            except (ValueError, TypeError, ZeroDivisionError):
                pass


def validate_price_observation(price: Any, currency: Any = "USD") -> ValidationReport:
    """Validate a price observation before writing it to history."""
    report = ValidationReport()
    try:
        numeric_price = float(price)
    except (TypeError, ValueError):
        report.add("price", price, ValidationSeverity.ERROR, "Price must be numeric.")
        return report

    if numeric_price != numeric_price or numeric_price in (float("inf"), float("-inf")):
        report.add("price", price, ValidationSeverity.ERROR, "Price must be finite.")
    elif numeric_price < PRICE_RANGE[0] or numeric_price > PRICE_RANGE[1]:
        report.add("price", price, ValidationSeverity.ERROR, "Price is outside the supported range.")

    normalized_currency = str(currency or "").upper()
    if normalized_currency not in SUPPORTED_CURRENCIES:
        report.add(
            "currency",
            currency,
            ValidationSeverity.ERROR,
            f"Unsupported currency: {currency}",
            f"Use one of: {', '.join(sorted(SUPPORTED_CURRENCIES))}",
        )
    return report


# Convenience functions
def validate_spec_value(field_name: str, value: Any) -> Optional[ValidationResult]:
    """Validate a single spec value."""
    validator = SpecValidator()
    validation_methods = {
        "battery_wh": validator.validate_battery_wh,
        "weight_kg": validator.validate_weight_kg,
        "ram_gb": validator.validate_ram_gb,
        "storage_gb": validator.validate_storage_gb,
        "display_size_in": validator.validate_display_size,
        "cpu_cores": validator.validate_cpu_cores,
        "display_refresh_hz": validator.validate_refresh_rate,
        "display_nits": validator.validate_display_nits,
        "npu_tops": validator.validate_npu_tops,
        "battery_life_hours": validator.validate_battery_life,
    }

    method = validation_methods.get(field_name)
    if method:
        try:
            if field_name in ("ram_gb", "storage_gb", "cpu_cores", "display_refresh_hz", "display_nits"):
                value = int(value)
            else:
                value = float(value)
            report = method(value)
            return report.results[0] if report.results else None
        except (ValueError, TypeError) as e:
            return ValidationResult(
                field=field_name,
                value=value,
                severity=ValidationSeverity.ERROR,
                message=f"Invalid numeric value: {e}"
            )
    return None


def validate_product(product_data: Dict[str, Any]) -> ValidationReport:
    """Validate a complete product."""
    validator = ProductValidator()
    return validator.validate_product(product_data)
