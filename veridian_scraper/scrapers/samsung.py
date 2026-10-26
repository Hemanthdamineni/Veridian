"""
Veridian Scraper - Samsung Scraper Implementation

What Samsung actually publishes
-------------------------------

* The Galaxy Book listing lives at ``/us/galaxybooks/``.  The older
  ``/us/computing/galaxy-book/`` path only redirects there.
* Every model has a landing page, for example
  ``/us/computing/galaxy-books/galaxy-book5-pro/``.  That page renders a
  "COMPARE / SPECS" section (``section#lineup-compare``) containing a
  ``table.lineup-compare__table``: one column per model of the family, one
  row per published specification category.  The table is **server rendered**,
  so the specification values are in the HTML response - nothing is rendered
  client side and no JSON endpoint has to be called for them.
* The purchasable configurations live on ``/buy/`` pages.  Those pages carry a
  schema.org ``Product`` block (part number, list price, availability) and a
  Next.js payload with the per-configuration attributes ("Memory and
  Storage", "Processor and Graphics", "Operating System", "Screen Size",
  "Color").  Both are read out of the server-rendered response.

Nothing here is inferred: every value stored is a value Samsung published,
and the source URL is attached to the record it came from.
"""

import asyncio
import json
import re
from typing import Any, AsyncIterator, Dict, List, Optional, Tuple
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


# Rows of the comparison table that carry marketing copy instead of product
# data.  They are never stored as a specification.
SAMSUNG_SKIP_ROWS = frozenset({
    'overview', 'galaxy ai', 'microsoft copilot', 'table product',
    'table item cta', 'galaxy book4 edge', 'note', 'disclaimer',
})

# Row title of the comparison table -> Veridian spec key.  Titles are matched
# after the footnote markers Samsung appends ("Memory and storage1 4") have
# been removed and the title has been lower-cased.
SAMSUNG_SPEC_KEYS = {
    'operating system': 'operating_system',
    'processor': 'processor',
    'processor speed': 'processor_speed',
    'graphics': 'graphics',
    'display': 'display',
    'screen size': 'screen_size',
    'touchscreen': 'touchscreen',
    'memory & storage': 'memory_storage',
    'memory and storage': 'memory_storage',
    'memory': 'memory',
    'storage': 'storage',
    'external memory': 'external_memory',
    'weight': 'weight',
    'weight and dimensions': 'weight_and_dimensions',
    'dimensions': 'dimensions',
    'dimensions (l x w x h)': 'dimensions',
    'battery': 'battery_life',
    'battery capacity': 'battery',
    'battery life': 'battery_life',
    'color': 'color',
    'ports': 'ports',
    'connectivity': 'network',
    'speakers': 'audio',
    'web camera': 'camera',
    'security': 'security',
    'pen': 'pen',
    'ai': 'neural_processor',
    'upc': 'upc',
    'model year': 'model_year',
}

# Attributes published on the buy page -> Veridian spec key.
SAMSUNG_BUY_ATTRIBUTE_KEYS = {
    'Color': 'color',
    'Device': 'device',
    'Processor and Graphics': 'processor',
    'Operating System': 'operating_system',
    'Screen Size': 'screen_size',
    'Memory and Storage': 'memory_storage',
}

# Model pages live one segment below one of these roots.
SAMSUNG_MODEL_ROOTS = (
    '/us/computing/galaxy-books/',
    '/us/computers/galaxy-book/',
)

# Slugs that are not models.
SAMSUNG_NON_MODEL_SLUGS = frozenset({
    'buy', 'compare', 'all-galaxy-books', 'galaxy-book5-series',
    'galaxy-book6-series', 'galaxy-book-copilot-plus-pcs',
})

_MODEL_URL_RE = re.compile(
    r'^/us/(?:computing/galaxy-books|computers/galaxy-book)/([^/]+)/$')
_BUY_URL_RE = re.compile(
    r'^/us/(?:computing/galaxy-books|computers/galaxy-book)/[^/]+/buy/([^/]+)/$')

# Samsung part numbers, e.g. NP750XHD-KB1US.
_PART_NUMBER_RE = re.compile(
    r'(np)(\d{3}[a-z]{1,3})-([a-z]{2}\d[a-z]{1,3})', re.IGNORECASE)

_MEMORY_RE = re.compile(
    r'(\d+(?:\.\d+)?)\s*(GB|TB)\s*\(?\s*(?:RAM|Memory)\b', re.IGNORECASE)
_STORAGE_RE = re.compile(
    r'(\d+(?:\.\d+)?)\s*(GB|TB)\s*\(?\s*(?:SSD|eUFS)\b', re.IGNORECASE)
_LBS_RE = re.compile(r'(\d+(?:\.\d+)?)\s*lbs?', re.IGNORECASE)
# Samsung marks the inch with a double quote, with two apostrophes or with a
# typographic quote, depending on the row.
_INCHES_RE = re.compile(
    r'(\d*\.?\d+)\s*(?:"|\'\'|”|″)\s*[xX]\s*(\d*\.?\d+)\s*'
    r'(?:"|\'\'|”|″)\s*[xX]\s*(\d*\.?\d+)\s*(?:"|\'\'|”|″)')
_MM_RE = re.compile(
    r'(\d+(?:\.\d+)?)\s*mm\s*[xX]\s*(\d+(?:\.\d+)?)\s*mm\s*[xX]\s*(\d+(?:\.\d+)?)\s*mm')


def _slug_key(text: str) -> str:
    """Normalise a name so that a URL slug and a table header compare."""
    return re.sub(r'[^a-z0-9]', '', (text or '').lower())


def _part_number_from_url(url: str) -> str:
    """Read the part number out of a configuration page URL.

    Samsung names a configuration page after the part number it sells
    (``.../galaxy-book5-15-6-...-sku-np750xhd-kb1us/``).  The schema.org
    block of such a page does not always describe that configuration: when a
    configuration is no longer sold, the page falls back to the default
    configuration of the family and publishes another part number.  The part
    number is therefore taken from the URL, and the structured data is only
    used where the two agree.
    """
    slug = urlparse(url).path.strip('/').split('/')[-1].lower()
    matches = _PART_NUMBER_RE.findall(slug)
    if not matches:
        return ''
    prefix, model, suffix = matches[-1]
    return f"{prefix.upper()}{model.upper()}-{suffix.upper()}"


def _to_gb(amount: str, unit: str) -> int:
    """Convert a published capacity to gigabytes."""
    value = float(amount)
    return int(round(value * 1024)) if unit.upper() == 'TB' else int(round(value))


def _processor_facts(text: str) -> Dict[str, object]:
    """Pull the structured facts out of a published processor string."""
    facts: Dict[str, object] = {}
    lowered = text.lower()
    for brand in ('Intel', 'AMD', 'Qualcomm', 'Apple'):
        if brand.lower() in lowered:
            facts['brand'] = brand
            break

    match = re.search(
        r'Core\s*™?\s*Ultra\s+\d+(?:\s+Series\s+\d+)?(?:\s*Processor)?\s*([0-9A-Z/]*)',
        text, re.IGNORECASE)
    if match:
        model = 'Core Ultra'
        number = re.search(r'Core\s*™?\s*Ultra\s+(\d+)', text, re.IGNORECASE)
        if number:
            model += f' {number.group(1)}'
        series = re.search(r'Core\s*™?\s*Ultra\s+\d+\s+(Series\s+\d+)', text, re.IGNORECASE)
        if series:
            model += f' {series.group(1)}'
        if match.group(1):
            model += f' {match.group(1).strip()}'
        facts['model'] = model
        return facts

    match = re.search(r'(Ryzen\s*™?\s*(?:AI\s*)?\d+\s*[A-Za-z]*)', text, re.IGNORECASE)
    if match:
        facts['model'] = match.group(1).replace('™', '').strip()
        return facts

    match = re.search(r'(Snapdragon\s*®?\s*X(?:\s*(?:Elite|Plus))?(?:\s*[\w\-]+)?)',
                      text, re.IGNORECASE)
    if match:
        facts['model'] = re.sub(r'\s+', ' ', match.group(1).replace('®', '')).strip()
        return facts

    match = re.search(r'(Apple\s+M\d[\w\s]*)', text, re.IGNORECASE)
    if match:
        facts['model'] = match.group(1).strip()
    return facts


class SamsungScraper(BaseScraper):
    """Samsung Galaxy Book scraper.

    The extraction is driven by two structural hooks that the site keeps
    stable:

    * ``table.lineup-compare__table`` on a model landing page - the published
      specification table, one column per model.
    * the schema.org ``Product`` block and the Next.js payload on a ``/buy/``
      page - part number, list price, availability and the per-configuration
      attributes.
    """

    CATEGORY_MAPPING = {
        'laptops': ProductCategory.LAPTOPS,
        'galaxy-book': ProductCategory.LAPTOPS,
        'galaxy-books': ProductCategory.LAPTOPS,
        'galaxybook': ProductCategory.LAPTOPS,
    }

    SERIES_MAPPING = {
        'galaxy-book': 'Galaxy Book',
        'galaxy-books': 'Galaxy Book',
        'galaxybook': 'Galaxy Book',
    }

    SELECTORS = {
        'compare_table': 'table.lineup-compare__table',
        'compare_header': 'th.lineup-compare__table-product',
        'compare_row': 'tr.lineup-compare__table-row',
        'compare_row_label': 'lineup-compare__category-item',
    }

    def __init__(self, config: ScraperConfig, region: RegionConfig):
        super().__init__(config, region)

        self.selectors = dict(self.SELECTORS)
        if region.selectors:
            self.selectors.update(region.selectors)

        # Model landing pages (slug -> URL) and the configuration pages that
        # belong to them.  Filled in by :meth:`discover_products`.
        self._model_urls: Dict[str, str] = {}
        self._buy_urls: Dict[str, List[str]] = {}
        self._model_cache: Dict[str, Tuple[List[str], List[Optional[str]], List[Tuple[str, List[str]]]]] = {}
        # Specifications of the family comparison page, keyed by model name.
        self._compare_specs: Dict[str, Dict[str, SpecValue]] = {}
        # The published configuration pages, keyed by the model they belong to.
        self._configuration_pages: Dict[str, List[Dict[str, Any]]] = {}

    # -- categories --------------------------------------------------------

    def get_category_from_url(self, url: str) -> ProductCategory:
        path = urlparse(url).path.lower()
        for root in SAMSUNG_MODEL_ROOTS:
            if root in path:
                return ProductCategory.LAPTOPS
        return ProductCategory.UNKNOWN

    def get_series_from_url(self, url: str) -> str:
        parts = [p for p in urlparse(url).path.strip('/').split('/') if p]
        for part in parts:
            if part in self.SERIES_MAPPING:
                return self.SERIES_MAPPING[part]
        return 'Galaxy Book'

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
                'name': 'galaxy-book',
                'slug': 'galaxy-book',
                'url': urljoin(self.region.base_url, 'galaxybooks/'),
                'category_type': ProductCategory.LAPTOPS,
            })
        return categories

    # -- discovery ---------------------------------------------------------

    async def discover_products(self, category_url: str, category_info: Dict) -> AsyncIterator[str]:
        """Discover the Galaxy Book model pages and their buy pages.

        The listing page links to every model landing page and to the buy
        page of every purchasable configuration.  Both are collected here so
        that the configuration pages can be attributed to the model they
        belong to without guessing.
        """
        try:
            soup = await self.http_client.get_soup(category_url)
        except Exception as exc:  # pragma: no cover - network dependent
            self.logger.error("Failed to fetch %s: %s", category_url, exc)
            return

        models: Dict[str, str] = {}
        buys: List[str] = []
        compare_url: Optional[str] = None
        for anchor in soup.select('a[href]'):
            href = anchor.get('href')
            if not href:
                continue
            url = urljoin(self.region.base_url, href)
            path = urlparse(url).path

            model_match = _MODEL_URL_RE.match(path)
            if model_match:
                slug = model_match.group(1).lower()
                if slug in SAMSUNG_NON_MODEL_SLUGS or slug.endswith('-series'):
                    if slug == 'compare' and path.rstrip('/').endswith('/compare'):
                        compare_url = canonicalize_url(url)
                    continue
                models.setdefault(slug, canonicalize_url(url))
                continue

            buy_match = _BUY_URL_RE.match(path)
            if buy_match:
                buys.append(canonicalize_url(url))
                continue

            if path.rstrip('/').endswith('/compare') and path.startswith('/us/'):
                compare_url = canonicalize_url(url)

        self._model_urls = models
        self._buy_urls = self._attribute_buy_pages(buys, models)

        self.logger.debug(
            "Found %d Galaxy Book models and %d configuration pages",
            len(models), sum(len(v) for v in self._buy_urls.values()),
        )

        if compare_url:
            await self._load_compare_page(compare_url)

        await self._load_configuration_pages(buys, models)

        for slug in sorted(models):
            yield models[slug]

    async def _load_compare_page(self, url: str) -> None:
        """Read the family comparison page, which publishes the full row set."""
        try:
            soup = await self.http_client.get_soup(url)
        except Exception as exc:
            self.logger.warning("Could not read the comparison page %s: %s", url, exc)
            return

        columns, _links, rows = self._read_table(soup)
        for index, name in enumerate(columns):
            if not name:
                continue
            specs = self._specs_for_column(rows, index)
            if specs:
                self._compare_specs[name] = specs
        self.logger.debug("Read %d models from the comparison page", len(self._compare_specs))

    async def _load_configuration_pages(self, buys: List[str], models: Dict[str, str]) -> None:
        """Read every published configuration page and file it under its model.

        Samsung publishes the model a configuration belongs to in the taxonomy
        of the page (``pc/pc/galaxy-book/galaxy-book5-pro``); that is used
        first, because the slug of a configuration page does not always start
        with the name of its model.  The URL is only used when the page does
        not publish a taxonomy.
        """
        seen: set = set()
        for url in sorted(set(buys)):
            configuration = await self._read_configuration_page(url)
            if configuration is None:
                continue
            slug = configuration.get('model_slug')
            if slug not in models:
                # The published taxonomy does not name a known model; fall back
                # to the model the page URL points at.
                slug = self._model_for_url(url, models)
            if slug is None or slug not in models:
                self.logger.info("Could not attribute %s to a model", url)
                continue
            key = (slug, configuration.get('sku') or url)
            if key in seen:
                # Samsung links the same configuration under more than one
                # URL; it is one part number and therefore one variant.
                continue
            seen.add(key)
            self._configuration_pages.setdefault(slug, []).append(configuration)

    @staticmethod
    def _model_for_url(url: str, models: Dict[str, str]) -> Optional[str]:
        """The model a configuration page URL belongs to.

        Samsung puts the family - and for most families the model - in the
        path segment in front of ``/buy/`` (``/us/computers/galaxy-book/
        galaxy-book6-intel-core/buy/...``).  When that segment names a known
        model it is used; otherwise the longest model name that prefixes the
        slug of the page is used.
        """
        parts = [p for p in urlparse(url).path.strip('/').split('/') if p]
        if 'buy' in parts:
            index = parts.index('buy')
            if index > 0:
                owner = parts[index - 1].lower()
                if owner in models:
                    return owner
        slug = parts[-1].lower() if parts else ''
        best = None
        for model in models:
            if slug.startswith(model) and (best is None or len(model) > len(best)):
                best = model
        return best

    @staticmethod
    def _attribute_buy_pages(buys: List[str], models: Dict[str, str]) -> Dict[str, List[str]]:
        """Assign every configuration page URL to the model it starts with.

        Samsung names a configuration page after the model it belongs to
        (``galaxy-book5-pro-360-16-intel-core-ultra-7-1tb-gray-np960qha-kg1us``),
        so the longest model name that prefixes the page slug is the model it
        belongs to.  Nothing is guessed when no model matches.
        """
        result: Dict[str, List[str]] = {}
        for url in sorted(set(buys)):
            slug = urlparse(url).path.strip('/').split('/')[-1].lower()
            best = None
            for model in models:
                if slug.startswith(model) and (best is None or len(model) > len(best)):
                    best = model
            if best is not None:
                result.setdefault(best, []).append(url)
        return result

    # -- extraction --------------------------------------------------------

    async def extract_product(self, url: str, category_info: Dict) -> Optional[Product]:
        """Extract one Galaxy Book model and its purchasable configurations."""
        slug = urlparse(url).path.strip('/').split('/')[-1].lower()

        try:
            soup = await self.http_client.get_soup(url)
        except Exception as exc:
            self.logger.error("Failed to fetch product page %s: %s", url, exc)
            return None

        columns, _links, rows = await self._comparison_table(slug, soup)
        if not rows:
            self.logger.warning("No specification table found on %s", url)

        index = self._column_index(slug, columns)
        model_name = columns[index] if columns else ''
        if not model_name:
            model_name = self._page_title(soup)

        # The model page publishes the categories that belong to the model it
        # is about; the family comparison page publishes the same models with
        # the full row set (weight, battery, dimensions, ...).  The model's
        # own page wins where both publish a value.
        model_specs = dict(self._compare_specs.get(model_name, {}))
        model_specs.update(self._specs_for_column(rows, index))

        variants: List[ProductVariant] = []
        for configuration in self._configuration_pages.get(slug, []):
            variant = self._variant_from_configuration(configuration, model_specs)
            if variant is not None:
                variants.append(variant)

        if not variants:
            variants = [self._model_only_variant(url, model_name, model_specs)]

        canonical_key = extract_canonical_key(url, 'samsung')
        product = Product(
            product_id=generate_product_id('samsung', canonical_key),
            canonical_key=canonical_key,
            manufacturer='samsung',
            brand='Samsung',
            name=model_name,
            category=ProductCategory.LAPTOPS,
            series=self.get_series_from_url(url),
            subcategory=category_info.get('slug', ''),
            url=canonicalize_url(url),
            region=self.region.code,
            variants=variants,
            source_urls=[canonicalize_url(url)],
            status=ProductStatus.CURRENT,
            family_id=f"samsung-{slug}",
        )
        for variant in variants:
            product.add_source_url(variant.source_url)
        return product

    async def _comparison_table(self, slug: str, soup: BeautifulSoup):
        """Return ``(columns, links, rows)`` of the published spec table."""
        cached = self._model_cache.get(slug)
        if cached is not None:
            return cached

        result = self._read_table(soup)
        self._model_cache[slug] = result
        return result

    def _read_table(self, soup: BeautifulSoup):
        """Read the published specification table of a page.

        Returns the model names of the table, the buy page linked from each
        of them and the published rows as ``(row title, values)`` pairs.
        """
        table = soup.select_one(self.selectors['compare_table'])
        if table is None:
            return ([], [], [])

        columns: List[str] = []
        links: List[Optional[str]] = []
        header_cells = table.select(self.selectors['compare_header'])
        for cell in header_cells[1:]:
            columns.append(clean_text(cell.get_text(' ', strip=True)))
            anchor = cell.find('a', href=True)
            links.append(urljoin(self.region.base_url, anchor['href']) if anchor else None)

        rows: List[Tuple[str, List[str]]] = []
        for tr in table.select(self.selectors['compare_row']):
            label_cell = tr.find('th', class_=self.selectors['compare_row_label'],
                                 recursive=False)
            if label_cell is None:
                continue
            label = clean_text(label_cell.get_text(' ', strip=True))
            if not label:
                continue
            values = [clean_text(cell.get_text(' ', strip=True))
                      for cell in tr.find_all('td', recursive=False)]
            rows.append((label, values))

        return (columns, links, rows)

    @staticmethod
    def _column_index(slug: str, columns: List[str]) -> int:
        """Find the column of the comparison table that belongs to the model.

        The table lists the models of the family in the order the site chose,
        with the model of the page itself first.  The column is matched by
        name so the scraper does not depend on that order, and falls back to
        the first column.
        """
        key = _slug_key(slug)
        best_index, best_score = 0, 0
        for index, name in enumerate(columns):
            other = _slug_key(name)
            if not other:
                continue
            if key == other:
                score = len(key)
            elif key.startswith(other) or other.startswith(key):
                # The two names share a prefix; the shorter one is the match.
                score = min(len(key), len(other))
            else:
                score = 0
            if score > best_score:
                best_index, best_score = index, score
        return best_index

    def _specs_for_column(self, rows: List[Tuple[str, List[str]]], index: int) -> Dict[str, SpecValue]:
        """Turn the published rows of one column into Veridian specifications."""
        specs: Dict[str, SpecValue] = {}
        for label, values in rows:
            if index >= len(values):
                continue
            value = clean_text(values[index])
            if not value or value in {'--', '-', 'N/A'}:
                continue

            key = self._standard_spec_key(label)
            if key is None:
                continue

            if key == 'memory_storage':
                specs.update(self._memory_storage_specs(value))
                continue
            if key == 'weight_and_dimensions':
                specs.update(self._weight_and_dimensions_specs(value))
                continue

            specs[key] = self._spec_value(key, value, source_field=label)
        return specs

    def _standard_spec_key(self, label: str) -> Optional[str]:
        """Map a published row title to a Veridian spec key."""
        normalised = re.sub(r'[^a-z0-9 &()\-/.]', '', label.lower()).strip()
        normalised = re.sub(r'\s+', ' ', normalised)
        if not normalised or normalised in SAMSUNG_SKIP_ROWS:
            return None
        if normalised in SAMSUNG_SPEC_KEYS:
            return SAMSUNG_SPEC_KEYS[normalised]
        # Unknown but still a real specification: keep it under a stable key.
        slug = re.sub(r'[^a-z0-9]+', '_', normalised).strip('_')
        return slug or None

    def _spec_value(self, key: str, value: str, source_field: str = '') -> SpecValue:
        """Build a :class:`SpecValue`, with Samsung specific parsing."""
        if key == 'processor':
            structured = _processor_facts(value)
            if structured:
                return SpecValue(raw=value, structured=structured, unit='GHz',
                                 confidence=0.9, source_field=source_field)
        elif key == 'processor_speed':
            structured = self._parse_processor_speed(value)
            if structured:
                return SpecValue(raw=value, structured=structured, unit='GHz',
                                 confidence=0.9, source_field=source_field)
        elif key == 'dimensions':
            measurements = self._parse_dimensions(value)
            if len(measurements) == 1:
                return SpecValue(raw=value, structured=measurements[0], unit='mm',
                                 confidence=0.9, source_field=source_field)
            if len(measurements) > 1:
                return SpecValue(raw=value, structured=None, unit='mm',
                                 is_multi_option=True,
                                 options=[m.group(0).strip() for m in _INCHES_RE.finditer(value)]
                                 or [m.group(0).strip() for m in _MM_RE.finditer(value)],
                                 confidence=0.5, source_field=source_field)
        elif key == 'weight':
            matches = list(_LBS_RE.finditer(value))
            if len(matches) == 1:
                return SpecValue(raw=value, structured={'weight_lbs': float(matches[0].group(1))},
                                 unit='lbs', confidence=0.9, source_field=source_field)
            if len(matches) > 1:
                # Several weights are published (one per screen size), so no
                # single weight is claimed.
                return SpecValue(raw=value, structured=None, unit='lbs',
                                 is_multi_option=True,
                                 options=[m.group(0).strip() for m in matches],
                                 confidence=0.5, source_field=source_field)

        return parse_spec_field(key, value)

    @staticmethod
    def _parse_processor_speed(value: str) -> Optional[Dict[str, object]]:
        """Read the published base and boost clock."""
        base = re.search(r'(\d+(?:\.\d+)?)\s*GHz', value, re.IGNORECASE)
        if not base:
            return None
        result: Dict[str, object] = {'base_frequency_ghz': float(base.group(1))}
        boost = re.search(r'up\s+to\s+(\d+(?:\.\d+)?)\s*GHz', value, re.IGNORECASE)
        if boost:
            result['boost_frequency_ghz'] = float(boost.group(1))
        return result

    @staticmethod
    def _parse_dimensions(value: str) -> List[Dict[str, object]]:
        """Read the published dimensions (millimetres or inches).

        Samsung publishes one set of dimensions per screen size, so the cell
        can hold more than one.
        """
        measurements: List[Dict[str, object]] = []
        for match in _MM_RE.finditer(value):
            measurements.append({
                'width_mm': float(match.group(1)),
                'depth_mm': float(match.group(2)),
                'height_mm': float(match.group(3)),
            })
        if measurements:
            return measurements
        for match in _INCHES_RE.finditer(value):
            measurements.append({
                'width_in': float(match.group(1)),
                'depth_in': float(match.group(2)),
                'height_in': float(match.group(3)),
            })
        return measurements

    def _memory_storage_specs(self, value: str) -> Dict[str, SpecValue]:
        """Split the published "Memory & Storage" cell into the two specs.

        The cell lists every configuration the model is sold in, so the raw
        value keeps all of them and the individual configurations are kept as
        options.
        """
        specs: Dict[str, SpecValue] = {}

        memory = [(m.group(1), m.group(2), m.group(0)) for m in _MEMORY_RE.finditer(value)]
        storage = [(s.group(1), s.group(2), s.group(0)) for s in _STORAGE_RE.finditer(value)]

        if memory:
            options = []
            capacities = []
            for amount, unit, raw in memory:
                if raw not in options:
                    options.append(raw)
                capacities.append(_to_gb(amount, unit))
            structured = {'capacity_gb': capacities[0]} if len(set(capacities)) == 1 else None
            specs['memory'] = SpecValue(
                raw=value, structured=structured, unit='GB',
                is_multi_option=len(options) > 1, options=options,
                confidence=0.9 if structured else 0.5, source_field='Memory & Storage',
            )

        if storage:
            options = []
            capacities = []
            for amount, unit, raw in storage:
                if raw not in options:
                    options.append(raw)
                capacities.append(_to_gb(amount, unit))
            structured = {'capacity_gb': capacities[0]} if len(set(capacities)) == 1 else None
            specs['storage'] = SpecValue(
                raw=value, structured=structured, unit='GB',
                is_multi_option=len(options) > 1, options=options,
                confidence=0.9 if structured else 0.5, source_field='Memory & Storage',
            )
        return specs

    def _weight_and_dimensions_specs(self, value: str) -> Dict[str, SpecValue]:
        """Split the published "Weight and dimensions" cell."""
        specs: Dict[str, SpecValue] = {}
        weight = self._spec_value('weight', value, source_field='Weight and dimensions')
        if weight.raw:
            specs['weight'] = weight
        dimensions = self._spec_value('dimensions', value, source_field='Weight and dimensions')
        if dimensions.raw:
            specs['dimensions'] = dimensions
        return specs

    # -- configuration pages -----------------------------------------------

    async def _read_configuration_page(self, buy_url: str) -> Optional[Dict[str, Any]]:
        """Read one published configuration page.

        Returns the published part number, name, price, availability and the
        per-configuration attributes, plus the taxonomy that names the model
        the configuration belongs to.
        """
        try:
            soup = await self.http_client.get_soup(buy_url)
        except Exception as exc:
            self.logger.error("Failed to fetch configuration page %s: %s", buy_url, exc)
            return None

        product_json = self._json_ld_product(soup)
        payload = self._next_data(soup)
        page_props = payload.get('props', {}).get('pageProps', {}) if payload else {}
        product_data = page_props.get('productData', {}) or {}
        products = product_data.get('products', []) or []

        # The page is named after the configuration it sells.  When its
        # structured data describes another configuration (a configuration that
        # is no longer sold falls back to the default of the family), the
        # price, the availability and the taxonomy of that other configuration
        # must not be attached to this one.
        url_sku = _part_number_from_url(buy_url)
        json_sku = (product_json or {}).get('sku') or ''
        describes_this_configuration = not (
            url_sku and json_sku and url_sku.lower() != json_sku.lower())
        if not describes_this_configuration:
            self.logger.info(
                "%s publishes the structured data of %s; its own part number "
                "is %s", buy_url, json_sku, url_sku)
            product_json = {}
            json_sku = ''
        sku = json_sku or url_sku

        entry = None
        for candidate in products:
            if candidate.get('modelCode') == sku:
                entry = candidate
                break
        if entry is None and len(products) == 1 and describes_this_configuration:
            entry = products[0]
        if entry is None:
            entry = {}

        # The taxonomy names the model the configuration belongs to, but only
        # when the page really describes this configuration.
        taxonomy = ''
        if describes_this_configuration:
            taxonomy = (entry.get('taxonomy_path')
                        or product_data.get('taxonomy_path') or '')
        model_slug = taxonomy.strip('/').split('/')[-1].lower() if taxonomy else ''

        attributes = entry.get('attributes', {}) or {}
        specs: Dict[str, SpecValue] = {}
        for label, value in attributes.items():
            key = SAMSUNG_BUY_ATTRIBUTE_KEYS.get(label)
            if not key or not value or key == 'device':
                continue
            if key == 'memory_storage':
                specs.update(self._memory_storage_specs(value))
                continue
            specs[key] = self._spec_value(key, value, source_field=label)

        offers = (product_json or {}).get('offers') or {}
        if isinstance(offers, list):
            offers = offers[0] if offers else {}

        return {
            'url': canonicalize_url(buy_url),
            'sku': sku,
            'name': (product_json or {}).get('name') or entry.get('productTitle') or sku,
            'price': self._published_price(product_json, entry),
            'currency': offers.get('priceCurrency') or self.region.currency,
            'availability': self._published_availability(product_json),
            'specs': specs,
            'model_slug': model_slug,
        }

    def _variant_from_configuration(self, configuration: Dict[str, Any],
                                    model_specs: Dict[str, SpecValue]) -> Optional[ProductVariant]:
        """Build the variant of a published configuration."""
        specs = dict(model_specs)
        specs.update(configuration.get('specs') or {})

        canonical_key = extract_canonical_key(configuration['url'], 'samsung')
        sku = configuration.get('sku') or ''
        name = configuration.get('name') or sku
        availability = configuration.get('availability')

        return ProductVariant(
            variant_id=generate_variant_id('samsung', canonical_key, sku or name),
            name=name,
            sku=sku,
            specs=specs,
            price=configuration.get('price'),
            currency=configuration.get('currency') or self.region.currency,
            availability=availability,
            status=self._status_from_availability(availability),
            source_url=configuration['url'],
        )

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
    def _published_price(product_json: Dict, entry: Dict) -> Optional[float]:
        """The list price Samsung published for this configuration."""
        offers = (product_json or {}).get('offers') or {}
        if isinstance(offers, list):
            offers = offers[0] if offers else {}
        price = offers.get('price')
        if price is not None:
            try:
                return float(price)
            except (TypeError, ValueError):
                pass
        for key in ('msrpPrice', 'currentPrice'):
            value = entry.get(key)
            if value is not None:
                try:
                    return float(value)
                except (TypeError, ValueError):
                    continue
        return None

    @staticmethod
    def _published_availability(product_json: Dict) -> Optional[str]:
        """The availability Samsung published for this configuration."""
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

    def _model_only_variant(self, url: str, model_name: str,
                            model_specs: Dict[str, SpecValue]) -> ProductVariant:
        """A variant for a model that has no configuration page of its own."""
        canonical_key = extract_canonical_key(url, 'samsung')
        return ProductVariant(
            variant_id=generate_variant_id('samsung', canonical_key, model_name),
            name=model_name,
            sku='',
            specs=model_specs,
            currency=self.region.currency,
            source_url=canonicalize_url(url),
        )

    @staticmethod
    def _page_title(soup: BeautifulSoup) -> str:
        title = soup.title.get_text(' ', strip=True) if soup.title else ''
        return re.sub(r'\s*\|\s*Samsung.*$', '', title).strip()


# =============================================================================
# CONFIGURATION
# =============================================================================

def create_samsung_config() -> ScraperConfig:
    """Create the Samsung scraper configuration.

    The YAML file is authoritative for the base URL and for the region list
    (category paths, rate limit, timeout).
    """
    regions = [
        RegionConfig(
            code='us',
            name='United States',
            base_url='https://www.samsung.com/us/',
            language='en',
            currency='USD',
            category_paths={
                'galaxy-book': 'galaxybooks/',
            },
            rate_limit=0.5,
            timeout=30,
        ),
    ]

    config = ScraperConfig(
        manufacturer='samsung',
        brand='Samsung',
        base_url='https://www.samsung.com/',
        regions=regions,
        output_dir='./output',
        max_concurrent=2,
        retry_attempts=3,
        checkpoint_interval=10,
    )

    return apply_yaml_config(config)


async def run_samsung_scraper(regions: List[str] = None):
    """Run the Samsung scraper for the requested regions."""
    config = create_samsung_config()

    if regions:
        target_regions = [r for r in config.regions if r.code in regions]
    else:
        target_regions = config.regions

    all_products = []

    for region in target_regions:
        scraper = SamsungScraper(config, region)
        scraper.load_checkpoint()

        products = await scraper.scrape()
        all_products.extend(products)

        from ..models import export_products_json, export_products_csv
        from pathlib import Path
        from datetime import datetime

        output_dir = Path(config.output_dir) / region.code
        output_dir.mkdir(parents=True, exist_ok=True)

        timestamp = datetime.now().strftime('%Y%m%d_%H%M%S')
        export_products_json(products, str(output_dir / f"samsung_products_{region.code}_{timestamp}.json"))
        export_products_csv(products, str(output_dir / f"samsung_products_{region.code}_{timestamp}.csv"))

        print(f"Region {region.code}: {len(products)} products")

    return all_products


if __name__ == '__main__':
    import sys
    regions = sys.argv[1:] if len(sys.argv) > 1 else None
    asyncio.run(run_samsung_scraper(regions))
