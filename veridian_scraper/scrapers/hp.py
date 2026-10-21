"""
Veridian Scraper - HP Scraper Implementation

What HP actually publishes (verified live on 2026-10-21 against the India
store, ``https://www.hp.com/in-en/shop``):

* One store page per *configuration*: the product URL carries the HP order
  code, e.g. ``/in-en/shop/products/laptops/hp-omnibook-3-laptop-ai-14-
  ht0218tu-e5sm2pa-acj`` for the SKU ``E5SM2PA#ACJ``.
* The technical specifications are **server rendered**. They live in the
  ``data-test-hook`` marked blocks ``@hpstellar/pdp/tech-specs*``. The
  Tailwind class names next to them are hashed per build (``GJ-GM_gh``), so
  only the hooks are used to find the data.
* The price is server rendered as well: the sale price sits in
  ``@hpstellar/core/price-block__sale-price--main-price`` and the list price
  (MRP) in ``@hpstellar/core/price-block__strike-price--main-price``.
* The datasheet PDF is linked from ``@hpstellar/pdp/tech-specs__downloads``.

Access notes (all measured, not assumed):

* ``https://www.hp.com/us-en/shop/pdp/...`` and the US store category pages
  accept the connection but never answer (0 bytes, >150 s) for the honest
  ``VeridianBot`` agent, and so do the ``support.hp.com`` product-spec pages.
  The scraper therefore reports those fetches as failures instead of
  pretending to have collected anything.
* ``https://www.hp.com/us-en/shop/app/api/...`` (the store's GraphQL API) is
  ``Disallow``-ed by HP's robots.txt, so it is never requested.
* The store renders only the first page of a listing server-side; deeper
  pages are fetched with the same ``?page=`` URL, which robots.txt allows.
"""

import asyncio
import re
from typing import AsyncIterator, List, Dict, Any, Optional, Tuple
from urllib.parse import urljoin, urlparse

import httpx
from bs4 import BeautifulSoup

from .base import (
    BaseScraper, ScraperConfig, RegionConfig, apply_yaml_config, get_config_manager,
    Product, ProductVariant, ProductCategory,
    SpecValue,
    generate_product_id, generate_variant_id,
    canonicalize_url,
    clean_text
)


class HPScraper(BaseScraper):
    """HP-specific scraper implementation"""

    CATEGORY_MAPPING = {
        'laptops': ProductCategory.LAPTOPS,
        'desktops': ProductCategory.DESKTOPS,
        'monitors': ProductCategory.MONITORS,
        'printers': ProductCategory.ACCESSORIES,
        'accessories': ProductCategory.ACCESSORIES,
        'workstations': ProductCategory.WORKSTATIONS,
        'tablets': ProductCategory.TABLETS,
        'ink--toner---paper': ProductCategory.ACCESSORIES,
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
        'dragonfly': 'Dragonfly',
        'hyperx': 'HyperX',
    }

    # Stable hooks on the live HP store product page.
    #
    # The store is a React application whose Tailwind class names are hashed
    # per build (``GJ-GM_gh``, ``Fn-Fo_gh``), so every selector below is a
    # ``data-test-hook`` attribute, which HP keeps literal.
    TECH_SPECS_SECTION = '[data-test-hook="@hpstellar/pdp/tech-specs"]'
    TECH_SPECS_HIGHLIGHTS = '[data-test-hook="@hpstellar/pdp/tech-specs-highlights"]'
    TECH_SPECS_HIGHLIGHT_DESC = '[data-test-hook="@hpstellar/pdp/tech-specs-highlight-description"]'
    TECH_SPECS_DETAILED = '[data-test-hook="@hpstellar/pdp/tech-specs-detailed-specs"]'
    TECH_SPECS_GROUP = '[data-test-hook="@hpstellar/pdp/tech-specs__detailedSpecWithSubSpecs"]'
    TECH_SPECS_DOWNLOADS = '[data-test-hook="@hpstellar/pdp/tech-specs__downloads"]'
    PRICE_SALE = '[data-test-hook="@hpstellar/core/price-block__sale-price--main-price"]'
    PRICE_LIST = '[data-test-hook="@hpstellar/core/price-block__strike-price--main-price"]'
    TYPOGRAPHY = '[data-test-hook="@hpstellar/core/typography"]'

    # HP order codes look like ``E5SM2PA#ACJ`` (product code, "#", config).
    SKU_PATTERN = re.compile(r'^[A-Z0-9]{4,12}#[A-Z0-9]{0,6}$')

    # Currency symbols the store renders, mapped to ISO codes.
    CURRENCY_SYMBOLS = {
        '₹': 'INR',
        '€': 'EUR',
        '£': 'GBP',
        '$': 'USD',
        '¥': 'JPY',
    }

    # Specification key standardization - HP row names to Veridian keys.
    SPEC_KEY_MAPPING = {
        'operating system': 'os',
        'processor': 'processor',
        'processor family': 'processor_family',
        'processor core': 'processor_cores',
        'processor cache': 'processor_cache',
        'chipset': 'chipset',
        'neural processing unit': 'neural_processor',
        'memory': 'memory',
        'memory layout (slots & size)': 'memory_layout',
        'memory note': 'memory_note',
        'memory and storage': 'memory_and_storage',
        'internal storage': 'storage',
        'storage': 'storage',
        'display': 'display',
        'touchscreen': 'touchscreen',
        'aspect ratio': 'aspect_ratio',
        'brightness': 'brightness',
        'color gamut': 'color_gamut',
        'screen-to-body ratio (without speakers)': 'screen_to_body_ratio',
        'flicker-free': 'flicker_free',
        'graphics': 'graphics',
        'graphics (integrated)': 'graphics',
        'ports': 'ports',
        'wireless': 'network',
        'audio': 'audio',
        'keyboard': 'keyboard',
        'pointing device': 'pointing_device',
        'weight': 'weight',
        'package weight': 'package_weight',
        'dimensions (w x d x h)': 'dimensions',
        'package dimensions (w x d x h)': 'package_dimensions',
        'battery type': 'battery',
        'battery life': 'battery_life',
        'battery life video playback': 'battery_life_video',
        'battery recharge time': 'battery_recharge_time',
        'power supply type': 'power_supply',
        'camera': 'camera',
        'product color': 'color',
        'color': 'color',
        'product design': 'design',
        'manufacturer warranty': 'warranty',
        'support service included': 'support_service',
        'security management': 'security',
        'software included': 'software',
        'cloud service': 'cloud_service',
    }

    # Rows that carry no product data: trademark boilerplate, icon URLs and
    # bare footnote references.
    SKIP_ROWS = frozenset({
        'trademark information',
        'power supply type icon',
        'battery type footnote number',
    })

    # Groups that hold legal or importer information instead of technical
    # data.
    SKIP_GROUPS = frozenset({
        'legal information',
        'product information',
    })

    def __init__(self, config: ScraperConfig, region: RegionConfig):
        super().__init__(config, region)

        self.selectors = {
            'product_link': 'a[href*="/shop/products/"]',
            'techspec_section': self.TECH_SPECS_SECTION,
            'techspec_highlights': self.TECH_SPECS_HIGHLIGHTS,
            'techspec_highlight_desc': self.TECH_SPECS_HIGHLIGHT_DESC,
            'techspec_detailed': self.TECH_SPECS_DETAILED,
            'techspec_group': self.TECH_SPECS_GROUP,
            'techspec_downloads': self.TECH_SPECS_DOWNLOADS,
            'price_sale': self.PRICE_SALE,
            'price_list': self.PRICE_LIST,
            'typography': self.TYPOGRAPHY,
        }

        if region.selectors:
            self.selectors.update(region.selectors)

        # Run limits live in the YAML because the store serves a fixed number
        # of products per listing page and a full catalogue run is a
        # multi-hour job.
        manager = get_config_manager()
        mfg_config = manager.get_manufacturer_config('hp') or {}
        self.max_listing_pages = max(1, int(mfg_config.get('max_listing_pages', 1)))
        self.max_products_per_category = int(mfg_config.get('max_products_per_category', 12))

        # Set once a region stops answering; the remaining categories of that
        # region are then skipped instead of timing out one by one.
        self._region_unreachable = False

    # ------------------------------------------------------------------
    # Categories and series
    # ------------------------------------------------------------------

    def get_category_from_url(self, url: str) -> ProductCategory:
        """Map a store product URL to a Veridian product category."""
        parts = [p for p in urlparse(url).path.strip('/').split('/') if p]
        if 'products' in parts:
            index = parts.index('products')
            if index + 1 < len(parts):
                segment = parts[index + 1].lower()
                if segment in self.CATEGORY_MAPPING:
                    return self.CATEGORY_MAPPING[segment]
        return ProductCategory.UNKNOWN

    def get_series_from_url(self, url: str) -> str:
        """Read the HP series out of the product slug."""
        slug = self._slug_of(url)
        for key, value in self.SERIES_MAPPING.items():
            if key in slug:
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
                ('laptops', '/shop/laptops'),
                ('desktops', '/shop/desktops'),
                ('monitors', '/shop/monitors'),
                ('printers', '/shop/printers'),
                ('accessories', '/shop/accessories'),
                ('workstations', '/shop/workstations'),
            ]
            for cat_name, cat_path in default_categories:
                categories.append({
                    'name': cat_name,
                    'slug': cat_name,
                    'url': urljoin(self.region.base_url, cat_path),
                    'category_type': self.CATEGORY_MAPPING.get(cat_name, ProductCategory.UNKNOWN)
                })

        return categories

    # ------------------------------------------------------------------
    # Discovery
    # ------------------------------------------------------------------

    async def discover_products(self, category_url: str, category_info: Dict) -> AsyncIterator[str]:
        """Discover product URLs from a store listing page.

        The store renders the first page of every listing server-side; deeper
        pages use the same path with a ``page`` query parameter.
        """
        if self._region_unreachable:
            self.logger.warning(
                "Skipping %s: the HP store did not answer earlier in this region",
                category_url,
            )
            return

        expected_category = category_info.get('slug', '')
        seen: set = set()
        found: List[str] = []

        for page in range(1, self.max_listing_pages + 1):
            separator = '&' if '?' in category_url else '?'
            page_url = category_url if page == 1 else f"{category_url}{separator}page={page}"

            try:
                soup = await self.http_client.get_soup(page_url)
            except Exception as exc:
                if self._is_transport_failure(exc):
                    # The store accepted the connection and then went silent.
                    # One such failure means the whole region is unusable, so
                    # the remaining categories are skipped instead of waiting
                    # for every timeout again.
                    self._region_unreachable = True
                    self.logger.error("HP store did not answer for %s: %s", page_url, exc)
                    return
                self.logger.error("Failed to fetch %s: %s", page_url, exc)
                break

            page_urls = set()
            for link in soup.select(self.selectors['product_link']):
                href = link.get('href')
                if not href:
                    continue
                full_url = urljoin(self.region.base_url, href)
                if self._is_product_url(full_url):
                    page_urls.add(canonicalize_url(full_url))

            new_urls = {u for u in page_urls if u not in seen}
            if not new_urls:
                break
            seen.update(new_urls)
            found.extend(sorted(new_urls))

            if len(found) >= self.max_products_per_category:
                break

            await asyncio.sleep(0.5)

        for url in found[:self.max_products_per_category]:
            yield url

    @staticmethod
    def _is_transport_failure(exc: Exception) -> bool:
        """Is this a network level failure (timeout, reset, DNS)?

        The HTTP client retries such failures and finally raises a
        ``RetryError``, so the original error has to be looked up.
        """
        if isinstance(exc, httpx.TransportError):
            return True
        last_attempt = getattr(exc, 'last_attempt', None)
        if last_attempt is not None:
            inner = last_attempt.exception()
            return isinstance(inner, httpx.TransportError)
        return False

    def _is_product_url(self, url: str) -> bool:
        """A store product page lives under ``/shop/products/<category>/<slug>``."""
        parts = [p for p in urlparse(url).path.strip('/').split('/') if p]
        if 'products' not in parts:
            return False
        index = parts.index('products')
        if index + 2 >= len(parts):
            return False
        excluded = ('compare', 'review', 'cart', 'checkout', 'account', 'support')
        return not any(word in parts[index + 2] for word in excluded)

    @staticmethod
    def _slug_of(url: str) -> str:
        parts = [p for p in urlparse(url).path.strip('/').split('/') if p]
        return parts[-1].lower() if parts else ""

    # ------------------------------------------------------------------
    # Product extraction
    # ------------------------------------------------------------------

    async def extract_product(self, url: str, category_info: Dict) -> Optional[Product]:
        self.logger.debug("Extracting product: %s", url)

        try:
            soup = await self.http_client.get_soup(url)
        except Exception as exc:
            self.logger.error("Failed to fetch product page %s: %s", url, exc)
            return None

        product_name = self._extract_product_name(soup, url)
        sku = self._extract_sku(soup)
        specs = self._extract_tech_specs(soup)
        sale_price, list_price, currency = self._extract_prices(soup)

        family_slug = self._family_slug(url, sku)
        canonical_key = family_slug if family_slug.startswith('hp-') else f"hp-{family_slug}"
        product_id = generate_product_id('hp', canonical_key)

        variant_name = sku or product_name
        variant = ProductVariant(
            variant_id=generate_variant_id('hp', canonical_key, variant_name),
            name=variant_name,
            sku=sku,
            specs=specs,
            price=sale_price,
            currency=currency,
            source_url=canonicalize_url(url),
        )

        product = Product(
            product_id=product_id,
            canonical_key=canonical_key,
            manufacturer='hp',
            brand='HP',
            name=product_name,
            category=self.get_category_from_url(url),
            series=self.get_series_from_url(url),
            subcategory=category_info.get('slug', ''),
            url=canonicalize_url(url),
            region=self.region.code,
            variants=[variant],
            source_urls=[canonicalize_url(url)],
            msrp=list_price,
            currency=currency,
            family_id=canonical_key,
        )

        datasheet = self._extract_datasheet_url(soup)
        if datasheet:
            product.add_source_url(datasheet)

        return product

    def _extract_product_name(self, soup: BeautifulSoup, url: str) -> str:
        for selector in ('h1', 'meta[property="og:title"]'):
            element = soup.select_one(selector)
            if element is None:
                continue
            if element.name == 'meta':
                name = clean_text(element.get('content', ''))
            else:
                name = clean_text(element.get_text())
            if name and len(name) > 3:
                return self._clean_product_name(name)
        return self._slug_of(url).replace('-', ' ').title()

    def _clean_product_name(self, name: str) -> str:
        name = re.sub(r'\s*[\(\[].*?[\)\]]\s*$', '', name)
        name = re.sub(r'\s*\|\s*HP.*$', '', name, flags=re.IGNORECASE)
        name = re.sub(r'\s*-\s*HP Store.*$', '', name, flags=re.IGNORECASE)
        return name.strip()

    def _extract_sku(self, soup: BeautifulSoup) -> str:
        """Read the HP order code (e.g. ``E5SM2PA#ACJ``) from the page."""
        specs_section = soup.select_one(self.selectors['techspec_section'])
        for element in soup.select(self.selectors['typography']):
            if specs_section is not None and element in specs_section.descendants:
                continue
            text = clean_text(element.get_text())
            if text and self.SKU_PATTERN.match(text):
                return text
        return ""

    def _extract_prices(self, soup: BeautifulSoup) -> Tuple[Optional[float], Optional[float], str]:
        """Return (sale price, list price, currency)."""
        currency = self.region.currency

        sale_element = soup.select_one(self.selectors['price_sale'])
        sale_price = self._parse_price(sale_element.get_text()) if sale_element else None
        if sale_element is not None:
            currency = self._currency_of(sale_element.get_text(), currency)

        list_element = soup.select_one(self.selectors['price_list'])
        list_price = self._parse_price(list_element.get_text()) if list_element else None
        if list_element is not None and sale_price is None:
            currency = self._currency_of(list_element.get_text(), currency)

        return sale_price, list_price, currency

    def _parse_price(self, text: str) -> Optional[float]:
        match = re.search(r'([\d,]+(?:\.\d+)?)', clean_text(text))
        if not match:
            return None
        try:
            return float(match.group(1).replace(',', ''))
        except ValueError:
            return None

    def _currency_of(self, text: str, default: str) -> str:
        for symbol, code in self.CURRENCY_SYMBOLS.items():
            if symbol in text:
                return code
        return default

    def _extract_datasheet_url(self, soup: BeautifulSoup) -> Optional[str]:
        downloads = soup.select_one(self.selectors['techspec_downloads'])
        if downloads is None:
            return None
        link = downloads.select_one('a[href]')
        if link is None:
            return None
        href = link.get('href')
        if not href:
            return None
        return urljoin(self.region.base_url, href)

    # ------------------------------------------------------------------
    # Specifications
    # ------------------------------------------------------------------

    def _extract_tech_specs(self, soup: BeautifulSoup) -> Dict[str, SpecValue]:
        """Read the technical specification table of the product page.

        The table is server rendered inside the ``tech-specs`` block: one
        ``detailedSpecWithSubSpecs`` group per topic, each group holding one
        row per specification (a name cell and a value cell).
        """
        specs: Dict[str, SpecValue] = {}

        for group_name, rows in self._spec_groups(soup):
            if group_name.strip().lower() in self.SKIP_GROUPS:
                continue
            for spec_name, value in rows:
                key = self._standard_spec_key(spec_name, group_name)
                if key in specs:
                    # The same row name appears twice inside one group (HP
                    # publishes a short and a long display line, for example).
                    # Both values are kept, the second one under a qualified
                    # key instead of overwriting the first.
                    key = f"{key}_{self._normalize(group_name)}"
                specs[key] = self._parse_spec_field(key, value, source_field=spec_name)

        return specs

    def _spec_groups(self, soup: BeautifulSoup) -> List[Tuple[str, List[Tuple[str, str]]]]:
        """Return ``[(group title, [(spec name, value)])]`` of the spec table."""
        groups: List[Tuple[str, List[Tuple[str, str]]]] = []

        for group in soup.select(self.selectors['techspec_group']):
            title = self._group_title(group)
            rows: List[Tuple[str, str]] = []

            for name_element in group.select(self.selectors['typography']):
                if name_element.name != 'p':
                    continue
                spec_name = clean_text(name_element.get_text())
                if not spec_name or spec_name.lower() in self.SKIP_ROWS:
                    continue
                value = self._row_value(name_element)
                if not value or self._is_noise(value):
                    continue
                rows.append((spec_name, value))

            if rows:
                groups.append((title, rows))

        return groups

    def _group_title(self, group) -> str:
        """The topic of a spec group is its first child that holds no row."""
        for child in group.find_all(recursive=False):
            if child.name == 'div' and not child.select(self.selectors['typography']):
                title = clean_text(child.get_text())
                if title:
                    return title
        return ""

    def _row_value(self, name_element) -> str:
        """Read the value cell that belongs to a specification name cell."""
        row = name_element.parent.parent if name_element.parent else None
        if row is None:
            return ""
        cells = [c for c in row.find_all(recursive=False) if c.name in ('div', 'p')]
        if len(cells) < 2:
            return ""
        value = clean_text(cells[1].get_text(" ", strip=True))
        return self._strip_footnotes(value)

    @staticmethod
    def _strip_footnotes(value: str) -> str:
        """Remove the trailing footnote markers HP appends to a value."""
        return re.sub(r'\s*\[\d+(?:\s*,\s*\d+)*\]\s*$', '', value).strip()

    @staticmethod
    def _is_noise(value: str) -> bool:
        """Values that carry no information: bare URLs and footnote markers."""
        if value.startswith('http://') or value.startswith('https://'):
            return True
        return bool(re.fullmatch(r'\[\d+(?:\s*,\s*\d+)*\]', value))

    @staticmethod
    def _normalize(name: str) -> str:
        return re.sub(r'[^a-z0-9]+', '_', name.strip().lower()).strip('_')

    def _standard_spec_key(self, spec_name: str, group_name: str) -> str:
        """Map an HP row name to a Veridian spec key."""
        lowered = spec_name.strip().lower()
        mapped = self.SPEC_KEY_MAPPING.get(lowered)
        if mapped:
            return mapped
        # Fall back to the row name, qualified with the group so that rows
        # with the same name in different groups do not collide.
        if group_name:
            return f"{self._normalize(group_name)}_{self._normalize(spec_name)}"
        return self._normalize(spec_name)

    def _parse_spec_field(self, key: str, value: str, source_field: str = None) -> SpecValue:
        """Parse an HP specification value into a :class:`SpecValue`.

        The shared parser in ``models`` is written for ASUS style values; HP
        writes "8 GB DDR5-5600 MT/s" and "31.45 x 22.6 x 1.48 cm", which that
        parser mangles (it splits "MT/s" at the slash and does not read
        centimetres), so the HP fields are parsed here.
        """
        structured = self._extract_structured(key, value)

        options: List[str] = []
        is_multi = False
        if key == 'ports':
            parts = [part.strip() for part in re.split(r';', value) if part.strip()]
            if len(parts) > 1:
                options = parts
                is_multi = True

        return SpecValue(
            raw=value,
            structured=structured if structured else None,
            unit=self._unit_for(key),
            is_multi_option=is_multi,
            options=options,
            confidence=0.9 if structured else 0.5,
            source_field=source_field or key,
        )

    def _extract_structured(self, key: str, value: str) -> Optional[Dict[str, Any]]:
        """Structured data for the HP specification fields."""
        result: Dict[str, Any] = {}
        lowered = key.lower()

        if lowered == 'processor':
            brand = re.search(r'\b(Intel|AMD|Qualcomm|Snapdragon|Apple)\b', value)
            if brand:
                result['brand'] = brand.group(1)
            model = re.search(r'(Core™?\s*\w+\s*\d+|Ryzen™?\s*[\w\s]*?\d+|Snapdragon\s*X?\s*\w+\s*\d+)', value)
            if model:
                result['model'] = model.group(1).strip()
            cores = re.search(r'(\d+)\s*cores?', value, re.IGNORECASE)
            if cores:
                result['cores'] = int(cores.group(1))
            threads = re.search(r'(\d+)\s*threads?', value, re.IGNORECASE)
            if threads:
                result['threads'] = int(threads.group(1))
            boost = re.search(r'up\s+to\s+(\d+(?:\.\d+)?)\s*GHz', value, re.IGNORECASE)
            if boost:
                result['boost_freq_ghz'] = float(boost.group(1))
            base = re.search(r'(\d+(?:\.\d+)?)\s*GHz', value)
            if base and 'boost_freq_ghz' not in result:
                result['base_freq_ghz'] = float(base.group(1))
            cache = re.search(r'(\d+)\s*MB\s*(?:L3\s*)?[Cc]ache', value)
            if cache:
                result['cache_mb'] = int(cache.group(1))

        elif lowered == 'processor_cores':
            cores = re.search(r'(\d+)', value)
            if cores:
                result['cores'] = int(cores.group(1))

        elif lowered == 'processor_cache':
            cache = re.search(r'(\d+)\s*MB', value, re.IGNORECASE)
            if cache:
                result['cache_mb'] = int(cache.group(1))

        elif lowered == 'neural_processor':
            tops = re.search(r'(\d+(?:\.\d+)?)\s*(?:NPU\s*)?TOPS', value, re.IGNORECASE)
            if tops:
                result['npu_tops'] = float(tops.group(1))
            brand = re.search(r'\b(Intel|AMD|Qualcomm|Apple)\b', value)
            if brand:
                result['brand'] = brand.group(1)

        elif lowered == 'memory':
            capacity = re.search(r'(\d+)\s*GB', value, re.IGNORECASE)
            if capacity:
                result['capacity_gb'] = int(capacity.group(1))
            memory_type = re.search(r'(LPDDR\d+X?|DDR\d+)', value, re.IGNORECASE)
            if memory_type:
                result['type'] = memory_type.group(1).upper()
            speed = re.search(r'(\d+)\s*MT/s', value, re.IGNORECASE)
            if speed:
                result['speed_mts'] = int(speed.group(1))
            modules = re.search(r'\(\s*(\d+)\s*x\s*(\d+)\s*GB\s*\)', value)
            if modules:
                result['modules'] = int(modules.group(1))
                result['module_size_gb'] = int(modules.group(2))

        elif lowered == 'memory_layout':
            modules = re.search(r'(\d+)\s*x\s*(\d+)\s*GB', value)
            if modules:
                result['modules'] = int(modules.group(1))
                result['module_size_gb'] = int(modules.group(2))

        elif lowered == 'storage':
            capacity = re.search(r'(\d+)\s*(TB|GB)', value, re.IGNORECASE)
            if capacity:
                size = int(capacity.group(1))
                unit = capacity.group(2).upper()
                result['capacity_gb'] = size * 1024 if unit == 'TB' else size
            if re.search(r'NVMe', value, re.IGNORECASE):
                result['interface'] = 'NVMe'
            elif re.search(r'SATA', value, re.IGNORECASE):
                result['interface'] = 'SATA'
            pcie = re.search(r'PCIe[®\s]*(?:Gen\s*)?(\d+\.?\d*)', value, re.IGNORECASE)
            if pcie:
                result['pcie_version'] = pcie.group(1)
            if re.search(r'M\.?2', value, re.IGNORECASE):
                result['form_factor'] = 'M.2'

        elif lowered == 'display':
            size = re.search(r'(\d+(?:\.\d+)?)\s*(?:"|inch)', value, re.IGNORECASE)
            if size:
                result['size_inches'] = float(size.group(1))
            resolution = re.search(r'(\d{3,5})\s*[x×]\s*(\d{3,5})', value)
            if resolution:
                result['width_px'] = int(resolution.group(1))
                result['height_px'] = int(resolution.group(2))
                result['resolution'] = f"{resolution.group(1)}x{resolution.group(2)}"
            for panel in ('OLED', 'IPS', 'TN', 'VA', 'Mini LED', 'Micro LED'):
                if panel.lower() in value.lower():
                    result['panel_type'] = panel
                    break
            nits = re.search(r'(\d+)\s*nits', value, re.IGNORECASE)
            if nits:
                result['brightness_nits'] = int(nits.group(1))
            refresh = re.search(r'(\d+)\s*Hz', value, re.IGNORECASE)
            if refresh:
                result['refresh_rate_hz'] = int(refresh.group(1))
            gamut = re.search(r'([\d.]+%\s*sRGB)', value, re.IGNORECASE)
            if gamut:
                result['color_gamut'] = gamut.group(1)

        elif lowered == 'graphics':
            for brand in ('NVIDIA', 'AMD', 'Intel', 'Qualcomm', 'Apple'):
                if brand.lower() in value.lower():
                    result['brand'] = brand
                    break
            model = re.search(r'(RTX\s*\d{4}\w*|GTX\s*\d{4}\w*|Radeon\s*[\w\s]+\d{4}\w*|Arc\s*\w+|Iris\s*\w+|UHD\s*\w+)', value)
            if model:
                result['model'] = model.group(1).strip()
            vram = re.search(r'(\d+)\s*GB\s*GDDR', value, re.IGNORECASE)
            if vram:
                result['vram_gb'] = int(vram.group(1))

        elif lowered == 'battery':
            wh = re.search(r'(\d+)\s*Wh', value, re.IGNORECASE)
            if wh:
                result['capacity_wh'] = int(wh.group(1))
            cells = re.search(r'(\d+)\s*-?\s*cell', value, re.IGNORECASE)
            if cells:
                result['cells'] = int(cells.group(1))

        elif lowered == 'weight':
            kg = re.search(r'(\d+(?:\.\d+)?)\s*kg', value, re.IGNORECASE)
            if kg:
                result['weight_kg'] = float(kg.group(1))
            lbs = re.search(r'(\d+(?:\.\d+)?)\s*lbs?', value, re.IGNORECASE)
            if lbs:
                result['weight_lbs'] = float(lbs.group(1))

        elif lowered == 'dimensions':
            cm = re.search(r'(\d+(?:\.\d+)?)\s*x\s*(\d+(?:\.\d+)?)\s*x\s*(\d+(?:\.\d+)?)\s*cm', value)
            if cm:
                result['width_mm'] = float(cm.group(1)) * 10
                result['depth_mm'] = float(cm.group(2)) * 10
                result['height_mm'] = float(cm.group(3)) * 10
                result['dimensions_cm'] = f"{cm.group(1)} x {cm.group(2)} x {cm.group(3)}"

        elif lowered == 'network':
            wifi = re.search(r'Wi-?Fi\s*(\d+(?:\.\d+)?|6E|7)', value, re.IGNORECASE)
            if wifi:
                result['wifi_standard'] = f"Wi-Fi {wifi.group(1)}"
            bluetooth = re.search(r'Bluetooth[®\s]*(\d+(?:\.\d+)?)', value, re.IGNORECASE)
            if bluetooth:
                result['bluetooth_version'] = bluetooth.group(1)

        elif lowered == 'camera':
            if re.search(r'\b1080p\b', value, re.IGNORECASE):
                result['resolution'] = '1080p'
            elif re.search(r'\b720p\b', value, re.IGNORECASE):
                result['resolution'] = '720p'
            elif re.search(r'\b4K\b', value):
                result['resolution'] = '4K'

        elif lowered == 'os':
            result['operating_system'] = value

        return result if result else None

    @staticmethod
    def _unit_for(key: str) -> Optional[str]:
        return {
            'processor': 'GHz',
            'memory': 'GB',
            'memory_layout': 'GB',
            'storage': 'GB',
            'display': 'inches',
            'battery': 'Wh',
            'weight': 'kg',
            'dimensions': 'mm',
            'package_dimensions': 'mm',
        }.get(key.lower())

    def _family_slug(self, url: str, sku: str) -> str:
        """The family slug of a product URL.

        HP appends the order code to the product slug
        (``...-ht0218tu-e5sm2pa-acj`` for ``E5SM2PA#ACJ``), so the family slug
        is the product slug without that suffix. All configurations of one
        family therefore share a canonical key and end up as the variants of
        a single product.
        """
        slug = self._slug_of(url)
        if sku:
            suffix = '-' + sku.lower().replace('#', '-')
            if slug.endswith(suffix):
                return slug[:-len(suffix)]
            if slug.endswith(sku.lower()):
                return slug[:-len(sku)]
        return slug


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

    config = ScraperConfig(
        manufacturer='hp',
        brand='HP',
        base_url='https://www.hp.com/',
        regions=regions,
        output_dir='./output',
        max_concurrent=2,
        retry_attempts=3,
        checkpoint_interval=10
    )

    return apply_yaml_config(config)


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
