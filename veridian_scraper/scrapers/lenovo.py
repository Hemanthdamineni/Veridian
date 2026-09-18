"""
Veridian Scraper - Lenovo Scraper Implementation
"""

import asyncio
import re
import xml.etree.ElementTree as ET
from typing import AsyncIterator, List, Dict, Any, Optional
from urllib.parse import urljoin, urlparse

from bs4 import BeautifulSoup

from .base import (
    BaseScraper, ScraperConfig, RegionConfig,
    Product, ProductVariant, ProductCategory, ProductStatus,
    SpecValue, SpecParser,
    generate_product_id, generate_variant_id,
    canonicalize_url, extract_canonical_key,
    clean_text, parse_spec_field
)


class LenovoScraper(BaseScraper):
    """Lenovo-specific scraper implementation"""

    CATEGORY_MAPPING = {
        'laptops': ProductCategory.LAPTOPS,
        'desktops': ProductCategory.DESKTOPS,
        'workstations': ProductCategory.DESKTOPS,
        'tablets': ProductCategory.TABLETS,
        'monitors': ProductCategory.MONITORS,
        'accessories': ProductCategory.ACCESSORIES,
        'servers': ProductCategory.SERVERS,
    }

    SERIES_MAPPING = {
        'thinkpad': 'ThinkPad',
        'ideapad': 'IdeaPad',
        'legion': 'Legion',
        'yoga': 'Yoga',
        'thinkbook': 'ThinkBook',
        'thinkcentre': 'ThinkCentre',
        'ideacentre': 'IdeaCentre',
        'loq': 'LOQ',
    }

    def __init__(self, config: ScraperConfig, region: RegionConfig):
        super().__init__(config, region)

        self.selectors = {
            'product_grid': '.products-grid, .product-list, .product-tiles',
            'product_card': '.product-tile, .product-card, .product-item',
            'product_link': 'a[href*="/p/"]',
            'techspec_link': 'a[href*="/techspecs"], a[href*="/specifications"], a[data-link="specs"]',
            'variant_names': '.model-name, .variant-title, [data-model]',
            'spec_rows': '.spec-row, .specification-row, tr',
            'spec_name': '.spec-label, .spec-name, th',
            'spec_values': '.spec-value, .spec-data, td',
        }

        if region.selectors:
            self.selectors.update(region.selectors)

    def get_category_from_url(self, url: str) -> ProductCategory:
        parsed = urlparse(url)
        path_parts = [p for p in parsed.path.strip('/').split('/') if p]

        for part in path_parts:
            if part in self.CATEGORY_MAPPING:
                return self.CATEGORY_MAPPING[part]

        # Check query params
        if '/laptops/' in url or 'laptops' in path_parts:
            return ProductCategory.LAPTOPS

        return ProductCategory.UNKNOWN

    def get_series_from_url(self, url: str) -> str:
        parsed = urlparse(url)
        path_parts = [p for p in parsed.path.strip('/').split('/') if p]

        for part in path_parts:
            if part in self.SERIES_MAPPING:
                return self.SERIES_MAPPING[part]

        return ""

    async def discover_categories(self) -> List[Dict[str, str]]:
        categories = []

        if self.region.category_paths:
            for cat_name, cat_path in self.region.category_paths.items():
                categories.append({
                    'name': cat_name,
                    'slug': cat_name,
                    'url': urljoin(self.region.base_url, cat_path),
                    'category_type': self.CATEGORY_MAPPING.get(cat_name, ProductCategory.UNKNOWN)
                })
        else:
            default_categories = [
                ('laptops', '/c/laptops/'),
                ('desktops', '/c/desktops/'),
                ('workstations', '/c/workstations/'),
                ('tablets', '/c/tablets/'),
                ('monitors', '/c/monitors/'),
                ('accessories', '/c/accessories/'),
            ]
            for cat_name, cat_path in default_categories:
                categories.append({
                    'name': cat_name,
                    'slug': cat_name,
                    'url': urljoin(self.region.base_url, cat_path),
                    'category_type': self.CATEGORY_MAPPING.get(cat_name, ProductCategory.UNKNOWN)
                })

        return categories

    async def discover_products(self, category_url: str, category_info: Dict) -> AsyncIterator[str]:
        """Discover products using sitemap for comprehensive coverage"""

        # Use sitemap to find all product URLs
        sitemap_urls = [
            'https://www.lenovo.com/sitemap-auto/089-intsitemap-us-en.xml',  # US English
        ]

        # Add category-specific filtering
        category_slug = category_info.get('slug', '').lower()

        for sitemap_url in sitemap_urls:
            try:
                self.logger.info(f"Fetching sitemap: {sitemap_url}")
                response = await self.http_client.get(sitemap_url)
                if response.status_code != 200:
                    continue

                # Parse XML
                root = ET.fromstring(response.text)
                namespace = {'ns': 'http://www.sitemaps.org/schemas/sitemap/0.9'}

                product_urls = set()
                for url_elem in root.findall('.//ns:url/ns:loc', namespace):
                    url = url_elem.text
                    if url and self._is_product_url(url) and self._matches_category(url, category_slug):
                        product_urls.add(canonicalize_url(url))

                self.logger.info(f"Found {len(product_urls)} product URLs in sitemap for category {category_slug}")

                for url in sorted(product_urls):
                    yield url

            except Exception as e:
                self.logger.error(f"Failed to fetch sitemap {sitemap_url}: {e}")
                continue

        # Fallback: use category page pagination if sitemap fails
        async for url in self._discover_products_pagination(category_url, category_info):
            yield url

    async def _discover_products_pagination(self, category_url: str, category_info: Dict) -> AsyncIterator[str]:
        """Fallback: discover products using pagination"""
        page = 1
        max_pages = 50

        while page <= max_pages:
            if page == 1:
                page_url = category_url
            else:
                separator = '&' if '?' in category_url else '?'
                page_url = f"{category_url}{separator}page={page}"

            try:
                soup = await self.http_client.get_soup(page_url)
            except Exception as e:
                self.logger.error(f"Failed to fetch {page_url}: {e}")
                break

            product_urls = set()

            # Lenovo product URLs typically contain /p/
            for selector in [
                self.selectors['product_link'],
                'a[href*="/p/"]',
                '.product-tile a',
                '.product-card a',
            ]:
                links = soup.select(selector)
                for link in links:
                    href = link.get('href')
                    if href:
                        full_url = urljoin(self.region.base_url, href)
                        if self._is_product_url(full_url):
                            product_urls.add(canonicalize_url(full_url))

            if not product_urls:
                break

            self.logger.debug(f"Found {len(product_urls)} products on page {page}")

            for url in sorted(product_urls):
                yield url

            page += 1
            await asyncio.sleep(0.5)

    def _matches_category(self, url: str, category_slug: str) -> bool:
        """Check if URL matches the category"""
        url_lower = url.lower()
        category_keywords = {
            'laptops': ['/laptops/', '/thinkpad/', '/ideapad/', '/legion/', '/yoga/', '/thinkbook/', '/loq/'],
            'desktops': ['/desktops/', '/thinkcentre/', '/ideacentre/'],
            'workstations': ['/workstations/', '/thinkstation/'],
            'tablets': ['/tablets/', '/tab/'],
            'monitors': ['/monitors/', '/monitor/'],
            'accessories': ['/accessories/', '/accessory/'],
        }

        if category_slug in category_keywords:
            return any(kw in url_lower for kw in category_keywords[category_slug])
        return True  # If no specific mapping, include all

    def _is_product_url(self, url: str) -> bool:
        parsed = urlparse(url)
        path = parsed.path.lower()

        # Product URLs must contain /p/ - that's the actual product page pattern
        has_product = '/p/' in path

        # Exclude non-product pages
        exclude_patterns = [
            '/compare', '/review', '/where-to-buy', '/buy',
            '/accessories/', '/support/', '/affiliate/', '/business/',
            '/c/laptops/', '/c/desktops/', '/c/tablets/', '/c/monitors/',
            '/c/accessories/', '/c/workstations/', '/c/'
        ]

        is_excluded = any(pattern in path for pattern in exclude_patterns)

        # Only allow URLs that have /p/ and are not excluded
        return has_product and not is_excluded

    async def extract_product(self, url: str, category_info: Dict) -> Optional[Product]:
        self.logger.debug(f"Extracting product: {url}")

        try:
            soup = await self.http_client.get_soup(url)
        except Exception as e:
            self.logger.error(f"Failed to fetch product page {url}: {e}")
            return None

        product_name = self._extract_product_name(soup, url)
        series = self.get_series_from_url(url)
        category = self.get_category_from_url(url)
        subcategory = category_info.get('slug', '')

        # Find techspec URL
        techspec_url = self._find_techspec_url(soup, url)

        # Extract variants
        variants = []

        if techspec_url:
            variants = await self._extract_variants_from_techspec(techspec_url)
        else:
            variants = self._extract_variants_from_main(soup, url)

        if not variants:
            variants = [self._create_base_variant(url, product_name)]

        canonical_key = extract_canonical_key(url, 'lenovo')
        product_id = generate_product_id('lenovo', canonical_key)

        product = Product(
            product_id=product_id,
            canonical_key=canonical_key,
            manufacturer='lenovo',
            brand='Lenovo',
            name=product_name,
            category=category,
            series=series,
            subcategory=subcategory,
            url=canonicalize_url(url),
            region=self.region.code,
            variants=variants,
            source_urls=[canonicalize_url(url)]
        )

        if techspec_url:
            product.add_source_url(canonicalize_url(techspec_url))

        return product

    def _extract_product_name(self, soup: BeautifulSoup, url: str) -> str:
        selectors = [
            'h1.product-name',
            '.product-title h1',
            '[data-testid="product-title"]',
            'h1[itemprop="name"]',
            '.product-header h1',
            'h1',
        ]

        for selector in selectors:
            elem = soup.select_one(selector)
            if elem:
                name = clean_text(elem.get_text())
                if name and len(name) > 3:
                    return self._clean_product_name(name)

        # Fallback from URL
        parsed = urlparse(url)
        slug = parsed.path.strip('/').split('/')[-1]
        return slug.replace('-', ' ').title()

    def _clean_product_name(self, name: str) -> str:
        import re
        name = re.sub(r'\s*[\(\[].*?[\)\]]\s*$', '', name)
        name = re.sub(r'\s*-\s*Lenovo.*$', '', name, flags=re.IGNORECASE)
        name = re.sub(r'\s*\|\s*Lenovo.*$', '', name, flags=re.IGNORECASE)
        return name.strip()

    def _find_techspec_url(self, soup: BeautifulSoup, base_url: str) -> Optional[str]:
        selectors = [
            'a[href*="/techspecs"]',
            'a[href*="/specifications"]',
            'a[data-link="specs"]',
            '.specs-link a',
        ]

        for selector in selectors:
            links = soup.select(selector)
            for link in links:
                href = link.get('href')
                if href:
                    full_url = urljoin(base_url, href)
                    if '/techspecs' in full_url or '/specifications' in full_url:
                        return canonicalize_url(full_url)

        # Construct from product URL
        parsed = urlparse(base_url)
        path = parsed.path.rstrip('/')
        if '/p/' in path:
            techspec_url = path.replace('/p/', '/p/') + '/techspecs'
            return urljoin(self.region.base_url, techspec_url)

        return None

    async def _extract_variants_from_techspec(self, techspec_url: str) -> List[ProductVariant]:
        try:
            soup = await self.http_client.get_soup(techspec_url)
        except Exception as e:
            self.logger.error(f"Failed to fetch techspec {techspec_url}: {e}")
            return []

        variants = []
        variant_names = self._extract_variant_names(soup)

        if not variant_names:
            return []

        spec_rows = soup.select(self.selectors['spec_rows'])
        variant_specs = {name: {} for name in variant_names}

        for row in spec_rows:
            spec_name_elem = row.select_one(self.selectors['spec_name'])
            if not spec_name_elem:
                continue

            spec_name = clean_text(spec_name_elem.get_text())
            if not spec_name or spec_name.lower() in ['model', 'color', 'model name']:
                continue

            value_containers = row.select(self.selectors['spec_values'])

            for idx, container in enumerate(value_containers):
                if idx < len(variant_names):
                    variant_name = variant_names[idx]
                    value = clean_text(container.get_text())
                    if value:
                        value = re.sub(r'\s+', ' ', value)
                        variant_specs[variant_name][spec_name] = parse_spec_field(spec_name, value)

        import hashlib
        for variant_name, specs in variant_specs.items():
            if specs:
                canonical_key = extract_canonical_key(techspec_url, 'lenovo')
                variant_id = generate_variant_id('lenovo', canonical_key, variant_name)
                variants.append(ProductVariant(
                    variant_id=variant_id,
                    name=variant_name,
                    specs=specs,
                    source_url=techspec_url
                ))

        return variants

    def _extract_variant_names(self, soup: BeautifulSoup) -> List[str]:
        names = []

        selectors = [
            '.model-name',
            '.variant-title',
            '[data-model]',
            '.ProductSpecs__model',
            'th[data-column]',
        ]

        for selector in selectors:
            elems = soup.select(selector)
            for elem in elems:
                name = clean_text(elem.get_text() or elem.get('data-model', ''))
                if name and name not in names:
                    names.append(name)

        if not names:
            headers = soup.select('th[data-column], thead th')
            for header in headers:
                name = clean_text(header.get_text())
                if name and name.lower() not in ['model', 'color', 'specifications', 'features']:
                    names.append(name)

        return names

    def _extract_variants_from_main(self, soup: BeautifulSoup, url: str) -> List[ProductVariant]:
        variants = []
        variant_names = []

        variant_selectors = [
            '.product-variants select option',
            '.color-options li',
            '.config-options li',
            '[data-variant]',
        ]

        for selector in variant_selectors:
            elems = soup.select(selector)
            for elem in elems:
                name = clean_text(elem.get_text() or elem.get('data-variant', ''))
                if name and name not in variant_names:
                    variant_names.append(name)

        if not variant_names:
            return [self._create_base_variant(url, "")]

        for variant_name in variant_names:
            specs = self._extract_basic_specs(soup)
            canonical_key = extract_canonical_key(url, 'lenovo')
            variant_id = generate_variant_id('lenovo', canonical_key, variant_name)
            variants.append(ProductVariant(
                variant_id=variant_id,
                name=variant_name,
                specs=specs,
                source_url=url
            ))

        return variants

    def _create_base_variant(self, url: str, product_name: str) -> ProductVariant:
        canonical_key = extract_canonical_key(url, 'lenovo')
        variant_id = generate_variant_id('lenovo', canonical_key, "Base")
        return ProductVariant(
            variant_id=variant_id,
            name="Base",
            specs={},
            source_url=url
        )

    def _extract_basic_specs(self, soup: BeautifulSoup) -> Dict[str, SpecValue]:
        specs = {}

        spec_selectors = [
            '.spec-item',
            '.product-specs li',
            '.features li',
            '.specifications li',
            '.key-specs li',
        ]

        for selector in spec_selectors:
            items = soup.select(selector)
            for item in items:
                text = clean_text(item.get_text())
                if ':' in text:
                    parts = text.split(':', 1)
                    if len(parts) == 2:
                        name = clean_text(parts[0])
                        value = clean_text(parts[1])
                        specs[name] = parse_spec_field(name, value)

        return specs


def create_lenovo_config() -> ScraperConfig:
    """Create Lenovo scraper configuration"""
    regions = [
        RegionConfig(
            code='us',
            name='United States',
            base_url='https://www.lenovo.com/us/en/',
            language='en',
            currency='USD',
            category_paths={
                'laptops': '/us/en/laptops/',
                'desktops': '/us/en/desktops/',
                'workstations': '/us/en/workstations/',
                'tablets': '/us/en/tablets/',
                'monitors': '/us/en/monitors/',
                'accessories': '/us/en/accessories/',
            },
            rate_limit=0.5,
            timeout=30
        ),
        RegionConfig(
            code='in',
            name='India',
            base_url='https://www.lenovo.com/in/en/',
            language='en',
            currency='INR',
            category_paths={
                'laptops': '/in/en/laptops/',
                'desktops': '/in/en/desktops/',
                'workstations': '/in/en/workstations/',
                'tablets': '/in/en/tablets/',
                'monitors': '/in/en/monitors/',
                'accessories': '/in/en/accessories/',
            },
            rate_limit=0.5,
            timeout=30
        ),
        RegionConfig(
            code='uk',
            name='United Kingdom',
            base_url='https://www.lenovo.com/gb/en/',
            language='en',
            currency='GBP',
            category_paths={
                'laptops': '/c/laptops/',
                'desktops': '/c/desktops/',
                'workstations': '/c/workstations/',
                'tablets': '/c/tablets/',
                'monitors': '/c/monitors/',
                'accessories': '/c/accessories/',
            },
            rate_limit=0.5,
            timeout=30
        ),
    ]

    return ScraperConfig(
        manufacturer='lenovo',
        brand='Lenovo',
        base_url='https://www.lenovo.com/',
        regions=regions,
        output_dir='./output',
        max_concurrent=2,
        retry_attempts=3,
        checkpoint_interval=10
    )


async def run_lenovo_scraper(regions: List[str] = None):
    """Run Lenovo scraper for specified regions"""
    config = create_lenovo_config()

    if regions:
        target_regions = [r for r in config.regions if r.code in regions]
    else:
        target_regions = config.regions

    all_products = []

    for region in target_regions:
        scraper = LenovoScraper(config, region)
        scraper.load_checkpoint()

        products = await scraper.scrape()
        all_products.extend(products)

        from ..models import export_products_json, export_products_csv
        from pathlib import Path
        from datetime import datetime

        output_dir = Path(config.output_dir) / region.code
        output_dir.mkdir(parents=True, exist_ok=True)

        timestamp = datetime.now().strftime('%Y%m%d_%H%M%S')
        export_products_json(products, str(output_dir / f"lenovo_products_{region.code}_{timestamp}.json"))
        export_products_csv(products, str(output_dir / f"lenovo_products_{region.code}_{timestamp}.csv"))

        print(f"Region {region.code}: {len(products)} products")

    return all_products


if __name__ == '__main__':
    import sys
    regions = sys.argv[1:] if len(sys.argv) > 1 else None
    asyncio.run(run_lenovo_scraper(regions))