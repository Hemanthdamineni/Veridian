"""
Veridian Scraper - ASUS Scraper Implementation
"""

import asyncio
import hashlib
import re
from datetime import datetime
from typing import AsyncIterator, List, Dict, Any, Optional
from urllib.parse import urljoin, urlparse

from bs4 import BeautifulSoup

from .base import (
    BaseScraper, ScraperConfig, RegionConfig,
    Product, ProductVariant, ProductCategory, ProductStatus,
    SpecValue, SpecParser,
    generate_product_id, generate_variant_id,
    canonicalize_url, extract_canonical_key,
    clean_text, parse_spec_field, extract_price
)


class AsusScraper(BaseScraper):
    """ASUS-specific scraper implementation"""

    # ASUS category mappings
    CATEGORY_MAPPING = {
        'laptops': ProductCategory.LAPTOPS,
        'displays-desktops': ProductCategory.DESKTOPS,
        'monitors': ProductCategory.MONITORS,
        'motherboards-components': ProductCategory.COMPONENTS,
        'networking-iot-servers': ProductCategory.NETWORKING,
        'tablets': ProductCategory.TABLETS,
        'phones': ProductCategory.PHONES,
        'accessories': ProductCategory.ACCESSORIES,
    }

    # Series mappings
    SERIES_MAPPING = {
        'zenbook': 'ZenBook',
        'vivobook': 'VivoBook',
        'rog': 'ROG (Republic of Gamers)',
        'tuf-gaming': 'TUF Gaming',
        'expertbook': 'ExpertBook',
        'chromebook': 'Chromebook',
        'proart': 'ProArt',
        'nucs': 'NUC',
        'mini-pcs': 'Mini PC',
    }

    # Specification key standardization - map ASUS field names to standard keys
    SPEC_KEY_MAPPING = {
        'Operating System': 'os',
        'Processor': 'processor',
        'Graphics': 'graphics',
        'Neural Processor': 'neural_processor',
        'Display': 'display',
        'Screen': 'display',
        'Memory': 'memory',
        'RAM': 'memory',
        'Storage': 'storage',
        'SSD': 'storage',
        'Hard Drive': 'storage',
        'Battery': 'battery',
        'Weight': 'weight',
        'Dimensions': 'dimensions',
        'Dimensions (WxDxH)': 'dimensions',
        'Size': 'dimensions',
        'I/O Ports': 'ports',
        'Ports': 'ports',
        'Network and Communication': 'network',
        'Network': 'network',
        'Wireless': 'network',
        'Bluetooth': 'network',
        'WiFi': 'network',
        'Audio': 'audio',
        'Keyboard & Touchpad': 'keyboard',
        'Keyboard': 'keyboard',
        'Touchpad': 'keyboard',
        'Camera': 'camera',
        'Webcam': 'camera',
        'Expansion Slots (includes used)': 'expansion_slots',
        'Expansion Slots': 'expansion_slots',
        'Dimensions (W x D x H)': 'dimensions',
        'Dimensions (WxDxH)': 'dimensions',
        'Power Supply': 'power_supply',
        'Power': 'power_supply',
        'Charger': 'power_supply',
        'Security': 'security',
        'Color': 'color',
        'Colors': 'color',
        'Model Name': 'model',
        'Model': 'model',
    }

    def __init__(self, config: ScraperConfig, region: RegionConfig):
        super().__init__(config, region)

        # ASUS-specific selectors
        self.selectors = {
            'product_grid': '.ProductList__grid, .products-grid, .product-list',
            'product_card': '.ProductCard, .product-item, .product-card',
            'product_link': 'a[href*="/laptops/"], a[href*="/displays-desktops/"], a[href*="/monitors/"]',
            'techspec_link': 'a[href*="/techspec"], a[href*="specifications"]',
            'variant_names': '.TechSpec__itemName__an9aU .pdName, .TechSpec__modelName, .model-name, .variant-name',
            'spec_rows': '.TechSpec__rowTable__1LR9D, .TechSpec__row, .spec-row, tr.spec-row',
            'spec_name': '.rowTableTitle, .TechSpec__rowTableTitle__3GLj4, .TechSpec__rowTitle, .spec-title, th',
            'spec_values': '.TechSpec__rowTableItems__KYWXp, .TechSpec__rowTableItems, .spec-value, td',
        }

        # Override with region-specific selectors if provided
        if region.selectors:
            self.selectors.update(region.selectors)

    def get_category_from_url(self, url: str) -> ProductCategory:
        """Map ASUS URL to product category"""
        parsed = urlparse(url)
        path_parts = [p for p in parsed.path.strip('/').split('/') if p]

        for part in path_parts:
            if part in self.CATEGORY_MAPPING:
                return self.CATEGORY_MAPPING[part]

        return ProductCategory.UNKNOWN

    def get_series_from_url(self, url: str) -> str:
        """Extract series from ASUS URL"""
        parsed = urlparse(url)
        path_parts = [p for p in parsed.path.strip('/').split('/') if p]

        for part in path_parts:
            if part in self.SERIES_MAPPING:
                return self.SERIES_MAPPING[part]

        return ""

    async def discover_categories(self) -> List[Dict[str, str]]:
        """Discover ASUS product categories from the main navigation"""
        categories = []

        # Use configured category paths or discover from homepage
        if self.region.category_paths:
            for cat_name, cat_path in self.region.category_paths.items():
                categories.append({
                    'name': cat_name,
                    'slug': cat_name,
                    'url': urljoin(self.region.base_url, cat_path),
                    'category_type': self.CATEGORY_MAPPING.get(cat_name, ProductCategory.UNKNOWN)
                })
        else:
            # Default ASUS categories
            default_categories = [
                ('laptops', '/laptops/'),
                ('displays-desktops', '/displays-desktops/'),
                ('monitors', '/monitors/'),
                ('motherboards-components', '/motherboards-components/'),
                ('networking-iot-servers', '/networking-iot-servers/'),
                ('accessories', '/accessories/'),
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
        """Discover product URLs from category listing pages"""
        # Handle pagination
        page = 1
        max_pages = 50  # Safety limit

        # Get the expected category path for filtering
        expected_category_path = category_info.get('slug', '')

        # Track all seen URLs to detect pagination loops
        all_seen_urls = set()

        while page <= max_pages:
            # Build page URL
            if page == 1:
                page_url = category_url
            else:
                separator = '&' if '?' in category_url else '?'
                page_url = f"{category_url}{separator}page={page}"

            self.logger.debug(f"Fetching page {page}: {page_url}")

            try:
                soup = await self.http_client.get_soup(page_url)
            except Exception as e:
                self.logger.error(f"Failed to fetch {page_url}: {e}")
                break

            # Find product links
            product_urls = set()

            # Try multiple selector strategies
            for selector in [
                self.selectors['product_link'],
                'a[href*="/laptops/"]',
                'a[href*="/displays-desktops/"]',
                'a[href*="/monitors/"]',
                '.ProductCard a',
                '.product-item a',
            ]:
                links = soup.select(selector)
                for link in links:
                    href = link.get('href')
                    if href:
                        full_url = urljoin(self.region.base_url, href)
                        # Filter for product detail pages (not listing pages)
                        if self._is_product_url(full_url):
                            # Also filter by category to avoid cross-category duplicates
                            if self._is_url_in_category(full_url, expected_category_path):
                                product_urls.add(canonicalize_url(full_url))

            if not product_urls:
                self.logger.debug(f"No products found on page {page}, stopping pagination")
                break

            # Check for pagination loop - if all URLs on this page were already seen, stop
            new_urls = product_urls - all_seen_urls
            if not new_urls:
                self.logger.debug(f"All products on page {page} already seen, stopping pagination")
                break

            all_seen_urls.update(new_urls)
            self.logger.debug(f"Found {len(new_urls)} new products on page {page} (total: {len(all_seen_urls)})")

            for url in sorted(new_urls):
                yield url

            page += 1
            await asyncio.sleep(0.5)  # Be polite

    def _is_url_in_category(self, url: str, category: str) -> bool:
        """Check if a product URL belongs to the expected category"""
        if not category:
            return True
        parsed = urlparse(url)
        path = parsed.path.lower()

        # Map category slugs to expected path patterns
        category_paths = {
            'laptops': '/laptops/',
            'displays-desktops': '/displays-desktops/',
            'monitors': '/monitors/',
            'motherboards-components': '/motherboards-components/',
            'networking-iot-servers': '/networking-iot-servers/',
            'accessories': '/accessories/',
        }

        expected_path = category_paths.get(category, f'/{category}/')
        return expected_path in path

    def _is_product_url(self, url: str) -> bool:
        """Check if URL is a product detail page"""
        parsed = urlparse(url)
        path = parsed.path.lower()

        # Must contain product identifiers (ASUS product URLs typically end with product slug)
        product_indicators = [
            '/asus-', '/rog-', '/tuf-', '/zenbook', '/vivobook',
            '/expertbook', '/chromebook', '/proart', '/nuc-'
        ]

        # Exclude listing/filter pages - be more specific about what to exclude
        # Category/series landing pages typically END with these patterns
        # Product URLs contain model numbers at the end
        exclude_exact = [
            '/techspec', '/specification', '/compare', '/review',
            '/where-to-buy', '/buy', '/shop', '/filter', '/sort',
            '/series', '/category', '/page=', '?page=',
            '/all-series', '/all-products', '/overview',
        ]

        # Series/category landing pages (not individual products) - check if path ENDS with these
        exclude_endswith = [
            '/rog-zephyrus/', '/rog-flow/', '/rog-strix/', '/rog-phone/',
            '/tuf-gaming/', '/vivobook/', '/zenbook/', '/expertbook/',
            '/chromebook/', '/proart/', '/nucs/', '/mini-pcs/',
            '/mini-pcs/', '/tower-pcs/', '/nuc-mini-pcs/',
            # Sub-category landing pages
            '/for-gaming/', '/for-home/', '/for-work/', '/for-creators/',
        ]

        # Check if URL has product-like structure (ends with product slug, not category)
        # Product URLs typically have 4+ path segments and end with a product-specific slug
        path_parts = [p for p in path.strip('/').split('/') if p]

        has_product = any(indicator in path for indicator in product_indicators)

        # Check exact exclusions
        is_excluded = any(pattern in path for pattern in exclude_exact)

        # Check endswith exclusions (for category landing pages)
        if not is_excluded:
            for pattern in exclude_endswith:
                if path.endswith(pattern):
                    is_excluded = True
                    break

        # Additional check: product URLs should have depth >= 3 and end with product-specific slug
        is_product_depth = len(path_parts) >= 3
        # The last part should be a product slug (contains model-like patterns)
        is_product_slug = False
        if path_parts:
            last_part = path_parts[-1]
            # Product slugs typically contain hyphens and model numbers
            is_product_slug = (
                '-' in last_part and
                len(last_part) > 10 and
                (any(c.isdigit() for c in last_part) or 'proart' in last_part or 'zenbook' in last_part or 'vivobook' in last_part or 'expertbook' in last_part or 'rog-' in last_part or 'tuf-' in last_part)
            )

        return has_product and not is_excluded and is_product_depth and is_product_slug

    async def extract_product(self, url: str, category_info: Dict) -> Optional[Product]:
        """Extract full product data from ASUS product page"""
        self.logger.debug(f"Extracting product: {url}")

        try:
            soup = await self.http_client.get_soup(url)
        except Exception as e:
            self.logger.error(f"Failed to fetch product page {url}: {e}")
            return None

        # Extract basic info
        product_name = self._extract_product_name(soup, url)
        series = self.get_series_from_url(url)
        category = self.get_category_from_url(url)
        subcategory = category_info.get('slug', '')

        # Find techspec URL
        techspec_url = self._find_techspec_url(soup, url)

        # Extract variants from techspec page or main page
        variants = []

        if techspec_url:
            variants = await self._extract_variants_from_techspec(techspec_url, url)
        else:
            variants = self._extract_variants_from_main(soup, url)

        if not variants:
            self.logger.warning(f"No variants found for {url}")
            # Create a base variant
            variants = [self._create_base_variant(url, product_name)]

        # Extract additional product info from main page
        msrp, currency_from_price = self._extract_msrp(soup)
        launch_date = self._extract_launch_date(soup)
        availability = self._extract_availability(soup)
        status = self._determine_status(soup, url)
        family_id = self._generate_family_id(url, product_name)

        # Create product
        canonical_key = extract_canonical_key(url, 'asus')
        product_id = generate_product_id('asus', canonical_key)

        product = Product(
            product_id=product_id,
            canonical_key=canonical_key,
            manufacturer='asus',
            brand='ASUS',
            name=product_name,
            category=category,
            series=series,
            subcategory=subcategory,
            url=canonicalize_url(url),
            region=self.region.code,
            variants=variants,
            source_urls=[canonicalize_url(url)],
            msrp=msrp,
            currency=currency_from_price or self.region.currency,
            launch_date=launch_date,
            availability=availability,
            status=status,
            family_id=family_id
        )

        if techspec_url:
            product.add_source_url(canonicalize_url(techspec_url))

        return product

    def _extract_product_name(self, soup: BeautifulSoup, url: str) -> str:
        """Extract product name from page"""
        # Try multiple selectors
        selectors = [
            'h1.product-title',
            '.ProductHero__title h1',
            '.product-name h1',
            'h1[itemprop="name"]',
            '.page-title h1',
            'h1',
        ]

        for selector in selectors:
            elem = soup.select_one(selector)
            if elem:
                name = clean_text(elem.get_text())
                if name and len(name) > 3:
                    return self._clean_product_name(name)

        # Fallback: extract from URL
        parsed = urlparse(url)
        slug = parsed.path.strip('/').split('/')[-1]
        return slug.replace('asus-', '').replace('-', ' ').title()

    def _clean_product_name(self, name: str) -> str:
        """Clean product name from website formatting"""
        import re
        # Remove common suffixes
        name = re.sub(r'\s*[\(\[].*?[\)\]]\s*$', '', name)
        name = re.sub(r'\s*-\s*ASUS.*$', '', name, flags=re.IGNORECASE)
        name = re.sub(r'\s*\|\s*ASUS.*$', '', name, flags=re.IGNORECASE)
        name = re.sub(r'\s*-\s*Laptops.*$', '', name, flags=re.IGNORECASE)
        return name.strip()

    def _find_techspec_url(self, soup: BeautifulSoup, base_url: str) -> Optional[str]:
        """Find the techspec/specifications page URL"""
        # Try direct link
        selectors = [
            'a[href*="/techspec"]',
            'a[href*="/specifications"]',
            'a[href*="/specs"]',
            '.TechSpec a',
            '.specs-link a',
            'a:contains("Spec")',
            'a:contains("Tech Spec")',
        ]

        for selector in selectors:
            links = soup.select(selector)
            for link in links:
                href = link.get('href')
                if href:
                    full_url = urljoin(base_url, href)
                    if '/techspec' in full_url or '/specifications' in full_url or '/specs' in full_url:
                        return canonicalize_url(full_url)

        # Try to construct techspec URL from product URL
        parsed = urlparse(base_url)
        path = parsed.path.rstrip('/')
        if not path.endswith('/techspec'):
            techspec_url = f"{path}/techspec/"
            return urljoin(self.region.base_url, techspec_url)

        return None

    def _extract_variant_names(self, soup: BeautifulSoup) -> List[str]:
        """Extract variant/model names from techspec page header"""
        names = []

        # Try new ASUS selectors first
        selectors = [
            '.TechSpec__itemName__an9aU .pdName',
            '.TechSpec__modelName',
            '.model-name',
            '.variant-name',
            '[data-model-name]',
            '.ProductSpecs__model',
            'th[data-column]',
        ]

        for selector in selectors:
            elems = soup.select(selector)
            for elem in elems:
                name = clean_text(elem.get_text() or elem.get('data-model-name', ''))
                if name and name not in names:
                    names.append(name)

        # If no names found, try to extract from table headers
        if not names:
            headers = soup.select('th[data-column], thead th')
            for header in headers:
                name = clean_text(header.get_text())
                if name and name not in ['Model', 'Color', 'Specifications', 'Features']:
                    names.append(name)

        return names

    async def _extract_variants_from_techspec(self, techspec_url: str, product_url: str) -> List[ProductVariant]:
        """Extract variants from techspec page"""
        try:
            soup = await self.http_client.get_soup(techspec_url)
        except Exception as e:
            self.logger.error(f"Failed to fetch techspec {techspec_url}: {e}")
            return []

        variants = []

        # Extract variant names from header
        variant_names = self._extract_variant_names(soup)

        if not variant_names:
            return []

        # Extract spec rows
        spec_rows = soup.select(self.selectors['spec_rows'])

        # Build specs for each variant
        variant_specs = {name: {} for name in variant_names}

        for row in spec_rows:
            spec_name_elem = row.select_one(self.selectors['spec_name'])
            if not spec_name_elem:
                continue

            spec_name = clean_text(spec_name_elem.get_text())
            if not spec_name or spec_name in ['Model', 'Color', 'Model Name']:
                continue

            # Standardize spec key
            standard_key = self.SPEC_KEY_MAPPING.get(spec_name, spec_name.lower().replace(' ', '_').replace('-', '_').replace('/', '_').replace('(', '').replace(')', ''))
            # Use the standardized key for storage, but keep original as source_field

            # Skip boilerplate/disclaimer fields
            if spec_name in ['Disclaimer', 'Exclusive Subscription Offers', 'Microsoft Office',
                            'Xbox Game Pass', 'Built-in Apps', 'MyASUS Features', 'Military Grade',
                            'Ecolabels & Compliances', 'Included in the Box']:
                continue

            # Get value containers for each variant
            value_containers = row.select(self.selectors['spec_values'])

            for idx, container in enumerate(value_containers):
                if idx < len(variant_names):
                    variant_name = variant_names[idx]
                    value = clean_text(container.get_text())
                    if value:
                        # Normalize whitespace
                        value = re.sub(r'\s+', ' ', value)
                        # Parse into structured SpecValue with multi-option handling
                        # Pass standard_key to _parse_spec_field_enhanced so it can use the right extraction rules
                        variant_specs[variant_name][standard_key] = self._parse_spec_field_enhanced(standard_key, value, source_field=spec_name)

        # Create ProductVariant objects
        for variant_name, specs in variant_specs.items():
            if specs:
                # Generate canonical key from product URL for variant ID
                canonical_key = extract_canonical_key(product_url, 'asus')
                variant_id = generate_variant_id('asus', canonical_key, variant_name)
                variants.append(ProductVariant(
                    variant_id=variant_id,
                    name=variant_name,
                    specs=specs,
                    source_url=techspec_url
                ))

        return variants

    def _parse_spec_field_enhanced(self, field_name: str, raw_value: str, source_field: str = None) -> SpecValue:
        """Enhanced spec field parsing with better multi-option handling for ASUS techspec pages"""
        import re
        from ..models import SpecValue

        if not raw_value or not raw_value.strip():
            return SpecValue(raw=raw_value, confidence=0.0)

        value = raw_value.strip()
        field_lower = field_name.lower().replace(' ', '_').replace('-', '_')

        # Split multi-option values
        options = self._split_multi_option(value, field_lower)
        is_multi = len(options) > 1

        # Parse structured data for primary option
        primary_value = options[0] if options else value
        structured = self._extract_structured(primary_value, field_lower)

        # Debug logging
        self.logger.debug(f"Field: {field_name}, primary: {primary_value[:100]}, structured: {structured}")

        # Get unit
        unit = self._extract_unit(primary_value, field_lower)

        return SpecValue(
            raw=value,
            structured=structured if structured else None,
            unit=unit,
            is_multi_option=is_multi,
            options=options if is_multi else [],
            confidence=0.9 if structured else 0.5,
            source_field=source_field if source_field else field_name
        )

    def _split_multi_option(self, value: str, field_name: str) -> List[str]:
        """Split concatenated spec values into options - ASUS-specific"""
        import re

        # Normalize field name
        field_normalized = field_name.lower().replace(' ', '_').replace('-', '_').replace('(', '').replace(')', '').replace('/', '_')

        # OS-specific extraction
        if field_normalized in ('operating_system', 'os'):
            os_patterns = [
                r'\b(Windows\s+11\s+(?:Pro|Home|Enterprise|Education|SE))\b',
                r'\b(Windows\s+10\s+(?:Pro|Home|Enterprise|Education))\b',
                r'\b(Ubuntu(?:\s+[\d\.]+)?)\b',
                r'\b(Chrome\s+OS)\b',
                r'\b(macOS(?:\s+\d+[\d\.]*)?)\b',
                r'(No\s+preinstalled\s+OS)',
                r'\b(FreeDOS)\b',
                r'\b(Linux(?:\s+\w+)?)\b',
                r'\b(DOS)\b',
            ]
            found_oses = []
            for pattern in os_patterns:
                matches = re.findall(pattern, value, re.IGNORECASE)
                for match in matches:
                    if match not in found_oses:
                        found_oses.append(match)
            if len(found_oses) > 1:
                return found_oses

        # Processor - handle "AMD Ryzen...; AMD XDNA NPU..." pattern
        if field_normalized in ('processor', 'cpu'):
            # Try to capture the full processor string first (before semicolon)
            full_proc_match = re.search(r'^([^;]+(?:Processor|CPU)[^;]*?)(?:\s*;|$)', value, re.IGNORECASE)
            if full_proc_match:
                full_proc = full_proc_match.group(1).strip()
                if len(full_proc) > 10:
                    # Check if there's also an NPU part
                    npu_match = re.search(r'(AMD\s+XDNA™?\s+NPU\s+up\s+to\s+\d+TOPS)', value, re.IGNORECASE)
                    if npu_match:
                        return [full_proc, npu_match.group(1)]
                    return [full_proc]

            # Fallback patterns
            proc_patterns = [
                r'\b(AMD\s+Ryzen[\s\w\d™\.]+?(?:\s+Processor|\s*;|\.{3,}|\s*$))',
                r'\b(Intel\s+Core[\s\w\d™\.]+?(?:\s+Processor|\s*;|\.{3,}|\s*$))',
                r'\b(Apple\s+M\d[\s\w\d™\.]+?(?:\s+Processor|\s*;|\.{3,}|\s*$))',
                r'\b(Qualcomm\s+Snapdragon[\s\w\d™\.]+?(?:\s+Processor|\s*;|\.{3,}|\s*$))',
                r'\b(Snapdragon\s+X\s+[\s\w\d™\.]+?(?:\s+Processor|\s*;|\.{3,}|\s*$))',
                r'\b(AMD\s+XDNA™\s+NPU\s+up\s+to\s+\d+TOPS)',
            ]
            found_procs = []
            for pattern in proc_patterns:
                matches = re.findall(pattern, value, re.IGNORECASE)
                for match in matches:
                    match = match.strip().rstrip(';').rstrip('.').strip()
                    if match not in found_procs and len(match) > 10:
                        found_procs.append(match)
            if len(found_procs) > 1:
                return found_procs

        # Graphics - handle "NVIDIA RTX... AMD Radeon..." pattern
        if field_normalized in ('graphics', 'gpu'):
            # Split by GPU brand boundaries
            parts = re.split(r'(?=AMD\s+Radeon|NVIDIA|Intel\s)', value)
            found_gpus = []
            for part in parts:
                part = part.strip().rstrip(';').strip()
                if part and len(part) > 10:
                    found_gpus.append(part)
            if len(found_gpus) > 1:
                return found_gpus

        # Neural Processor - separate NPU from CPU
        if field_normalized in ('neural_processor', 'npu'):
            # NPU is usually separate from CPU
            npu_match = re.search(r'(AMD\s+XDNA™?\s+NPU\s+up\s+to\s+\d+TOPS)', value, re.IGNORECASE)
            if npu_match:
                return [npu_match.group(1)]

        # Display - usually single spec per variant but could have multiple
        if field_normalized in ('display', 'screen'):
            # Keep as single unless explicitly multiple displays
            pass

        # Memory - handle "64GB LPDDR5X on boardMax Total... 32GB LPDDR5X..."
        if field_normalized in ('memory', 'ram'):
            # Split by boundary (start of new memory spec: digits + GB + LPDDR/DDR)
            parts = re.split(r'(?<!\d)(?=\d+\s*GB\s+(?:LPDDR|DDR))', value)
            found_mem = []
            for p in parts:
                p = p.strip()
                if p and len(p) > 5:
                    # Extract just the memory spec
                    mem_match = re.search(r'(\d+\s*GB\s+(?:LPDDR\d+X?|DDR\d+)\s+on\s+board)', p, re.IGNORECASE)
                    if mem_match:
                        found_mem.append(mem_match.group(1))
            if len(found_mem) > 1:
                return found_mem

        # Storage - handle multiple SSD configs
        if field_normalized in ('storage', 'ssd', 'hdd'):
            # Use the same pattern that works in testing
            storage_pattern = r'(\d+\s*(?:TB|GB)\s+(?:M\.2\s+)?NVMe™?\s+PCIe[®\s]*\d+\.?\d*\s+(?:Performance\s+)?SSD)(?:\s+x\s*(\d+))?'
            matches = re.findall(storage_pattern, value, re.IGNORECASE)
            found_storage = []
            for match in matches:
                spec = match[0].strip()
                count = match[1].strip() if match[1] else ''
                if count:
                    spec = f"{spec} x {count}"
                if spec not in found_storage and len(spec) > 5:
                    found_storage.append(spec)
            if len(found_storage) > 1:
                return found_storage

        # I/O Ports - split by common port separators (boundary-based)
        if field_normalized in ('i_o_ports', 'ports', 'io_ports'):
            # Split by port start boundaries (digit + x + space)
            parts = re.split(r'(?=\d+x\s)', value)
            ports = [p.strip().rstrip(',') for p in parts if p.strip() and len(p.strip()) > 5]
            if len(ports) > 1:
                return ports

        # Expansion Slots - split by "+" or ";"
        if field_normalized in ('expansion_slots', 'expansion_slots_includes_used'):
            parts = re.split(r'\s*\+\s*|\s*;\s*', value)
            cleaned = [p.strip() for p in parts if p.strip() and len(p.strip()) > 5]
            if len(cleaned) > 1:
                return cleaned

        # Network and Communication - split WiFi and Bluetooth
        if field_normalized in ('network_and_communication', 'network', 'wireless', 'bluetooth'):
            parts = re.split(r'\s*\+\s*', value)
            cleaned = [p.strip() for p in parts if p.strip() and len(p.strip()) > 5]
            if len(cleaned) > 1:
                return cleaned

        # Power Supply - handle disclaimer splitting
        if field_normalized in ('power_supply', 'power'):
            # Try to split charger spec from disclaimer
            if '*whether' in value.lower() or '*whether' in value.lower():
                parts = re.split(r'\*,?\s*\*?[Ww]hether', value)
                if len(parts) > 1:
                    charger = parts[0].strip()
                    disclaimer = '*Whether ' + '*Whether '.join(parts[1:]).strip()
                    if len(charger) > 10 and len(disclaimer) > 10:
                        return [charger, disclaimer]

        # Generic separators for other fields
        generic_separators = [
            r'\.{3,}',      # ... ellipsis
            r'\s*/\s*',     # / slash
            r'\s*\|\s*',    # | pipe
            r'\s*;\s*',     # ; semicolon
        ]

        for pattern in generic_separators:
            parts = re.split(pattern, value)
            if len(parts) > 1:
                cleaned = [p.strip() for p in parts if p.strip() and len(p.strip()) > 2]
                if len(cleaned) > 1:
                    return cleaned

        return [value]

    def _extract_structured(self, value: str, field_name: str) -> Optional[Dict]:
        """Extract structured data based on field type - ASUS enhanced"""
        import re

        result = {}
        field_normalized = field_name.lower().replace(' ', '_').replace('-', '_').replace('(', '').replace(')', '').replace('/', '_')

        # Processor
        if field_normalized in ('processor', 'cpu'):
            # Brand
            for brand in ['Intel', 'AMD', 'Apple', 'Qualcomm', 'Snapdragon', 'MediaTek']:
                if brand.lower() in value.lower():
                    result['brand'] = brand
                    break

            # Clean value for parsing (remove ™ and ®)
            clean_value = value.replace('™', '').replace('®', '')

            # Model - more comprehensive patterns
            model_patterns = [
                r'(Core\s+Ultra\s+\d+\s+\d+[A-Z]?)',
                r'(Ryzen\s+AI\s+\d+\s+\w+\s+\d+[A-Z]?)',
                r'(Ryzen\s+(?:AI\s+)?[\w]+[\s\w]*?\s+\d+[A-Z]?\d*)',
                r'(Ryzen\s+\d+\s+\d+[A-Z]?)',
                r'(M\d+\s+\w+)',
                r'(Snapdragon\s+\w+\s+\d+\s+\d+)',
                r'(Snapdragon\s+X\s+\w+\s+\d+)',
                r'(Ryzen\s+\w+\s+AI\s+\d+\s+\w+\s+\d+[A-Z]?)',
            ]
            for pattern in model_patterns:
                match = re.search(pattern, clean_value, re.IGNORECASE)
                if match:
                    result['model'] = match.group(1).strip()
                    break

            # Cores/threads
            cores = re.search(r'(\d+)\s*cores?', clean_value, re.IGNORECASE)
            if cores:
                result['cores'] = int(cores.group(1))
            threads = re.search(r'(\d+)\s*threads?', clean_value, re.IGNORECASE)
            if threads:
                result['threads'] = int(threads.group(1))

            # Frequencies
            base = re.search(r'(\d+\.?\d*)\s*GHz', clean_value)
            if base:
                result['base_freq_ghz'] = float(base.group(1))
            boost = re.search(r'up\s+to\s+(\d+\.?\d*)\s*GHz', clean_value, re.IGNORECASE)
            if boost:
                result['boost_freq_ghz'] = float(boost.group(1))

            # Cache
            cache = re.search(r'(\d+)\s*MB\s*Cache', clean_value, re.IGNORECASE)
            if cache:
                result['cache_mb'] = int(cache.group(1))

            # NPU
            npu = re.search(r'(?:NPU|XDNA).*?(\d+\.?\d*)\s*TOPS', clean_value, re.IGNORECASE)
            if npu:
                result['npu_tops'] = float(npu.group(1))

        # Memory
        elif field_normalized in ('memory', 'ram'):
            cap = re.search(r'(\d+)\s*GB', value, re.IGNORECASE)
            if cap:
                result['capacity_gb'] = int(cap.group(1))
            type_match = re.search(r'(LPDDR\d+X?|DDR\d+|LPDDR\d+)', value, re.IGNORECASE)
            if type_match:
                result['type'] = type_match.group(1).upper()
            speed = re.search(r'(\d+)\s*MT/s|(\d+)\s*MHz', value, re.IGNORECASE)
            if speed:
                result['speed_mts'] = int(speed.group(1) or speed.group(2))
            if 'on board' in value.lower() or 'soldered' in value.lower():
                result['form_factor'] = 'soldered'

        # Storage
        elif field_normalized in ('storage', 'ssd', 'hdd'):
            cap = re.search(r'(\d+)\s*(TB|GB)', value, re.IGNORECASE)
            if cap:
                size = int(cap.group(1))
                unit = cap.group(2).upper()
                result['capacity_gb'] = size * 1024 if unit == 'TB' else size
            if 'nvme' in value.lower():
                result['interface'] = 'NVMe'
            elif 'sata' in value.lower():
                result['interface'] = 'SATA'
            pcie = re.search(r'PCIe[®\s]*(\d+\.?\d*)', value, re.IGNORECASE)
            if pcie:
                result['pcie_version'] = pcie.group(1)
            if 'm.2' in value.lower() or 'm2' in value.lower():
                result['form_factor'] = 'M.2'

        # Display
        elif field_normalized in ('display', 'screen'):
            size = re.search(r'(\d+\.?\d*)\s*(?:\"|-?\s*in(?:ch)?)', value, re.IGNORECASE)
            if size:
                result['size_inches'] = float(size.group(1))
            res = re.search(r'(\d+)\s*[x×]\s*(\d+)', value)
            if res:
                result['width_px'] = int(res.group(1))
                result['height_px'] = int(res.group(2))
                result['resolution'] = f"{res.group(1)}x{res.group(2)}"
            for panel in ['OLED', 'IPS', 'TN', 'VA', 'Mini LED', 'Micro LED']:
                if panel.lower() in value.lower():
                    result['panel_type'] = panel
                    break
            ar = re.search(r'(\d+:\d+)', value)
            if ar:
                result['aspect_ratio'] = ar.group(1)
            hz = re.search(r'(\d+)\s*Hz', value, re.IGNORECASE)
            if hz:
                result['refresh_rate_hz'] = int(hz.group(1))
            rt = re.search(r'(\d+\.?\d*)\s*ms', value, re.IGNORECASE)
            if rt:
                result['response_time_ms'] = float(rt.group(1))
            nit = re.search(r'(\d+(?:\.\d+)?)\s*nits?', value, re.IGNORECASE)
            if nit:
                result['brightness_nits'] = int(nit.group(1))
            contrast = re.search(r'(\d{1,3}(?:,\d{3})+|\d{4,})\s*:\s*(\d+)', value)
            if contrast:
                # Remove commas from the first group
                c1 = contrast.group(1).replace(',', '')
                result['contrast_ratio'] = f"{int(c1)}:{int(contrast.group(2))}"

        # Battery
        elif field_normalized in ('battery',):
            wh = re.search(r'(\d+)\s*Wh', value, re.IGNORECASE)
            if wh:
                result['capacity_wh'] = int(wh.group(1))
            cells = re.search(r'(\d+)\s*cell', value, re.IGNORECASE)
            if cells:
                result['cells'] = int(cells.group(1))

        # Weight
        elif field_normalized in ('weight',):
            kg = re.search(r'(\d+\.?\d*)\s*kg', value, re.IGNORECASE)
            if kg:
                result['weight_kg'] = float(kg.group(1))
            lbs = re.search(r'(\d+\.?\d*)\s*lbs?', value, re.IGNORECASE)
            if lbs:
                result['weight_lbs'] = float(lbs.group(1))

        # Dimensions
        elif field_normalized in ('dimensions', 'dimensions_wxdxh'):
            mm = re.search(r'(\d+\.?\d*)\s*x\s*(\d+\.?\d*)\s*x\s*(\d+\.?\d*)\s*mm', value, re.IGNORECASE)
            if mm:
                result['width_mm'] = float(mm.group(1))
                result['depth_mm'] = float(mm.group(2))
                result['height_mm'] = float(mm.group(3))
            inch = re.search(r'(\d+\.?\d*)\s*x\s*(\d+\.?\d*)\s*x\s*(\d+\.?\d*)\s*in', value, re.IGNORECASE)
            if inch:
                result['width_in'] = float(inch.group(1))
                result['depth_in'] = float(inch.group(2))
                result['height_in'] = float(inch.group(3))

        # Graphics
        elif field_normalized in ('graphics', 'gpu'):
            for brand in ['NVIDIA', 'AMD', 'Intel', 'Apple', 'Qualcomm']:
                if brand.lower() in value.lower():
                    result['brand'] = brand
                    break
            vram = re.search(r'(\d+)\s*GB\s*GDDR', value, re.IGNORECASE)
            if vram:
                result['vram_gb'] = int(vram.group(1))
            model_patterns = [
                r'(RTX\s+\d{4}[A-Z]?)',
                r'(GTX\s+\d{4}[A-Z]?)',
                r'(Radeon\s+(?:RX\s+)?\d{4}[A-Z]?)',
                r'(Arc\s+(?:Pro\s+)?B?\d{3,4})',
                r'(Adreno\s+\w+)',
            ]
            for pattern in model_patterns:
                match = re.search(pattern, value, re.IGNORECASE)
                if match:
                    result['model'] = match.group(1).strip().upper()
                    break

        # I/O Ports
        elif field_normalized in ('i_o_ports', 'ports', 'io_ports'):
            # Split by port start boundaries (digit + x + space) - same as _split_multi_option
            parts = re.split(r'(?=\d+x\s)', value)
            ports = [p.strip().rstrip(',') for p in parts if p.strip() and len(p.strip()) > 5]
            if ports:
                result['ports'] = ports

        # Audio
        elif field_normalized in ('audio',):
            audio_features = []
            if 'smart amp' in value.lower() or 'smartamp' in value.lower():
                audio_features.append('Smart Amp')
            if 'dolby' in value.lower():
                audio_features.append('Dolby')
            if 'harman' in value.lower() or 'kardon' in value.lower():
                audio_features.append('Harman Kardon')
            if 'array microphone' in value.lower():
                audio_features.append('Array Microphone')
            if 'speaker' in value.lower():
                audio_features.append('Built-in Speaker')
            if audio_features:
                result['features'] = audio_features

        # Network/Communication
        elif field_normalized in ('network_and_communication', 'network', 'wireless', 'bluetooth', 'wifi'):
            wifi_match = re.search(r'Wi-?Fi\s*(\d+|6E|7|[0-9]\.[0-9])\s*\(?([^)]+)\)?', value, re.IGNORECASE)
            if wifi_match:
                result['wifi_standard'] = f"Wi-Fi {wifi_match.group(1)}"
                if wifi_match.group(2):
                    result['wifi_bands'] = wifi_match.group(2).strip()
            bt_match = re.search(r'Bluetooth[®]?\s*(\d+\.?\d*)', value, re.IGNORECASE)
            if bt_match:
                result['bluetooth_version'] = bt_match.group(1)

        # Expansion Slots
        elif field_normalized in ('expansion_slots', 'expansion_slots_includes_used'):
            # Split by "+" or ";"
            parts = re.split(r'\s*\+\s*|\s*;\s*', value)
            slots = [p.strip() for p in parts if p.strip() and len(p.strip()) > 5]
            if slots:
                result['slots'] = slots

        return result if result else None

    def _extract_unit(self, value: str, field_name: str) -> Optional[str]:
        """Extract unit from value"""
        field_normalized = field_name.lower().replace(' ', '_').replace('-', '_')
        units = {
            'processor': 'GHz',
            'cpu': 'GHz',
            'memory': 'GB',
            'ram': 'GB',
            'storage': 'GB',
            'ssd': 'GB',
            'hdd': 'GB',
            'display': 'inches',
            'screen': 'inches',
            'battery': 'Wh',
            'weight': 'kg',
            'dimensions': 'mm',
            'dimensions_wxdxh': 'mm',
        }
        return units.get(field_normalized)

    def _extract_variants_from_main(self, soup: BeautifulSoup, url: str) -> List[ProductVariant]:
        """Extract variants from main product page (fallback)"""
        variants = []

        # Look for variant selectors (color, config dropdowns)
        variant_selectors = [
            '.product-variants select option',
            '.color-options li',
            '.config-options li',
            '[data-variant]',
        ]

        variant_names = []
        for selector in variant_selectors:
            elems = soup.select(selector)
            for elem in elems:
                name = clean_text(elem.get_text() or elem.get('data-variant', ''))
                if name and name not in variant_names:
                    variant_names.append(name)

        if not variant_names:
            # Create single base variant
            return [self._create_base_variant(url, "")]

        # Extract basic specs from main page
        for variant_name in variant_names:
            specs = self._extract_basic_specs(soup)
            # Generate canonical key from product URL for variant ID
            canonical_key = extract_canonical_key(url, 'asus')
            variant_id = generate_variant_id('asus', canonical_key, variant_name)
            variants.append(ProductVariant(
                variant_id=variant_id,
                name=variant_name,
                specs=specs,
                source_url=url
            ))

        return variants

    def _create_base_variant(self, url: str, product_name: str) -> ProductVariant:
        """Create a base variant when no variants found"""
        canonical_key = extract_canonical_key(url, 'asus')
        variant_id = generate_variant_id('asus', canonical_key, "Base")
        return ProductVariant(
            variant_id=variant_id,
            name="Base",
            specs={},
            source_url=url
        )

    def _extract_basic_specs(self, soup: BeautifulSoup) -> Dict[str, SpecValue]:
        """Extract basic specs from main product page"""
        specs = {}

        # Common spec selectors
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

    def _extract_msrp(self, soup: BeautifulSoup) -> tuple[Optional[float], Optional[str]]:
        """Extract MSRP and currency from product page using JSON-LD schema"""
        import json
        import re

        # First try JSON-LD Product schema with offers
        scripts = soup.find_all('script', type='application/ld+json')
        for script in scripts:
            try:
                data = json.loads(script.string)
                if isinstance(data, list):
                    for item in data:
                        if item.get('@type') == 'Product' and 'offers' in item:
                            offers = item['offers']
                            if isinstance(offers, dict):
                                price_str = offers.get('price', '')
                                currency = offers.get('priceCurrency', '')
                                if price_str:
                                    return float(price_str), currency if currency else None
                            elif isinstance(offers, list):
                                for offer in offers:
                                    if isinstance(offer, dict) and 'price' in offer:
                                        currency = offer.get('priceCurrency', '')
                                        return float(offer['price']), currency if currency else None
                elif isinstance(data, dict) and data.get('@type') == 'Product' and 'offers' in data:
                    offers = data['offers']
                    if isinstance(offers, dict):
                        price_str = offers.get('price', '')
                        currency = offers.get('priceCurrency', '')
                        if price_str:
                            return float(price_str), currency if currency else None
            except (json.JSONDecodeError, ValueError, TypeError):
                continue

        # Fallback: Try meta tags
        meta_price = soup.select_one('meta[property="product:price:amount"], meta[itemprop="price"]')
        meta_currency = soup.select_one('meta[property="product:price:currency"], meta[itemprop="priceCurrency"]')
        if meta_price:
            price_str = meta_price.get('content', '')
            currency = meta_currency.get('content', '') if meta_currency else None
            try:
                return float(price_str), currency if currency else None
            except ValueError:
                pass

        # Fallback: Try CSS selectors (legacy)
        price_selectors = [
            '.product-price .price',
            '.price-current',
            '.product-price',
            '[data-price]',
            '.Price__current',
            '.price__current',
            '.ProductPrice__price',
        ]

        for selector in price_selectors:
            elem = soup.select_one(selector)
            if elem:
                text = clean_text(elem.get_text())
                price = extract_price(text)
                if price:
                    return price, None

        return None, None

    def _extract_launch_date(self, soup: BeautifulSoup) -> Optional[str]:
        """Extract launch/release date from product page"""
        import json
        import re

        # First try JSON-LD Product schema for release date
        scripts = soup.find_all('script', type='application/ld+json')
        for script in scripts:
            try:
                data = json.loads(script.string)
                if isinstance(data, list):
                    for item in data:
                        if item.get('@type') == 'Product':
                            # Check for releaseDate, datePublished, or launchDate
                            for date_field in ['releaseDate', 'datePublished', 'launchDate', 'availableFrom']:
                                if date_field in item:
                                    date_val = item[date_field]
                                    if isinstance(date_val, str) and date_val:
                                        # Extract just the date part
                                        match = re.search(r'(\d{4}-\d{2}-\d{2})', date_val)
                                        if match:
                                            return match.group(1)
                                        return date_val.split('T')[0]
                elif isinstance(data, dict) and data.get('@type') == 'Product':
                    for date_field in ['releaseDate', 'datePublished', 'launchDate', 'availableFrom']:
                        if date_field in data:
                            date_val = data[date_field]
                            if isinstance(date_val, str) and date_val:
                                match = re.search(r'(\d{4}-\d{2}-\d{2})', date_val)
                                if match:
                                    return match.group(1)
                                return date_val.split('T')[0]
            except (json.JSONDecodeError, ValueError, TypeError):
                continue

        # Fallback: Look for date patterns in the page
        date_selectors = [
            '.release-date',
            '.launch-date',
            '[data-release-date]',
            '.ProductMeta__release',
            'time[datetime]',
        ]

        for selector in date_selectors:
            elem = soup.select_one(selector)
            if elem:
                text = clean_text(elem.get_text())
                # Try to parse various date formats
                date_patterns = [
                    r'(\d{4}-\d{2}-\d{2})',
                    r'(\d{2}/\d{2}/\d{4})',
                    r'(\d{2}\.\d{2}\.\d{4})',
                    r'(January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2},?\s+\d{4}',
                ]
                for pattern in date_patterns:
                    match = re.search(pattern, text, re.IGNORECASE)
                    if match:
                        return match.group(1)

                datetime_attr = elem.get('datetime')
                if datetime_attr:
                    return datetime_attr.split('T')[0]

        # Fallback: Search page text for release/launch mentions
        page_text = soup.get_text()
        date_patterns = [
            r'release[d]?\s*[:\-]\s*([A-Za-z]+\s+\d{1,2},?\s+\d{4})',
            r'launch[ed]?\s*[:\-]\s*([A-Za-z]+\s+\d{1,2},?\s+\d{4})',
            r'available\s*[:\-]\s*([A-Za-z]+\s+\d{1,2},?\s+\d{4})',
        ]
        for pattern in date_patterns:
            match = re.search(pattern, page_text, re.IGNORECASE)
            if match:
                try:
                    # Try to parse the date
                    from dateutil import parser
                    parsed = parser.parse(match.group(1))
                    return parsed.strftime('%Y-%m-%d')
                except:
                    return match.group(1)

        return None

    def _extract_availability(self, soup: BeautifulSoup) -> Optional[str]:
        """Extract availability status from product page"""
        import json
        import re

        # First try JSON-LD Product schema for availability
        scripts = soup.find_all('script', type='application/ld+json')
        for script in scripts:
            try:
                data = json.loads(script.string)
                if isinstance(data, list):
                    for item in data:
                        if item.get('@type') == 'Product' and 'offers' in item:
                            offers = item['offers']
                            if isinstance(offers, dict) and 'availability' in offers:
                                avail_url = offers['availability']
                                # Map schema.org availability to readable text
                                if 'InStock' in avail_url:
                                    return "In Stock"
                                elif 'OutOfStock' in avail_url:
                                    return "Out of Stock"
                                elif 'PreOrder' in avail_url or 'PreSale' in avail_url:
                                    return "Pre-order"
                                elif 'Discontinued' in avail_url:
                                    return "Discontinued"
                                elif 'LimitedAvailability' in avail_url:
                                    return "Limited Availability"
                                return avail_url
                            elif isinstance(offers, list):
                                for offer in offers:
                                    if isinstance(offer, dict) and 'availability' in offer:
                                        avail_url = offer['availability']
                                        if 'InStock' in avail_url:
                                            return "In Stock"
                                        elif 'OutOfStock' in avail_url:
                                            return "Out of Stock"
                                        elif 'PreOrder' in avail_url or 'PreSale' in avail_url:
                                            return "Pre-order"
                                        elif 'Discontinued' in avail_url:
                                            return "Discontinued"
                                        elif 'LimitedAvailability' in avail_url:
                                            return "Limited Availability"
                                        return avail_url
                elif isinstance(data, dict) and data.get('@type') == 'Product' and 'offers' in data:
                    offers = data['offers']
                    if isinstance(offers, dict) and 'availability' in offers:
                        avail_url = offers['availability']
                        if 'InStock' in avail_url:
                            return "In Stock"
                        elif 'OutOfStock' in avail_url:
                            return "Out of Stock"
                        elif 'PreOrder' in avail_url or 'PreSale' in avail_url:
                            return "Pre-order"
                        elif 'Discontinued' in avail_url:
                            return "Discontinued"
                        elif 'LimitedAvailability' in avail_url:
                            return "Limited Availability"
                        return avail_url
            except (json.JSONDecodeError, ValueError, TypeError):
                continue

        # Fallback: Look for availability indicators
        availability_selectors = [
            '.availability',
            '.stock-status',
            '[data-availability]',
            '.ProductAvailability',
            '.availability-status',
        ]

        for selector in availability_selectors:
            elem = soup.select_one(selector)
            if elem:
                text = clean_text(elem.get_text())
                if text:
                    return text

        # Check for common availability text
        page_text = soup.get_text()
        if re.search(r'\bin\s+stock\b', page_text, re.IGNORECASE):
            return "In Stock"
        elif re.search(r'\bout\s+of\s+stock\b', page_text, re.IGNORECASE):
            return "Out of Stock"
        elif re.search(r'\bpre-?order\b', page_text, re.IGNORECASE):
            return "Pre-order"
        elif re.search(r'\bcoming\s+soon\b', page_text, re.IGNORECASE):
            return "Coming Soon"
        elif re.search(r'\bdiscontinued\b', page_text, re.IGNORECASE):
            return "Discontinued"

        return None

    def _determine_status(self, soup: BeautifulSoup, url: str) -> ProductStatus:
        """Determine product lifecycle status"""
        availability = self._extract_availability(soup)

        if availability:
            avail_lower = availability.lower()
            if 'discontinued' in avail_lower or 'end of life' in avail_lower:
                return ProductStatus.DISCONTINUED
            elif 'pre-order' in avail_lower or 'preorder' in avail_lower or 'coming soon' in avail_lower:
                return ProductStatus.ANNOUNCED
            elif 'refurbished' in avail_lower or 'refurb' in avail_lower:
                return ProductStatus.REFURBISHED
            elif 'in stock' in avail_lower or 'available' in avail_lower:
                return ProductStatus.CURRENT

        # Check URL for discontinued/outlet indicators
        if 'outlet' in url.lower() or 'refurbished' in url.lower():
            return ProductStatus.REFURBISHED

        return ProductStatus.CURRENT

    def _generate_family_id(self, url: str, product_name: str) -> str:
        """Generate family ID for grouping similar products across regions"""
        import re
        from urllib.parse import urlparse

        parsed = urlparse(url)
        path_parts = [p for p in parsed.path.strip('/').split('/') if p]

        # Use the product slug from URL as base
        for part in reversed(path_parts):
            if len(part) > 5 and not part.isdigit() and part not in ['laptops', 'displays-desktops', 'monitors', 'techspec', 'specifications', 'specs']:
                # Remove region-specific suffixes
                clean_part = re.sub(r'-(us|in|uk|de|cn|jp|fr|es|it)$', '', part)
                return f"asus-{clean_part}"

        # Fallback: use canonical key
        return f"asus-{extract_canonical_key(url, 'asus')}"


# =============================================================================
# CONFIGURATION
# =============================================================================

def create_asus_config() -> ScraperConfig:
    """Create ASUS scraper configuration"""
    regions = [
        RegionConfig(
            code='us',
            name='United States',
            base_url='https://www.asus.com/us/',
            language='en',
            currency='USD',
            category_paths={
                'laptops': '/laptops/',
                'displays-desktops': '/displays-desktops/',
                'monitors': '/monitors/',
                'motherboards-components': '/motherboards-components/',
                'networking-iot-servers': '/networking-iot-servers/',
                'accessories': '/accessories/',
            },
            rate_limit=0.5,  # 1 request per 2 seconds
            timeout=30
        ),
        RegionConfig(
            code='in',
            name='India',
            base_url='https://www.asus.com/in/',
            language='en',
            currency='INR',
            category_paths={
                'laptops': '/laptops/',
                'displays-desktops': '/displays-desktops/',
                'monitors': '/monitors/',
                'motherboards-components': '/motherboards-components/',
                'networking-iot-servers': '/networking-iot-servers/',
                'accessories': '/accessories/',
            },
            rate_limit=0.5,
            timeout=30
        ),
        RegionConfig(
            code='uk',
            name='United Kingdom',
            base_url='https://www.asus.com/uk/',
            language='en',
            currency='GBP',
            category_paths={
                'laptops': '/laptops/',
                'displays-desktops': '/displays-desktops/',
                'monitors': '/monitors/',
                'motherboards-components': '/motherboards-components/',
                'networking-iot-servers': '/networking-iot-servers/',
                'accessories': '/accessories/',
            },
            rate_limit=0.5,
            timeout=30
        ),
        RegionConfig(
            code='de',
            name='Germany',
            base_url='https://www.asus.com/de/',
            language='de',
            currency='EUR',
            category_paths={
                'laptops': '/laptops/',
                'displays-desktops': '/displays-desktops/',
                'monitors': '/monitors/',
                'motherboards-components': '/motherboards-components/',
                'networking-iot-servers': '/networking-iot-servers/',
                'accessories': '/accessories/',
            },
            rate_limit=0.5,
            timeout=30
        ),
        RegionConfig(
            code='fr',
            name='France',
            base_url='https://www.asus.com/fr/',
            language='fr',
            currency='EUR',
            category_paths={
                'laptops': '/laptops/',
                'displays-desktops': '/displays-desktops/',
                'monitors': '/monitors/',
                'motherboards-components': '/motherboards-components/',
                'networking-iot-servers': '/networking-iot-servers/',
                'accessories': '/accessories/',
            },
            rate_limit=0.5,
            timeout=30
        ),
    ]

    return ScraperConfig(
        manufacturer='asus',
        brand='ASUS',
        base_url='https://www.asus.com/',
        regions=regions,
        output_dir='./output',
        max_concurrent=2,
        retry_attempts=3,
        checkpoint_interval=10
    )


async def run_asus_scraper(regions: List[str] = None):
    """Run ASUS scraper for specified regions"""
    config = create_asus_config()

    if regions:
        target_regions = [r for r in config.regions if r.code in regions]
    else:
        target_regions = config.regions

    all_products = []

    for region in target_regions:
        scraper = AsusScraper(config, region)
        scraper.load_checkpoint()

        products = await scraper.scrape()
        all_products.extend(products)

        # Export
        from ..models import export_products_json, export_products_csv
        from pathlib import Path

        output_dir = Path(config.output_dir) / region.code
        output_dir.mkdir(parents=True, exist_ok=True)

        timestamp = datetime.now().strftime('%Y%m%d_%H%M%S')
        export_products_json(products, str(output_dir / f"asus_products_{region.code}_{timestamp}.json"))
        export_products_csv(products, str(output_dir / f"asus_products_{region.code}_{timestamp}.csv"))

        print(f"Region {region.code}: {len(products)} products")

    return all_products


if __name__ == '__main__':
    import sys
    regions = sys.argv[1:] if len(sys.argv) > 1 else None
    asyncio.run(run_asus_scraper(regions))