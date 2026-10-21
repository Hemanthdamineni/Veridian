"""
Tests for the Samsung and LG product-page extraction.

Both manufacturers are tested against trimmed copies of the pages they
publish, so the assertions are about the values the site actually shows and
not about "the function returned something".

Samsung
    * the specification table is server rendered on the model page and on the
      family comparison page (``table.lineup-compare__table``);
    * the purchasable configurations are read from the schema.org ``Product``
      block and the Next.js payload of the ``/buy/`` pages.

LG
    * the catalogue is published as a schema.org ``ItemList`` on the listing
      page;
    * the specification table is published in the Next.js payload of the
      product page, together with a schema.org ``Product`` block.

Every fixture is a copy of a page that was fetched with the project's own
HTTP client, which enforces robots.txt.
"""

import asyncio
import json
from pathlib import Path

import pytest
from bs4 import BeautifulSoup

from veridian_scraper.scrapers.lg import LGScraper, create_lg_config
from veridian_scraper.scrapers.samsung import SamsungScraper, create_samsung_config

FIXTURES = Path(__file__).parent / 'fixtures'

SAMSUNG_LISTING = FIXTURES / 'samsung_galaxybooks_listing.html'
SAMSUNG_MODEL = FIXTURES / 'samsung_galaxy_book5_pro.html'
SAMSUNG_BOOK5 = FIXTURES / 'samsung_galaxy_book5.html'
SAMSUNG_COMPARE = FIXTURES / 'samsung_galaxy_book_compare.html'
SAMSUNG_BUY = FIXTURES / 'samsung_buy_galaxy_book5.html'
SAMSUNG_BUY_PRO = FIXTURES / 'samsung_buy_galaxy_book5_pro.html'
LG_LISTING = FIXTURES / 'lg_laptops_listing.html'
LG_PDP = FIXTURES / 'lg_gram_16z90s.html'

MAX_FIXTURE_BYTES = 120 * 1024

SAMSUNG_MODEL_URL = (
    "https://www.samsung.com/us/computing/galaxy-books/galaxy-book5-pro/"
)
SAMSUNG_BOOK5_URL = (
    "https://www.samsung.com/us/computing/galaxy-books/galaxy-book5/"
)
SAMSUNG_COMPARE_URL = (
    "https://www.samsung.com/us/computing/galaxy-books/compare/"
)
SAMSUNG_BUY_URL = (
    "https://www.samsung.com/us/computing/galaxy-books/galaxy-book5-series/buy/"
    "galaxy-book5-15-6-intel-core-ultra-7-512gb-silver-sku-np750xhd-kb1us/"
)
LG_PDP_URL = (
    "https://www.lg.com/us/laptops/lg-16z90s-h.adb9u1-gram-laptop"
)


class _FixtureClient:
    """HTTP client stub that serves the saved pages."""

    def __init__(self, pages):
        # {url fragment: html}
        self.pages = pages
        self.requested = []

    async def get_soup(self, url: str, **kwargs) -> BeautifulSoup:
        self.requested.append(url)
        for fragment, html in self.pages.items():
            if fragment in url:
                return BeautifulSoup(html, 'html.parser')
        raise AssertionError(f"unexpected URL requested: {url}")


def _read(path: Path) -> str:
    return path.read_text(encoding='utf-8')


# =============================================================================
# FIXTURES
# =============================================================================

@pytest.mark.parametrize('fixture', [
    SAMSUNG_LISTING, SAMSUNG_MODEL, SAMSUNG_BOOK5, SAMSUNG_COMPARE,
    SAMSUNG_BUY, SAMSUNG_BUY_PRO, LG_LISTING, LG_PDP,
])
def test_fixture_is_present_and_trimmed(fixture):
    assert fixture.exists(), "the trimmed live-page fixture must be committed"
    assert fixture.stat().st_size <= MAX_FIXTURE_BYTES, (
        f"{fixture.name} is {fixture.stat().st_size} bytes, the limit is "
        f"{MAX_FIXTURE_BYTES}"
    )


# =============================================================================
# CONFIGURATION
# =============================================================================

def test_samsung_config_uses_the_region_relative_category_path():
    config = create_samsung_config()
    region = config.regions[0]
    assert region.base_url == 'https://www.samsung.com/us/'
    assert region.category_paths == {'galaxy-book': 'galaxybooks/'}
    # The listing URL must be built from the region base URL and the path.
    assert region.base_url + region.category_paths['galaxy-book'] == (
        'https://www.samsung.com/us/galaxybooks/'
    )
    assert config.user_agent.startswith('VeridianBot/')


def test_lg_config_uses_the_region_relative_category_path():
    config = create_lg_config()
    region = config.regions[0]
    assert region.base_url == 'https://www.lg.com/us/'
    assert region.category_paths == {'laptops': 'laptops/'}
    assert region.base_url + region.category_paths['laptops'] == (
        'https://www.lg.com/us/laptops/'
    )
    assert config.user_agent.startswith('VeridianBot/')


# =============================================================================
# SAMSUNG
# =============================================================================

def _samsung_pages():
    return {
        'galaxybooks': _read(SAMSUNG_LISTING),
        '/compare/': _read(SAMSUNG_COMPARE),
        'galaxy-book5-pro/': _read(SAMSUNG_MODEL),
        'galaxy-book5/': _read(SAMSUNG_BOOK5),
        'np750xhd-kb1us': _read(SAMSUNG_BUY),
        'np940xha-kg2us': _read(SAMSUNG_BUY_PRO),
    }


def _samsung_scraper(pages) -> SamsungScraper:
    config = create_samsung_config()
    scraper = SamsungScraper(config, config.regions[0])
    scraper.http_client = _FixtureClient(pages)
    return scraper


def _samsung_models():
    """Run the discovery step against the saved listing page."""
    scraper = _samsung_scraper({
        'galaxybooks': _read(SAMSUNG_LISTING),
        '/compare/': _read(SAMSUNG_COMPARE),
    })
    category = {
        'name': 'galaxy-book',
        'slug': 'galaxy-book',
        'url': 'https://www.samsung.com/us/galaxybooks/',
    }

    async def run():
        return [url async for url in scraper.discover_products(category['url'], category)]

    return scraper, asyncio.run(run())


def test_samsung_discovers_the_model_pages():
    _scraper, models = _samsung_models()
    assert models, "the listing page must publish the model pages"
    assert 'https://www.samsung.com/us/computing/galaxy-books/galaxy-book5-pro/' in models
    assert 'https://www.samsung.com/us/computing/galaxy-books/galaxy-book5/' in models
    # The comparison page and the buy pages are not models.
    assert not any('/compare/' in url for url in models)
    assert not any('/buy/' in url for url in models)


def test_samsung_attributes_each_configuration_page_to_its_model():
    scraper, _models = _samsung_models()
    buys = scraper._buy_urls
    assert buys, "the listing page must publish the configuration pages"
    # The longest matching model name wins, so the Galaxy Book5 Pro 360
    # configuration is not attributed to the Galaxy Book5 Pro.
    assert 'galaxy-book5-pro-360' in buys
    assert any('np960qha-kg1us' in url for url in buys['galaxy-book5-pro-360'])
    assert all('np960qha-kg1us' not in url for url in buys.get('galaxy-book5-pro', []))
    assert all('np750xhd-kb1us' in url for url in buys.get('galaxy-book5', []))


def _samsung_product(model_url: str = SAMSUNG_MODEL_URL):
    """Extract a Samsung model against the saved pages.

    The discovery step runs first, exactly as it does in a real run: it finds
    the model pages, the configuration pages and the family comparison page.
    """
    scraper = _samsung_scraper(_samsung_pages())
    category = {
        'name': 'galaxy-book',
        'slug': 'galaxy-book',
        'url': 'https://www.samsung.com/us/galaxybooks/',
    }

    async def run():
        models = [url async for url in scraper.discover_products(category['url'], category)]
        assert model_url in models
        return await scraper.extract_product(model_url, {'slug': 'galaxy-book'})

    return asyncio.run(run())


def test_samsung_extracts_the_published_specifications_of_a_model():
    product = _samsung_product()

    assert product.name == 'Galaxy Book5 Pro'
    assert product.manufacturer == 'samsung'
    assert product.brand == 'Samsung'
    assert product.category.value == 'laptops'
    assert product.series == 'Galaxy Book'
    assert product.url == 'https://www.samsung.com/us/computing/galaxy-books/galaxy-book5-pro/'

    specs = product.variants[0].specs

    assert specs['operating_system'].raw == 'Windows 11 Home'

    processor = specs['processor']
    assert processor.structured['brand'] == 'Intel'
    assert processor.structured['model'] == 'Core Ultra 7 Series 2 256V'
    assert processor.confidence == 0.9

    display = specs['display']
    assert display.raw.startswith('14" or 16" 3K Dynamic AMOLED 2X')
    assert display.structured['panel_type'] == 'OLED'

    # The comparison page publishes the row set the model page does not.
    assert specs['processor_speed'].structured == {
        'base_frequency_ghz': 2.2, 'boost_frequency_ghz': 4.8,
    }
    assert specs['graphics'].raw == 'Intel ® Arc ™ 140V GPU (8 GB / 16 GB)'
    assert specs['battery'].structured == {'capacity_wh': 76}
    # The model is published in a 14" and a 16" size, so the cell holds two
    # weights and two sets of dimensions and no single one is claimed.
    weight = specs['weight']
    assert weight.structured is None
    assert weight.is_multi_option is True
    assert weight.options == ['2.7 lbs', '3.4 lbs']

    dimensions = specs['dimensions']
    assert dimensions.structured is None
    assert dimensions.is_multi_option is True
    assert len(dimensions.options) == 2


def test_samsung_splits_the_published_memory_and_storage_configurations():
    product = _samsung_product()
    specs = product.variants[0].specs

    memory = specs['memory']
    assert memory.is_multi_option is True
    assert memory.options == ['16GB RAM', '32GB RAM']
    # The cell lists three configurations, so no single capacity is claimed.
    assert memory.structured is None
    assert memory.confidence == 0.5

    storage = specs['storage']
    assert storage.is_multi_option is True
    assert storage.options == ['512GB SSD', '1TB SSD']


def test_samsung_reads_the_part_number_and_price_of_a_configuration():
    # The Galaxy Book5 is the model the saved configuration page belongs to.
    product = _samsung_product(SAMSUNG_BOOK5_URL)
    variants = product.variants

    assert len(variants) == 1
    variant = variants[0]
    assert variant.sku == 'NP750XHD-KB1US'
    assert variant.price == 1199.99
    assert variant.currency == 'USD'
    assert variant.availability == 'Out of Stock'
    assert variant.source_url == (
        'https://www.samsung.com/us/computing/galaxy-books/galaxy-book5-series/buy/'
        'galaxy-book5-15-6-intel-core-ultra-7-512gb-silver-sku-np750xhd-kb1us/'
    )
    # The configuration page publishes its own memory and storage, which are
    # more precise than the model level cell.
    assert variant.specs['memory'].raw == '16GB (RAM) + 512GB (SSD)'
    assert variant.specs['memory'].structured['capacity_gb'] == 16
    assert variant.specs['storage'].structured['capacity_gb'] == 512
    assert variant.specs['screen_size'].raw == '15.6"'
    # The model level specifications are kept on the configuration as well.
    assert variant.specs['battery'].structured == {'capacity_wh': 61}
    assert variant.specs['weight'].structured == {'weight_lbs': 3.46}


def test_samsung_does_not_take_the_data_of_another_configuration():
    """A configuration page can publish the data of another configuration.

    The Galaxy Book5 Pro 14" configuration page falls back to the default
    configuration of the family (the Galaxy Book5 Pro 360) and publishes its
    part number and its price.  Neither may be attached to the Galaxy Book5
    Pro 14" configuration.
    """
    product = _samsung_product(SAMSUNG_MODEL_URL)
    variant = product.variants[0]

    assert variant.sku == 'NP940XHA-KG2US'
    assert variant.price is None
    assert variant.availability is None
    # The model level specifications are still published for it.
    assert variant.specs['processor'].structured['model'] == 'Core Ultra 7 Series 2 256V'
    assert variant.specs['battery'].structured == {'capacity_wh': 76}


def test_samsung_product_is_reproducible():
    first = _samsung_product()
    second = _samsung_product()
    assert first.product_id == second.product_id
    assert first.canonical_key == second.canonical_key
    assert [v.variant_id for v in first.variants] == [v.variant_id for v in second.variants]
    assert [v.name for v in first.variants] == [v.name for v in second.variants]


# =============================================================================
# LG
# =============================================================================

def _lg_scraper(pages) -> LGScraper:
    config = create_lg_config()
    scraper = LGScraper(config, config.regions[0])
    scraper.http_client = _FixtureClient(pages)
    return scraper


def test_lg_discovers_the_products_from_the_published_item_list():
    scraper = _lg_scraper({'laptops': _read(LG_LISTING)})
    category = {
        'name': 'laptops',
        'slug': 'laptops',
        'url': 'https://www.lg.com/us/laptops/',
    }

    async def run():
        return [url async for url in scraper.discover_products(category['url'], category)]

    urls = asyncio.run(run())
    assert LG_PDP_URL in urls
    assert len(urls) == 48


def _lg_product():
    scraper = _lg_scraper({'16z90s': _read(LG_PDP)})
    return asyncio.run(scraper.extract_product(LG_PDP_URL, {'slug': 'laptops'}))


def test_lg_extracts_the_published_specifications_of_a_product():
    product = _lg_product()

    assert product.name.startswith('LG gram 16 Inch Lightweight Laptop')
    assert product.manufacturer == 'lg'
    assert product.brand == 'LG'
    assert product.category.value == 'laptops'
    assert product.series == 'LG gram'
    assert product.family_id == 'lg-16z90s-h.adb9u1'

    specs = product.variants[0].specs

    processor = specs['processor']
    assert processor.structured['brand'] == 'Intel'
    assert processor.structured['model'] == 'Core Ultra 7 155H'
    assert processor.structured['cores'] == 16
    assert processor.structured['base_frequency_ghz'] == 1.4
    assert processor.structured['boost_frequency_ghz'] == 4.8

    assert specs['memory'].structured['capacity_gb'] == 32
    assert specs['memory'].structured['type'] == 'LPDDR5X'

    storage = specs['storage']
    assert storage.structured['interface'] == 'NVMe'
    assert storage.structured['capacity_gb'] == 2048
    assert storage.structured['form_factor'] == 'M.2'

    assert specs['display'].structured['size_inches'] == 16
    assert specs['display_resolution'].structured['resolution'] == '2560x1600'
    assert specs['display_type'].raw == 'IPS'
    assert specs['graphics'].raw == 'Intel® Arc™ Graphics'

    assert specs['battery'].structured['capacity_wh'] == 77
    assert specs['weight'].structured['weight_lbs'] == 2.78
    assert specs['dimensions'].structured == {
        'width_in': 13.98, 'height_in': 9.54, 'depth_in': 0.70,
    }

    assert specs['operating_system'].raw == 'Windows 11 Home'
    assert specs['network'].raw.startswith('Intel® Wireless-AX211')
    assert specs['network'].structured['wifi_standard'] == 'Wi-Fi 6'
    assert specs['bluetooth_version'].raw == 'BT 5.3'
    assert specs['bluetooth_version'].structured['version'] == '5.3'
    assert specs['ports_usb_c'].raw.startswith('USB 4 Gen3x2 Type C')
    assert specs['ports_hdmi'].raw == 'Yes'
    assert specs['audio'].raw.startswith('HD Audio with Dolby Atmos')
    assert specs['upc'].raw == '195174084274'


def test_lg_reads_the_part_number_price_and_availability():
    product = _lg_product()
    variant = product.variants[0]

    assert variant.sku == '16Z90S-H.ADB9U1'
    assert variant.price == 1799.99
    assert product.msrp == 3149.99
    assert variant.currency == 'USD'
    assert variant.availability == 'Out of Stock'


def test_lg_product_is_reproducible():
    first = _lg_product()
    second = _lg_product()
    assert first.product_id == second.product_id
    assert first.canonical_key == second.canonical_key
    assert [v.variant_id for v in first.variants] == [v.variant_id for v in second.variants]


# =============================================================================
# HONESTY
# =============================================================================

def test_no_specification_is_invented_when_the_page_publishes_none():
    """An empty specification table must produce no specification at all."""
    scraper = _samsung_scraper({'galaxy-book5-pro': '<html><body></body></html>'})
    product = asyncio.run(scraper.extract_product(
        SAMSUNG_MODEL_URL, {'slug': 'galaxy-book'}))
    assert product is not None
    assert product.variants[0].specs == {}
    assert product.variants[0].price is None
    assert product.variants[0].sku == ''


def test_both_manufacturers_keep_the_source_url_of_every_record():
    samsung = _samsung_product()
    assert SAMSUNG_MODEL_URL in samsung.source_urls
    assert samsung.variants[0].source_url in samsung.source_urls

    lg = _lg_product()
    assert LG_PDP_URL in lg.source_urls
