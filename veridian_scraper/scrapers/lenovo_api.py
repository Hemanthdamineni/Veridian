"""
Veridian Scraper - Lenovo official feed (PSREF JSON API) implementation.

Lenovo publishes its complete product specification reference as a JSON API
on ``psref.lenovo.com``. That host publishes no ``robots.txt`` (the request
answers 404), which RFC 9309 section 2.3.1.3 defines as "no restrictions",
so the API may be read. The API is token protected: a short lived JWT is
requested from ``/api/home/auth/issue`` and sent as a bearer token on every
call.

Three endpoints are used:

``/api/search/DefinitionFilterAndSearch/Suggest``
    Product discovery. A search term returns the product families together
    with the machine types (the part numbers) each family covers.
``/api/product/Info/GetInfoByKey``
    One product: name, line, series and the published specification PDF.
``/api/product/Compare/LoadSpecData``
    The complete specification table of one product as structured JSON:
    section -> group -> feature -> value groups -> attribute/value pairs.

The API describes a product *family* and lists the published options of each
specification (several processors, several memory configurations and so on).
The collector therefore records one variant per family and keeps the option
list of every specification, instead of inventing a configuration that the
manufacturer never published.
"""

import html
import json
import re
import time
from typing import Any, AsyncIterator, Dict, List, Optional, Tuple
from urllib.parse import urlencode

from .base import (
    BaseScraper, ScraperConfig, RegionConfig, apply_yaml_config, get_config_manager,
    Product, ProductVariant, ProductCategory, ProductStatus,
    SpecValue, SpecParser,
    generate_product_id, generate_variant_id,
    canonicalize_url, extract_canonical_key,
    clean_text,
)
from .base import RobotsPolicyError


# The API returns the specification values with the HTML entities of the
# publisher's own CMS ("Intel Core&trade; Ultra 5"). They are decoded, never
# rewritten.
def _text(value: Any) -> str:
    """Normalise a value that came out of the API."""
    if value is None:
        return ''
    return clean_text(html.unescape(str(value)))


def _slug(value: str) -> str:
    """A lower case identifier built from a label."""
    return re.sub(r'[^a-z0-9]+', '_', (value or '').strip().lower()).strip('_')


# The specification keys of the PSREF feed, mapped onto the field names the
# rest of Veridian uses. A key that is not listed keeps its own name, so a
# specification the feed publishes is never dropped.
SPEC_KEY_MAPPING: Dict[str, str] = {
    'memory': 'memory', 'memory_type': 'memory_type',
    'memory_slots': 'memory_slots', 'max_memory': 'max_memory',
    'storage': 'storage', 'storage_type': 'storage_type',
    'storage_capacity': 'storage_capacity', 'processor': 'processor',
    'processor_name': 'processor_name', 'processor_family': 'processor_family',
    'operating_system': 'operating_system', 'os': 'operating_system',
    'graphics': 'graphics', 'display': 'display', 'battery': 'battery',
    'battery_capacity': 'battery_capacity', 'weight': 'weight',
    'dimensions': 'dimensions', 'network': 'network', 'ports': 'ports',
    'color': 'color', 'warranty': 'warranty', 'security': 'security',
    'camera': 'camera', 'keyboard': 'keyboard', 'audio': 'audio',
}


# The specification fields that name a whole category of the product. A
# label that names one of them but sits in another group keeps the group in
# its key: the "Memory" of the graphics group is the shared graphics memory,
# not the memory of the system.
CANONICAL_FIELDS = frozenset({
    'memory', 'storage', 'processor', 'graphics', 'display', 'battery',
    'weight', 'operating_system', 'network', 'ports', 'dimensions', 'color',
    'warranty',
})


def spec_key(label: str, feature: str = '', group: str = '') -> str:
    """The Veridian spec key of a published specification.

    ``label`` is the name the feed publishes for the value ("Processor Name",
    "Memory", "Resolution"). A sub attribute of a feature keeps the feature
    in its key ("Processor" + "Cores" -> ``processor_cores``) so two features
    of the same product cannot overwrite each other. A label the mapping
    knows keeps its own name ("OS" -> ``operating_system``).
    """
    key = _slug(label)
    if not key:
        return ''

    mapped = SPEC_KEY_MAPPING.get(key)
    if mapped:
        group_slug = _slug(group)
        canonical_group = group_slug if group_slug in CANONICAL_FIELDS else ''
        if mapped in CANONICAL_FIELDS and canonical_group and mapped != canonical_group:
            key = f"{group_slug}_{mapped}"
        else:
            return SpecParser.standardize_field_name(mapped)

    feature_slug = _slug(feature)
    if feature_slug and not key.startswith(feature_slug):
        key = f"{feature_slug}_{key}"

    return SpecParser.standardize_field_name(key)


# The specification fields Veridian knows how to structure. A key that
# belongs to one of them ("processor_cores" belongs to "processor") is parsed
# with the parser of that field, so a sub attribute is structured exactly like
# the field it belongs to.
STANDARD_FIELDS = (
    'processor', 'memory', 'storage', 'display', 'graphics', 'battery',
    'weight', 'dimensions', 'operating_system', 'network', 'ports', 'color',
    'warranty', 'camera', 'keyboard', 'audio', 'security',
)


def parser_field(key: str) -> str:
    """The specification field whose parser fits this key."""
    for field in STANDARD_FIELDS:
        if key == field or key.startswith(f"{field}_"):
            return field
    for token in key.split('_'):
        if token in STANDARD_FIELDS:
            return token
    return key


def resolution(value: str) -> Optional[Dict[str, Any]]:
    """The pixel size of a published resolution.

    The shared model extracts ``width_px`` and ``height_px`` from the same
    capture group, so both of them would carry the width. The resolution is
    therefore read here, with the same field names the model uses, so a wrong
    pixel height never reaches the catalog.
    """
    match = re.search(r'(\d{3,5})\s*[x\u00d7]\s*(\d{3,5})', value or '')
    if not match:
        return None
    width = int(match.group(1))
    height = int(match.group(2))
    return {
        'width_px': width,
        'height_px': height,
        'resolution': f"{width}x{height}",
    }


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


def make_spec(key: str, values: List[str], label: str) -> Optional[SpecValue]:
    """Build the spec value of one published specification.

    A specification that the feed publishes with several options keeps the
    whole option list; the first option is parsed for the structured value,
    exactly like the HTML collectors do.
    """
    options: List[str] = []
    for value in values:
        if value and value not in options:
            options.append(value)
    if not options:
        return None

    spec = SpecParser.parse_spec(parser_field(key), options[0])

    if key == 'display_resolution':
        structured = resolution(options[0])
        if structured:
            spec.structured = structured
            spec.confidence = 0.9

    if key == 'storage' and spec.structured:
        capacity = storage_capacity(options[0])
        if capacity is not None:
            spec.structured = dict(spec.structured)
            spec.structured['capacity_gb'] = capacity
    if len(options) > 1:
        spec.raw = '; '.join(options)
        spec.is_multi_option = True
        spec.options = list(options)
    spec.source_field = label
    return spec


def parse_spec_payload(payload: Dict[str, Any]) -> Tuple[Dict[str, SpecValue], Dict[str, Any]]:
    """Turn a PSREF ``LoadSpecData`` response into Veridian spec values.

    Returns the specification mapping and the metadata of the product
    (name, classification, product key and the published specification PDF).
    """
    specs: Dict[str, SpecValue] = {}
    meta: Dict[str, Any] = {}

    data = payload.get('data') or {}
    meta['classification'] = data.get('Classification')

    general = data.get('GeneralSpecData') or []
    if not general:
        return specs, meta

    entry = general[0]
    meta['product_name'] = _text(entry.get('ProductName'))
    meta['product_id'] = entry.get('ProductID')

    raw = entry.get('GeneralSpecJson')
    if isinstance(raw, str):
        try:
            inner = json.loads(raw)
        except (TypeError, ValueError):
            inner = {}
    else:
        inner = raw or {}

    spec_data = ((inner.get('data') or {}).get('SpecData')) or []

    for section in spec_data:
        section_name = _text(section.get('L1'))
        for group in section.get('L2') or []:
            group_name = _text(group.get('L2'))
            for feature in group.get('Features') or []:
                feature_name = _text(feature.get('FName'))
                values_by_attribute: Dict[str, List[str]] = {}

                for value_group in feature.get('FVs') or []:
                    for group_item in value_group.get('FVGs') or []:
                        for item in group_item.get('FVGItem') or []:
                            attribute = _text(item.get('Att'))
                            value = _text(item.get('AttV'))
                            if not value:
                                continue
                            if not attribute:
                                attribute = feature_name or section_name
                            values_by_attribute.setdefault(attribute, []).append(value)

                for attribute, values in values_by_attribute.items():
                    # "DefaultDescription" is the feed's way of saying that
                    # the value carries the whole specification.
                    if attribute.lower() == 'defaultdescription':
                        label = feature_name or group_name or section_name
                    else:
                        label = attribute
                    if not label:
                        label = attribute

                    key = spec_key(label, feature=feature_name, group=group_name)
                    if not key:
                        continue
                    if key in specs:
                        # Two features of the same product published the same
                        # label; the group keeps them apart.
                        suffix = _slug(group_name) or 'value'
                        candidate = f"{key}_{suffix}"
                        counter = 2
                        while candidate in specs:
                            candidate = f"{key}_{suffix}_{counter}"
                            counter += 1
                        key = SpecParser.standardize_field_name(candidate)

                    spec = make_spec(key, values, label)
                    if spec is not None:
                        specs[key] = spec

    return specs, meta


def parse_search_results(payload: Dict[str, Any]) -> List[Dict[str, Any]]:
    """The product rows of a PSREF search response."""
    rows: List[Dict[str, Any]] = []
    for row in payload.get('data') or []:
        if not isinstance(row, dict):
            continue
        if row.get('SearchResultType') != 'Product':
            continue
        if not row.get('ProductKey'):
            continue
        rows.append(row)
    return rows


class LenovoApiScraper(BaseScraper):
    """Lenovo collector for the official PSREF JSON API."""

    MANUFACTURER = 'lenovo'
    BRAND = 'Lenovo'

    CATEGORY_MAPPING = {
        'laptops': ProductCategory.LAPTOPS,
        'desktops': ProductCategory.DESKTOPS,
        'workstations': ProductCategory.DESKTOPS,
        'desktops and workstations': ProductCategory.DESKTOPS,
        'monitors': ProductCategory.MONITORS,
        'tablets': ProductCategory.TABLETS,
        'accessories': ProductCategory.ACCESSORIES,
        'servers': ProductCategory.SERVERS,
    }

    def __init__(self, config: ScraperConfig, region: RegionConfig):
        super().__init__(config, region)

        block = get_config_manager().get_manufacturer_config(config.manufacturer) or {}
        self.feed: Dict[str, Any] = dict(block.get('official_feed') or {})
        self.endpoints: Dict[str, str] = dict(self.feed.get('endpoints') or {})
        self.categories: List[Dict[str, Any]] = list(self.feed.get('categories') or [])
        self._token: Optional[str] = None
        self._catalog: Dict[str, Dict[str, Any]] = {}

    # -- configuration helpers ---------------------------------------------

    def _api_url(self, path: str, **params: Any) -> str:
        base = self.region.base_url.rstrip('/')
        query = urlencode({k: v for k, v in params.items() if v is not None})
        return f"{base}{path}" + (f"?{query}" if query else '')

    def _timestamp(self) -> int:
        return int(time.time() * 1000)

    def _origin(self) -> Optional[str]:
        """The origin the API belongs to.

        The API is the back end of the site on this host and refuses a
        request that does not name it, exactly like a browser sends it.
        """
        auth = self.feed.get('auth') or {}
        return auth.get('origin') or None

    def _api_headers(self, token: Optional[str] = None) -> Dict[str, str]:
        """The headers of an API request."""
        headers: Dict[str, str] = {}
        origin = self._origin()
        if origin:
            headers['Origin'] = origin
        if token:
            headers['Authorization'] = f'Bearer {token}'
        return headers

    def _product_url(self, product_key: str) -> str:
        template = self.feed.get('product_path') or '/product/{product_key}'
        return self._api_url(template.format(product_key=product_key))

    # -- transport ---------------------------------------------------------

    async def _issue_token(self) -> str:
        """Request the bearer token the API requires."""
        if self._token:
            return self._token

        auth = self.feed.get('auth') or {}
        url = self._api_url(auth.get('path') or '/api/home/auth/issue')
        payload = await self._post_json(url, auth.get('body') or {})

        token = payload.get('access_token') or ''
        if not token:
            raise ValueError(f"PSREF issued no access token: {payload}")
        self._token = token
        return token

    async def _post_json(self, url: str, body: Dict[str, Any]) -> Dict[str, Any]:
        """POST a JSON body, honouring the robots policy and the rate limit."""
        client = self.http_client

        try:
            await client.robots.check(url)
        except RobotsPolicyError as exc:
            if self.health is not None:
                self.health.record_page_attempt()
                self.health.record_page_failure(url, exc, kind='source')
                self.health.record_blocked(str(exc))
            raise

        await client.rate_limiter.wait()

        if self.health is not None:
            self.health.record_page_attempt()

        started = time.perf_counter()
        try:
            response = await client.client.post(
                url,
                json=body,
                headers={'Content-Type': 'application/json', **self._api_headers()},
            )
            response.raise_for_status()
        except Exception as exc:
            if self.health is not None:
                self.health.record_page_failure(url, exc, kind='source')
            raise

        if self.health is not None:
            self.health.record_page_success((time.perf_counter() - started) * 1000)

        try:
            return response.json()
        except ValueError as exc:
            if self.health is not None:
                self.health.record_parser_failure(url, exc)
            raise

    async def _get_json(self, path: str, **params: Any) -> Dict[str, Any]:
        """GET a JSON document of the API with the bearer token attached."""
        token = await self._issue_token()
        url = self._api_url(path, **params)
        response = await self.http_client.get(url, headers=self._api_headers(token))
        try:
            return response.json()
        except ValueError as exc:
            if self.health is not None:
                self.health.record_parser_failure(url, exc)
            raise

    # -- BaseScraper interface ---------------------------------------------

    async def discover_categories(self) -> List[Dict[str, str]]:
        """One category per search term of the official feed."""
        categories: List[Dict[str, str]] = []
        limit = int((self.feed.get('search') or {}).get('limit', 500))

        for entry in self.categories:
            term = entry.get('search_term') or entry.get('name')
            if not term:
                continue
            categories.append({
                'name': entry.get('name') or term,
                'slug': entry.get('slug') or _slug(term),
                'url': self._api_url(
                    self.endpoints.get('search') or '/api/search/DefinitionFilterAndSearch/Suggest',
                    kw=term,
                    limit=limit,
                    IsPreviewProduct='true',
                    t=self._timestamp(),
                ),
                'classification': entry.get('classification'),
                'category_type': entry.get('category_type'),
            })

        return categories

    async def discover_products(self, category_url: str, category_info: Dict) -> AsyncIterator[str]:
        """The product pages of one category, read from the search feed."""
        token = await self._issue_token()
        response = await self.http_client.get(
            category_url, headers=self._api_headers(token)
        )
        try:
            payload = response.json()
        except ValueError as exc:
            if self.health is not None:
                self.health.record_parser_failure(category_url, exc)
            return

        classification = category_info.get('classification')
        max_products = int(self.feed.get('max_products') or 0)
        collected = 0

        for row in parse_search_results(payload):
            if classification and row.get('ClassificationName') != classification:
                continue
            product_key = row.get('ProductKey')
            if not product_key:
                continue
            self._catalog[product_key] = row
            collected += 1
            yield self._product_url(product_key)
            if max_products and collected >= max_products:
                return

    async def extract_product(self, url: str, category_info: Dict) -> Optional[Product]:
        """Read the specification table of one product."""
        product_key = url.rstrip('/').split('/')[-1]
        if not product_key:
            return None

        payload = await self._get_json(
            self.endpoints.get('spec_data') or '/api/product/Compare/LoadSpecData',
            ProductKey=product_key,
            t=self._timestamp(),
        )

        specs, meta = parse_spec_payload(payload)
        if not specs:
            self.logger.warning("No specifications published for %s", product_key)
            return None

        row = self._catalog.get(product_key, {})
        name = meta.get('product_name') or row.get('ProductName') or product_key
        classification = meta.get('classification') or row.get('ClassificationName') or ''
        series = row.get('ProductLine') or ''
        machine_type = row.get('MachineType') or ''
        announce_date = row.get('AnnounceDate') or ''

        category = self.CATEGORY_MAPPING.get(classification.lower(), ProductCategory.UNKNOWN)
        if category == ProductCategory.UNKNOWN:
            category = self.get_category_from_url(url)

        canonical_key = extract_canonical_key(url, self.MANUFACTURER)
        variant_name = machine_type or name
        variant = ProductVariant(
            variant_id=generate_variant_id(self.MANUFACTURER, canonical_key, variant_name),
            name=variant_name,
            sku=machine_type,
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
            category=category,
            series=series,
            subcategory=classification,
            url=canonicalize_url(url),
            region=self.region.code,
            variants=[variant],
            source_urls=[canonicalize_url(url)],
            launch_date=announce_date or None,
            metadata={
                'psref_product_key': product_key,
                'psref_classification': classification,
                'machine_type': machine_type,
                'machine_types': [
                    part.strip() for part in str(machine_type).split('/') if part.strip()
                ],
                'announce_date': announce_date,
                'source': 'lenovo-psref-api',
            },
        )

    def get_category_from_url(self, url: str) -> ProductCategory:
        """Map a PSREF product to a Veridian product category."""
        key = url.rstrip('/').split('/')[-1].replace('_', ' ')
        for name, category in self.CATEGORY_MAPPING.items():
            if name.replace('_', ' ') in key.lower():
                return category
        return ProductCategory.UNKNOWN


def create_lenovo_api_config() -> ScraperConfig:
    """The configuration of the Lenovo PSREF API collector."""
    regions = [
        RegionConfig(
            code='us',
            name='United States',
            base_url='https://psref.lenovo.com/',
            language='en',
            currency='USD',
            rate_limit=0.5,
            timeout=30,
        ),
    ]

    config = ScraperConfig(
        manufacturer='lenovo_api',
        brand='Lenovo',
        base_url='https://psref.lenovo.com/',
        regions=regions,
        output_dir='./output',
        max_concurrent=1,
        retry_attempts=3,
        checkpoint_interval=10,
    )

    return apply_yaml_config(config)


async def run_lenovo_api_scraper(regions: Optional[List[str]] = None):
    """Run the Lenovo PSREF API collector."""
    config = create_lenovo_api_config()

    target_regions = [r for r in config.regions if not regions or r.code in regions]

    all_products: List[Product] = []
    for region in target_regions:
        scraper = LenovoApiScraper(config, region)
        scraper.load_checkpoint()
        products = await scraper.scrape()
        all_products.extend(products)
        print(f"Region {region.code}: {len(products)} products")

    return all_products


if __name__ == '__main__':
    import sys

    asyncio_run = __import__('asyncio').run
    asyncio_run(run_lenovo_api_scraper(sys.argv[1:] or None))
