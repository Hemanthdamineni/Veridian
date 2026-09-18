"""
Veridian Scraper - MSI Scraper Implementation
"""

import asyncio
import re
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


class MsiScraper(BaseScraper):
    """MSI-specific scraper implementation"""

    CATEGORY_MAPPING = {
        'laptops': ProductCategory.LAPTOPS,
        'desktops': ProductCategory.DESKTOPS,
        'monitors': ProductCategory.MONITORS,
        'components': ProductCategory.COMPONENTS,
        'accessories': ProductCategory.ACCESSORIES,
    }

    SERIES_MAPPING = {
        'gf63': 'GF63',
        'gs66': 'GS66',
        'ge76': 'GE76',
        'creator': 'Creator',
        'prestige': 'Prestige',
        'modern': 'Modern',
        'katana': 'Katana',
        'raider': 'Raider',
        'stealth': 'Stealth',
        'vector': 'Vector',
        'crosshair': 'Crosshair',
        'pulse': 'Pulse',
        'sword': 'Sword',
        'cyborg': 'Cyborg',
    }

    def __init__(self, config: ScraperConfig, region: RegionConfig):
        super().__init__(config, region)

        self.selectors = {
            'product_grid': '.product-grid, .product-list',
            'product_card': '.product-item, .product-card',
            'product_link': 'a[href*="/Laptop/"]',
            'techspec_link': 'a[href*="/Specifications"], a[href*="/specs"]',
            'variant_names': '.variant-name, .model-name',
            'spec_rows': '.spec-row, tr',
            'spec_name': '.spec-label, th',
            'spec_values': '.spec-value, td',
        }

        if region.selectors:
            self.selectors.update(region.selectors)

    def get_category_from_url(self, url: str) -> ProductCategory:
        parsed = urlparse(url)
        path_parts = [p for p in parsed.path.strip('/').split('/') if p]

        for part in path_parts:
            if part in self.CATEGORY_MAPPING:
                return self.CATEGORY_MAPPING[part]

        if '/laptop/' in url.lower() or '/laptops/' in url.lower():
            return ProductCategory.LAPTOPS

        return ProductCategory.UNKNOWN

    def get_series_from_url(self, url: str) -> str:
        parsed = urlparse(url)
        path_parts = [p for p in parsed.path.strip('/').split('/') if p]

        for part in path_parts:
            if part in self.SERIES_MAPPING:
                return self.SERIES_MAPPING[part]

        # Try to find in path
        for part in path_parts:
            for key, value in self.SERIES_MAPPING.items():
                if key in part.lower():
                    return value

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
                ('laptops', '/Laptop/'),
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

            for selector in [
                self.selectors['product_link'],
                'a[href*="/Laptop/"]',
                '.product-item a',
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

    def _is_product_url(self, url: str) -> bool:
        parsed = urlparse(url)
        path = parsed.path.lower()

        product_indicators = ['/laptop/', '/laptops/']
        exclude_patterns = ['/compare', '/review', '/buy', '/support/', '/driver/', '/download/']

        has_product = any(indicator in path for indicator in product_indicators)
        is_excluded = any(pattern in path for pattern in exclude_patterns)

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

        techspec_url = self._find_techspec_url(soup, url)

        variants = []

        if techspec_url:
            variants = await self._extract_variants_from_techspec(techspec_url)
        else:
            variants = self._extract_variants_from_main(soup, url)

        if not variants:
            variants = [self._create_base_variant(url, product_name)]

        canonical_key = extract_canonical_key(url, 'msi')
        product_id = generate_product_id('msi', canonical_key)

        product = Product(
            product_id=product_id,
            canonical_key=canonical_key,
            manufacturer='msi',
            brand='MSI',
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
            'h1.product-title',
            '.product-name h1',
            'h1[itemprop="name"]',
            'h1',
        ]

        for selector in selectors:
            elem = soup.select_one(selector)
            if elem:
                name = clean_text(elem.get_text())
                if name and len(name) > 3:
                    return self._clean_product_name(name)

        parsed = urlparse(url)
        slug = parsed.path.strip('/').split('/')[-1]
        return slug.replace('-', ' ').title()

    def _clean_product_name(self, name: str) -> str:
        import re
        name = re.sub(r'\s*[\(\[].*?[\)\]]\s*$', '', name)
        name = re.sub(r'\s*-\s*MSI.*$', '', name, flags=re.IGNORECASE)
        return name.strip()

    def _find_techspec_url(self, soup: BeautifulSoup, base_url: str) -> Optional[str]:
        selectors = [
            'a[href*="/Specifications"]',
            'a[href*="/specs"]',
            '.specs-link a',
        ]

        for selector in selectors:
            links = soup.select(selector)
            for link in links:
                href = link.get('href')
                if href:
                    full_url = urljoin(base_url, href)
                    if '/specifications' in full_url.lower() or '/specs' in full_url.lower():
                        return canonicalize_url(full_url)

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
                variant_id = generate_variant_id(
                    hashlib.md5(f"{techspec_url}{variant_name}".encode()).hexdigest()[:16],
                    variant_name
                )
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
            '.variant-name',
            '.model-name',
            'th[data-column]',
        ]

        for selector in selectors:
            elems = soup.select(selector)
            for elem in elems:
                name = clean_text(elem.get_text() or elem.get('data-variant', ''))
                if name and name not in names:
                    names.append(name)

        return names

    def _extract_variants_from_main(self, soup: BeautifulSoup, url: str) -> List[ProductVariant]:
        variants = []
        variant_names = []

        variant_selectors = [
            '.product-variants select option',
            '.color-options li',
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

        import hashlib
        for variant_name in variant_names:
            specs = self._extract_basic_specs(soup)
            variant_id = generate_variant_id(
                hashlib.md5(f"{url}{variant_name}".encode()).hexdigest()[:16],
                variant_name
            )
            variants.append(ProductVariant(
                variant_id=variant_id,
                name=variant_name,
                specs=specs,
                source_url=url
            ))

        return variants

    def _create_base_variant(self, url: str, product_name: str) -> ProductVariant:
        import hashlib
        variant_id = generate_variant_id(
            hashlib.md5(url.encode()).hexdigest()[:16],
            "Base"
        )
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


def create_msi_config() -> ScraperConfig:
    """Create MSI scraper configuration"""
    regions = [
        RegionConfig(
            code='us',
            name='United States',
            base_url='https://www.msi.com/',
            language='en',
            currency='USD',
            category_paths={
                'laptops': '/Laptop/',
            },
            rate_limit=0.5,
            timeout=30
        ),
    ]

    return ScraperConfig(
        manufacturer='msi',
        brand='MSI',
        base_url='https://www.msi.com/',
        regions=regions,
        output_dir='./output',
        max_concurrent=2,
        retry_attempts=3,
        checkpoint_interval=10
    )


async def run_msi_scraper(regions: List[str] = None):
    config = create_msi_config()

    if regions:
        target_regions = [r for r in config.regions if r.code in regions]
    else:
        target_regions = config.regions

    all_products = []

    for region in target_regions:
        scraper = MsiScraper(config, region)
        scraper.load_checkpoint()

        products = await scraper.scrape()
        all_products.extend(products)

        from ..models import export_products_json, export_products_csv
        from pathlib import Path
        from datetime import datetime

        output_dir = Path(config.output_dir) / region.code
        output_dir.mkdir(parents=True, exist_ok=True)

        timestamp = datetime.now().strftime('%Y%m%d_%H%M%S')
        export_products_json(products, str(output_dir / f"msi_products_{region.code}_{timestamp}.json"))
        export_products_csv(products, str(output_dir / f"msi_products_{region.code}_{timestamp}.csv"))

        print(f"Region {region.code}: {len(products)} products")

    return all_products


if __name__ == '__main__':
    import sys
    regions = sys.argv[1:] if len(sys.argv) > 1 else None
    asyncio.run(run_msi_scraper(regions))