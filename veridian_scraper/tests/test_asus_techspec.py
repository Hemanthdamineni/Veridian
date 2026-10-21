"""
Tests for the ASUS tech-spec extractor.

The live ASUS spec table is rendered by a Vue component whose class names are
hashed per build, so the extractor must rely on the stable hooks only. The
fixture is a trimmed copy of the real page (see the file header) and keeps the
hashed class names, which is exactly what makes this test meaningful.
"""

import asyncio
from pathlib import Path

import pytest
from bs4 import BeautifulSoup

from veridian_scraper.scrapers.asus import AsusScraper, create_asus_config

FIXTURE = Path(__file__).parent / 'fixtures' / 'asus_techspec_zenbook_ux3407.html'
TECHSPEC_URL = (
    "https://www.asus.com/us/laptops/for-home/zenbook/"
    "asus-zenbook-a14-ux3407/techspec/"
)
PRODUCT_URL = (
    "https://www.asus.com/us/laptops/for-home/zenbook/asus-zenbook-a14-ux3407/"
)


class _FixtureClient:
    """HTTP client stub that serves the saved tech-spec page."""

    def __init__(self, html: str):
        self._soup = BeautifulSoup(html, 'html.parser')
        self.requested: list = []

    async def get_soup(self, url: str, **kwargs) -> BeautifulSoup:
        self.requested.append(url)
        return self._soup


def _scraper() -> AsusScraper:
    config = create_asus_config()
    scraper = AsusScraper(config, config.regions[0])
    scraper.http_client = _FixtureClient(FIXTURE.read_text(encoding='utf-8'))
    return scraper


def _extract() -> list:
    scraper = _scraper()
    return asyncio.run(scraper._extract_variants_from_techspec(TECHSPEC_URL, PRODUCT_URL))


def test_fixture_is_present():
    assert FIXTURE.exists(), "the trimmed live-page fixture must be committed"


def test_extracts_one_variant_per_configuration_column():
    variants = _extract()
    # The live page has five configuration columns.
    assert len(variants) == 5


def test_part_numbers_come_from_the_model_row():
    variants = _extract()
    names = [v.name for v in variants]

    # The Model row of the table holds the part numbers, in column order.
    assert names[0].startswith('UX3407QA')
    assert names[1] == 'UX3407RA'
    assert names[2].startswith('UX3407QA')
    assert names[3] == 'UX3407NA'
    assert names[4] == 'UX3407NA-CG'

    # The same part number appears twice on this page, so the duplicate has to
    # be disambiguated - otherwise the two columns would share one SKU.
    assert names[0] != names[2]
    assert len({v.sku for v in variants}) == 5


def test_part_numbers_are_stored_as_the_model_spec():
    variants = _extract()
    assert variants[0].specs['model'].raw == 'UX3407QA'
    assert variants[4].specs['model'].raw == 'UX3407NA-CG'


def test_values_are_parsed_into_structured_specs():
    variants = _extract()

    processor = variants[0].specs['processor']
    assert processor.structured['brand'] == 'Snapdragon'
    assert processor.structured['cores'] == 8
    assert processor.structured['cache_mb'] == 30

    memory = variants[0].specs['memory']
    assert memory.structured['capacity_gb'] == 32
    assert memory.structured['type'] == 'LPDDR5X'
    assert memory.is_multi_option is True
    assert memory.options == ['32GB LPDDR5X on board', '16GB LPDDR5X on board']

    storage = variants[0].specs['storage']
    assert storage.structured['capacity_gb'] == 1024
    assert storage.structured['interface'] == 'NVMe'

    display = variants[0].specs['display']
    assert display.structured['resolution'] == '1920x1200'
    assert display.structured['panel_type'] == 'OLED'

    weight = variants[0].specs['weight']
    assert weight.structured['weight_kg'] == 0.98

    battery = variants[0].specs['battery']
    assert battery.structured['capacity_wh'] == 70


def test_variant_names_are_stable_between_runs():
    first = [v.variant_id for v in _extract()]
    second = [v.variant_id for v in _extract()]
    assert first == second


def test_boilerplate_rows_are_skipped():
    variants = _extract()
    for variant in variants:
        assert 'disclaimer' not in variant.specs
        assert 'myasus_features' not in variant.specs
        assert 'built_in_apps' not in variant.specs
