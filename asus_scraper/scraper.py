"""
ASUS India Product Scraper
Comprehensive scraper for extracting product listings with detailed specifications
from asus.com/in including laptops, motherboards, displays, networking, and more.
"""

import asyncio
import json
import csv
import logging
import time
import hashlib
import re
from pathlib import Path
from dataclasses import dataclass, field, asdict
from typing import Optional, List, Dict, Any, Set
from urllib.parse import urljoin, urlparse, parse_qs
from datetime import datetime
import yaml

import httpx
from bs4 import BeautifulSoup
from tenacity import retry, stop_after_attempt, wait_exponential, retry_if_exception_type

# Configure logging
def setup_logging(config: dict):
    log_config = config.get('logging', {})
    log_file = Path(log_config.get('file', './logs/scraper.log'))
    log_file.parent.mkdir(parents=True, exist_ok=True)

    logging.basicConfig(
        level=getattr(logging, log_config.get('level', 'INFO')),
        format='%(asctime)s - %(name)s - %(levelname)s - %(message)s',
        handlers=[
            logging.FileHandler(log_file),
            logging.StreamHandler()
        ]
    )
    return logging.getLogger(__name__)


@dataclass
class ProductVariant:
    """Individual product variant (SKU) with its specifications"""
    variant_id: str
    name: str
    specs: Dict[str, str] = field(default_factory=dict)


@dataclass
class Product:
    """Product with all its variants and metadata"""
    product_id: str
    url: str
    category: str
    subcategory: str
    series: str
    name: str
    variants: List[ProductVariant] = field(default_factory=list)
    scraped_at: str = field(default_factory=lambda: datetime.now().isoformat())
    source_url: str = ""

    def to_dict(self) -> Dict[str, Any]:
        return {
            'product_id': self.product_id,
            'url': self.url,
            'category': self.category,
            'subcategory': self.subcategory,
            'series': self.series,
            'name': self.name,
            'variants': [asdict(v) for v in self.variants],
            'scraped_at': self.scraped_at,
            'source_url': self.source_url
        }


@dataclass
class ScrapingProgress:
    """Track scraping progress for resumability"""
    discovered_categories: List[str] = field(default_factory=list)
    discovered_product_urls: List[str] = field(default_factory=list)
    scraped_product_ids: Set[str] = field(default_factory=set)
    failed_urls: List[Dict[str, Any]] = field(default_factory=list)
    last_checkpoint: str = field(default_factory=lambda: datetime.now().isoformat())
    total_products: int = 0
    scraped_count: int = 0

    def to_dict(self) -> Dict[str, Any]:
        return {
            'discovered_categories': self.discovered_categories,
            'discovered_product_urls': self.discovered_product_urls,
            'scraped_product_ids': list(self.scraped_product_ids),
            'failed_urls': self.failed_urls,
            'last_checkpoint': self.last_checkpoint,
            'total_products': self.total_products,
            'scraped_count': self.scraped_count
        }

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> 'ScrapingProgress':
        progress = cls()
        progress.discovered_categories = data.get('discovered_categories', [])
        progress.discovered_product_urls = data.get('discovered_product_urls', [])
        progress.scraped_product_ids = set(data.get('scraped_product_ids', []))
        progress.failed_urls = data.get('failed_urls', [])
        progress.last_checkpoint = data.get('last_checkpoint', datetime.now().isoformat())
        progress.total_products = data.get('total_products', 0)
        progress.scraped_count = data.get('scraped_count', 0)
        return progress


class Config:
    """Configuration manager"""

    def __init__(self, config_path: str):
        with open(config_path, 'r') as f:
            self.config = yaml.safe_load(f)
        self.logger = logging.getLogger(__name__)

    def get(self, key: str, default=None):
        return self.config.get(key, default)


class HTTPClient:
    """Async HTTP client with rate limiting and retries"""

    def __init__(self, config: Config):
        self.config = config
        self.client: Optional[httpx.AsyncClient] = None
        self.last_request_time = 0
        self.logger = logging.getLogger(__name__)

    async def __aenter__(self):
        timeout = httpx.Timeout(self.config.get('timeout', 30))
        headers = {
            'User-Agent': self.config.get('user_agent'),
            'Accept-Language': self.config.get('accept_language', 'en-IN,en;q=0.9'),
        }
        self.client = httpx.AsyncClient(
            timeout=timeout,
            headers=headers,
            follow_redirects=True,
            limits=httpx.Limits(max_connections=10, max_keepalive_connections=5)
        )
        return self

    async def __aexit__(self, exc_type, exc_val, exc_tb):
        if self.client:
            await self.client.aclose()

    async def _rate_limit(self):
        delay = self.config.get('rate_limit_delay', 2.0)
        elapsed = time.time() - self.last_request_time
        if elapsed < delay:
            await asyncio.sleep(delay - elapsed)
        self.last_request_time = time.time()

    @retry(
        stop=stop_after_attempt(3),
        wait=wait_exponential(multiplier=2, min=2, max=30),
        retry=retry_if_exception_type((httpx.RequestError, httpx.HTTPStatusError))
    )
    async def get(self, url: str) -> httpx.Response:
        await self._rate_limit()
        if not self.client:
            raise RuntimeError("HTTP client not initialized")

        self.logger.debug(f"GET {url}")
        response = await self.client.get(url)
        response.raise_for_status()
        return response

    async def get_text(self, url: str) -> str:
        response = await self.get(url)
        return response.text


class CategoryDiscoverer:
    """Discover all product categories and subcategories"""

    def __init__(self, http_client: HTTPClient, config: Config):
        self.http = http_client
        self.config = config
        self.logger = logging.getLogger(__name__)
        self.base_url = f"{self.config.get('base_url')}/{self.config.get('region')}"

    async def discover_main_categories(self) -> List[str]:
        """Get main category URLs from homepage"""
        self.logger.info("Discovering main categories from homepage...")
        html = await self.http.get_text(self.base_url + "/")
        soup = BeautifulSoup(html, 'html.parser')

        categories = set()
        # Find all navigation links
        for link in soup.find_all('a', href=True):
            href = link['href']
            if f'/{self.config.get("region")}/' in href:
                # Filter for product categories
                if any(keyword in href for keyword in [
                    '/laptops/', '/motherboards/', '/displays/', '/monitors/',
                    '/networking/', '/graphics-cards/', '/components/',
                    '/accessories/', '/phones/', '/tablets/', '/handhelds/',
                    '/desktops/', '/servers/', '/routers/', '/workstations/'
                ]):
                    full_url = urljoin(self.base_url, href)
                    categories.add(full_url)

        self.logger.info(f"Discovered {len(categories)} main category URLs")
        return sorted(categories)

    async def discover_subcategories(self, category_url: str) -> List[str]:
        """Discover subcategories within a category"""
        self.logger.info(f"Discovering subcategories for {category_url}")
        try:
            html = await self.http.get_text(category_url)
            soup = BeautifulSoup(html, 'html.parser')

            subcategories = set()
            for link in soup.find_all('a', href=True):
                href = link['href']
                if f'/{self.config.get("region")}/' in href and href != category_url:
                    # Must be a subcategory (deeper path)
                    parsed_cat = urlparse(category_url)
                    parsed_sub = urlparse(href)
                    if parsed_sub.path.startswith(parsed_cat.path) and len(parsed_sub.path) > len(parsed_cat.path):
                        full_url = urljoin(self.base_url, href)
                        subcategories.add(full_url)

            return sorted(subcategories)
        except Exception as e:
            self.logger.warning(f"Failed to discover subcategories for {category_url}: {e}")
            return []


class ProductLister:
    """Extract product URLs from category/listing pages"""

    def __init__(self, http_client: HTTPClient, config: Config):
        self.http = http_client
        self.config = config
        self.logger = logging.getLogger(__name__)

    async def get_product_urls(self, category_url: str) -> List[str]:
        """Get all product URLs from a category (handles pagination)"""
        self.logger.info(f"Listing products from {category_url}")
        product_urls = set()
        page = 1

        while True:
            page_url = f"{category_url}?page={page}" if page > 1 else category_url
            try:
                html = await self.http.get_text(page_url)
                urls = self._extract_product_urls(html)

                if not urls:
                    self.logger.info(f"No more products on page {page} for {category_url}")
                    break

                product_urls.update(urls)
                self.logger.info(f"Page {page}: found {len(urls)} products (total: {len(product_urls)})")

                # Check for next page
                if not self._has_next_page(html):
                    break

                page += 1

            except Exception as e:
                self.logger.warning(f"Failed to fetch page {page} of {category_url}: {e}")
                break

        return sorted(product_urls)

    def _extract_product_urls(self, html: str) -> List[str]:
        """Extract product URLs from listing page HTML"""
        soup = BeautifulSoup(html, 'html.parser')
        urls = set()

        # Method 1: Direct product links in HTML
        for link in soup.find_all('a', href=True):
            href = link['href']
            # Match product URLs like /in/laptops/for-home/vivobook/asus-vivobook-s16-s3607/
            # Pattern: /in/{category}/{subcategory}/{series}/asus-{product}
            if re.search(rf'/{self.config.get("region")}/[^/]+/[^/]+/[^/]+/asus-[^/]+/?$', href):
                urls.add(urljoin(self.config.get('base_url'), href))

        # Method 2: Check for embedded Nuxt data
        nuxt_data = self._extract_nuxt_products(html)
        urls.update(nuxt_data)

        return list(urls)

    def _extract_nuxt_products(self, html: str) -> List[str]:
        """Extract product URLs from embedded Nuxt state"""
        urls = set()
        try:
            # Find the Nuxt data script
            pattern = r'window\.__NUXT__=\(function.*?\{return\s+(\{.*?\})\);'
            match = re.search(pattern, html, re.DOTALL)
            if match:
                # The data is obfuscated, but URLs might be in plain text
                # Look for product URLs in the script
                script_content = match.group(0)
                product_urls = re.findall(rf'https?://[^"\']*{self.config.get("region")}[^"\']*asus-[^"\']*', script_content)
                urls.update(product_urls)
        except Exception as e:
            self.logger.debug(f"Nuxt extraction failed: {e}")
        return list(urls)

    def _has_next_page(self, html: str) -> bool:
        """Check if there's a next page"""
        soup = BeautifulSoup(html, 'html.parser')
        # Look for pagination indicators
        next_link = soup.find('a', rel='next')
        if next_link:
            return True
        # Check for page numbers
        pagination = soup.find(class_=re.compile(r'pagination|page-number'))
        if pagination:
            current = pagination.find(class_=re.compile(r'current|active'))
            if current:
                # Try to find next page link
                next_page = current.find_next_sibling('a')
                if next_page:
                    return True
        return False


class SpecExtractor:
    """Extract detailed specifications from product techspec pages"""

    def __init__(self, http_client: HTTPClient, config: Config):
        self.http = http_client
        self.config = config
        self.logger = logging.getLogger(__name__)
        self.spec_mapping = config.get('spec_fields', {})

    async def extract_specs(self, product_url: str) -> List[ProductVariant]:
        """Extract all variants and their specs from techspec page"""
        techspec_url = product_url.rstrip('/') + '/techspec/'
        self.logger.info(f"Extracting specs from {techspec_url}")

        try:
            html = await self.http.get_text(techspec_url)
            return self._parse_techspec_page(html, product_url)
        except Exception as e:
            self.logger.warning(f"Failed to extract specs from {techspec_url}: {e}")
            return []

    def _parse_techspec_page(self, html: str, base_product_url: str) -> List[ProductVariant]:
        """Parse the techspec page HTML for variant specifications"""
        soup = BeautifulSoup(html, 'html.parser')
        variants = []

        # Find the main product table body (id="productTableBody")
        main_table = soup.find(id='productTableBody')
        if not main_table:
            self.logger.warning("No productTableBody found on techspec page")
            return variants

        # Extract variant names from the model row in the header table
        variant_names = self._extract_variant_names(soup)
        if not variant_names:
            self.logger.warning("No variant names found")
            return variants

        # Extract spec rows from main table
        spec_rows = main_table.find_all(class_=re.compile(r'TechSpec__rowTable__1LR9D'))

        # Build variant specs
        variant_specs = {name: {} for name in variant_names}

        for row in spec_rows:
            title_elem = row.find(class_=re.compile(r'TechSpec__rowTableTitle__3GLj4|rowTableTitle'))
            if not title_elem:
                continue

            spec_name = title_elem.get_text(strip=True)
            if not spec_name:
                continue

            # Skip non-spec rows like Model, Color (these are in the header)
            if spec_name in ['Model', 'Color']:
                continue

            # Get values for each variant
            value_containers = row.find_all(class_=re.compile(r'TechSpec__rowTableItems__KYWXp|rowTableItems'))

            for idx, container in enumerate(value_containers):
                if idx < len(variant_names):
                    variant_name = variant_names[idx]
                    value = container.get_text(strip=True)
                    if value:
                        # Clean up the value - normalize whitespace
                        value = re.sub(r'\s+', ' ', value)
                        # Map to normalized field name
                        normalized_name = self.spec_mapping.get(
                            spec_name,
                            spec_name.lower().replace(' ', '_').replace('(', '').replace(')', '').replace('/', '_')
                        )
                        variant_specs[variant_name][normalized_name] = value

        # Create ProductVariant objects
        for variant_name, specs in variant_specs.items():
            if specs:  # Only create if has specs
                variant_id = hashlib.md5(f"{base_product_url}{variant_name}".encode()).hexdigest()[:12]
                variants.append(ProductVariant(
                    variant_id=variant_id,
                    name=variant_name,
                    specs=specs
                ))

        return variants

    def _extract_variant_names(self, soup) -> List[str]:
        """Extract variant/model names from the techspec page header"""
        names = []

        # Look for the model row in the header tables
        header_tables = soup.find_all(class_=re.compile(r'TechSpec__productTable__1imwW'))
        for header_table in header_tables:
            model_row = header_table.find(class_=re.compile(r'TechSpec__rowTableModel|rowTableModel'))
            if model_row:
                model_items = model_row.find_all(class_=re.compile(r'TechSpec__itemName|itemName'))
                for item in model_items:
                    pd_name = item.find(class_=re.compile(r'pdName'))
                    if pd_name:
                        names.append(pd_name.get_text(strip=True))
                    else:
                        # Fallback: get text directly
                        text = item.get_text(strip=True)
                        if text and text != 'Model':
                            names.append(text)
                if names:
                    break

        return names


class ProductParser:
    """Parse product listing page for basic product info"""

    def __init__(self, config: Config):
        self.config = config
        self.logger = logging.getLogger(__name__)

    def parse_product_url(self, url: str) -> Dict[str, str]:
        """Parse category, subcategory, series from product URL"""
        # URL pattern: /in/laptops/for-home/vivobook/asus-vivobook-s16-s3607/
        parsed = urlparse(url)
        path_parts = [p for p in parsed.path.split('/') if p]

        result = {
            'category': '',
            'subcategory': '',
            'series': '',
            'product_slug': ''
        }

        if len(path_parts) >= 4:
            # /in/laptops/for-home/vivobook/asus-vivobook-s16-s3607/
            result['category'] = path_parts[1] if len(path_parts) > 1 else ''
            result['subcategory'] = path_parts[2] if len(path_parts) > 2 else ''
            result['series'] = path_parts[3] if len(path_parts) > 3 else ''
            result['product_slug'] = path_parts[4] if len(path_parts) > 4 else ''

        return result

    def extract_product_name(self, url: str) -> str:
        """Extract readable product name from URL slug"""
        parsed = urlparse(url)
        slug = parsed.path.strip('/').split('/')[-1]
        # Convert asus-vivobook-s16-s3607 to ASUS Vivobook S16 S3607
        name = slug.replace('asus-', '').replace('-', ' ').title()
        return f"ASUS {name}"


class DataExporter:
    """Export scraped data to various formats"""

    def __init__(self, config: Config):
        self.config = config
        self.output_dir = Path(config.get('output_dir', './output'))
        self.output_dir.mkdir(parents=True, exist_ok=True)
        self.logger = logging.getLogger(__name__)

    def export_json(self, products: List[Product], filename: str = None) -> Path:
        """Export products to JSON"""
        if filename is None:
            timestamp = datetime.now().strftime('%Y%m%d_%H%M%S')
            filename = f"asus_products_{timestamp}.json"

        filepath = self.output_dir / filename
        data = [p.to_dict() for p in products]

        with open(filepath, 'w', encoding='utf-8') as f:
            json.dump(data, f, indent=2, ensure_ascii=False)

        self.logger.info(f"Exported {len(products)} products to {filepath}")
        return filepath

    def export_csv(self, products: List[Product], filename: str = None) -> Path:
        """Export products to CSV (flattened variants)"""
        if filename is None:
            timestamp = datetime.now().strftime('%Y%m%d_%H%M%S')
            filename = f"asus_products_{timestamp}.csv"

        filepath = self.output_dir / filename

        # Flatten all variants
        rows = []
        for product in products:
            if not product.variants:
                # Product without variants
                base_specs = product.variants[0].specs if product.variants else {}
                rows.append({
                    'product_id': product.product_id,
                    'product_url': product.url,
                    'category': product.category,
                    'subcategory': product.subcategory,
                    'series': product.series,
                    'product_name': product.name,
                    'variant_id': '',
                    'variant_name': '',
                    **base_specs
                })
            else:
                for variant in product.variants:
                    row = {
                        'product_id': product.product_id,
                        'product_url': product.url,
                        'category': product.category,
                        'subcategory': product.subcategory,
                        'series': product.series,
                        'product_name': product.name,
                        'variant_id': variant.variant_id,
                        'variant_name': variant.name,
                        **variant.specs
                    }
                    rows.append(row)

        if rows:
            # Get all unique columns
            all_columns = set()
            for row in rows:
                all_columns.update(row.keys())

            # Sort columns logically
            priority_cols = ['product_id', 'product_url', 'category', 'subcategory', 'series',
                           'product_name', 'variant_id', 'variant_name',
                           'model', 'color', 'operating_system', 'processor', 'graphics',
                           'memory', 'storage', 'display', 'battery', 'weight', 'dimensions']
            other_cols = sorted(all_columns - set(priority_cols))
            columns = [c for c in priority_cols if c in all_columns] + other_cols

            with open(filepath, 'w', newline='', encoding='utf-8') as f:
                writer = csv.DictWriter(f, fieldnames=columns, extrasaction='ignore')
                writer.writeheader()
                writer.writerows(rows)

        self.logger.info(f"Exported {len(rows)} variant rows to {filepath}")
        return filepath

    def export_checkpoint(self, progress: ScrapingProgress, filename: str = "checkpoint.json") -> Path:
        """Save scraping progress checkpoint"""
        filepath = self.output_dir / filename
        with open(filepath, 'w') as f:
            json.dump(progress.to_dict(), f, indent=2)
        return filepath

    def load_checkpoint(self, filename: str = "checkpoint.json") -> Optional[ScrapingProgress]:
        """Load scraping progress checkpoint"""
        filepath = self.output_dir / filename
        if filepath.exists():
            with open(filepath, 'r') as f:
                data = json.load(f)
            return ScrapingProgress.from_dict(data)
        return None


class ASUSScraper:
    """Main scraper orchestrator"""

    def __init__(self, config_path: str):
        self.config = Config(config_path)
        self.logger = setup_logging(self.config.config)
        self.http_client: Optional[HTTPClient] = None
        self.category_discoverer: Optional[CategoryDiscoverer] = None
        self.product_lister: Optional[ProductLister] = None
        self.spec_extractor: Optional[SpecExtractor] = None
        self.product_parser = ProductParser(self.config)
        self.exporter = DataExporter(self.config)
        self.progress = ScrapingProgress()
        self.semaphore: Optional[asyncio.Semaphore] = None

    async def __aenter__(self):
        self.http_client = HTTPClient(self.config)
        await self.http_client.__aenter__()

        self.category_discoverer = CategoryDiscoverer(self.http_client, self.config)
        self.product_lister = ProductLister(self.http_client, self.config)
        self.spec_extractor = SpecExtractor(self.http_client, self.config)
        self.semaphore = asyncio.Semaphore(self.config.get('concurrency', 3))

        # Try to load checkpoint
        checkpoint = self.exporter.load_checkpoint()
        if checkpoint:
            self.progress = checkpoint
            self.logger.info(f"Resumed from checkpoint: {self.progress.scraped_count}/{self.progress.total_products} products scraped")

        return self

    async def __aexit__(self, exc_type, exc_val, exc_tb):
        if self.http_client:
            await self.http_client.__aexit__(exc_type, exc_val, exc_tb)

    async def run(self, categories: List[str] = None):
        """Run the complete scraping pipeline"""
        self.logger.info("Starting ASUS India product scraper")

        # Phase 1: Discover categories
        if categories is None:
            categories = await self.category_discoverer.discover_main_categories()
            # Also discover subcategories
            all_categories = set(categories)
            for cat in categories:
                subcats = await self.category_discoverer.discover_subcategories(cat)
                all_categories.update(subcats)
            categories = sorted(all_categories)
            self.logger.info(f"Total categories to scrape: {len(categories)}")

        self.progress.discovered_categories = categories

        # Phase 2: List all products
        all_product_urls = set(self.progress.discovered_product_urls)

        for category_url in categories:
            if category_url in self.progress.discovered_categories[:self.progress.scraped_count]:
                continue  # Already processed

            try:
                product_urls = await self.product_lister.get_product_urls(category_url)
                all_product_urls.update(product_urls)
                self.logger.info(f"Category {category_url}: {len(product_urls)} products")
            except Exception as e:
                self.logger.error(f"Failed to list products for {category_url}: {e}")
                self.progress.failed_urls.append({
                    'url': category_url,
                    'error': str(e),
                    'type': 'category_listing',
                    'timestamp': datetime.now().isoformat()
                })

            # Save checkpoint periodically
            self.progress.discovered_product_urls = list(all_product_urls)
            self.progress.total_products = len(all_product_urls)
            self.exporter.export_checkpoint(self.progress)

        self.logger.info(f"Total unique products discovered: {len(all_product_urls)}")

        # Phase 3: Scrape product details and specs
        product_urls_to_scrape = [u for u in all_product_urls if u not in self.progress.scraped_product_ids]
        self.logger.info(f"Products to scrape: {len(product_urls_to_scrape)}")

        products = []
        for i, product_url in enumerate(product_urls_to_scrape):
            try:
                product = await self._scrape_product(product_url)
                if product:
                    products.append(product)

                self.progress.scraped_product_ids.add(product_url)
                self.progress.scraped_count = len(self.progress.scraped_product_ids)

                # Save checkpoint
                if self.progress.scraped_count % self.config.get('checkpoint_interval', 50) == 0:
                    self.exporter.export_checkpoint(self.progress)
                    # Also export intermediate results
                    self.exporter.export_json(products)
                    self.exporter.export_csv(products)

                self.logger.info(f"Progress: {self.progress.scraped_count}/{self.progress.total_products} "
                               f"({self.progress.scraped_count/self.progress.total_products*100:.1f}%)")

            except Exception as e:
                self.logger.error(f"Failed to scrape {product_url}: {e}")
                self.progress.failed_urls.append({
                    'url': product_url,
                    'error': str(e),
                    'type': 'product_scrape',
                    'timestamp': datetime.now().isoformat()
                })

        # Final export
        self.logger.info(f"Scraping complete. Total products: {len(products)}")
        self.exporter.export_json(products)
        self.exporter.export_csv(products)
        self.exporter.export_checkpoint(self.progress)

        return products

    async def _scrape_product(self, product_url: str) -> Optional[Product]:
        """Scrape a single product with all its variants"""
        async with self.semaphore:
            # Parse URL for metadata
            url_info = self.product_parser.parse_product_url(product_url)
            product_name = self.product_parser.extract_product_name(product_url)

            # Generate product ID
            product_id = hashlib.md5(product_url.encode()).hexdigest()[:12]

            # Extract specs from techspec page
            variants = await self.spec_extractor.extract_specs(product_url)

            if not variants:
                self.logger.warning(f"No variants found for {product_url}")
                # Still create product entry
                variants = [ProductVariant(variant_id=product_id, name="Base", specs={})]

            product = Product(
                product_id=product_id,
                url=product_url,
                category=url_info['category'],
                subcategory=url_info['subcategory'],
                series=url_info['series'],
                name=product_name,
                variants=variants,
                source_url=product_url
            )

            return product


async def main():
    """Main entry point"""
    import argparse

    parser = argparse.ArgumentParser(description='ASUS India Product Scraper')
    parser.add_argument('--config', default='config.yaml', help='Config file path')
    parser.add_argument('--categories', nargs='+', help='Specific categories to scrape')
    parser.add_argument('--resume', action='store_true', help='Resume from checkpoint')
    parser.add_argument('--output-dir', help='Output directory')
    args = parser.parse_args()

    config_path = args.config
    if not Path(config_path).exists():
        # Use default config in script directory
        config_path = Path(__file__).parent / 'config.yaml'

    async with ASUSScraper(str(config_path)) as scraper:
        if args.output_dir:
            scraper.exporter.output_dir = Path(args.output_dir)
            scraper.exporter.output_dir.mkdir(parents=True, exist_ok=True)

        products = await scraper.run(categories=args.categories)
        print(f"\nScraping complete! {len(products)} products scraped.")
        print(f"Results saved to: {scraper.exporter.output_dir}")


if __name__ == '__main__':
    asyncio.run(main())