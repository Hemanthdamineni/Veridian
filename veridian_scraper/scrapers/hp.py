"""
Veridian Scraper - HP Scraper Implementation
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


class HPScraper(BaseScraper):
    """HP-specific scraper implementation"""

    CATEGORY_MAPPING = {
        'laptops': ProductCategory.LAPTOPS,
        'desktops': ProductCategory.DESKTOPS,
        'monitors': ProductCategory.MONITORS,
        'printers': ProductCategory.ACCESSORIES,
        'accessories': ProductCategory.ACCESSORIES,
        'workstations': ProductCategory.DESKTOPS,
    }

    SERIES_MAPPING = {
        'pavilion': 'Pavilion',
        'envy': 'Envy',
        'spectre': 'Spectre',
        'omen': 'OMEN',
        'victus': 'Victus',
        'elitebook': 'EliteBook',
        'probook': 'ProBook',
        'zbook': 'ZBook',
        'elitedesk': 'EliteDesk',
        'prodesk': 'ProDesk',
        'chromebook': 'Chromebook',
        'omnibook': 'OmniBook',
    }

    def __init__(self, config: ScraperConfig, region: RegionConfig):
        super().__init__(config, region)

        self.selectors = {
            'product_grid': '.product-grid, .product-list, .product-tiles',
            'product_card': '.product-tile, .product-card, .product-item',
            'product_link': 'a[href*="/products/"]',
            'techspec_link': 'a[href*="/specifications"], a[href*="/specs"]',
            'variant_names': '.variant-name, .model-name, [data-variant]',
            'spec_rows': '.spec-row, .specification-row, tr',
            'spec_name': '.spec-label, .spec-name, th',
            'spec_values': '.spec-value, .spec-data, td',
        }

        if region.selectors:
            self.selectors.update(region.selectors)

    def get_category_from_url(self, url: str) -> ProductCategory:
        """Map URL to product category using keyword matching"""
        url_lower = url.lower()

        # Check for category keywords in URL (check specific categories first)
        if any(kw in url_lower for kw in ['monitor', 'display']):
            return ProductCategory.MONITORS
        elif any(kw in url_lower for kw in ['mouse', 'keyboard', 'headset', 'dock', 'adapter', 'cable', 'case', 'bag']):
            return ProductCategory.ACCESSORIES
        elif any(kw in url_lower for kw in ['printer', 'ink', 'toner', 'printhead', 'designjet']):
            return ProductCategory.ACCESSORIES  # PRINTERS not in enum
        elif any(kw in url_lower for kw in ['elitedesk', 'prodesk', 'pavilion-desktop', 'envy-desktop']):
            return ProductCategory.DESKTOPS
        elif any(kw in url_lower for kw in ['zbook', 'z-desktop', 'z2', 'workstation']):
            return ProductCategory.WORKSTATIONS
        elif any(kw in url_lower for kw in ['probook', 'elitebook', 'pavilion', 'envy', 'spectre', 'victus', 'chromebook', 'omnibook', 'notebook']):
            return ProductCategory.LAPTOPS
        elif 'omen' in url_lower:
            # OMEN could be laptop or monitor - check for monitor keywords first
            if any(kw in url_lower for kw in ['monitor', 'display']):
                return ProductCategory.MONITORS
            return ProductCategory.LAPTOPS

        return ProductCategory.UNKNOWN

    def get_series_from_url(self, url: str) -> str:
        parsed = urlparse(url)
        path_parts = [p for p in parsed.path.strip('/').split('/') if p]

        # Check path parts for series keywords (slug contains series name)
        for part in path_parts:
            part_lower = part.lower()
            for key, value in self.SERIES_MAPPING.items():
                if key in part_lower:
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
                ('laptops', '/laptops/'),
                ('desktops', '/desktops/'),
                ('monitors', '/monitors/'),
                ('printers', '/printers/'),
                ('accessories', '/accessories/'),
                ('workstations', '/workstations/'),
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

        # Use HP's sitemap to find all product URLs
        sitemap_urls = [
            'https://www.hp.com/sitemap-us-en-pdp.xml',  # US English product detail pages
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
                import io
                root = ET.parse(io.StringIO(response.text)).getroot()
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

            for selector in [
                self.selectors['product_link'],
                'a[href*="/products/"]',
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
            'laptops': ['probook', 'elitebook', 'zbook', 'pavilion', 'envy', 'spectre', 'omen', 'victus', 'chromebook', 'omnibook', 'notebook'],
            'desktops': ['elitedesk', 'prodesk', 'pavilion-desktop', 'envy-desktop'],
            'workstations': ['zbook', 'z-desktop', 'z2', 'workstation'],
            'monitors': ['monitor', 'display'],
            'accessories': ['mouse', 'keyboard', 'headset', 'dock', 'adapter', 'cable', 'case', 'bag'],
            'printers': ['printer', 'ink', 'toner', 'printhead', 'designjet'],
        }

        if category_slug in category_keywords:
            return any(kw in url_lower for kw in category_keywords[category_slug])
        return True  # If no specific mapping, include all

    def _is_product_url(self, url: str) -> bool:
        parsed = urlparse(url)
        path = parsed.path.lower()

        # Product URLs contain /pdp/ or /mlp/ or /products/
        has_product = '/pdp/' in path or '/mlp/' in path or '/products/' in path

        # Exclude non-product pages
        exclude_patterns = [
            '/compare', '/review', '/buy', '/support/', '/drivers/',
            '/cart/', '/checkout/', '/account/', '/login/', '/register/',
            '/search/', '/sitemap/', '/xml', '.pdf', '.jpg', '.png',
            '/care-packs/', '/ink--toner', '/paper/',
        ]

        is_excluded = any(pattern in path for pattern in exclude_patterns)

        return has_product and not is_excluded

    async def extract_product(self, url: str, category_info: Dict) -> Optional[Product]:
        self.logger.debug(f"Extracting product: {url}")

        try:
            soup = await self.http_client.get_soup(url)
        except Exception as e:
            self.logger.error(f"Failed to fetch product page {url}: {e}")
            return None

        # Extract data from JSON-LD
        json_ld_data = self._extract_json_ld(soup)

        product_name = json_ld_data.get('name') or self._extract_product_name(soup, url)
        series = self.get_series_from_url(url)
        category = self.get_category_from_url(url)
        subcategory = category_info.get('slug', '')

        # Build variants from JSON-LD data (works for ProductGroup pages)
        variants = self._extract_variants_from_json_ld(json_ld_data, url)

        # Extract specs from JSON-LD
        specs = self._extract_specs_from_json_ld(json_ld_data)

        # If no variants/specs from JSON-LD, try GraphQL PDP API
        if not variants or not specs:
            graphql_specs, graphql_variants = await self._extract_from_graphql_pdp(url)

            if graphql_specs and not specs:
                specs = graphql_specs

            if graphql_variants and not variants:
                variants = graphql_variants

        if not variants:
            variants = [self._create_base_variant(url, product_name)]

        canonical_key = extract_canonical_key(url, 'hp')
        product_id = generate_product_id('hp', canonical_key)

        product = Product(
            product_id=product_id,
            canonical_key=canonical_key,
            manufacturer='hp',
            brand='HP',
            name=product_name,
            category=category,
            series=series,
            subcategory=subcategory,
            url=canonicalize_url(url),
            region=self.region.code,
            variants=variants,
            source_urls=[canonicalize_url(url)],
            msrp=json_ld_data.get('price'),
            currency=json_ld_data.get('currency', 'USD'),
        )

        # Add base product specs to the first variant if no specs found there
        if specs and variants:
            for k, v in specs.items():
                if k not in variants[0].specs:
                    variants[0].specs[k] = v

        return product

    async def _extract_from_graphql_pdp(self, url: str) -> tuple[Dict[str, SpecValue], List[ProductVariant]]:
        """Extract specs and variants from GraphQL PDP API"""
        specs = {}
        variants = []

        try:
            # Build GraphQL PDP URL from product URL
            # Expected format: /us-en/shop/pdp/product-slug
            parsed = urlparse(url)
            path = parsed.path.strip('/')

            # Extract the pdp/... part
            if '/pdp/' in path:
                # Get everything from /pdp/ onwards
                pdp_idx = path.index('/pdp/')
                pdp_slug = path[pdp_idx + 1:]  # Skip leading /
            elif path.startswith('pdp/'):
                pdp_slug = path
            else:
                return specs, variants

            import urllib.parse
            encoded = urllib.parse.quote(pdp_slug, safe='')
            graphql_url = f'https://www.hp.com/us-en/shop/app/api/web/graphql/page/{encoded}/async'

            resp = await self.http_client.get(graphql_url)
            if resp.status_code != 200:
                return specs, variants

            data = resp.json()
            components = data.get('data', {}).get('page', {}).get('pageComponents', {})

            # Extract specs from pdpTechSpecs
            if 'pdpTechSpecs' in components:
                tech_specs = components['pdpTechSpecs']
                specs = self._parse_graphql_tech_specs(tech_specs)

            # Extract catentryId for potential variant extraction
            catentry_id = None
            if 'pdpAccessories' in components:
                catentry_id = components['pdpAccessories'].get('catentryId')

            # If we have catentryId, try to get variants from ConfigureView GraphQL
            if catentry_id:
                graphql_variants = await self._extract_variants_from_configureview(catentry_id)
                variants.extend(graphql_variants)

        except Exception as e:
            self.logger.debug(f"GraphQL PDP extraction failed for {url}: {e}")

        return specs, variants

    def _parse_graphql_tech_specs(self, tech_specs: Dict) -> Dict[str, SpecValue]:
        """Parse GraphQL pdpTechSpecs into SpecValue dict"""
        specs = {}
        technical_specs = tech_specs.get('technical_specifications', [])

        for spec_item in technical_specs:
            name = spec_item.get('name', '')
            values = spec_item.get('value', [])

            if not name or not values:
                continue

            # Extract text value (first value's first element)
            value_text = ''
            if values and isinstance(values, list):
                first_val = values[0]
                if isinstance(first_val, dict) and 'value' in first_val:
                    val_list = first_val['value']
                    if isinstance(val_list, list) and val_list:
                        value_text = val_list[0]

            if value_text:
                # Clean HTML tags
                import re
                value_text = re.sub(r'<[^>]+>', '', value_text)
                value_text = re.sub(r'\s+', ' ', value_text).strip()
                specs[name] = parse_spec_field(name, value_text)

        return specs

    async def _extract_variants_from_configureview(self, catentry_id: str) -> List[ProductVariant]:
        """Extract variant configurations from ConfigureView GraphQL"""
        variants = []

        try:
            # Build ConfigureView GraphQL URL
            import urllib.parse
            config_params = f'langId=-1&storeId=10151&catalogId=10051&catEntryId={catentry_id}&urlLangId=&quantity=1'
            encoded = urllib.parse.quote(config_params, safe='')
            graphql_url = f'https://www.hp.com/us-en/shop/app/api/web/graphql/page/ConfigureView%3F{encoded}/async'

            resp = await self.http_client.get(graphql_url)
            if resp.status_code != 200:
                return variants

            data = resp.json()
            components = data.get('data', {}).get('page', {}).get('pageComponents', {})

            # Parse ConfigureView page components for variant data
            # The actual variant data is in the HTML page, so we may need to fetch the HTML
            # For now, return empty - the HTML parsing method handles this

        except Exception as e:
            self.logger.debug(f"ConfigureView GraphQL extraction failed for catentry {catentry_id}: {e}")

        return variants

    def _extract_json_ld(self, soup: BeautifulSoup) -> Dict:
        """Extract structured data from JSON-LD scripts"""
        import json
        result = {}

        scripts = soup.select('script[type="application/ld+json"]')
        for script in scripts:
            try:
                data = json.loads(script.get_text())
                items = data if isinstance(data, list) else [data]

                # First pass: look for ProductGroup (has variant info and specs)
                product_group = None
                product_item = None

                for item in items:
                    if item.get('@type') == 'ProductGroup':
                        product_group = item
                    elif item.get('@type') == 'Product':
                        product_item = item

                # Prefer ProductGroup for variant data, fall back to Product
                main_item = product_group or product_item

                if main_item:
                    result['name'] = main_item.get('name')
                    result['sku'] = main_item.get('sku') or main_item.get('mpn')
                    result['description'] = main_item.get('description')
                    result['varies_by'] = main_item.get('variesBy', [])
                    result['additional_property'] = main_item.get('additionalProperty', [])
                    result['has_variant'] = main_item.get('hasVariant', [])

                    # Extract price from offers
                    offers = main_item.get('offers')
                    if offers:
                        if isinstance(offers, list):
                            for offer in offers:
                                if offer.get('@type') in ['Offer', 'AggregateOffer']:
                                    if offer.get('price'):
                                        result['price'] = float(offer.get('price'))
                                        result['currency'] = offer.get('priceCurrency', 'USD')
                                        break
                        elif isinstance(offers, dict):
                            if offers.get('price'):
                                result['price'] = float(offers.get('price'))
                                result['currency'] = offers.get('priceCurrency', 'USD')

                    # Extract brand
                    brand = main_item.get('brand')
                    if isinstance(brand, dict):
                        result['brand_name'] = brand.get('name')
                    elif isinstance(brand, str):
                        result['brand_name'] = brand

                    break  # Found product, stop searching
            except Exception as e:
                self.logger.debug(f"Failed to parse JSON-LD: {e}")
                continue

        return result

    def _extract_product_name(self, soup: BeautifulSoup, url: str) -> str:
        selectors = [
            'h1.product-title',
            '.product-name h1',
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

        parsed = urlparse(url)
        slug = parsed.path.strip('/').split('/')[-1]
        return slug.replace('-', ' ').title()

    def _clean_product_name(self, name: str) -> str:
        import re
        name = re.sub(r'\s*[\(\[].*?[\)\]]\s*$', '', name)
        name = re.sub(r'\s*-\s*HP.*$', '', name, flags=re.IGNORECASE)
        name = re.sub(r'\s*\|\s*HP.*$', '', name, flags=re.IGNORECASE)
        return name.strip()

    def _extract_specs_from_json_ld(self, json_ld_data: Dict) -> Dict[str, SpecValue]:
        """Extract specs from JSON-LD additionalProperty"""
        specs = {}
        additional_props = json_ld_data.get('additional_property', [])

        for prop in additional_props:
            name = prop.get('name', '')
            value = prop.get('value', '')
            if name and value:
                specs[name] = parse_spec_field(name, value)

        return specs

    def _extract_variants_from_json_ld(self, json_ld_data: Dict, base_url: str) -> List[ProductVariant]:
        """Extract variants from JSON-LD hasVariant data"""
        variants = []
        has_variants = json_ld_data.get('has_variant', [])
        canonical_key = extract_canonical_key(base_url, 'hp')

        for var_data in has_variants:
            if not isinstance(var_data, dict):
                continue

            variant_name = var_data.get('sku', '').replace('#', ' ').strip()
            if not variant_name:
                variant_name = var_data.get('name', 'Variant')

            # Extract variant-specific specs if available
            variant_specs = {}
            if 'additionalProperty' in var_data:
                for prop in var_data['additionalProperty']:
                    name = prop.get('name', '')
                    value = prop.get('value', '')
                    if name and value:
                        variant_specs[name] = parse_spec_field(name, value)

            variant_url = var_data.get('url', base_url)
            variant_id = generate_variant_id('hp', canonical_key, variant_name)

            variants.append(ProductVariant(
                variant_id=variant_id,
                name=variant_name,
                specs=variant_specs,
                source_url=canonicalize_url(variant_url)
            ))

        return variants

    def _find_techspec_url(self, soup: BeautifulSoup, base_url: str) -> Optional[str]:
        selectors = [
            'a[href*="/specifications"]',
            'a[href*="/specs"]',
            '.specs-link a',
        ]

        for selector in selectors:
            links = soup.select(selector)
            for link in links:
                href = link.get('href')
                if href:
                    full_url = urljoin(base_url, href)
                    if '/specifications' in full_url or '/specs' in full_url:
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
                canonical_key = extract_canonical_key(techspec_url, 'hp')
                variant_id = generate_variant_id('hp', canonical_key, variant_name)
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
            '[data-variant]',
            'th[data-column]',
        ]

        for selector in selectors:
            elems = soup.select(selector)
            for elem in elems:
                name = clean_text(elem.get_text() or elem.get('data-variant', ''))
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
            canonical_key = extract_canonical_key(url, 'hp')
            variant_id = generate_variant_id('hp', canonical_key, variant_name)
            variants.append(ProductVariant(
                variant_id=variant_id,
                name=variant_name,
                specs=specs,
                source_url=url
            ))

        return variants

    def _create_base_variant(self, url: str, product_name: str) -> ProductVariant:
        canonical_key = extract_canonical_key(url, 'hp')
        variant_id = generate_variant_id('hp', canonical_key, "Base")
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


def create_hp_config() -> ScraperConfig:
    """Create HP scraper configuration"""
    regions = [
        RegionConfig(
            code='us',
            name='United States',
            base_url='https://www.hp.com/',
            language='en',
            currency='USD',
            category_paths={
                'laptops': '/us-en/shop/laptops',
                'desktops': '/us-en/shop/desktops',
                'monitors': '/us-en/shop/monitors',
                'printers': '/us-en/shop/printers',
                'accessories': '/us-en/shop/accessories',
                'workstations': '/us-en/shop/workstations',
            },
            rate_limit=0.5,
            timeout=30
        ),
        RegionConfig(
            code='in',
            name='India',
            base_url='https://www.hp.com/',
            language='en',
            currency='INR',
            category_paths={
                'laptops': '/in-en/shop/laptops',
                'desktops': '/in-en/shop/desktops',
                'monitors': '/in-en/shop/monitors',
                'printers': '/in-en/shop/printers',
                'accessories': '/in-en/shop/accessories',
                'workstations': '/in-en/shop/workstations',
            },
            rate_limit=0.5,
            timeout=30
        ),
        RegionConfig(
            code='uk',
            name='United Kingdom',
            base_url='https://www.hp.com/',
            language='en',
            currency='GBP',
            category_paths={
                'laptops': '/uk-en/shop/laptops',
                'desktops': '/uk-en/shop/desktops',
                'monitors': '/uk-en/shop/monitors',
                'printers': '/uk-en/shop/printers',
                'accessories': '/uk-en/shop/accessories',
                'workstations': '/uk-en/shop/workstations',
            },
            rate_limit=0.5,
            timeout=30
        ),
    ]

    return ScraperConfig(
        manufacturer='hp',
        brand='HP',
        base_url='https://www.hp.com/',
        regions=regions,
        output_dir='./output',
        max_concurrent=2,
        retry_attempts=3,
        checkpoint_interval=10
    )


async def run_hp_scraper(regions: List[str] = None):
    """Run HP scraper for specified regions"""
    config = create_hp_config()

    if regions:
        target_regions = [r for r in config.regions if r.code in regions]
    else:
        target_regions = config.regions

    all_products = []

    for region in target_regions:
        scraper = HPScraper(config, region)
        scraper.load_checkpoint()

        products = await scraper.scrape()
        all_products.extend(products)

        from ..models import export_products_json, export_products_csv
        from pathlib import Path
        from datetime import datetime

        output_dir = Path(config.output_dir) / region.code
        output_dir.mkdir(parents=True, exist_ok=True)

        timestamp = datetime.now().strftime('%Y%m%d_%H%M%S')
        export_products_json(products, str(output_dir / f"hp_products_{region.code}_{timestamp}.json"))
        export_products_csv(products, str(output_dir / f"hp_products_{region.code}_{timestamp}.csv"))

        print(f"Region {region.code}: {len(products)} products")

    return all_products


if __name__ == '__main__':
    import sys
    regions = sys.argv[1:] if len(sys.argv) > 1 else None
    asyncio.run(run_hp_scraper(regions))