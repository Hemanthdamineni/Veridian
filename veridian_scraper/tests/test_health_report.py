"""
Tests for the scraper health report.

A scrape that exits 0 proves nothing, so every run has to be measurable: pages
fetched, products and SKUs found, records rejected, failures by kind and the
latency of the pages that were actually parsed.
"""

import json

import pytest

from veridian_scraper.health import (
    HealthCollector,
    RunReport,
    ScraperHealth,
    SkuLedger,
    evaluate_product,
    get_collector,
    reset_collector,
)
from veridian_scraper.models import (
    Product,
    ProductCategory,
    ProductVariant,
    SpecValue,
)


def _product(name: str = "Zenbook UX3407", canonical_key: str = "asus-ux3407") -> Product:
    variant = ProductVariant(
        variant_id="abc123",
        name="UX3407QA",
        sku="UX3407QA",
        specs={"memory": SpecValue(raw="32GB LPDDR5X", structured={"capacity_gb": 32})},
    )
    return Product(
        product_id="p1",
        canonical_key=canonical_key,
        manufacturer="asus",
        brand="ASUS",
        name=name,
        category=ProductCategory.LAPTOPS,
        variants=[variant],
    )


def test_empty_run_is_not_a_success():
    health = ScraperHealth('asus', 'us')
    report = health.build_report()
    assert report.pages_succeeded == 0
    assert report.success is False
    assert report.status == 'failed'


def test_a_run_with_parsed_pages_is_a_success():
    health = ScraperHealth('asus', 'us')
    health.record_page_attempt()
    health.record_page_success(120.0)
    report = health.build_report()
    assert report.success is True
    assert report.status == 'success'
    assert report.average_latency_ms == 120.0


def test_failures_are_counted_by_kind():
    health = ScraperHealth('asus', 'us')
    health.record_page_attempt()
    health.record_page_failure('https://example.com/a', TimeoutError('boom'))
    health.record_parser_failure('https://example.com/b', ValueError('bad markup'))
    report = health.build_report()

    assert report.pages_failed == 2
    assert report.source_failures == 1
    assert report.parser_failures == 1
    assert report.last_failure is not None
    assert report.status == 'failed'


def test_partial_run_is_reported_as_partial():
    health = ScraperHealth('asus', 'us')
    health.record_page_attempt()
    health.record_page_success(100.0)
    health.record_page_attempt()
    health.record_page_failure('https://example.com/a', TimeoutError('boom'))
    report = health.build_report()
    assert report.status == 'partial'
    assert report.success is True


def test_blocked_run_is_not_a_success():
    health = ScraperHealth('lenovo', 'us')
    health.record_blocked('robots.txt returned HTTP 403; refusing to fetch')
    report = health.build_report()
    assert report.blocked_reason is not None
    assert report.status == 'blocked'
    assert report.success is False


def test_products_and_skus_are_recorded(tmp_path):
    ledger = SkuLedger(tmp_path / 'skus.json')
    health = ScraperHealth('asus', 'us', ledger=ledger)

    health.record_product(_product())
    report = health.build_report()

    assert report.products_discovered == 1
    assert report.skus_discovered == 1
    assert report.new_skus == 1
    assert report.updated_skus == 0
    assert report.rejected_records == 0


def test_records_missing_critical_fields_are_counted():
    health = ScraperHealth('asus', 'us')
    product = _product()
    product.name = ''
    health.record_product(product)
    report = health.build_report()

    assert report.missing_critical_fields >= 1
    assert report.rejected_records >= 1


def test_evaluate_product_rejects_impossible_prices():
    product = _product()
    product.msrp = 5_000_000.0
    evaluation = evaluate_product(product)
    assert evaluation.valid is False
    assert evaluation.errors


def test_sku_ledger_distinguishes_new_updated_and_unchanged(tmp_path):
    path = tmp_path / 'skus.json'
    ledger = SkuLedger(path)
    assert ledger.observe('SKU-1', 'hash-a') == 'new'
    assert ledger.observe('SKU-1', 'hash-b') == 'updated'
    assert ledger.observe('SKU-1', 'hash-b') == 'unchanged'
    assert ledger.observe('SKU-2', 'hash-c') == 'new'

    ledger.save()
    reloaded = SkuLedger(path)
    assert reloaded.observe('SKU-1', 'hash-b') == 'unchanged'
    assert reloaded.observe('SKU-2', 'hash-c') == 'unchanged'


def test_collector_merges_the_regions_of_one_manufacturer():
    collector = HealthCollector(output_dir='/tmp/veridian-health-test')

    first = ScraperHealth('asus', 'us')
    first.record_page_attempt()
    first.record_page_success(100.0)
    collector.register(first.build_report())

    second = ScraperHealth('asus', 'in')
    second.record_page_attempt()
    second.record_page_success(300.0)
    collector.register(second.build_report())

    merged = collector.get('asus')
    assert merged is not None
    assert merged.pages_succeeded == 2
    assert merged.average_latency_ms == 200.0


def test_collector_writes_a_json_report_per_manufacturer(tmp_path):
    collector = HealthCollector(output_dir=str(tmp_path))
    health = ScraperHealth('asus', 'us')
    health.record_page_attempt()
    health.record_page_success(50.0)
    collector.register(health.build_report())

    written = collector.write_all()
    assert len(written) == 1
    payload = json.loads(written[0].read_text())
    assert payload['manufacturer'] == 'asus'
    assert payload['pages_succeeded'] == 1
    assert payload['status'] == 'success'


def test_summary_table_lists_every_manufacturer():
    collector = HealthCollector(output_dir='/tmp/veridian-health-test')
    for manufacturer in ('asus', 'lenovo'):
        health = ScraperHealth(manufacturer, 'us')
        health.record_page_attempt()
        health.record_page_success(10.0)
        collector.register(health.build_report())

    table = collector.summary_table()
    assert 'asus' in table
    assert 'lenovo' in table
    assert 'manufacturer' in table


def test_run_report_serialises_every_required_metric():
    report = ScraperHealth('asus', 'us').build_report()
    payload = report.to_dict()
    for key in (
        'pages_discovered', 'pages_attempted', 'pages_succeeded', 'pages_failed',
        'products_discovered', 'skus_discovered', 'new_skus', 'updated_skus',
        'duplicates', 'rejected_records', 'missing_critical_fields',
        'source_failures', 'parser_failures', 'average_latency_ms',
        'last_successful_run', 'last_failure',
    ):
        assert key in payload


def test_base_scraper_produces_a_report(tmp_path, monkeypatch):
    """A scraper run must always leave a report behind."""
    import asyncio

    from veridian_scraper.models import ProductCategory
    from veridian_scraper.scrapers import base as base_module

    class _FakeHTTPClient:
        def __init__(self, config, region, health=None, robots=None):
            self.health = health
            self.region = region

        async def __aenter__(self):
            return self

        async def __aexit__(self, *args):
            return None

        async def get(self, url, **kwargs):
            if self.health is not None:
                self.health.record_page_attempt()
                self.health.record_page_success(42.0)
            return None

        async def get_soup(self, url, **kwargs):
            return await self.get(url, **kwargs)

    monkeypatch.setattr(base_module, 'HTTPClient', _FakeHTTPClient)

    class _DummyScraper(base_module.BaseScraper):
        async def discover_categories(self):
            return [{'name': 'laptops', 'slug': 'laptops', 'url': 'https://example.com/laptops'}]

        async def discover_products(self, category_url, category_info):
            yield 'https://example.com/laptops/zenbook'

        async def extract_product(self, url, category_info):
            await self.http_client.get(url)
            return _product()

        def get_category_from_url(self, url):
            return ProductCategory.LAPTOPS

    config = base_module.ScraperConfig(
        manufacturer='asus',
        brand='ASUS',
        base_url='https://example.com/',
        regions=[base_module.RegionConfig(code='us', name='United States', base_url='https://example.com/')],
        output_dir=str(tmp_path),
    )
    scraper = _DummyScraper(config, config.regions[0])

    reset_collector()
    products = asyncio.run(scraper.scrape())

    assert len(products) == 1
    assert scraper.report is not None
    assert scraper.report.products_discovered == 1
    assert scraper.report.skus_discovered == 1

    report_file = tmp_path / 'health' / 'asus.json'
    assert report_file.exists()
    payload = json.loads(report_file.read_text())
    assert payload['manufacturer'] == 'asus'

    assert get_collector().get('asus') is not None


def test_base_scraper_records_a_blocked_run(tmp_path, monkeypatch):
    """A robots refusal must be recorded as a blocked run, not as success."""
    import asyncio

    from veridian_scraper.models import ProductCategory
    from veridian_scraper.scrapers import base as base_module

    class _BlockingHTTPClient:
        def __init__(self, config, region, health=None, robots=None):
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, *args):
            return None

        async def get(self, url, **kwargs):
            raise base_module.RobotsDisallowedError(f"robots.txt does not permit {url}")

        async def get_soup(self, url, **kwargs):
            return await self.get(url, **kwargs)

    monkeypatch.setattr(base_module, 'HTTPClient', _BlockingHTTPClient)

    class _DummyScraper(base_module.BaseScraper):
        async def discover_categories(self):
            return [{'name': 'laptops', 'slug': 'laptops', 'url': 'https://example.com/laptops'}]

        async def discover_products(self, category_url, category_info):
            yield 'https://example.com/laptops/zenbook'

        async def extract_product(self, url, category_info):
            await self.http_client.get(url)
            return _product()

        def get_category_from_url(self, url):
            return ProductCategory.LAPTOPS

    config = base_module.ScraperConfig(
        manufacturer='lenovo',
        brand='Lenovo',
        base_url='https://example.com/',
        regions=[base_module.RegionConfig(code='us', name='United States', base_url='https://example.com/')],
        output_dir=str(tmp_path),
    )
    scraper = _DummyScraper(config, config.regions[0])

    reset_collector()
    asyncio.run(scraper.scrape())

    assert scraper.report is not None
    assert scraper.report.status == 'blocked'
    assert scraper.report.success is False
    assert 'robots' in (scraper.report.blocked_reason or '').lower()
