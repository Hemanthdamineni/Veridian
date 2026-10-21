"""
Veridian Scraper - LG Scraper Implementation

What LG actually publishes
--------------------------

* The listing lives at ``/us/laptops/``.  The page renders the catalogue
  client side, but it also publishes the whole product list as a schema.org
  ``ItemList`` inside a ``CollectionPage`` block, with the product URL, the
  model code and the published price for every entry.  That block is read for
  discovery.
* A product page (``/us/laptops/<model>``) publishes its specification table
  in the Next.js page payload that is server-rendered into the response
  (``script#__NEXT_DATA__`` -> ``props.pageProps.productData.allInfo``).
  The payload holds the specification groups ("Processor", "Hard Drive",
  "Display", "Connectivity", "Battery/Power", "Dimensions/Weight", ...) and,
  in every entry, the published term and its published description.
* The same page publishes a schema.org ``Product`` block with the list price
  and the availability.

The payload is the JSON the page itself is rendered from, so it is read out of
the server-rendered response instead of being requested again: the Next.js
data route (``/_next/data/<buildId>/...``) answers 404 for this site.
"""

import asyncio
import json
import re
from typing import AsyncIterator, Dict, List, Optional
from urllib.parse import urljoin, urlparse

from bs4 import BeautifulSoup

from .base import (
    BaseScraper, ScraperConfig, RegionConfig, apply_yaml_config,
    Product, ProductVariant, ProductCategory, ProductStatus,
    SpecValue,
    generate_product_id, generate_variant_id,
    canonicalize_url, extract_canonical_key,
    clean_text, parse_spec_field
)


# Term of the published specification table -> Veridian spec key.
LG_SPEC_KEYS = {
    'operating system': 'operating_system',
    'core processor': 'processor',
    'ram': 'memory',
    'storage': 'storage',
    'screen size': 'display',
    'screen type': 'screen_type',
    'display type': 'display_type',
    'resolution': 'display_resolution',
    'color gamut': 'color_gamut',
    'graphics': 'graphics',
    'battery': 'battery',
    'weight': 'weight',
    'dimensions (wxhxd)': 'dimensions',
    'shipping dimensions (wxhxd)': 'shipping_dimensions',
    'shipping weight': 'shipping_weight',
    'bluetooth': 'bluetooth_version',
    'wireless': 'network',
    'speakers': 'audio',
    'webcam resolution': 'camera',
    'hdmi': 'ports_hdmi',
    'usb-a': 'ports_usb_a',
    'usb-c': 'ports_usb_c',
    'headphone out': 'ports_headphone_out',
    'model year': 'model_year',
    'upc': 'upc',
    'country of origin': 'country_of_origin',
    'limited warranty': 'warranty',
}

_LBS_RE = re.compile(r'(\d+(?:\.\d+)?)\s*lbs?', re.IGNORECASE)
_INCHES_RE = re.compile(
    r'(\d+(?:\.\d+)?)\s*"\s*[xX]\s*(\d+(?:\.\d+)?)\s*"\s*[xX]\s*(\d+(?:\.\d+)?)\s*"')
_RESOLUTION_RE = re.compile(r'(\d+)\s*[xX×]\s*(\d+)')
_WIFI_RE = re.compile(r'Wi-?Fi\s*(\d+|6E|7|[0-9]\.[0-9])', re.IGNORECASE)
# LG also publishes the standard as the 802.11 name, e.g. "802.11ax".
_WIFI_802_RE = re.compile(r'802\.11\s*([a-z]{2})', re.IGNORECASE)
_WIFI_802_NAMES = {'a': '5', 'b': '6', 'be': '7', 'ax': '6', 'n': '4'}
_BLUETOOTH_RE = re.compile(r'BT\s*(\d+\.\d+)|Bluetooth[^0-9]*(\d+\.\d+)', re.IGNORECASE)


def _processor_facts(text: str) -> Dict[str, object]:
    """Pull the structured facts out of a published processor string."""
    facts: Dict[str, object] = {}
    lowered = text.lower()
    for brand in ('Intel', 'AMD', 'Qualcomm', 'Apple'):
        if brand.lower() in lowered:
            facts['brand'] = brand
            break

    match = re.search(r'Core\s*™?\s*Ultra\s+\d+\s*(\w+)', text, re.IGNORECASE)
    if match:
        facts['model'] = f"Core Ultra {re.search(r'Core\s*™?\s*Ultra\s+(\d+)', text, re.IGNORECASE).group(1)} {match.group(1)}"
    else:
        match = re.search(r'(Ryzen\s*™?\s*(?:AI\s*)?\d+\s*[A-Za-z]*)', text, re.IGNORECASE)
        if match:
            facts['model'] = match.group(1).replace('™', '').strip()
        else:
            match = re.search(r'(Snapdragon\s*®?\s*X[\w\s\-]*)', text, re.IGNORECASE)
            if match:
                facts['model'] = re.sub(r'\s+', ' ', match.group(1).replace('®', '')).strip()

    cores = re.search(r'(\d+)\s*Cores?', text, re.IGNORECASE)
    if cores:
        facts['cores'] = int(cores.group(1))

    # "P: 1.4 up to 4.8 GHz" - the published base and boost clock.
    clocks = re.search(r'(\d+(?:\.\d+)?)\s*(?:GHz)?\s*up\s+to\s+(\d+(?:\.\d+)?)\s*GHz',
                        text, re.IGNORECASE)
    if clocks:
        facts['base_frequency_ghz'] = float(clocks.group(1))
        facts['boost_frequency_ghz'] = float(clocks.group(2))
    else:
        boost = re.search(r'up\s+to\s+(\d+(?:\.\d+)?)\s*GHz', text, re.IGNORECASE)
        if boost:
            facts['boost_frequency_ghz'] = float(boost.group(1))

    cache = re.search(r'(\d+)\s*MB\s*(?:Smart\s*)?Cache', text, re.IGNORECASE)
    if cache:
        facts['cache_mb'] = int(cache.group(1))
    return facts


class LGScraper(BaseScraper):
    """LG laptop scraper.

    The extraction is driven by two structural hooks that the site keeps
    stable:

    * the schema.org ``ItemList`` on the listing page - the published
      catalogue with model code and price.
    * the ``script#__NEXT_DATA__`` payload on a product page - the published
      specification table, plus the schema.org ``Product`` block with the
      list price and the availability.
    """

    CATEGORY_MAPPING = {
        'laptops': ProductCategory.LAPTOPS,
        'gram': ProductCategory.LAPTOPS,
        'monitors': ProductCategory.MONITORS,
    }

    SERIES_MAPPING = {
        'gram': 'LG gram',
        'ultragear': 'UltraGear',
    }

    def __init__(self, config: ScraperConfig, region: RegionConfig):
        super().__init__(config, region)

        self.selectors = {
            'product_link': 'a[href*="/laptops/"]',
        }
        if region.selectors:
            self.selectors.update(region.selectors)

    # -- categories --------------------------------------------------------

    def get_category_from_url(self, url: str) -> ProductCategory:
        path = urlparse(url).path.lower()
        if '/laptops/' in path:
            return ProductCategory.LAPTOPS
        if '/monitors/' in path:
            return ProductCategory.MONITORS
        return ProductCategory.UNKNOWN

    def get_series_from_url(self, url: str) -> str:
        path = urlparse(url).path.lower()
        for part, series in self.SERIES_MAPPING.items():
            if part in path:
                return series
        return ''

    async def discover_categories(self) -> List[Dict[str, str]]:
        """Build the category list from the configured, region relative paths."""
        categories = []
        if self.region.category_paths:
            for cat_name, cat_path in self.region.category_paths.items():
                categories.append({
                    'name': cat_name,
                    'slug': cat_name,
                    'url': urljoin(self.region.base_url, cat_path),
                    'category_type': self.CATEGORY_MAPPING.get(cat_name, ProductCategory.LAPTOPS),
                })
        else:
            categories.append({
                'name': 'laptops',
                'slug': 'laptops',
                'url': urljoin(self.region.base_url, 'laptops/'),
                'category_type': ProductCategory.LAPTOPS,
            })
        return categories

    # -- discovery ---------------------------------------------------------

    async def discover_products(self, category_url: str, category_info: Dict) -> AsyncIterator[str]:
        """Discover the product pages published on the listing page.

        LG renders the catalogue client side, but the same page publishes the
        complete list as a schema.org ``ItemList``.  That block is preferred
        because it also carries the model code; the anchors of the page are
        the fallback.
        """
        try:
            soup = await self.http_client.get_soup(category_url)
        except Exception as exc:  # pragma: no cover - network dependent
            self.logger.error("Failed to fetch %s: %s", category_url, exc)
            return

        urls = set()
        for entry in self._schema_item_list(soup):
            url = entry.get('url')
            if url:
                urls.add(canonicalize_url(url))

        if not urls:
            for anchor in soup.select(self.selectors['product_link']):
                href = anchor.get('href')
                if not href:
                    continue
                url = urljoin(self.region.base_url, href)
                if '/laptops/' in urlparse(url).path:
                    urls.add(canonicalize_url(url))

        self.logger.debug("Found %d LG product pages", len(urls))
        for url in sorted(urls):
            yield url

    @staticmethod
    def _schema_item_list(soup: BeautifulSoup) -> List[Dict]:
        """Return the product entries of the page's schema.org ItemList."""
        entries: List[Dict] = []
        for script in soup.find_all('script', type='application/ld+json'):
            try:
                data = json.loads(script.string or '')
            except (json.JSONDecodeError, TypeError, ValueError):
                continue
            candidates = data if isinstance(data, list) else [data]
            for candidate in candidates:
                if not isinstance(candidate, dict):
                    continue
                main = candidate.get('mainEntity')
                if isinstance(main, dict) and 'itemListElement' in main:
                    for element in main.get('itemListElement') or []:
                        if isinstance(element, dict):
                            entries.append(element)
        return entries

    # -- extraction --------------------------------------------------------

    async def extract_product(self, url: str, category_info: Dict) -> Optional[Product]:
        """Extract one LG product page."""
        try:
            soup = await self.http_client.get_soup(url)
        except Exception as exc:
            self.logger.error("Failed to fetch product page %s: %s", url, exc)
            return None

        product_json = self._json_ld_product(soup)
        payload = self._next_data(soup)
        page_props = payload.get('props', {}).get('pageProps', {}) if payload else {}
        product_data = page_props.get('productData', {}) or {}
        product = product_data.get('product', {}) or {}
        price_data = page_props.get('productPriceData', {}).get('price', {}) or {}

        name = product.get('title') or (product_json.get('name') or '').strip()
        sku = product.get('sku') or ''
        specs = self._specs_from_all_info(product_data.get('allInfo') or [])

        msrp = self._price_value(price_data.get('msrp'))
        final_price = self._price_value(price_data.get('finalPrice'))
        if msrp is None:
            msrp = self._offer_price(product_json)
        if final_price is None:
            final_price = self._offer_price(product_json)
        currency = (price_data.get('currency') or 'USD')
        availability = self._published_availability(product_json)

        canonical_key = extract_canonical_key(url, 'lg')
        variant = ProductVariant(
            variant_id=generate_variant_id('lg', canonical_key, sku or name),
            name=name,
            sku=sku,
            specs=specs,
            price=final_price,
            currency=currency,
            availability=availability,
            status=self._status_from_availability(availability),
            source_url=canonicalize_url(url),
        )

        return Product(
            product_id=generate_product_id('lg', canonical_key),
            canonical_key=canonical_key,
            manufacturer='lg',
            brand='LG',
            name=name,
            category=self.get_category_from_url(url),
            series=self.get_series_from_url(url),
            subcategory=category_info.get('slug', ''),
            url=canonicalize_url(url),
            region=self.region.code,
            variants=[variant],
            source_urls=[canonicalize_url(url)],
            msrp=msrp,
            currency=currency,
            availability=availability,
            status=self._status_from_availability(availability),
            family_id=f"lg-{sku.lower()}" if sku else f"lg-{canonical_key}",
        )

    # -- specification table -----------------------------------------------

    def _specs_from_all_info(self, groups: List[Dict]) -> Dict[str, SpecValue]:
        """Turn the published specification groups into Veridian specs."""
        specs: Dict[str, SpecValue] = {}
        for group in groups:
            if not isinstance(group, dict):
                continue
            subtitle = clean_text(group.get('subtitle') or '')
            for entry in group.get('tableData') or []:
                if not isinstance(entry, dict):
                    continue
                term = clean_text(entry.get('term') or '')
                description = clean_text(entry.get('description') or '')
                if not term or not description:
                    continue
                key = self._standard_spec_key(term)
                if key is None or key in specs:
                    continue
                specs[key] = self._spec_value(key, description, source_field=term or subtitle)
        return specs

    @staticmethod
    def _standard_spec_key(term: str) -> Optional[str]:
        """Map a published term to a Veridian spec key."""
        normalised = re.sub(r'[^a-z0-9 &()\-/.]', '', term.lower()).strip()
        normalised = re.sub(r'\s+', ' ', normalised)
        if not normalised:
            return None
        if normalised in LG_SPEC_KEYS:
            return LG_SPEC_KEYS[normalised]
        slug = re.sub(r'[^a-z0-9]+', '_', normalised).strip('_')
        return slug or None

    def _spec_value(self, key: str, value: str, source_field: str = '') -> SpecValue:
        """Build a :class:`SpecValue`, with LG specific parsing."""
        if key == 'processor':
            structured = _processor_facts(value)
            if structured:
                return SpecValue(raw=value, structured=structured, unit='GHz',
                                 confidence=0.9, source_field=source_field)
        elif key == 'memory':
            structured = self._parse_memory(value)
            if structured:
                return SpecValue(raw=value, structured=structured, unit='GB',
                                 confidence=0.9, source_field=source_field)
        elif key == 'storage':
            structured = self._parse_storage(value)
            if structured:
                return SpecValue(raw=value, structured=structured, unit='GB',
                                 confidence=0.9, source_field=source_field)
        elif key == 'network':
            structured = self._parse_network(value)
            if structured:
                return SpecValue(raw=value, structured=structured,
                                 confidence=0.9, source_field=source_field)
        elif key == 'bluetooth_version':
            match = _BLUETOOTH_RE.search(value)
            if match:
                version = match.group(1) or match.group(2)
                return SpecValue(raw=value, structured={'version': version},
                                 confidence=0.9, source_field=source_field)
        elif key == 'dimensions' or key == 'shipping_dimensions':
            inches = _INCHES_RE.search(value)
            if inches:
                # LG publishes the size as width x height x depth.
                return SpecValue(
                    raw=value,
                    structured={
                        'width_in': float(inches.group(1)),
                        'height_in': float(inches.group(2)),
                        'depth_in': float(inches.group(3)),
                    },
                    unit='inches', confidence=0.9, source_field=source_field)
        elif key == 'display_resolution':
            match = _RESOLUTION_RE.search(value)
            if match:
                return SpecValue(
                    raw=value,
                    structured={
                        'width_px': int(match.group(1)),
                        'height_px': int(match.group(2)),
                        'resolution': f"{match.group(1)}x{match.group(2)}",
                    },
                    confidence=0.9, source_field=source_field)
        elif key == 'weight':
            match = _LBS_RE.search(value)
            if match:
                return SpecValue(raw=value, structured={'weight_lbs': float(match.group(1))},
                                 unit='lbs', confidence=0.9, source_field=source_field)

        return parse_spec_field(key, value)

    @staticmethod
    def _parse_memory(value: str) -> Optional[Dict[str, object]]:
        """Read the published memory capacity, type and speed."""
        structured: Dict[str, object] = {}
        capacity = re.search(r'(\d+)\s*GB', value, re.IGNORECASE)
        if capacity:
            structured['capacity_gb'] = int(capacity.group(1))
        memory_type = re.search(r'(LPDDR\d+X?|DDR\d+)', value, re.IGNORECASE)
        if memory_type:
            structured['type'] = memory_type.group(1).upper()
        speed = re.search(r'(\d+)\s*MHz', value, re.IGNORECASE)
        if speed:
            structured['speed_mts'] = int(speed.group(1))
        if 'dual channel' in value.lower():
            structured['channels'] = 2
        return structured or None

    @staticmethod
    def _parse_storage(value: str) -> Optional[Dict[str, object]]:
        """Read the published storage capacity, interface and form factor."""
        structured: Dict[str, object] = {}
        capacity = re.search(r'(\d+)\s*(TB|GB)', value, re.IGNORECASE)
        if capacity:
            size = int(capacity.group(1))
            structured['capacity_gb'] = size * 1024 if capacity.group(2).upper() == 'TB' else size
        if 'nvme' in value.lower():
            structured['interface'] = 'NVMe'
        elif 'sata' in value.lower():
            structured['interface'] = 'SATA'
        if 'm.2' in value.lower() or 'm2' in value.lower():
            structured['form_factor'] = 'M.2'
        return structured or None

    @staticmethod
    def _parse_network(value: str) -> Optional[Dict[str, object]]:
        """Read the published wireless standard."""
        structured: Dict[str, object] = {}
        wifi = _WIFI_RE.search(value)
        if wifi:
            structured['wifi_standard'] = f"Wi-Fi {wifi.group(1)}"
        else:
            named = _WIFI_802_RE.search(value)
            if named:
                standard = _WIFI_802_NAMES.get(named.group(1).lower())
                if standard:
                    structured['wifi_standard'] = f"Wi-Fi {standard}"
        return structured or None

    # -- helpers -----------------------------------------------------------

    @staticmethod
    def _json_ld_product(soup: BeautifulSoup) -> Dict:
        """Return the schema.org Product block of the page, if it has one."""
        for script in soup.find_all('script', type='application/ld+json'):
            try:
                data = json.loads(script.string or '')
            except (json.JSONDecodeError, TypeError, ValueError):
                continue
            candidates = data if isinstance(data, list) else [data]
            for candidate in candidates:
                if isinstance(candidate, dict) and candidate.get('@type') == 'Product':
                    return candidate
        return {}

    @staticmethod
    def _next_data(soup: BeautifulSoup) -> Dict:
        """Return the Next.js page payload of the page, if it has one."""
        script = soup.find('script', id='__NEXT_DATA__')
        if script is None:
            return {}
        try:
            return json.loads(script.string or '{}')
        except (json.JSONDecodeError, TypeError, ValueError):
            return {}

    @staticmethod
    def _price_value(entry) -> Optional[float]:
        """Read a published price object."""
        if isinstance(entry, dict):
            value = entry.get('value')
        else:
            value = entry
        if value is None:
            return None
        try:
            return float(value)
        except (TypeError, ValueError):
            return None

    @staticmethod
    def _offer_price(product_json: Dict) -> Optional[float]:
        """The price published in the schema.org offer."""
        offers = (product_json or {}).get('offers') or {}
        if isinstance(offers, list):
            offers = offers[0] if offers else {}
        price = offers.get('price')
        if price is None:
            return None
        try:
            return float(price)
        except (TypeError, ValueError):
            return None

    @staticmethod
    def _published_availability(product_json: Dict) -> Optional[str]:
        """The availability published in the schema.org offer."""
        offers = (product_json or {}).get('offers') or {}
        if isinstance(offers, list):
            offers = offers[0] if offers else {}
        raw = offers.get('availability')
        if not raw:
            return None
        if 'InStock' in raw:
            return 'In Stock'
        if 'OutOfStock' in raw:
            return 'Out of Stock'
        if 'PreOrder' in raw or 'PreSale' in raw:
            return 'Pre-order'
        if 'Discontinued' in raw:
            return 'Discontinued'
        if 'LimitedAvailability' in raw:
            return 'Limited Availability'
        return raw

    @staticmethod
    def _status_from_availability(availability: Optional[str]) -> ProductStatus:
        if not availability:
            return ProductStatus.UNKNOWN
        lowered = availability.lower()
        if 'discontinued' in lowered:
            return ProductStatus.DISCONTINUED
        if 'pre-order' in lowered or 'preorder' in lowered:
            return ProductStatus.ANNOUNCED
        if 'in stock' in lowered:
            return ProductStatus.CURRENT
        if 'out of stock' in lowered:
            return ProductStatus.CURRENT
        return ProductStatus.UNKNOWN


# =============================================================================
# CONFIGURATION
# =============================================================================

def create_lg_config() -> ScraperConfig:
    """Create the LG scraper configuration.

    The YAML file is authoritative for the base URL and for the region list
    (category paths, rate limit, timeout).
    """
    regions = [
        RegionConfig(
            code='us',
            name='United States',
            base_url='https://www.lg.com/us/',
            language='en',
            currency='USD',
            category_paths={
                'laptops': 'laptops/',
            },
            rate_limit=0.5,
            timeout=30,
        ),
    ]

    config = ScraperConfig(
        manufacturer='lg',
        brand='LG',
        base_url='https://www.lg.com/',
        regions=regions,
        output_dir='./output',
        max_concurrent=2,
        retry_attempts=3,
        checkpoint_interval=10,
    )

    return apply_yaml_config(config)


async def run_lg_scraper(regions: List[str] = None):
    """Run the LG scraper for the requested regions."""
    config = create_lg_config()

    if regions:
        target_regions = [r for r in config.regions if r.code in regions]
    else:
        target_regions = config.regions

    all_products = []

    for region in target_regions:
        scraper = LGScraper(config, region)
        scraper.load_checkpoint()

        products = await scraper.scrape()
        all_products.extend(products)

        from ..models import export_products_json, export_products_csv
        from pathlib import Path
        from datetime import datetime

        output_dir = Path(config.output_dir) / region.code
        output_dir.mkdir(parents=True, exist_ok=True)

        timestamp = datetime.now().strftime('%Y%m%d_%H%M%S')
        export_products_json(products, str(output_dir / f"lg_products_{region.code}_{timestamp}.json"))
        export_products_csv(products, str(output_dir / f"lg_products_{region.code}_{timestamp}.csv"))

        print(f"Region {region.code}: {len(products)} products")

    return all_products


if __name__ == '__main__':
    import sys
    regions = sys.argv[1:] if len(sys.argv) > 1 else None
    asyncio.run(run_lg_scraper(regions))
