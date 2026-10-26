"""
Veridian Scraper - Apple Scraper Implementation

What Apple actually publishes (verified live on 2026-10-21):

* The store page of a product family (``/shop/buy-mac/macbook-air``) carries
  a schema.org ``Product`` block with the family name and an
  ``AggregateOffer``: ``lowPrice`` is the price of the cheapest configuration
  of the family, ``highPrice`` the most expensive one. The offer belongs to
  the *family*, not to a single configuration, so it is recorded on the
  product and never on a variant.
* The technical specifications live on a separate, server rendered page
  (``/macbook-air/specs/``). The page is a table per model size
  (``div.table-tab``); every row is a ``div.techspecs-row`` with a
  ``div.techspecs-rowheader`` (the specification name) and one
  ``div.techspecs-column`` per model. A row with a single column is shared
  by every model of that table, a row with several columns gives one value
  per model.
* The column headers are published as ``Model 1``, ``Model 2``, ... and the
  price row links every column to the store configuration it belongs to
  (``data-pricing-product``). Apple does not publish part numbers on the
  specification page, so no part number is invented here.
"""

import asyncio
import re
from typing import AsyncIterator, List, Dict, Any, Optional, Tuple
from urllib.parse import urljoin, urlparse

from bs4 import BeautifulSoup

from .base import (
    BaseScraper, ScraperConfig, RegionConfig, apply_yaml_config, get_config_manager,
    Product, ProductVariant, ProductCategory,
    SpecValue,
    generate_product_id, generate_variant_id,
    canonicalize_url, extract_canonical_key,
    clean_text
)


class AppleScraper(BaseScraper):
    """Apple-specific scraper implementation"""

    CATEGORY_MAPPING = {
        'macbook-air': ProductCategory.LAPTOPS,
        'macbook-pro': ProductCategory.LAPTOPS,
        'imac': ProductCategory.DESKTOPS,
        'mac-mini': ProductCategory.DESKTOPS,
        'mac-studio': ProductCategory.DESKTOPS,
        'mac-pro': ProductCategory.DESKTOPS,
        'mac': ProductCategory.LAPTOPS,
    }

    SERIES_MAPPING = {
        'macbook-air': 'MacBook Air',
        'macbook-pro': 'MacBook Pro',
        'imac': 'iMac',
        'mac-mini': 'Mac mini',
        'mac-studio': 'Mac Studio',
        'mac-pro': 'Mac Pro',
    }

    # Stable hooks on Apple's technical specification pages.
    #
    # Apple ships plain, unhashed class names on these pages
    # (``techspecs-row``, ``techspecs-rowheader``, ``techspecs-column``),
    # which is what makes the extraction deterministic.
    SPEC_TABLE = 'div.techspecs'
    SPEC_TABS = 'div.table-tab'
    SPEC_ROWS = 'div.techspecs-row'
    SPEC_ROW_HEADER = 'div.techspecs-rowheader'
    SPEC_COLUMNS = 'div.techspecs-column'
    SPEC_SUBHEADER = 'p.techspecs-subheader'
    SPEC_COPY = 'p.techspecs-copy'
    SPEC_LIST = 'ul.techspecs-list'
    SPEC_COLUMN_HEADERS = '[role="columnheader"]'
    SPEC_PRICING_PRODUCT = '[data-pricing-product]'
    LEGACY_SECTION = 'section.section'
    LEGACY_SECTION_HEADER = '.section-header'

    # Apple uses two layouts for the value of a cell: the newer pages mark
    # the headline with ``techspecs-subheader`` / ``techspecs-copy``, the
    # older ones with ``title-N`` and a ``strong.title``.
    HEADLINE_CLASS_PREFIXES = ('techspecs-subheader', 'techspecs-copy', 'title')

    # Specification key standardization - Apple row names to Veridian keys.
    SPEC_KEY_MAPPING = {
        'chip': 'processor',
        'processor': 'processor',
        'memory': 'memory',
        'storage': 'storage',
        'storage 1': 'storage',
        'display': 'display',
        'battery and power': 'battery',
        'battery': 'battery',
        'power': 'battery',
        'size and weight': 'dimensions',
        'weight': 'weight',
        'operating system': 'os',
        'audio': 'audio',
        'video playback': 'video',
        'audio playback': 'audio_playback',
        'wireless': 'network',
        'communications': 'network',
        'camera': 'camera',
        'keyboard and trackpad': 'keyboard',
        'keyboard': 'keyboard',
        'pointing device': 'pointing_device',
        'ports': 'ports',
        'connections and expansion': 'ports',
        'charging and expansion': 'ports',
        'external display support': 'external_display_support',
        'finish': 'color',
        'color': 'color',
        'colors': 'color',
        'operating requirements': 'operating_requirements',
        'security': 'security',
        'applecare': 'applecare',
        'touch id': 'security',
    }

    # Rows that are marketing copy, legal text or images instead of data.
    SKIP_ROWS = frozenset({
        'product image',
        'in the box',
        'configure to order',
        'built-in apps',
        'accessibility',
        'apple intelligence',
        'environmental report',
        'video playback',
        'audio playback',
        'operating requirements',
        'price',
        'at a glance',
        'macbook air and the environment',
    })

    def __init__(self, config: ScraperConfig, region: RegionConfig):
        super().__init__(config, region)

        self.selectors = {
            'spec_table': self.SPEC_TABLE,
            'spec_tabs': self.SPEC_TABS,
            'spec_rows': self.SPEC_ROWS,
            'spec_row_header': self.SPEC_ROW_HEADER,
            'spec_columns': self.SPEC_COLUMNS,
            'spec_subheader': self.SPEC_SUBHEADER,
            'spec_copy': self.SPEC_COPY,
            'spec_list': self.SPEC_LIST,
            'spec_column_headers': self.SPEC_COLUMN_HEADERS,
            'spec_pricing_product': self.SPEC_PRICING_PRODUCT,
            'legacy_section': self.LEGACY_SECTION,
            'legacy_section_header': self.LEGACY_SECTION_HEADER,
        }

        if region.selectors:
            self.selectors.update(region.selectors)

        manager = get_config_manager()
        mfg_config = manager.get_manufacturer_config('apple') or {}
        self.specs_paths: Dict[str, str] = mfg_config.get('specs_paths') or {}

    # ------------------------------------------------------------------
    # Categories and series
    # ------------------------------------------------------------------

    def get_category_from_url(self, url: str) -> ProductCategory:
        parts = [p for p in urlparse(url).path.strip('/').split('/') if p]
        for part in reversed(parts):
            if part in self.CATEGORY_MAPPING:
                return self.CATEGORY_MAPPING[part]
        return ProductCategory.UNKNOWN

    def get_series_from_url(self, url: str) -> str:
        parts = [p for p in urlparse(url).path.strip('/').split('/') if p]
        for part in reversed(parts):
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
                ('macbook-air', '/shop/buy-mac/macbook-air'),
                ('macbook-pro', '/shop/buy-mac/macbook-pro'),
                ('imac', '/shop/buy-mac/imac'),
                ('mac-mini', '/shop/buy-mac/mac-mini'),
                ('mac-studio', '/shop/buy-mac/mac-studio'),
                ('mac-pro', '/shop/buy-mac/mac-pro'),
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
        """Yield the store page of the product family of a category.

        Apple's store publishes one page per family; the technical
        specifications of that family live on its own page, which is derived
        from the family path (``/shop/buy-mac/macbook-air`` ->
        ``/macbook-air/specs/``).
        """
        yield canonicalize_url(category_url)

    def _specs_url(self, category_url: str, category_info: Dict) -> str:
        """The technical specification page of a product family."""
        slug = category_info.get('slug', '')
        configured = self.specs_paths.get(slug)
        if configured:
            return urljoin(self.region.base_url, configured)

        parts = [p for p in urlparse(category_url).path.strip('/').split('/') if p]
        family = parts[-1] if parts else slug
        return urljoin(self.region.base_url, f"{family}/specs/")

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

        json_ld = self._extract_json_ld(soup)
        product_name = self._extract_product_name(soup, url, json_ld)
        series = self.get_series_from_url(url)
        category = self.get_category_from_url(url)

        variants = []
        specs_url = self._specs_url(url, category_info)
        if specs_url:
            variants = await self._extract_variants_from_specs(specs_url, url, product_name)

        if not variants:
            variants = [self._create_base_variant(url, product_name)]

        canonical_key = extract_canonical_key(url, 'apple')
        product_id = generate_product_id('apple', canonical_key)

        offers = json_ld.get('offers') or {}
        msrp = offers.get('lowPrice')
        currency = offers.get('priceCurrency') or self.region.currency

        product = Product(
            product_id=product_id,
            canonical_key=canonical_key,
            manufacturer='apple',
            brand='Apple',
            name=product_name,
            category=category,
            series=series,
            subcategory=category_info.get('slug', ''),
            url=canonicalize_url(url),
            region=self.region.code,
            variants=variants,
            source_urls=[canonicalize_url(url)],
            msrp=msrp,
            currency=currency,
            family_id=f"apple-{series.lower().replace(' ', '-')}" if series else None,
        )

        if specs_url:
            product.add_source_url(canonicalize_url(specs_url))

        if offers:
            product.metadata['price_range'] = {
                'low': offers.get('lowPrice'),
                'high': offers.get('highPrice'),
                'currency': offers.get('priceCurrency'),
            }
        if json_ld.get('sku'):
            product.metadata['store_sku'] = json_ld['sku']

        return product

    def _extract_json_ld(self, soup: BeautifulSoup) -> Dict[str, Any]:
        """Read the schema.org Product block of the store page."""
        result: Dict[str, Any] = {}

        for script in soup.select('script[type="application/ld+json"]'):
            try:
                import json
                data = json.loads(script.string or '')
            except (ValueError, TypeError):
                continue

            items = data if isinstance(data, list) else [data]
            for item in items:
                if not isinstance(item, dict):
                    continue
                if item.get('@type') not in ('Product', 'ProductGroup'):
                    continue

                result['name'] = self._normalize_text(item.get('name'))
                result['sku'] = item.get('sku') or item.get('mpn')
                result['description'] = item.get('description')
                result['url'] = item.get('url')
                result['image'] = item.get('image')

                offers = item.get('offers')
                if isinstance(offers, list):
                    for offer in offers:
                        if isinstance(offer, dict) and 'lowPrice' in offer:
                            result['offers'] = offer
                            break
                elif isinstance(offers, dict):
                    result['offers'] = offers

                break

        return result

    def _extract_product_name(self, soup: BeautifulSoup, url: str, json_ld: Dict[str, Any]) -> str:
        if json_ld.get('name'):
            return self._clean_product_name(json_ld['name'])

        for selector in ('h1', 'meta[property="og:title"]'):
            element = soup.select_one(selector)
            if element is None:
                continue
            if element.name == 'meta':
                name = self._normalize_text(element.get('content', ''))
            else:
                name = self._normalize_text(element.get_text())
            if name and len(name) > 3:
                return self._clean_product_name(name)

        parts = [p for p in urlparse(url).path.strip('/').split('/') if p]
        return parts[-1].replace('-', ' ').title() if parts else url

    def _clean_product_name(self, name: str) -> str:
        name = self._normalize_text(name)
        name = re.sub(r'\s*[\(\[].*?[\)\]]\s*$', '', name)
        name = re.sub(r'\s*-\s*Apple.*$', '', name, flags=re.IGNORECASE)
        name = re.sub(r'\s*\|\s*Apple.*$', '', name, flags=re.IGNORECASE)
        return name.strip()

    @staticmethod
    def _normalize_text(text: str) -> str:
        """Normalise the text Apple prints (non breaking spaces, dashes)."""
        if not text:
            return ""
        text = text.replace('\xa0', ' ')
        text = text.replace('‑', '-').replace('–', '-').replace('—', '-')
        # Superscript footnote markers become ordinary digits.
        text = text.translate(str.maketrans('¹²³⁴', '1234'))
        return re.sub(r'\s+', ' ', text).strip()

    # ------------------------------------------------------------------
    # Specifications
    # ------------------------------------------------------------------

    async def _extract_variants_from_specs(self, specs_url: str, product_url: str, default_label: str = "") -> List[ProductVariant]:
        """Read the models of a family from its technical specification page."""
        try:
            soup = await self.http_client.get_soup(specs_url)
        except Exception as exc:
            self.logger.error("Failed to fetch specs page %s: %s", specs_url, exc)
            return []

        variants = self._variants_from_specs(soup, specs_url, product_url, default_label)
        if not variants:
            variants = self._variants_from_legacy_sections(soup, specs_url, product_url, default_label)
        return variants

    def _variants_from_specs(self, soup: BeautifulSoup, specs_url: str, product_url: str, default_label: str = "") -> List[ProductVariant]:
        """One variant per model column of every specification table."""
        tabs = soup.select(self.selectors['spec_tabs'])
        if tabs:
            tables = [(tab, tab.select(self.selectors['spec_rows'])) for tab in tabs]
        else:
            table = soup.select_one(self.selectors['spec_table'])
            rows = table.select(self.selectors['spec_rows']) if table else []
            tables = [(table, rows)]

        variants: List[ProductVariant] = []
        canonical_key = extract_canonical_key(product_url, 'apple')

        for table, rows in tables:
            if table is None or not rows:
                continue

            label = self._table_label(table) or default_label
            headers = self._column_headers(table)
            column_count = max(
                [len(row.select(self.selectors['spec_columns'])) for row in rows] + [len(headers)]
            )
            if column_count <= 0:
                continue

            names = headers[:column_count] if headers else []
            while len(names) < column_count:
                names.append(f"Model {len(names) + 1}")

            # The price row links every column to the store configuration it
            # belongs to. That identifier is published by Apple, so it is used
            # as the SKU of the variant.
            slugs = self._pricing_slugs(table, column_count)

            spec_sets: List[Dict[str, SpecValue]] = [{} for _ in range(column_count)]

            for row in rows:
                header = row.select_one(self.selectors['spec_row_header'])
                if header is None:
                    continue
                spec_name = self._normalize_text(header.get_text())
                if not spec_name or self._row_key(spec_name) in self.SKIP_ROWS:
                    continue

                cells = row.select(self.selectors['spec_columns'])
                if not cells:
                    continue

                values = [self._cell_text(cell) for cell in cells]
                values = [value for value in values if value]

                if len(values) == 1:
                    # A row with a single cell is shared by every model.
                    for index in range(column_count):
                        spec_sets[index][self._standard_spec_key(spec_name)] = self._parse_spec_field(
                            self._standard_spec_key(spec_name), values[0], source_field=spec_name
                        )
                else:
                    for index, value in enumerate(values[:column_count]):
                        key = self._standard_spec_key(spec_name)
                        spec_sets[index][key] = self._parse_spec_field(key, value, source_field=spec_name)

            for index, specs in enumerate(spec_sets):
                if not specs:
                    continue
                header = names[index]
                if re.fullmatch(r'model\s*\d+', header, re.IGNORECASE):
                    # The column header is only "Model N"; the table label
                    # names the model size it belongs to.
                    name = f"{label} {header}" if label else header
                else:
                    # Apple named the column itself ("Mac Studio, Model1").
                    name = header
                variants.append(ProductVariant(
                    variant_id=generate_variant_id('apple', canonical_key, name),
                    name=name,
                    sku=slugs[index] if index < len(slugs) else "",
                    specs=specs,
                    source_url=canonicalize_url(specs_url),
                ))

        return variants

    def _variants_from_legacy_sections(self, soup: BeautifulSoup, specs_url: str, product_url: str, default_label: str = "") -> List[ProductVariant]:
        """Read the older section based layout (iMac)."""
        sections = soup.select(self.selectors['legacy_section'])
        if not sections:
            return []

        canonical_key = extract_canonical_key(product_url, 'apple')
        specs: Dict[str, SpecValue] = {}

        for section in sections:
            header = section.select_one(self.selectors['legacy_section_header'])
            if header is None:
                continue
            spec_name = self._normalize_text(header.get_text())
            if not spec_name or self._row_key(spec_name) in self.SKIP_ROWS:
                continue
            value = self._normalize_text(section.get_text(" ", strip=True))
            if value.startswith(spec_name):
                value = value[len(spec_name):].strip()
            if not value:
                continue
            key = self._standard_spec_key(spec_name)
            specs[key] = self._parse_spec_field(key, value, source_field=spec_name)

        if not specs:
            return []

        name = default_label or (self._normalize_text(soup.title.get_text()) if soup.title else "Specifications")
        return [ProductVariant(
            variant_id=generate_variant_id('apple', canonical_key, name),
            name=name,
            sku="",
            specs=specs,
            source_url=canonicalize_url(specs_url),
        )]

    def _table_label(self, table) -> str:
        """The name Apple publishes for a specification table."""
        labelled_by = self._normalize_text(table.get('aria-labelledby') or '')
        if labelled_by and labelled_by.lower() not in ('tableheader', 'table header'):
            return labelled_by
        region = table.get('data-analytics-activitymap-region-id')
        if region:
            return self._normalize_text(region).replace(' specs', '').title()
        return ""

    def _column_headers(self, table) -> List[str]:
        """The published column headers ("Model 1", "Model 2", ...)."""
        headers = []
        for header in table.select(self.selectors['spec_column_headers']):
            text = self._normalize_text(header.get_text())
            if text:
                headers.append(text)
        return headers

    def _pricing_slugs(self, table, column_count: int) -> List[str]:
        """The store configuration each column belongs to, in column order."""
        slugs: List[str] = []
        for row in table.select(self.selectors['spec_rows']):
            header = row.select_one(self.selectors['spec_row_header'])
            if header is None:
                continue
            if self._normalize_text(header.get_text()).lower() != 'price':
                continue
            for cell in row.select(self.selectors['spec_columns']):
                element = cell.select_one(self.selectors['spec_pricing_product'])
                slugs.append(element.get('data-pricing-product') if element else "")
            break
        while len(slugs) < column_count:
            slugs.append("")
        return slugs[:column_count]

    def _cell_text(self, cell) -> str:
        """The value of a specification cell, in the order Apple prints it.

        A cell holds a headline (``techspecs-subheader``), the description
        that belongs to it (``techspecs-copy``) and, for the chip, the
        display and the ports, a list (``techspecs-list``). A subheader that
        ends with a colon ("Configurable to:") labels the value that follows
        it.
        """
        parts: List[str] = []
        pending_prefix = ""

        for element in cell.find_all(['p', 'li', 'strong']):
            if element.name == 'li':
                text = self._text_without_footnotes(element)
            elif element.name == 'strong':
                classes = element.get('class') or []
                if 'title' not in classes:
                    continue
                if self._has_list_ancestor(element, cell):
                    # The label is part of the list item, which is collected
                    # as a whole.
                    continue
                text = self._text_without_footnotes(element)
            else:
                classes = element.get('class') or []
                is_headline = any(
                    cls.startswith(prefix)
                    for prefix in self.HEADLINE_CLASS_PREFIXES
                    for cls in classes
                )
                if not is_headline:
                    continue
                if element.find('strong', class_='title') is not None:
                    # The headline is the inner <strong class="title">.
                    continue
                text = self._text_without_footnotes(element)

            if not text:
                continue

            if element.name != 'li' and text.endswith(':'):
                pending_prefix = f"{text} "
                continue

            parts.append(f"{pending_prefix}{text}".strip())
            pending_prefix = ""

        if not parts:
            parts.append(self._normalize_text(cell.get_text(" ", strip=True)))

        return ', '.join(part for part in parts if part)

    @staticmethod
    def _has_list_ancestor(element, cell) -> bool:
        """Is the element inside a list item of the cell?"""
        for parent in element.parents:
            if parent is cell:
                return False
            if parent.name == 'li':
                return True
        return False

    @classmethod
    def _text_without_footnotes(cls, element) -> str:
        """The text of an element without the footnote reference numbers."""
        pieces: List[str] = []
        for descendant in element.descendants:
            if not isinstance(descendant, str):
                continue
            if any(parent.name == 'sup' for parent in descendant.parents if parent is not element):
                continue
            pieces.append(descendant)
        return cls._normalize_text(''.join(pieces))

    def _standard_spec_key(self, spec_name: str) -> str:
        """Map an Apple row name to a Veridian spec key.

        Apple marks rows with a footnote number ("Storage 1", "Battery and
        Power 3"); the number is part of the footnote, not of the name, so it
        is removed before the row is looked up.
        """
        lowered = self._row_key(spec_name)
        mapped = self.SPEC_KEY_MAPPING.get(lowered)
        if mapped:
            return mapped
        return re.sub(r'[^a-z0-9]+', '_', lowered).strip('_')

    @staticmethod
    def _row_key(spec_name: str) -> str:
        """A row name without its footnote number, in lower case."""
        lowered = spec_name.strip().lower()
        return re.sub(r'\s*\d+$', '', lowered).strip()

    def _parse_spec_field(self, key: str, value: str, source_field: str = None) -> SpecValue:
        """Parse an Apple specification value into a :class:`SpecValue`."""
        structured = self._extract_structured(key, value)
        return SpecValue(
            raw=value,
            structured=structured if structured else None,
            unit=self._unit_for(key),
            is_multi_option=False,
            options=[],
            confidence=0.9 if structured else 0.5,
            source_field=source_field or key,
        )

    def _extract_structured(self, key: str, value: str) -> Optional[Dict[str, Any]]:
        """Structured data for the Apple specification fields."""
        result: Dict[str, Any] = {}
        lowered = key.lower()

        if lowered == 'processor':
            model = re.search(r'\b(M\d)\b', value)
            if model:
                result['model'] = f"Apple {model.group(1)}"
                result['brand'] = 'Apple'
            cpu = re.search(r'(\d+)[‑\- ]core CPU', value)
            if cpu:
                result['cores'] = int(cpu.group(1))
            gpu = re.search(r'(\d+)[‑\- ]core GPU', value)
            if gpu:
                result['gpu_cores'] = int(gpu.group(1))
            neural = re.search(r'(\d+)[‑\- ]core Neural Engine', value)
            if neural:
                result['neural_engine_cores'] = int(neural.group(1))
            bandwidth = re.search(r'(\d+)GB/s memory bandwidth', value)
            if bandwidth:
                result['memory_bandwidth_gbs'] = int(bandwidth.group(1))

        elif lowered == 'memory':
            capacity = re.search(r'(\d+)\s*GB', value)
            if capacity:
                result['capacity_gb'] = int(capacity.group(1))
            if 'unified memory' in value.lower():
                result['type'] = 'unified'
            configurable = re.search(r'Configurable to:\s*([^()]+)', value)
            if configurable:
                options = re.findall(r'(\d+)\s*GB', configurable.group(1))
                if options:
                    result['configurable_gb'] = [int(option) for option in options]

        elif lowered == 'storage':
            capacity = re.search(r'(\d+)\s*(TB|GB)', value)
            if capacity:
                size = int(capacity.group(1))
                unit = capacity.group(2).upper()
                result['capacity_gb'] = size * 1024 if unit == 'TB' else size
                result['capacity'] = f"{size}{unit}"
            if 'SSD' in value:
                result['interface'] = 'SSD'
            configurable = re.search(r'Configurable to:\s*([^()]+)', value)
            if configurable:
                options = re.findall(r'(\d+)\s*(TB|GB)', configurable.group(1))
                if options:
                    result['configurable_gb'] = [
                        int(size) * 1024 if unit.upper() == 'TB' else int(size)
                        for size, unit in options
                    ]

        elif lowered == 'display':
            size = re.search(r'(\d+(?:\.\d+)?)[‑\- ]inch', value)
            if size:
                result['size_inches'] = float(size.group(1))
            resolution = re.search(r'(\d{3,5})\s*[-–]?\s*(?:x|by|×)\s*[-–]?\s*(\d{3,5})', value)
            if resolution:
                result['width_px'] = int(resolution.group(1))
                result['height_px'] = int(resolution.group(2))
                result['resolution'] = f"{resolution.group(1)}x{resolution.group(2)}"
            if 'Liquid Retina' in value:
                result['panel_type'] = 'Liquid Retina'
            elif 'Retina' in value:
                result['panel_type'] = 'Retina'
            elif 'Mini-LED' in value or 'Mini LED' in value:
                result['panel_type'] = 'Mini LED'
            elif 'XDR' in value:
                result['panel_type'] = 'XDR'
            refresh = re.search(r'(\d+)\s*Hz', value)
            if refresh:
                result['refresh_rate_hz'] = int(refresh.group(1))
            nits = re.search(r'(\d+)\s*nits', value)
            if nits:
                result['brightness_nits'] = int(nits.group(1))

        elif lowered == 'battery':
            hours = re.search(r'Up to\s*(\d+)\s*hours', value)
            if hours:
                result['battery_life_hours'] = int(hours.group(1))
            watt = re.search(r'(\d+)\s*Wh', value)
            if watt:
                result['capacity_wh'] = int(watt.group(1))

        elif lowered == 'dimensions':
            for label, key in (('Height', 'height'), ('Width', 'width'), ('Depth', 'depth')):
                match = re.search(label + r':\s*([\d.]+)\s*(inch|inches|cm)', value)
                if match:
                    amount = float(match.group(1))
                    if match.group(2).lower() in ('inch', 'inches'):
                        result[f"{key}_in"] = amount
                        result[f"{key}_mm"] = round(amount * 25.4, 2)
                    else:
                        result[f"{key}_cm"] = amount
                        result[f"{key}_mm"] = round(amount * 10, 2)
            # Apple publishes the weight in the same row as the dimensions.
            weight = re.search(r'Weight[^:]*:\s*([\d.]+)\s*(pounds|lbs|kg|kilograms)', value, re.IGNORECASE)
            if weight:
                amount = float(weight.group(1))
                if weight.group(2).lower() in ('pounds', 'lbs'):
                    result['weight_lbs'] = amount
                    result['weight_kg'] = round(amount * 0.45359237, 3)
                else:
                    result['weight_kg'] = amount

        elif lowered == 'weight':
            match = re.search(r'([\d.]+)\s*(pounds|lbs|kg|kilograms)', value, re.IGNORECASE)
            if match:
                amount = float(match.group(1))
                if match.group(2).lower() in ('pounds', 'lbs'):
                    result['weight_lbs'] = amount
                    result['weight_kg'] = round(amount * 0.45359237, 3)
                else:
                    result['weight_kg'] = amount

        elif lowered == 'network':
            wifi = re.search(r'Wi[-]?Fi\s*(\d+(?:\.\d+)?|6E|7)', value, re.IGNORECASE)
            if wifi:
                result['wifi_standard'] = f"Wi-Fi {wifi.group(1)}"
            bluetooth = re.search(r'Bluetooth\s*(\d+(?:\.\d+)?)', value, re.IGNORECASE)
            if bluetooth:
                result['bluetooth_version'] = bluetooth.group(1)

        elif lowered == 'camera':
            megapixels = re.search(r'(\d+)MP', value)
            if megapixels:
                result['megapixels'] = int(megapixels.group(1))
            if 'Center Stage' in value:
                result['features'] = ['Center Stage']

        elif lowered == 'os':
            result['operating_system'] = 'macOS' if 'macOS' in value else value

        elif lowered == 'keyboard':
            if 'Magic Keyboard' in value:
                result['type'] = 'Magic Keyboard'
            keys = re.search(r'(\d+)[‑\- ]\((?:ANSI|ISO)\)', value)
            if keys:
                result['key_count'] = int(keys.group(1))

        elif lowered == 'ports':
            ports = [port.strip() for port in re.split(r',|Two |Three |Four ', value) if port.strip()]
            if ports:
                result['ports'] = ports

        elif lowered == 'color':
            colors = [color.strip() for color in re.split(r',', value) if color.strip()]
            if colors:
                result['colors'] = colors

        return result if result else None

    @staticmethod
    def _unit_for(key: str) -> Optional[str]:
        return {
            'processor': 'GHz',
            'memory': 'GB',
            'storage': 'GB',
            'display': 'inches',
            'battery': 'Wh',
            'weight': 'kg',
            'dimensions': 'mm',
        }.get(key.lower())

    def _create_base_variant(self, url: str, product_name: str) -> ProductVariant:
        canonical_key = extract_canonical_key(url, 'apple')
        return ProductVariant(
            variant_id=generate_variant_id('apple', canonical_key, product_name or "Base"),
            name=product_name or "Base",
            sku="",
            specs={},
            source_url=canonicalize_url(url),
        )


def create_apple_config() -> ScraperConfig:
    """Create Apple scraper configuration"""
    regions = [
        RegionConfig(
            code='us',
            name='United States',
            base_url='https://www.apple.com/',
            language='en',
            currency='USD',
            category_paths={
                'macbook-air': '/shop/buy-mac/macbook-air',
                'macbook-pro': '/shop/buy-mac/macbook-pro',
                'imac': '/shop/buy-mac/imac',
                'mac-mini': '/shop/buy-mac/mac-mini',
                'mac-studio': '/shop/buy-mac/mac-studio',
                'mac-pro': '/shop/buy-mac/mac-pro',
            },
            rate_limit=0.5,  # 1 request per 2 seconds
            timeout=30
        ),
    ]

    config = ScraperConfig(
        manufacturer='apple',
        brand='Apple',
        base_url='https://www.apple.com/',
        regions=regions,
        output_dir='./output',
        max_concurrent=1,
        retry_attempts=3,
        checkpoint_interval=5
    )

    return apply_yaml_config(config)


async def run_apple_scraper(regions: List[str] = None):
    """Run Apple scraper for specified regions"""
    config = create_apple_config()

    if regions:
        target_regions = [r for r in config.regions if r.code in regions]
    else:
        target_regions = config.regions

    all_products = []

    for region in target_regions:
        scraper = AppleScraper(config, region)
        scraper.load_checkpoint()

        products = await scraper.scrape()
        all_products.extend(products)

        from ..models import export_products_json, export_products_csv
        from pathlib import Path
        from datetime import datetime

        output_dir = Path(config.output_dir) / region.code
        output_dir.mkdir(parents=True, exist_ok=True)

        timestamp = datetime.now().strftime('%Y%m%d_%H%M%S')
        export_products_json(products, str(output_dir / f"apple_products_{region.code}_{timestamp}.json"))
        export_products_csv(products, str(output_dir / f"apple_products_{region.code}_{timestamp}.csv"))

        print(f"Region {region.code}: {len(products)} products")

    return all_products


if __name__ == '__main__':
    import sys
    regions = sys.argv[1:] if len(sys.argv) > 1 else None
    asyncio.run(run_apple_scraper(regions))
