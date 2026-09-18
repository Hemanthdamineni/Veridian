"""
Veridian Scraper - Generic Scraper
A generic scraper implementation for manufacturers with standard pagination-based product listings.

This reduces code duplication for scrapers that follow the standard pattern:
1. Fetch listing page with pagination
2. Extract product URLs
3. Fetch each product page
4. Extract tech specs table
5. Build Product/ProductVariant objects
"""

import asyncio
import hashlib
import logging
import re
from typing import Dict, List, Optional, Set, Any
from urllib.parse import urljoin

from bs4 import BeautifulSoup

from ..models import (
    Product,
    ProductVariant,
    ProductCategory,
    ProductStatus,
    SpecValue,
    generate_product_id,
    generate_variant_id,
    canonicalize_url,
    extract_canonical_key,
    ScrapingProgress,
)
from .base import BaseScraper, HTTPClient, ScraperConfig, RegionConfig, FIELD_PARSERS


class GenericScraper(BaseScraper):
    """
    Generic scraper for manufacturers with standard pagination-based product listings.

    Subclasses should override:
    - product_listing_paths: Paths to product category pages
    - product_link_selector: CSS selector for product links on listing page
    - product_name_selector: CSS selector for product name on detail page
    - specs_table_selector: CSS selector for specs table on detail page
    - specs_row_selector: CSS selector for spec rows in the table
    - specs_label_selector: CSS selector for spec label/name
    - specs_value_selector: CSS selector for spec value
    """

    # Override these in subclasses
    product_listing_paths: List[str] = ["/laptops"]
    product_link_selector: str = "a.product-link"
    product_name_selector: str = "h1.product-name"
    specs_table_selector: str = "table.specs-table"
    specs_row_selector: str = "tr"
    specs_label_selector: str = "th, td:first-child"
    specs_value_selector: str = "td:last-child"
    pagination_selector: str = "a.next-page"
    max_pages: int = 10

    def __init__(self, config: ScraperConfig, region: RegionConfig):
        super().__init__(config, region)
        self.product_urls: Set[str] = set()

    async def scrape(self) -> List[Product]:
        """Main scrape method"""
        self.logger.info(f"Starting {self.config.brand} scraper for {self.region.code}")

        async with HTTPClient(self.config, region=self.region) as client:
            self.http_client = client

            # Discover product URLs
            await self._discover_products(client)

            # Scrape each product
            products = await self._scrape_products(client)

        self.logger.info(f"Completed {self.config.brand}: {len(products)} products")
        return products

    async def _discover_products(self, client: HTTPClient):
        """Discover product URLs from listing pages"""
        self.product_urls.clear()

        for path in self.product_listing_paths:
            base_url = urljoin(self.region.base_url, path)
            await self._discover_from_listing(client, base_url)

        self.logger.info(f"Discovered {len(self.product_urls)} product URLs")

    async def _discover_from_listing(self, client: HTTPClient, base_url: str):
        """Discover products from a listing page with pagination"""
        for page in range(1, self.max_pages + 1):
            # Build page URL (override in subclass if different pattern)
            page_url = self._get_page_url(base_url, page)

            try:
                response = await self._fetch_with_retry(client, page_url)
                if not response:
                    break

                soup = BeautifulSoup(response.text, "html.parser")

                # Extract product links
                links = soup.select(self.product_link_selector)
                page_urls = set()
                for link in links:
                    href = link.get("href")
                    if href:
                        full_url = urljoin(self.region.base_url, href)
                        page_urls.add(canonicalize_url(full_url))

                if not page_urls:
                    break

                self.product_urls.update(page_urls)
                self.logger.debug(f"Page {page}: found {len(page_urls)} products")

                # Check for next page
                next_link = soup.select_one(self.pagination_selector)
                if not next_link:
                    break

            except Exception as e:
                self.logger.warning(f"Error on page {page} of {base_url}: {e}")
                break

    def _get_page_url(self, base_url: str, page: int) -> str:
        """Get URL for a specific page number. Override for custom pagination."""
        if page == 1:
            return base_url
        separator = "&" if "?" in base_url else "?"
        return f"{base_url}{separator}page={page}"

    async def _scrape_products(self, client: HTTPClient) -> List[Product]:
        """Scrape all discovered product URLs"""
        products = []
        self.progress = ScrapingProgress()

        for i, url in enumerate(self.product_urls):
            self.progress.total_items = len(self.product_urls)
            self.progress.processed_items = i

            try:
                product = await self._scrape_product(client, url)
                if product:
                    products.append(product)
                    self.progress.successful_items += 1
            except Exception as e:
                self.logger.error(f"Error scraping {url}: {e}")
                self.progress.failed_items += 1

            # Checkpoint periodically
            if i > 0 and i % self.config.checkpoint_interval == 0:
                self.logger.info(f"Progress: {i}/{len(self.product_urls)} products")

        return products

    async def _scrape_product(self, client: HTTPClient, url: str) -> Optional[Product]:
        """Scrape a single product page"""
        response = await self._fetch_with_retry(client, url)
        if not response:
            return None

        soup = BeautifulSoup(response.text, "html.parser")

        # Extract product name
        name_elem = soup.select_one(self.product_name_selector)
        if not name_elem:
            return None

        product_name = name_elem.get_text(strip=True)

        # Extract specs
        specs = self._extract_specs(soup)

        # Build product
        return self._build_product(url, product_name, specs)

    def _extract_specs(self, soup: BeautifulSoup) -> Dict[str, SpecValue]:
        """Extract specifications from the page"""
        specs = {}

        # Try to find specs table
        table = soup.select_one(self.specs_table_selector)
        if table:
            rows = table.select(self.specs_row_selector)
            for row in rows:
                label_elem = row.select_one(self.specs_label_selector)
                value_elem = row.select_one(self.specs_value_selector)

                if label_elem and value_elem:
                    label = label_elem.get_text(strip=True)
                    value = value_elem.get_text(strip=True)

                    if label and value:
                        spec = self._parse_spec_field(label, value)
                        if spec:
                            specs[spec.name] = spec

        # Also try JSON-LD structured data
        json_ld_specs = self._extract_json_ld_specs(soup)
        specs.update(json_ld_specs)

        return specs

    def _extract_json_ld_specs(self, soup: BeautifulSoup) -> Dict[str, SpecValue]:
        """Extract specs from JSON-LD structured data"""
        specs = {}
        import json

        for script in soup.find_all("script", type="application/ld+json"):
            try:
                data = json.loads(script.string)
                if isinstance(data, dict) and data.get("@type") == "Product":
                    # Extract common fields from Product schema
                    if "name" in data:
                        specs["product_name"] = SpecValue(
                            name="product_name",
                            raw_value=data["name"],
                            confidence=1.0,
                        )
                    if "brand" in data:
                        brand = data.get("brand", {}).get("name", data.get("brand", ""))
                        specs["brand"] = SpecValue(
                            name="brand",
                            raw_value=brand,
                            confidence=1.0,
                        )
            except (json.JSONDecodeError, TypeError):
                continue

        return specs

    def _parse_spec_field(self, label: str, value: str) -> Optional[SpecValue]:
        """Parse a spec field using appropriate parser"""
        # Normalize label
        label_lower = label.lower().rstrip(":").strip()

        # Find matching parser
        for key, parser in FIELD_PARSERS.items():
            if key in label_lower:
                try:
                    parsed = parser(value)
                    if parsed:
                        return SpecValue(
                            name=label_lower.replace(" ", "_"),
                            raw_value=value,
                            parsed_value=parsed,
                            confidence=0.8,
                        )
                except Exception:
                    pass

        # Fallback: store as-is
        return SpecValue(
            name=label_lower.replace(" ", "_"),
            raw_value=value,
            confidence=0.5,
        )

    def _build_product(self, url: str, name: str, specs: Dict[str, SpecValue]) -> Product:
        """Build a Product object from extracted data"""
        # Generate IDs
        product_id = generate_product_id(self.config.brand, name)
        variant_id = generate_variant_id(product_id, specs)

        # Extract key specs for variant
        cpu = self._find_spec(specs, ["processor", "cpu", "processor_name"])
        memory = self._find_spec(specs, ["memory", "ram", "system_memory"])
        storage = self._find_spec(specs, ["storage", "ssd", "hard_drive", "drive"])
        display = self._find_spec(specs, ["display", "screen", "monitor"])
        battery = self._find_spec(specs, ["battery", "battery_life"])
        weight = self._find_spec(specs, ["weight"])

        # Build variant
        variant = ProductVariant(
            variant_id=variant_id,
            sku_code=extract_canonical_key(name) or variant_id,
            canonical_url=url,
            specs=specs,
            category=ProductCategory.LAPTOP,
            status=ProductStatus.ACTIVE,
        )

        # Build product
        product = Product(
            product_id=product_id,
            name=name,
            brand=self.config.brand,
            category=ProductCategory.LAPTOP,
            url=url,
            variants=[variant],
            specs=specs,
        )

        return product

    def _find_spec(self, specs: Dict[str, SpecValue], keys: List[str]) -> Optional[SpecValue]:
        """Find a spec by trying multiple possible keys"""
        for key in keys:
            if key in specs:
                return specs[key]
        return None

    async def _fetch_with_retry(self, client: HTTPClient, url: str):
        """Fetch URL with retry logic"""
        for attempt in range(self.config.retry_attempts):
            try:
                return await client.get(url)
            except Exception as e:
                if attempt == self.config.retry_attempts - 1:
                    self.logger.error(f"Failed to fetch {url}: {e}")
                    return None
                await asyncio.sleep(2 ** attempt)
        return None
