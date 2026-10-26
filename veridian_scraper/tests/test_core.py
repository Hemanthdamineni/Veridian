from veridian_db.clock import utcnow

def test_normalize_product():
    """The shared spec normalizer turns a scraped spec into a typed, unit-standardised value."""
    from veridian_db.normalizer import SpecNormalizer

    ram = SpecNormalizer.normalize_value("16GB LPDDR5X 5600MHz", "ram_gb")
    assert ram.value == 16.0
    assert ram.unit == "GB"
    assert ram.spec_type == "number"

    cpu = SpecNormalizer.normalize_value("Intel Core Ultra 7 155H 1.4 GHz", "cpu_model")
    assert cpu.value == "Intel Core Ultra 7 155H"
    assert cpu.spec_type == "string"


def test_normalize_variant():
    """The normalizer separates the value from the unit and keeps the raw text."""
    from veridian_db.normalizer import SpecNormalizer

    storage = SpecNormalizer.normalize_value("512GB NVMe SSD", "storage_gb")
    assert storage.value == 512.0
    assert storage.unit == "GB"

    weight = SpecNormalizer.normalize_value("1.2 kg", "weight_kg")
    assert weight.value == 1.2
    assert weight.unit == "kg"
    assert weight.raw_text == "1.2 kg"

def test_validate_spec():
    """Test specification validation."""
    from veridian_scraper.validators.validator import validate_spec_value
    assert validate_spec_value("battery_wh", 75) is None
    assert validate_spec_value("weight_kg", 1.2) is None
    assert validate_spec_value("ram_gb", 16) is None
    assert validate_spec_value("display_size_in", 14) is None
    print("✅ Specification validation test passed")

def test_identity_resolution():
    """Test identity resolution."""
    from veridian_scraper.price_tracker.identity_resolver import IdentityResolver
    canonical_skus = [
        {"id": "1", "sku_code": "UX3407QA", "name": "Zenbook UX3407"}
    ]
    resolver = IdentityResolver(canonical_skus)
    result = resolver.resolve("ASUS Zenbook UX3407QA-QD123WS")
    assert result.resolved_sku_id == "1"
    print("✅ Identity resolution test passed")

def test_price_rollup():
    """Test price rollup calculation."""
    from datetime import datetime
    from veridian_scraper.price_tracker.price_tracker import PricePoint, PriceTracker
    tracker = PriceTracker()
    tracker.set_msrp("1", 999)
    tracker.add_price_point(PricePoint(
        sku_id="1",
        seller_id="1",
        seller_name="Best Buy",
        price=899,
        currency="USD",
        url="",
        scraped_at=utcnow(),
        is_available=True,
    ))
    rollup = tracker.compute_rollups("1", "1")
    assert rollup.current_price == 899
    assert rollup.lowest_ever == 899
    print("✅ Price rollup test passed")

if __name__ == "__main__":
    test_normalize_product()
    test_normalize_variant()
    test_validate_spec()
    test_identity_resolution()
    test_price_rollup()
    print("All tests passed")

def test_price_observation_validation():
    """Validate price observations reject impossible values and unknown currencies."""
    from veridian_scraper.validators.validator import (
        validate_price_observation,
        ValidationSeverity,
    )

    # Valid observation
    report = validate_price_observation(899.99, "USD")
    assert not report.has_errors

    # Negative and absurd prices rejected
    assert validate_price_observation(-1, "USD").has_errors
    assert validate_price_observation(1e9, "USD").has_errors
    assert validate_price_observation(float("nan"), "USD").has_errors

    # Unsupported currency rejected; valid ones accepted
    assert validate_price_observation(999, "XYZ").has_errors
    for currency in ("usd", "EUR", "GBP", "inr"):
        assert not validate_price_observation(999, currency).has_errors

    # Non-numeric price rejected
    report = validate_price_observation("free", "USD")
    assert report.has_errors
    assert any(r.severity == ValidationSeverity.ERROR for r in report.results)
    print("✅ Price observation validation test passed")
