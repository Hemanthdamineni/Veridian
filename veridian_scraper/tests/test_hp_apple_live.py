"""
Tests for the HP and Apple product-page extraction.

Both fixtures are trimmed copies of pages that were fetched live on
2026-10-21 with the project's own HTTP client (which enforces robots.txt)
and the honest ``VeridianBot`` agent:

* ``hp_omnibook3_pdp.html`` - the HP store page of one configuration
  (``https://www.hp.com/in-en/shop/products/laptops/hp-omnibook-3-laptop-ai-
  14-ht0218tu-e5sm2pa-acj``). The specifications are server rendered inside
  ``data-test-hook`` blocks; the Tailwind class names around them are hashed
  per build and are kept in the fixture so the test proves that the
  extraction does not depend on them.
* ``apple_macbook_air_specs.html`` - the Apple technical specification page
  of the MacBook Air (``https://www.apple.com/macbook-air/specs/``).
* ``apple_macbook_air_buy.html`` - the Apple store page of the same family
  (``https://www.apple.com/shop/buy-mac/macbook-air``), which carries the
  schema.org Product block with the price range of the family.

The tests assert the values that are actually published, not that a function
returns something.
"""

import asyncio
from pathlib import Path

import pytest
from bs4 import BeautifulSoup

from veridian_scraper.scrapers.apple import AppleScraper, create_apple_config
from veridian_scraper.scrapers.hp import HPScraper, create_hp_config

FIXTURES = Path(__file__).parent / 'fixtures'
HP_PDP_FIXTURE = FIXTURES / 'hp_omnibook3_pdp.html'
APPLE_SPECS_FIXTURE = FIXTURES / 'apple_macbook_air_specs.html'
APPLE_BUY_FIXTURE = FIXTURES / 'apple_macbook_air_buy.html'
APPLE_MINI_SPECS_FIXTURE = FIXTURES / 'apple_mac_mini_specs.html'

HP_PDP_URL = (
    "https://www.hp.com/in-en/shop/products/laptops/"
    "hp-omnibook-3-laptop-ai-14-ht0218tu-e5sm2pa-acj"
)
APPLE_SPECS_URL = "https://www.apple.com/macbook-air/specs/"
APPLE_BUY_URL = "https://www.apple.com/shop/buy-mac/macbook-air"

# The fixtures must stay small enough to be committed and must not contain
# whole pages of noise.
MAX_FIXTURE_BYTES = 120 * 1024


class _FixtureClient:
    """HTTP client stub that serves a saved page."""

    def __init__(self, html: str):
        self._soup = BeautifulSoup(html, 'html.parser')
        self.requested: list = []

    async def get_soup(self, url: str, **kwargs) -> BeautifulSoup:
        self.requested.append(url)
        return self._soup


def _hp_scraper(html: str = None) -> HPScraper:
    config = create_hp_config()
    scraper = HPScraper(config, config.regions[1])
    scraper.http_client = _FixtureClient(html if html is not None else HP_PDP_FIXTURE.read_text(encoding='utf-8'))
    return scraper


def _apple_scraper(html: str = None) -> AppleScraper:
    config = create_apple_config()
    scraper = AppleScraper(config, config.regions[0])
    scraper.http_client = _FixtureClient(html if html is not None else APPLE_SPECS_FIXTURE.read_text(encoding='utf-8'))
    return scraper


def _hp_soup() -> BeautifulSoup:
    return BeautifulSoup(HP_PDP_FIXTURE.read_text(encoding='utf-8'), 'html.parser')


def _hp_specs() -> dict:
    return _hp_scraper()._extract_tech_specs(_hp_soup())


def _apple_variants() -> list:
    scraper = _apple_scraper()
    soup = BeautifulSoup(APPLE_SPECS_FIXTURE.read_text(encoding='utf-8'), 'html.parser')
    return scraper._variants_from_specs(soup, APPLE_SPECS_URL, APPLE_BUY_URL, "MacBook Air")


# =============================================================================
# Fixtures
# =============================================================================

@pytest.mark.parametrize(
    "fixture",
    [HP_PDP_FIXTURE, APPLE_SPECS_FIXTURE, APPLE_BUY_FIXTURE, APPLE_MINI_SPECS_FIXTURE],
)
def test_fixture_is_present_and_small(fixture: Path):
    assert fixture.exists(), "the trimmed live-page fixture must be committed"
    assert fixture.stat().st_size <= MAX_FIXTURE_BYTES, "the fixture must stay under 120 KB"


def test_hp_fixture_keeps_the_hashed_class_names():
    """The hashed build class names are kept, so the extraction must ignore them."""
    html = HP_PDP_FIXTURE.read_text(encoding='utf-8')
    assert 'GJ-GM_gh' in html, "the hashed class names of the live build are part of the fixture"
    assert 'data-test-hook="@hpstellar/pdp/tech-specs__detailedSpecWithSubSpecs"' in html


# =============================================================================
# HP
# =============================================================================

def test_hp_reads_the_product_name_and_the_order_code():
    scraper = _hp_scraper()
    soup = _hp_soup()

    assert scraper._extract_product_name(soup, HP_PDP_URL) == "HP OmniBook 3 Laptop AI 14-ht0218TU"
    assert scraper._extract_sku(soup) == "E5SM2PA#ACJ"


def test_hp_reads_the_published_prices():
    """The page publishes the sale price and the MRP, both in INR."""
    sale_price, list_price, currency = _hp_scraper()._extract_prices(_hp_soup())

    assert sale_price == 72999.0
    assert list_price == 206414.0
    assert currency == "INR"


def test_hp_reads_the_processor():
    processor = _hp_specs()['processor']

    assert processor.raw == (
        "Intel® Core™ 3 304 (up to 4.3 GHz with Intel® Turbo Boost Technology, "
        "6 MB L3 cache, 5 cores, 5 threads)"
    )
    assert processor.structured['brand'] == "Intel"
    assert processor.structured['cores'] == 5
    assert processor.structured['threads'] == 5
    assert processor.structured['cache_mb'] == 6
    assert processor.structured['boost_freq_ghz'] == 4.3
    assert processor.unit == "GHz"


def test_hp_reads_the_memory():
    memory = _hp_specs()['memory']

    assert memory.raw == "8 GB DDR5-5600 MT/s (1 x 8 GB)"
    assert memory.structured['capacity_gb'] == 8
    assert memory.structured['type'] == "DDR5"
    assert memory.structured['speed_mts'] == 5600
    assert memory.structured['modules'] == 1
    assert memory.unit == "GB"


def test_hp_reads_the_storage():
    storage = _hp_specs()['storage']

    assert storage.raw == "512 GB PCIe® Gen4 NVMe™ M.2 SSD"
    assert storage.structured['capacity_gb'] == 512
    assert storage.structured['interface'] == "NVMe"
    assert storage.structured['pcie_version'] == "4"
    assert storage.structured['form_factor'] == "M.2"


def test_hp_reads_the_display():
    display = _hp_specs()['display']

    assert display.raw == (
        '35.6 cm (14") diagonal, 2K (1920 x 1200), IPS, micro-edge, '
        'anti-glare, 300 nits, low power, 62.5% sRGB'
    )
    assert display.structured['size_inches'] == 14.0
    assert display.structured['width_px'] == 1920
    assert display.structured['height_px'] == 1200
    assert display.structured['resolution'] == "1920x1200"
    assert display.structured['panel_type'] == "IPS"
    assert display.structured['brightness_nits'] == 300
    assert display.structured['color_gamut'] == "62.5% sRGB"


def test_hp_reads_the_weight_dimensions_and_battery():
    specs = _hp_specs()

    assert specs['weight'].raw == "1.4 kg"
    assert specs['weight'].structured['weight_kg'] == 1.4

    assert specs['dimensions'].raw == "31.45 x 22.6 x 1.48 cm"
    assert specs['dimensions'].structured['width_mm'] == 314.5
    assert specs['dimensions'].structured['depth_mm'] == 226.0
    assert specs['dimensions'].structured['height_mm'] == 14.8

    assert specs['battery'].raw == "3-cell, 41 Wh Li-ion polymer"
    assert specs['battery'].structured['capacity_wh'] == 41
    assert specs['battery'].structured['cells'] == 3


def test_hp_reads_the_neural_processor_and_the_network():
    specs = _hp_specs()

    assert specs['neural_processor'].raw == "Intel® AI Boost (15 NPU TOPS)"
    assert specs['neural_processor'].structured['npu_tops'] == 15.0

    assert specs['network'].raw == "Realtek Wi-Fi 6 (2x2) and Bluetooth® 5.4 wireless card"
    assert specs['network'].structured['wifi_standard'] == "Wi-Fi 6"
    assert specs['network'].structured['bluetooth_version'] == "5.4"


def test_hp_reads_the_operating_system_and_the_graphics():
    specs = _hp_specs()

    assert specs['os'].raw == "Windows 11 Home Single Language"
    assert specs['os'].structured['operating_system'] == "Windows 11 Home Single Language"
    assert specs['graphics'].raw == "Intel® Graphics"
    assert specs['graphics'].structured['brand'] == "Intel"


def test_hp_keeps_every_published_specification_group():
    specs = _hp_specs()

    # 45 rows, including the groups HP publishes (processor, memory,
    # display, graphics, ports, weights, dimensions, battery, warranty).
    assert len(specs) == 45
    for key in ('processor', 'memory', 'storage', 'display', 'graphics', 'ports',
                'network', 'audio', 'keyboard', 'weight', 'dimensions', 'battery',
                'power_supply', 'camera', 'color', 'warranty', 'security'):
        assert key in specs, f"{key} must be extracted"


def test_hp_skips_boilerplate_rows():
    specs = _hp_specs()

    # Trademark text and the icon URL of the power supply are not
    # specifications.
    assert not any('trademark' in key for key in specs)
    assert 'power_supply_type_icon' not in specs
    assert 'battery_type_footnote_number' not in specs
    # The legal importer information is not a specification either.
    assert not any(key.startswith('product_information') for key in specs)


def test_hp_does_not_depend_on_the_hashed_class_names():
    """Strip every class attribute: the extraction must not change."""
    soup = _hp_soup()
    for element in soup.find_all(True):
        element.attrs.pop('class', None)

    specs = _hp_scraper()._extract_tech_specs(soup)

    assert specs['processor'].raw == (
        "Intel® Core™ 3 304 (up to 4.3 GHz with Intel® Turbo Boost Technology, "
        "6 MB L3 cache, 5 cores, 5 threads)"
    )
    assert specs['memory'].structured['capacity_gb'] == 8
    assert specs['display'].structured['resolution'] == "1920x1200"
    assert specs['weight'].structured['weight_kg'] == 1.4


def test_hp_builds_the_product_from_the_page():
    scraper = _hp_scraper()
    product = asyncio.run(scraper.extract_product(HP_PDP_URL, {'slug': 'laptops'}))

    assert product is not None
    assert product.manufacturer == 'hp'
    assert product.brand == 'HP'
    assert product.name == "HP OmniBook 3 Laptop AI 14-ht0218TU"
    assert product.series == "OmniBook"
    assert product.category.value == "laptops"
    assert product.msrp == 206414.0
    assert product.currency == "INR"

    assert len(product.variants) == 1
    variant = product.variants[0]
    assert variant.sku == "E5SM2PA#ACJ"
    assert variant.name == "E5SM2PA#ACJ"
    assert variant.price == 72999.0
    assert variant.specs['processor'].structured['cores'] == 5
    assert variant.specs['memory'].structured['capacity_gb'] == 8
    assert variant.specs['storage'].structured['capacity_gb'] == 512


def test_hp_links_the_datasheet_it_publishes():
    scraper = _hp_scraper()
    product = asyncio.run(scraper.extract_product(HP_PDP_URL, {'slug': 'laptops'}))

    # The source URLs are canonicalised (lower case, trailing slash).
    assert "https://www8.hp.com/h20195/v2/getpdf.aspx/c09274129/" in product.source_urls


def test_hp_groups_the_configurations_of_one_family():
    """The order code is removed from the slug, so one family is one product."""
    scraper = _hp_scraper()

    assert scraper._family_slug(HP_PDP_URL, "E5SM2PA#ACJ") == "hp-omnibook-3-laptop-ai-14-ht0218tu"
    assert scraper._family_slug(HP_PDP_URL, "E5SM2PA#ACJ") == scraper._family_slug(
        "https://www.hp.com/in-en/shop/products/laptops/"
        "hp-omnibook-3-laptop-ai-14-ht0218tu-e6sm2pa-acj", "E6SM2PA#ACJ"
    )


def test_hp_reads_the_category_and_the_series_from_the_url():
    scraper = _hp_scraper()

    assert scraper.get_category_from_url(HP_PDP_URL).value == "laptops"
    assert scraper.get_category_from_url(
        "https://www.hp.com/in-en/shop/products/monitors/hp-v27-g5-19-inch-monitor"
    ).value == "monitors"
    assert scraper.get_series_from_url(HP_PDP_URL) == "OmniBook"
    assert scraper.get_series_from_url(
        "https://www.hp.com/in-en/shop/products/laptops/omen-gaming-laptop-16-am0076tx-bl2d8pa-acj"
    ) == "OMEN"


def test_hp_recognises_the_store_product_urls():
    scraper = _hp_scraper()

    assert scraper._is_product_url(HP_PDP_URL) is True
    assert scraper._is_product_url("https://www.hp.com/in-en/shop/listings/laptops") is False
    assert scraper._is_product_url("https://www.hp.com/in-en/shop/cart") is False


# =============================================================================
# Apple
# =============================================================================

def test_apple_reads_one_variant_per_published_model():
    variants = _apple_variants()

    # Two model sizes, three models each.
    assert len(variants) == 6
    assert [v.name for v in variants] == [
        "MacBook Air 13-inch Model 1",
        "MacBook Air 13-inch Model 2",
        "MacBook Air 13-inch Model 3",
        "MacBook Air 15-inch Model 1",
        "MacBook Air 15-inch Model 2",
        "MacBook Air 15-inch Model 3",
    ]


def test_apple_links_every_model_to_its_store_configuration():
    variants = _apple_variants()

    assert [v.sku for v in variants] == [
        "macbook-air-13-good",
        "macbook-air-13-better",
        "macbook-air-13-best",
        "macbook-air-15-good",
        "macbook-air-15-better",
        "macbook-air-15-best",
    ]


def test_apple_reads_the_processor_of_every_model():
    variants = {v.name: v for v in _apple_variants()}

    good = variants["MacBook Air 13-inch Model 1"].specs['processor']
    assert good.structured['model'] == "Apple M5"
    assert good.structured['cores'] == 10
    assert good.structured['gpu_cores'] == 8
    assert good.structured['neural_engine_cores'] == 16

    best = variants["MacBook Air 13-inch Model 3"].specs['processor']
    assert best.structured['model'] == "Apple M5"
    assert best.structured['gpu_cores'] == 10


def test_apple_reads_the_memory_and_the_storage_of_every_model():
    variants = {v.name: v for v in _apple_variants()}

    good = variants["MacBook Air 13-inch Model 1"]
    assert good.specs['memory'].structured['capacity_gb'] == 16
    assert good.specs['memory'].structured['type'] == "unified"
    assert good.specs['memory'].structured['configurable_gb'] == [24, 32]
    assert good.specs['storage'].structured['capacity_gb'] == 512
    assert good.specs['storage'].structured['interface'] == "SSD"

    best = variants["MacBook Air 13-inch Model 3"]
    assert best.specs['memory'].structured['capacity_gb'] == 24
    assert best.specs['memory'].structured['configurable_gb'] == [32]
    assert best.specs['storage'].structured['capacity_gb'] == 1024


def test_apple_applies_the_shared_rows_to_every_model():
    variants = {v.name: v for v in _apple_variants()}

    for name in ("MacBook Air 13-inch Model 1", "MacBook Air 13-inch Model 3"):
        display = variants[name].specs['display']
        assert display.structured['size_inches'] == 13.6
        assert display.structured['resolution'] == "2560x1664"
        assert display.structured['panel_type'] == "Liquid Retina"
        assert display.structured['brightness_nits'] == 500

    fifteen = variants["MacBook Air 15-inch Model 1"].specs['display']
    assert fifteen.structured['size_inches'] == 15.3
    assert fifteen.structured['resolution'] == "2880x1864"


def test_apple_reads_the_size_and_the_weight():
    variants = {v.name: v for v in _apple_variants()}

    dimensions = variants["MacBook Air 13-inch Model 1"].specs['dimensions']
    assert dimensions.structured['height_in'] == 0.44
    assert dimensions.structured['width_in'] == 11.97
    assert dimensions.structured['depth_in'] == 8.46
    assert dimensions.structured['weight_lbs'] == 2.7
    assert dimensions.structured['weight_kg'] == 1.225


def test_apple_reads_the_remaining_published_rows():
    variants = {v.name: v for v in _apple_variants()}
    specs = variants["MacBook Air 13-inch Model 1"].specs

    assert specs['os'].raw == "macOS"
    assert specs['network'].structured['wifi_standard'] == "Wi-Fi 7"
    assert specs['network'].structured['bluetooth_version'] == "6"
    assert specs['camera'].structured['megapixels'] == 12
    assert specs['keyboard'].structured['type'] == "Magic Keyboard"
    assert specs['battery'].structured['battery_life_hours'] == 18
    assert specs['color'].structured['colors'] == ["Sky Blue", "Silver", "Starlight", "Midnight"]


def test_apple_skips_the_marketing_rows():
    variants = {v.name: v for v in _apple_variants()}
    specs = variants["MacBook Air 13-inch Model 1"].specs

    assert 'built_in_apps' not in specs
    assert 'in_the_box' not in specs
    assert 'configure_to_order' not in specs
    assert 'price' not in specs
    assert 'macbook_air_and_the_environment' not in specs


def test_apple_reads_the_family_price_from_the_store_page():
    scraper = _apple_scraper(APPLE_BUY_FIXTURE.read_text(encoding='utf-8'))
    soup = BeautifulSoup(APPLE_BUY_FIXTURE.read_text(encoding='utf-8'), 'html.parser')

    json_ld = scraper._extract_json_ld(soup)

    assert json_ld['name'] == "MacBook Air"
    assert json_ld['offers']['lowPrice'] == 1299.0
    assert json_ld['offers']['highPrice'] == 3719.0
    assert json_ld['offers']['priceCurrency'] == "USD"
    assert scraper._extract_product_name(soup, APPLE_BUY_URL, json_ld) == "MacBook Air"


def test_apple_builds_the_product_with_the_price_of_the_family():
    """The AggregateOffer belongs to the family, so it lands on the product."""
    scraper = _apple_scraper()

    class _TwoPageClient:
        def __init__(self):
            self.buy = BeautifulSoup(APPLE_BUY_FIXTURE.read_text(encoding='utf-8'), 'html.parser')
            self.specs = BeautifulSoup(APPLE_SPECS_FIXTURE.read_text(encoding='utf-8'), 'html.parser')

        async def get_soup(self, url: str, **kwargs):
            return self.specs if url.endswith('/specs/') else self.buy

    scraper.http_client = _TwoPageClient()
    product = asyncio.run(scraper.extract_product(
        APPLE_BUY_URL, {'slug': 'macbook-air', 'name': 'macbook-air'}
    ))

    assert product is not None
    assert product.name == "MacBook Air"
    assert product.brand == "Apple"
    assert product.series == "MacBook Air"
    assert product.category.value == "laptops"
    assert product.msrp == 1299.0
    assert product.currency == "USD"
    assert product.metadata['price_range']['high'] == 3719.0

    assert len(product.variants) == 6
    assert product.variants[0].name == "MacBook Air 13-inch Model 1"
    assert product.variants[0].specs['processor'].structured['model'] == "Apple M5"
    assert APPLE_SPECS_URL.rstrip('/') in " ".join(product.source_urls)


def test_apple_derives_the_specs_page_from_the_family_path():
    scraper = _apple_scraper()

    assert scraper._specs_url(APPLE_BUY_URL, {'slug': 'macbook-air'}) == APPLE_SPECS_URL
    assert scraper._specs_url(
        "https://www.apple.com/shop/buy-mac/mac-mini", {'slug': 'mac-mini'}
    ) == "https://www.apple.com/mac-mini/specs/"
    # The YAML path wins over the derived one.
    assert scraper._specs_url(
        "https://www.apple.com/shop/buy-mac/imac", {'slug': 'imac'}
    ) == "https://www.apple.com/imac/specs/"


def test_apple_reads_the_older_specification_layout():
    """Apple marks the Mac mini page differently; it must be read as well."""
    scraper = _apple_scraper(APPLE_MINI_SPECS_FIXTURE.read_text(encoding='utf-8'))
    soup = BeautifulSoup(APPLE_MINI_SPECS_FIXTURE.read_text(encoding='utf-8'), 'html.parser')

    variants = scraper._variants_from_specs(
        soup,
        "https://www.apple.com/mac-mini/specs/",
        "https://www.apple.com/shop/buy-mac/mac-mini",
        "Mac mini",
    )

    assert len(variants) == 4
    assert [v.name for v in variants] == [
        "Mac mini Model 1",
        "Mac mini Model 2",
        "Mac mini Model 3",
        "Mac mini Model 4",
    ]
    assert [v.sku for v in variants] == [
        "mac-mini-specs-1",
        "mac-mini-specs-2",
        "mac-mini-specs-3",
        "mac-mini-specs-4",
    ]

    first = variants[0].specs
    assert first['processor'].structured['model'] == "Apple M6"
    assert first['processor'].structured['cores'] == 12
    assert first['memory'].structured['capacity_gb'] == 16
    assert first['storage'].structured['capacity_gb'] == 256
    assert first['network'].structured['wifi_standard'] == "Wi-Fi 7"
    assert first['dimensions'].structured['height_in'] == 2.0
    assert first['dimensions'].structured['width_in'] == 5.0
    assert first['dimensions'].structured['weight_lbs'] == 1.5
