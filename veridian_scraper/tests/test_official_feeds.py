"""
Tests for the official manufacturer data feeds.

Five manufacturers were checked for a feed that is meant to be read: a
sitemap of product URLs, a public JSON API, a downloadable specification file
or an RSS feed. Lenovo (the PSREF JSON API) and Razer (the sitemap feed and
the product pages it points at) publish one. Framework, MSI and Gigabyte do
not, and their collectors have to say so honestly instead of reporting a
successful run with zero rows.

The fixtures in ``fixtures/feed_*.json`` are real responses, truncated where
the response was larger than 120 KB. The tests assert the values the
publisher sent, not merely that the collectors survive a response.
"""

import asyncio
import json
from pathlib import Path

import httpx
import pytest

import veridian_scraper.scrapers.base as base_module
from veridian_scraper.health import reset_collector
from veridian_scraper.models import ProductCategory
from veridian_scraper.scrapers.base import ROBOTS_USER_AGENT
from veridian_scraper.scrapers.framework_api import (
    FrameworkApiScraper,
    create_framework_api_config,
)
from veridian_scraper.scrapers.gigabyte_api import (
    GigabyteApiScraper,
    create_gigabyte_api_config,
)
from veridian_scraper.scrapers.lenovo_api import (
    LenovoApiScraper,
    create_lenovo_api_config,
    parse_search_results,
    parse_spec_payload,
    spec_key,
)
from veridian_scraper.scrapers.msi_api import (
    MsiApiScraper,
    create_msi_api_config,
)
from veridian_scraper.scrapers.razer_api import (
    RazerApiScraper,
    create_razer_api_config,
    parse_product_page,
    parse_product_sitemap,
    parse_sitemap_index,
    part_number_from_url,
    split_memory_and_storage,
)

FIXTURES = Path(__file__).parent / 'fixtures'


def _load(name: str):
    """Read a saved response."""
    return json.loads((FIXTURES / name).read_text(encoding='utf-8'))


# =============================================================================
# HELPERS
# =============================================================================

class _FakeResponse:
    """A response that carries a JSON payload or a text payload."""

    def __init__(self, payload, status_code: int = 200):
        self.status_code = status_code
        self._payload = payload
        if isinstance(payload, str):
            self.text = payload
        else:
            self.text = json.dumps(payload)

    def json(self):
        if isinstance(self._payload, str):
            raise ValueError("the payload is not JSON")
        return self._payload

    def raise_for_status(self) -> None:
        return None


class _FakeRobots:
    async def check(self, url: str) -> None:
        return None


class _FakeRateLimiter:
    async def wait(self) -> None:
        return None


class _FakeClient:
    async def post(self, url, json=None, headers=None):
        return _FakeResponse({'code': 1, 'access_token': 'test-token'})


class _FakeHTTP:
    """An HTTP client that answers from a routing table."""

    def __init__(self, routes):
        self.routes = routes
        self.robots = _FakeRobots()
        self.rate_limiter = _FakeRateLimiter()
        self.client = _FakeClient()
        self.requests = []

    async def get(self, url, headers=None, **kwargs):
        self.requests.append(url)
        for needle, response in self.routes.items():
            if needle in url:
                return response
        raise AssertionError(f"unexpected request: {url}")


def _collect(generator):
    """Drain an async generator into a list."""
    async def _drain():
        return [item async for item in generator]

    return asyncio.run(_drain())


# =============================================================================
# LENOVO - THE PSREF JSON API
# =============================================================================

def test_lenovo_search_feed_yields_products_with_their_part_numbers():
    payload = _load('feed_lenovo_search.json')

    rows = parse_search_results(payload)

    assert len(rows) == 6
    first = rows[0]
    assert first['ProductName'] == 'ThinkPad X13 Detachable Gen 1'
    assert first['ProductKey'] == 'ThinkPad_X13_Detachable_Gen_1'
    assert first['MachineType'] == '21U7 / 21U6'
    assert first['AnnounceDate'] == '2026-07-27'
    assert first['ClassificationName'] == 'Laptops'
    assert first['SearchResultType'] == 'Product'

    # Every laptop row of the feed carries the machine types it covers.
    assert all(row['MachineType'] for row in rows)
    assert [row['MachineType'] for row in rows[1:3]] == ['21XR / 21XS', '22A8 / 22A7']


def test_lenovo_spec_feed_yields_the_published_specifications():
    payload = _load('feed_lenovo_product_specs.json')

    specs, meta = parse_spec_payload(payload)

    assert meta['product_name'] == 'ThinkPad X13 Detachable Gen 1'
    assert meta['classification'] == 'Laptops'

    # The feed publishes the whole specification table of the product.
    assert len(specs) > 50

    assert specs['memory_type'].raw == 'LPDDR5X-7467'
    assert specs['memory_type'].structured == {'type': 'LPDDR5X'}
    assert specs['memory_type'].confidence == 0.9

    assert specs['battery'].structured['capacity_wh'] == 45
    assert specs['battery'].unit == 'Wh'
    assert specs['battery'].raw.startswith('45Wh Rechargeable Li-ion Battery')

    assert specs['display_size'].structured['size_inches'] == 13
    assert specs['display_size'].raw == '13"'

    assert specs['display_resolution'].structured == {
        'width_px': 2880,
        'height_px': 1920,
        'resolution': '2880x1920',
    }

    assert specs['graphics'].structured['brand'] == 'Intel'
    assert specs['graphics'].raw == 'Intel® Graphics'

    assert specs['weight'].structured['weight_kg'] == 0.89
    assert specs['max_memory'].structured['capacity_gb'] == 16
    assert specs['max_memory'].structured['soldered'] is True


def test_lenovo_specifications_with_several_options_keep_every_option():
    payload = _load('feed_lenovo_product_specs.json')

    specs, _ = parse_spec_payload(payload)

    processor = specs['processor_name']
    assert processor.is_multi_option is True
    assert processor.options == ['Core Ultra 5 332', 'Core Ultra 5 335', 'Core Ultra 7 365']
    assert processor.raw.startswith('Core Ultra 5 332;')

    operating_system = specs['operating_system']
    assert operating_system.is_multi_option is True
    assert operating_system.options == [
        'Windows® 11 Pro',
        'Windows® 11 Home',
        'No preload operating system',
    ]


def test_lenovo_specification_labels_use_the_veridian_field_names():
    payload = _load('feed_lenovo_product_specs.json')

    specs, _ = parse_spec_payload(payload)

    for key in (
        'processor', 'processor_name', 'processor_cores', 'graphics', 'battery',
        'weight', 'memory_type', 'max_memory', 'operating_system',
        'display_size', 'display_resolution', 'storage_type_interface',
    ):
        assert key in specs, f"{key} is missing from the extracted specifications"

    # A sub attribute keeps the field it belongs to in its key.
    assert spec_key('Cores', feature='Processor') == 'processor_cores'
    assert spec_key('Memory', feature='Memory') == 'memory'
    assert spec_key('OS', feature='Operating System') == 'operating_system'


def test_lenovo_html_entities_are_decoded_not_rewritten():
    payload = _load('feed_lenovo_product_specs.json')

    specs, _ = parse_spec_payload(payload)

    assert specs['processor_family'].raw == 'Intel Core™ Ultra 5 / 7 Processor (Series 3)'
    assert '&trade;' not in specs['processor_family'].raw


def test_lenovo_scraper_builds_a_product_with_the_part_number():
    search = _load('feed_lenovo_search.json')
    spec_payload = _load('feed_lenovo_product_specs.json')

    config = create_lenovo_api_config()
    scraper = LenovoApiScraper(config, config.regions[0])
    scraper.http_client = _FakeHTTP({
        'Suggest': _FakeResponse(search),
        'LoadSpecData': _FakeResponse(spec_payload),
    })

    categories = asyncio.run(scraper.discover_categories())
    assert [c['name'] for c in categories] == ['ThinkPad', 'Legion', 'Yoga']

    urls = _collect(scraper.discover_products(categories[0]['url'], categories[0]))
    assert urls[0] == 'https://psref.lenovo.com/product/ThinkPad_X13_Detachable_Gen_1'
    assert len(urls) == 6

    product = asyncio.run(scraper.extract_product(urls[0], categories[0]))

    assert product is not None
    assert product.manufacturer == 'lenovo'
    assert product.brand == 'Lenovo'
    assert product.name == 'ThinkPad X13 Detachable Gen 1'
    assert product.category == ProductCategory.LAPTOPS
    assert product.series == 'ThinkPad'
    assert product.metadata['psref_product_key'] == 'ThinkPad_X13_Detachable_Gen_1'
    assert product.metadata['machine_types'] == ['21U7', '21U6']

    assert len(product.variants) == 1
    variant = product.variants[0]
    assert variant.sku == '21U7 / 21U6'
    assert variant.specs['memory_type'].raw == 'LPDDR5X-7467'
    assert variant.specs['battery'].structured['capacity_wh'] == 45
    assert variant.source_url == 'https://psref.lenovo.com/product/ThinkPad_X13_Detachable_Gen_1'


def test_lenovo_a_label_of_another_group_keeps_its_group():
    # The memory of the graphics group is the shared graphics memory, not the
    # memory of the system, so it must not claim the "memory" key.
    assert spec_key('Memory', group='Graphics') == 'graphics_memory'
    assert spec_key('Memory', group='Memory') == 'memory'
    assert spec_key('Max Memory', group='Memory') == 'max_memory'
    assert spec_key('Graphics', group='Graphics') == 'graphics'

    payload = _load('feed_lenovo_product_specs.json')
    specs, _ = parse_spec_payload(payload)
    assert specs['graphics_memory'].raw == 'Shared'
    assert 'memory' not in specs


def test_lenovo_config_describes_the_api_endpoints():
    config = create_lenovo_api_config()

    assert config.manufacturer == 'lenovo_api'
    assert config.base_url == 'https://psref.lenovo.com/'

    block = base_module.get_config_manager().get_manufacturer_config('lenovo_api')
    endpoints = block['official_feed']['endpoints']
    assert endpoints['spec_data'] == '/api/product/Compare/LoadSpecData'
    assert endpoints['search'] == '/api/search/DefinitionFilterAndSearch/Suggest'
    assert block['official_feed']['auth']['path'] == '/api/home/auth/issue'


# =============================================================================
# RAZER - THE SITEMAP FEED
# =============================================================================

def test_razer_sitemap_index_publishes_the_product_sitemap():
    fixture = _load('feed_razer_sitemap.json')

    children = parse_sitemap_index(fixture['sitemap_index_xml'])

    assert len(children) > 50
    product_sitemaps = [url for url in children if '/medias/Product-en-US' in url]
    assert len(product_sitemaps) == 1
    assert product_sitemaps[0] == fixture['product_sitemap_url']
    assert product_sitemaps[0].startswith('https://api-p1.phoenix.razer.com/medias/Product-en-US')


def test_razer_product_sitemap_yields_product_urls_with_part_numbers():
    fixture = _load('feed_razer_sitemap.json')

    entries = parse_product_sitemap(fixture['product_sitemap_xml'])

    assert len(entries) == 20

    laptops = [e for e in entries if '/gaming-laptops/' in e['url']]
    assert len(laptops) == 16
    assert laptops[0]['url'] == 'https://www.razer.com/gaming-laptops/razer-blade-16/RZ09-05286EN3-R3U1'
    assert part_number_from_url(laptops[0]['url']) == 'RZ09-05286EN3-R3U1'
    assert laptops[0]['lastmod'] == '2026-10-19'

    accessory = entries[0]
    assert part_number_from_url(accessory['url']) == 'RC21-01250101-R3M1'


def test_razer_product_page_yields_the_published_specifications():
    fixture = _load('feed_razer_product.json')

    name, specs = parse_product_page(
        fixture['product_name_html'] + fixture['spec_list_html']
    )

    assert name == 'Razer Blade 16'

    assert specs['processor'].raw == 'AMD Ryzen™ AI 9 365'
    assert specs['processor'].structured['brand'] == 'AMD'
    assert specs['operating_system'].raw == 'Windows 11 Home'
    assert specs['display'].raw == '16" QHD+ 240 Hz OLED'
    assert specs['display'].structured['size_inches'] == 16
    assert specs['graphics'].raw == 'GeForce RTX 5070'
    assert specs['graphics'].structured['model'] == 'RTX 5070'

    # The publisher writes the memory and the drive in one cell; they are
    # recorded as the two specifications they are.
    assert specs['memory'].raw == '32 GB 8000 MHz RAM'
    assert specs['memory'].structured['capacity_gb'] == 32
    assert specs['storage'].raw == '1 TB SSD'
    assert specs['storage'].structured['capacity_gb'] == 1024


def test_razer_combined_memory_and_storage_cell_is_split():
    assert split_memory_and_storage('32 GB 8000 MHz RAM,  1 TB SSD') == {
        'memory': '32 GB 8000 MHz RAM',
        'storage': '1 TB SSD',
    }
    # A cell that cannot be split is left alone.
    assert split_memory_and_storage('32 GB 8000 MHz RAM') == {}


def test_razer_scraper_builds_a_product_with_the_part_number():
    sitemap = _load('feed_razer_sitemap.json')
    page = _load('feed_razer_product.json')

    config = create_razer_api_config()
    scraper = RazerApiScraper(config, config.regions[0])
    scraper.http_client = _FakeHTTP({
        'sitemap.xml': _FakeResponse(sitemap['sitemap_index_xml']),
        '/medias/Product-en-US': _FakeResponse(sitemap['product_sitemap_xml']),
        'razer-blade-16': _FakeResponse(
            page['product_name_html'] + page['spec_list_html']
        ),
    })

    categories = asyncio.run(scraper.discover_categories())
    assert [c['name'] for c in categories] == ['gaming-laptops', 'refurb-laptops']

    urls = _collect(scraper.discover_products(categories[0]['url'], categories[0]))
    assert len(urls) == 16
    assert urls[0] == 'https://www.razer.com/gaming-laptops/razer-blade-16/RZ09-05286EN3-R3U1'
    assert all('/gaming-laptops/' in url for url in urls)

    product = asyncio.run(scraper.extract_product(urls[0], categories[0]))

    assert product is not None
    assert product.manufacturer == 'razer'
    assert product.brand == 'Razer'
    assert product.name == 'Razer Blade 16'
    assert product.category == ProductCategory.LAPTOPS
    assert product.metadata['part_number'] == 'RZ09-05286EN3-R3U1'

    variant = product.variants[0]
    assert variant.sku == 'RZ09-05286EN3-R3U1'
    assert variant.specs['processor'].raw == 'AMD Ryzen™ AI 9 365'
    assert variant.specs['memory'].structured['capacity_gb'] == 32
    assert variant.specs['storage'].structured['capacity_gb'] == 1024


def test_razer_config_describes_the_sitemap_feed():
    config = create_razer_api_config()

    assert config.manufacturer == 'razer_api'
    assert config.base_url == 'https://www.razer.com/'

    block = base_module.get_config_manager().get_manufacturer_config('razer_api')
    assert block['official_feed']['kind'] == 'sitemap'
    assert block['official_feed']['sitemap_index'] == 'https://www.razer.com/sitemap.xml'
    assert block['official_feed']['product_sitemap_pattern'] == '/medias/Product-en-US'


# =============================================================================
# FRAMEWORK, MSI AND GIGABYTE - NO READABLE OFFICIAL FEED
# =============================================================================

def _install_transport(monkeypatch, handler):
    """Route every HTTP request of the collector through a mock transport."""

    class _AsyncClient(httpx.AsyncClient):
        def __init__(self, **kwargs):
            kwargs.pop('transport', None)
            super().__init__(transport=httpx.MockTransport(handler), **kwargs)

    monkeypatch.setattr(base_module.httpx, 'AsyncClient', _AsyncClient)


def test_framework_reports_that_no_official_feed_is_available(monkeypatch, tmp_path):
    fixture = _load('feed_framework_robots.json')

    def handler(request: httpx.Request) -> httpx.Response:
        url = str(request.url)
        if url == 'https://frame.work/robots.txt':
            return httpx.Response(fixture['robots_status'], text=fixture['robots_body'])
        if url == 'https://guides.frame.work/robots.txt':
            return httpx.Response(200, text='User-agent: *\nDisallow: /Sales\n')
        if url == 'https://guides.frame.work/sitemap.xml':
            return httpx.Response(404, text='Not found')
        return httpx.Response(403, text=fixture['robots_body'])

    _install_transport(monkeypatch, handler)

    config = create_framework_api_config()
    config.output_dir = str(tmp_path)
    scraper = FrameworkApiScraper(config, config.regions[0])

    reset_collector()
    products = asyncio.run(scraper.scrape())

    assert products == []

    report = scraper.report
    assert report is not None
    assert report.success is False
    assert report.status == 'blocked'
    assert report.pages_succeeded == 0
    assert report.products_discovered == 0
    assert 'no official product feed is available for framework' in report.blocked_reason
    assert 'https://frame.work/products.json' in report.blocked_reason
    assert 'https://guides.frame.work/sitemap.xml' in report.blocked_reason
    # The reason the host was refused is recorded, not hidden.
    assert any('403' in error['message'] for error in report.to_dict()['errors'])
    reset_collector()


def test_msi_reports_that_no_official_feed_is_available(monkeypatch, tmp_path):
    fixture = _load('feed_msi_robots.json')

    def handler(request: httpx.Request) -> httpx.Response:
        url = str(request.url)
        if url == 'https://www.msi.com/robots.txt':
            return httpx.Response(fixture['robots_status'], text=fixture['robots_body'])
        if url == 'https://api.msi.com/robots.txt':
            return httpx.Response(200, text='User-agent: *\nDisallow:\n')
        if url == 'https://api.msi.com/api/products':
            return httpx.Response(404, text='Not found')
        return httpx.Response(403, text=fixture['robots_body'])

    _install_transport(monkeypatch, handler)

    config = create_msi_api_config()
    config.output_dir = str(tmp_path)
    scraper = MsiApiScraper(config, config.regions[0])

    reset_collector()
    products = asyncio.run(scraper.scrape())

    assert products == []

    report = scraper.report
    assert report is not None
    assert report.success is False
    assert report.status == 'blocked'
    assert report.pages_succeeded == 0
    assert report.products_discovered == 0
    assert 'no official product feed is available for msi' in report.blocked_reason
    assert 'https://www.msi.com/sitemap.xml' in report.blocked_reason
    assert 'https://api.msi.com/api/products' in report.blocked_reason
    reset_collector()


def test_gigabyte_reports_that_no_official_feed_is_available(monkeypatch, tmp_path):
    fixture = _load('feed_gigabyte_robots.json')

    def handler(request: httpx.Request) -> httpx.Response:
        url = str(request.url)
        if url == 'https://www.gigabyte.com/robots.txt':
            return httpx.Response(fixture['robots_status'], text=fixture['robots_body'])
        if url == 'https://api.gigabyte.com/robots.txt':
            return httpx.Response(404, text='Not found')
        if url == 'https://api.gigabyte.com/products':
            return httpx.Response(401, text='Unauthorized')
        return httpx.Response(403, text=fixture['robots_body'])

    _install_transport(monkeypatch, handler)

    config = create_gigabyte_api_config()
    config.output_dir = str(tmp_path)
    scraper = GigabyteApiScraper(config, config.regions[0])

    reset_collector()
    products = asyncio.run(scraper.scrape())

    assert products == []

    report = scraper.report
    assert report is not None
    assert report.success is False
    assert report.status == 'blocked'
    assert report.pages_succeeded == 0
    assert report.products_discovered == 0
    assert 'no official product feed is available for gigabyte' in report.blocked_reason
    assert 'https://www.gigabyte.com/sitemap.xml' in report.blocked_reason
    assert 'https://api.gigabyte.com/products' in report.blocked_reason
    reset_collector()


@pytest.mark.parametrize(
    'config_factory,manufacturer',
    [
        (create_framework_api_config, 'framework'),
        (create_msi_api_config, 'msi'),
        (create_gigabyte_api_config, 'gigabyte'),
    ],
)
def test_unavailable_sources_record_the_endpoints_that_were_probed(
    config_factory, manufacturer
):
    config = config_factory()

    block = base_module.get_config_manager().get_manufacturer_config(config.manufacturer)
    feed = block['official_feed']

    assert feed['kind'] == 'unavailable'
    assert feed['status'] == 'unavailable'
    assert feed['reason'].strip()
    assert len(feed['candidates']) >= 3
    for candidate in feed['candidates']:
        assert candidate['url'].startswith('https://')
        assert candidate['kind'] in ('json', 'xml')
        assert candidate['note'].strip()


def test_the_unavailable_sources_use_the_honest_user_agent():
    for factory in (
        create_framework_api_config,
        create_msi_api_config,
        create_gigabyte_api_config,
    ):
        config = factory()
        assert config.user_agent == ROBOTS_USER_AGENT
        assert config.robots_user_agent == ROBOTS_USER_AGENT
