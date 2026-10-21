"""
Veridian Scraper - Razer official feed (sitemap) implementation.

Razer publishes an XML sitemap index at ``https://www.razer.com/sitemap.xml``.
The child product sitemaps live on ``api-p1.phoenix.razer.com`` and are
explicitly allowed by that host's robots.txt (``Allow: /medias/Product``), so
the product list may be read. Every product URL ends with the part number,
for example ``/gaming-laptops/razer-blade-16/RZ09-05286EN3-R3U1``.

The product page itself renders the specification list of the selected
configuration server side, so the collector reads it from the response. The
complete technical table is fetched by the site's own front end and is not
part of the document; the collector records what the publisher serves and
nothing else.
"""

import html
import re
from typing import Any, AsyncIterator, Dict, List, Optional, Tuple
from urllib.parse import urlparse

from bs4 import BeautifulSoup

from .base import (
    BaseScraper, ScraperConfig, RegionConfig, apply_yaml_config, get_config_manager,
    Product, ProductVariant, ProductCategory, ProductStatus,
    SpecValue, SpecParser,
    generate_product_id, generate_variant_id,
    canonicalize_url, extract_canonical_key,
    clean_text,
)


# The specification labels of the product page, mapped onto the field names
# the rest of Veridian uses.
SPEC_KEY_MAPPING: Dict[str, str] = {
    'processor': 'processor',
    'cpu': 'processor',
    'os': 'operating_system',
    'operating_system': 'operating_system',
    'display': 'display',
    'screen': 'display',
    'graphic': 'graphics',
    'graphics': 'graphics',
    'gpu': 'graphics',
    'memory': 'memory',
    'ram': 'memory',
    'storage': 'storage',
    'ssd': 'storage',
    'battery': 'battery',
    'weight': 'weight',
}


def _slug(value: str) -> str:
    return re.sub(r'[^a-z0-9]+', '_', (value or '').strip().lower()).strip('_')


def parse_sitemap_index(xml_text: str) -> List[str]:
    """The child sitemap URLs of a sitemap index."""
    return [html.unescape(loc).strip() for loc in re.findall(r'<loc>(.*?)</loc>', xml_text, re.S)]


def parse_product_sitemap(xml_text: str) -> List[Dict[str, str]]:
    """The product entries of a product sitemap."""
    entries: List[Dict[str, str]] = []
    for block in re.findall(r'<url>(.*?)</url>', xml_text, re.S):
        loc = re.search(r'<loc>(.*?)</loc>', block, re.S)
        if not loc:
            continue
        url = html.unescape(loc.group(1)).strip()
        lastmod = re.search(r'<lastmod>(.*?)</lastmod>', block, re.S)
        entries.append({
            'url': url,
            'lastmod': html.unescape(lastmod.group(1)).strip() if lastmod else '',
        })
    return entries


def part_number_from_url(url: str) -> str:
    """The part number Razer publishes as the last segment of the URL."""
    path = urlparse(url).path.rstrip('/')
    if not path:
        return ''
    return path.split('/')[-1]


def split_memory_and_storage(value: str) -> Dict[str, str]:
    """Split the combined "RAM & Storage" cell into its two values.

    The publisher writes both values in one cell, separated by a comma. The
    split is only done when the two halves are recognisable, otherwise the
    value is left untouched.
    """
    memory = ''
    storage = ''
    for part in re.split(r'[,;]', value):
        part = part.strip()
        if not part:
            continue
        lowered = part.lower()
        if not memory and 'ram' in lowered:
            memory = part
        elif not storage and ('ssd' in lowered or 'hdd' in lowered or 'storage' in lowered):
            storage = part

    if memory and storage:
        return {'memory': memory, 'storage': storage}
    return {}


def storage_capacity(value: str) -> Optional[int]:
    """The capacity of a published storage value, in GB.

    The shared model reads the number of the first match without converting
    the unit, so "1 TB SSD" would carry a capacity of 1. The capacity is read
    here instead, with the same field name.
    """
    match = re.search(r'(\d+(?:\.\d+)?)\s*(TB|GB)', value or '', re.IGNORECASE)
    if not match:
        return None
    size = float(match.group(1))
    gigabytes = size * 1024 if match.group(2).upper() == 'TB' else size
    return int(gigabytes) if float(gigabytes).is_integer() else gigabytes


def make_spec_value(key: str, value: str, label: str) -> SpecValue:
    """The spec value of one published specification."""
    spec = SpecParser.parse_spec(key, value)

    if key == 'storage' and spec.structured:
        capacity = storage_capacity(value)
        if capacity is not None:
            spec.structured = dict(spec.structured)
            spec.structured['capacity_gb'] = capacity

    spec.source_field = label
    return spec


def parse_product_page(html_text: str) -> Tuple[str, Dict[str, SpecValue]]:
    """The product name and the specifications of a Razer product page.

    The specification list the publisher renders server side is the source of
    the record. A value the publisher does not publish stays absent.
    """
    soup = BeautifulSoup(html_text, 'html.parser')

    name = ''
    heading = soup.select_one('h1.product-name') or soup.select_one('h1')
    if heading is not None:
        parts: List[str] = []
        for node in heading.find_all(string=True):
            parent = node.parent
            if parent is not None and parent.name == 'span':
                label = parent.get_text(strip=True).lower()
                if label.startswith('customize') or label.startswith('buy'):
                    continue
            text = node.strip()
            if text:
                parts.append(text)
        name = clean_text(' '.join(parts))

    specs: Dict[str, SpecValue] = {}
    listing = soup.select_one('ul.current-spec-list')
    if listing is None:
        return name, specs

    for item in listing.select('li'):
        cells = item.find_all('div', recursive=False)
        if len(cells) < 2:
            continue
        label = clean_text(html.unescape(cells[0].get_text(' ', strip=True)))
        value = clean_text(html.unescape(cells[1].get_text(' ', strip=True)))
        if not label or not value:
            continue

        if label.lower().replace(' ', '') in ('ram&storage', 'ramandstorage'):
            parts = split_memory_and_storage(value)
            if parts:
                for key, raw in parts.items():
                    specs[key] = make_spec_value(key, raw, label)
                continue

        key = SPEC_KEY_MAPPING.get(_slug(label), _slug(label))
        key = SpecParser.standardize_field_name(key)
        if not key:
            continue
        specs[key] = make_spec_value(key, value, label)

    return name, specs


class RazerApiScraper(BaseScraper):
    """Razer collector for the official sitemap feed."""

    MANUFACTURER = 'razer'
    BRAND = 'Razer'

    CATEGORY_MAPPING = {
        'gaming-laptops': ProductCategory.LAPTOPS,
        'refurb-laptops': ProductCategory.LAPTOPS,
        'gaming-laptops-skins': ProductCategory.ACCESSORIES,
        'gaming-laptops-accessories': ProductCategory.ACCESSORIES,
        'gaming-mice': ProductCategory.PERIPHERALS,
        'gaming-keyboards': ProductCategory.PERIPHERALS,
        'gaming-headsets': ProductCategory.PERIPHERALS,
        'gaming-chairs': ProductCategory.ACCESSORIES,
        'gaming-monitors': ProductCategory.MONITORS,
    }

    def __init__(self, config: ScraperConfig, region: RegionConfig):
        super().__init__(config, region)

        block = get_config_manager().get_manufacturer_config(config.manufacturer) or {}
        self.feed: Dict[str, Any] = dict(block.get('official_feed') or {})
        self.categories: List[Dict[str, Any]] = list(self.feed.get('categories') or [])
        self._product_sitemap: Optional[str] = None

    # -- configuration helpers ---------------------------------------------

    def _sitemap_index_url(self) -> str:
        return self.feed.get('sitemap_index') or 'https://www.razer.com/sitemap.xml'

    async def _find_product_sitemap(self) -> Optional[str]:
        """The product sitemap of the configured locale."""
        if self._product_sitemap:
            return self._product_sitemap

        pattern = self.feed.get('product_sitemap_pattern') or '/medias/Product-'
        response = await self.http_client.get(self._sitemap_index_url())
        for url in parse_sitemap_index(response.text):
            if pattern in url:
                self._product_sitemap = url
                return url
        return None

    # -- BaseScraper interface ---------------------------------------------

    async def discover_categories(self) -> List[Dict[str, str]]:
        """One category per product path segment of the sitemap."""
        categories: List[Dict[str, str]] = []
        for entry in self.categories:
            segment = entry.get('path_segment') or entry.get('name')
            if not segment:
                continue
            categories.append({
                'name': entry.get('name') or segment,
                'slug': entry.get('slug') or _slug(segment),
                'url': self._sitemap_index_url(),
                'path_segment': segment,
                'category_type': entry.get('category_type'),
            })
        return categories

    async def discover_products(self, category_url: str, category_info: Dict) -> AsyncIterator[str]:
        """The product URLs of one category, read from the product sitemap."""
        sitemap_url = await self._find_product_sitemap()
        if not sitemap_url:
            self.logger.error("The Razer sitemap index publishes no product sitemap")
            return

        response = await self.http_client.get(sitemap_url)
        segment = category_info.get('path_segment') or category_info.get('slug') or ''
        max_products = int(self.feed.get('max_products') or 0)
        collected = 0
        seen: set = set()

        for entry in parse_product_sitemap(response.text):
            url = entry.get('url') or ''
            if not url or url in seen:
                # The sitemap lists a product once per published image, so
                # the same URL appears several times.
                continue
            seen.add(url)

            path = urlparse(url).path
            parts = [part for part in path.split('/') if part]
            # A Razer product URL is /<category>/<product>/<part number>.
            if segment and (not parts or parts[0] != segment):
                continue
            collected += 1
            yield url
            if max_products and collected >= max_products:
                return

    async def extract_product(self, url: str, category_info: Dict) -> Optional[Product]:
        """Read the specification list of one product page."""
        response = await self.http_client.get(url)
        name, specs = parse_product_page(response.text)

        if not specs:
            self.logger.warning("No specifications rendered on %s", url)
            return None

        part_number = part_number_from_url(url)
        if not name:
            slug = urlparse(url).path.rstrip('/').split('/')[-2] if '/' in urlparse(url).path else ''
            name = slug.replace('-', ' ').title()

        canonical_key = extract_canonical_key(url, self.MANUFACTURER)
        variant = ProductVariant(
            variant_id=generate_variant_id(self.MANUFACTURER, canonical_key, part_number or name),
            name=part_number or name,
            sku=part_number,
            specs=specs,
            source_url=url,
            status=ProductStatus.CURRENT,
        )

        return Product(
            product_id=generate_product_id(self.MANUFACTURER, canonical_key),
            canonical_key=canonical_key,
            manufacturer=self.MANUFACTURER,
            brand=self.BRAND,
            name=name,
            category=self.get_category_from_url(url),
            series=category_info.get('path_segment') or '',
            subcategory=category_info.get('slug') or '',
            url=canonicalize_url(url),
            region=self.region.code,
            variants=[variant],
            source_urls=[canonicalize_url(url)],
            metadata={
                'part_number': part_number,
                'source': 'razer-sitemap',
            },
        )

    def get_category_from_url(self, url: str) -> ProductCategory:
        """Map a Razer product URL to a Veridian product category."""
        parts = [part for part in urlparse(url).path.split('/') if part]
        for part in parts:
            if part in self.CATEGORY_MAPPING:
                return self.CATEGORY_MAPPING[part]
        return ProductCategory.UNKNOWN


def create_razer_api_config() -> ScraperConfig:
    """The configuration of the Razer sitemap collector."""
    regions = [
        RegionConfig(
            code='us',
            name='United States',
            base_url='https://www.razer.com/',
            language='en',
            currency='USD',
            rate_limit=0.5,
            timeout=30,
        ),
    ]

    config = ScraperConfig(
        manufacturer='razer_api',
        brand='Razer',
        base_url='https://www.razer.com/',
        regions=regions,
        output_dir='./output',
        max_concurrent=1,
        retry_attempts=3,
        checkpoint_interval=10,
    )

    return apply_yaml_config(config)


async def run_razer_api_scraper(regions: Optional[List[str]] = None):
    """Run the Razer sitemap collector."""
    config = create_razer_api_config()

    target_regions = [r for r in config.regions if not regions or r.code in regions]

    all_products: List[Product] = []
    for region in target_regions:
        scraper = RazerApiScraper(config, region)
        scraper.load_checkpoint()
        products = await scraper.scrape()
        all_products.extend(products)
        print(f"Region {region.code}: {len(products)} products")

    return all_products


if __name__ == '__main__':
    import sys

    asyncio_run = __import__('asyncio').run
    asyncio_run(run_razer_api_scraper(sys.argv[1:] or None))
