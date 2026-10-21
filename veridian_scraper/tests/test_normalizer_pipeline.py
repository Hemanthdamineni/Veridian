"""
Tests for the scraped-product pipeline of the database normalizer.

The scrapers hand over ``SpecValue`` objects, while older payloads used plain
dicts. The colour of a variant used to be read with ``specs['color'].get('raw')``,
which raises for a ``SpecValue`` and made the whole product disappear in the
rollback of the failed normalisation.
"""

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from veridian_db.models import Base, ProductVariant, create_all_tables
from veridian_db.normalizer import DataNormalizer
from veridian_scraper.models import (
    Product,
    ProductCategory,
    ProductVariant as ScrapedVariant,
    SpecValue,
)


@pytest.fixture
def session():
    engine = create_engine("sqlite:///:memory:")
    create_all_tables(engine)
    db_session = sessionmaker(bind=engine)()
    try:
        yield db_session
    finally:
        db_session.close()


def _product(specs):
    variant = ScrapedVariant(
        variant_id="v1",
        name="UX3407QA",
        sku="UX3407QA",
        specs=specs,
        source_url="https://www.asus.com/us/laptops/example/",
    )
    return Product(
        product_id="p1",
        canonical_key="asus-ux3407",
        manufacturer="asus",
        brand="ASUS",
        name="ASUS Zenbook A14 UX3407",
        category=ProductCategory.LAPTOPS,
        variants=[variant],
    )


def test_colour_is_taken_from_a_spec_value(session):
    product = _product({
        "color": SpecValue(raw="Zabriskie Beige"),
        "memory": SpecValue(raw="32GB LPDDR5X", structured={"capacity_gb": 32}),
    })

    variant = DataNormalizer(session).process_scraped_product(product, "us")

    assert isinstance(variant, ProductVariant)
    assert variant.color == "Zabriskie Beige"
    assert variant.sku == "UX3407QA"


def test_colour_is_taken_from_a_plain_dict(session):
    """Older payloads stored the spec values as dictionaries."""
    product = _product({"color": {"raw": "Iceland Gray"}})

    variant = DataNormalizer(session).process_scraped_product(product, "us")

    assert variant.color == "Iceland Gray"


def test_a_product_without_a_colour_is_still_normalised(session):
    product = _product({"memory": SpecValue(raw="16GB LPDDR5X")})

    variant = DataNormalizer(session).process_scraped_product(product, "us")

    assert variant.color is None
    assert variant.sku == "UX3407QA"
