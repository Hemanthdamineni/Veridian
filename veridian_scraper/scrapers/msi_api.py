"""
Veridian Scraper - MSI official feed implementation.

VERIFIED 2026-10-21: MSI publishes no reachable official product feed.

``www.msi.com`` answers HTTP 403 (Akamai "Access Denied") to the honest
``VeridianBot`` agent, so its ``robots.txt`` cannot be read. An unreadable
policy is not permission, so the collector refuses the whole host.
``api.msi.com`` publishes an allow-all policy and answers 200 for its
robots.txt, but it serves the login protected "MSI Tool Box" service, which
carries no product data at all.

This module therefore does the honest thing: it probes every official feed
endpoint that was found, records what happened to each one in the health
report, and reports the source as *unavailable* instead of returning an empty
but successful run.
"""

from typing import Any, AsyncIterator, Dict, List, Optional

from .base import (
    BaseScraper, ScraperConfig, RegionConfig, apply_yaml_config, get_config_manager,
    Product, ProductCategory,
)
from .base import RobotsPolicyError


class MsiApiScraper(BaseScraper):
    """Collector for the official MSI feed (currently unavailable)."""

    MANUFACTURER = 'msi'
    BRAND = 'MSI'

    def __init__(self, config: ScraperConfig, region: RegionConfig):
        super().__init__(config, region)

        block = get_config_manager().get_manufacturer_config(config.manufacturer) or {}
        self.feed: Dict[str, Any] = dict(block.get('official_feed') or {})
        self.candidates: List[Dict[str, Any]] = list(self.feed.get('candidates') or [])

    # -- the probe ---------------------------------------------------------

    def _looks_like_a_feed(self, body: str, kind: str) -> str:
        """Is the payload a product feed? Returns the reason when it is not."""
        import json

        if kind == 'json':
            try:
                payload = json.loads(body)
            except ValueError:
                return 'the payload is not JSON'
            if isinstance(payload, dict):
                payload = payload.get('data') or payload.get('products') or payload.get('items')
            if not isinstance(payload, list) or not payload:
                return 'the JSON payload carries no product list'
            return ''

        if kind == 'xml':
            if '<urlset' in body or '<sitemapindex' in body:
                return ''
            return 'the XML payload is not a sitemap'

        return ''

    async def discover_categories(self) -> List[Dict[str, str]]:
        """Probe the official feed endpoints and report what happened.

        The health report ends with the reason the source is unavailable, so
        the fleet records "unavailable" and never "successful with zero rows".
        """
        outcomes: List[str] = []
        blocked = False

        for candidate in self.candidates:
            url = candidate.get('url') or ''
            kind = candidate.get('kind') or ''
            if not url:
                continue

            try:
                response = await self.http_client.get(url)
            except RobotsPolicyError as exc:
                blocked = True
                outcomes.append(f"{url} -> refused by the source policy: {exc}")
                continue
            except Exception as exc:
                outcomes.append(f"{url} -> failed: {type(exc).__name__}: {exc}")
                continue

            problem = self._looks_like_a_feed(response.text, kind)
            if problem:
                outcomes.append(
                    f"{url} -> HTTP {response.status_code}, not a product feed ({problem})"
                )
                continue

            # A usable feed would need an extractor; until one exists the
            # run must not report a success.
            outcomes.append(f"{url} -> HTTP {response.status_code}, looks like a product feed")
            self.logger.warning(
                "MSI now publishes a product feed at %s; the extractor has to be "
                "written before it can be collected.", url
            )

        summary = (
            f"no official product feed is available for msi: "
            + " | ".join(outcomes)
        )
        self.logger.error(summary)

        if blocked and self.health is not None:
            self.health.record_blocked(summary)

        return []

    # -- BaseScraper interface ---------------------------------------------

    async def discover_products(self, category_url: str, category_info: Dict) -> AsyncIterator[str]:
        """No product can be discovered without a feed."""
        return
        yield  # pragma: no cover - makes this an async generator

    async def extract_product(self, url: str, category_info: Dict) -> Optional[Product]:
        """No product can be extracted without a feed."""
        return None

    def get_category_from_url(self, url: str) -> ProductCategory:
        """MSI's product pages mix laptops and desktops."""
        path = url.lower()
        if '/laptop' in path or '/notebook' in path:
            return ProductCategory.LAPTOPS
        if '/desktop' in path or '/monitor' in path:
            return ProductCategory.DESKTOPS
        return ProductCategory.UNKNOWN


def create_msi_api_config() -> ScraperConfig:
    """The configuration of the MSI official feed collector."""
    regions = [
        RegionConfig(
            code='us',
            name='United States',
            base_url='https://www.msi.com/',
            language='en',
            currency='USD',
            rate_limit=0.5,
            timeout=30,
        ),
    ]

    config = ScraperConfig(
        manufacturer='msi_api',
        brand='MSI',
        base_url='https://www.msi.com/',
        regions=regions,
        output_dir='./output',
        max_concurrent=1,
        retry_attempts=3,
        checkpoint_interval=10,
    )

    return apply_yaml_config(config)


async def run_msi_api_scraper(regions: Optional[List[str]] = None):
    """Run the MSI official feed collector."""
    config = create_msi_api_config()

    target_regions = [r for r in config.regions if not regions or r.code in regions]

    all_products: List[Product] = []
    for region in target_regions:
        scraper = MsiApiScraper(config, region)
        scraper.load_checkpoint()
        products = await scraper.scrape()
        all_products.extend(products)
        print(f"Region {region.code}: {len(products)} products")

    return all_products


if __name__ == '__main__':
    import sys

    asyncio_run = __import__('asyncio').run
    asyncio_run(run_msi_api_scraper(sys.argv[1:] or None))
