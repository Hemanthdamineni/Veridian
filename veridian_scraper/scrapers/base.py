"""
Veridian Scraper - Base Scraper Classes
Abstract base classes for manufacturer scrapers
"""

import asyncio
import logging
import time
import hashlib
import re
from abc import ABC, abstractmethod
from pathlib import Path
from dataclasses import dataclass, field
from typing import Optional, List, Dict, Any, Set, AsyncIterator
from urllib.parse import urljoin, urlparse, parse_qs
from datetime import datetime
import yaml

import httpx
from bs4 import BeautifulSoup
from tenacity import retry, stop_after_attempt, wait_exponential, retry_if_exception_type

from ..models import (
    Product, ProductVariant, ProductCategory, ProductStatus,
    SpecValue, SpecParser,
    generate_product_id, generate_variant_id,
    canonicalize_url, extract_canonical_key,
    ScrapingProgress
)


# =============================================================================
# CONFIGURATION
# =============================================================================

@dataclass
class RegionConfig:
    """Configuration for a specific region"""
    code: str
    name: str
    base_url: str
    language: str = "en"
    currency: str = "USD"
    category_paths: Dict[str, str] = field(default_factory=dict)
    selectors: Dict[str, str] = field(default_factory=dict)
    rate_limit: float = 1.0  # requests per second
    timeout: int = 30


@dataclass
class ScraperConfig:
    """Main scraper configuration"""
    manufacturer: str
    brand: str
    base_url: str
    regions: List[RegionConfig]
    user_agent: str = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
    output_dir: str = "./output"
    max_concurrent: int = 3
    retry_attempts: int = 3
    checkpoint_interval: int = 10


class ConfigManager:
    """Load and manage configuration from YAML"""

    def __init__(self, config_path: str):
        with open(config_path, 'r') as f:
            self.config = yaml.safe_load(f)
        self.logger = logging.getLogger(__name__)

    def get_manufacturer_config(self, manufacturer: str) -> Optional[Dict]:
        return self.config.get('manufacturers', {}).get(manufacturer)

    def get_region_configs(self, manufacturer: str) -> List[RegionConfig]:
        mfg_config = self.get_manufacturer_config(manufacturer)
        if not mfg_config:
            return []

        regions = []
        for r in mfg_config.get('regions', []):
            regions.append(RegionConfig(
                code=r['code'],
                name=r['name'],
                base_url=r['base_url'],
                language=r.get('language', 'en'),
                currency=r.get('currency', 'USD'),
                category_paths=r.get('category_paths', {}),
                selectors=r.get('selectors', {}),
                rate_limit=r.get('rate_limit', 1.0),
                timeout=r.get('timeout', 30)
            ))
        return regions


# =============================================================================
# HTTP CLIENT
# =============================================================================

class RateLimiter:
    """Simple rate limiter"""

    def __init__(self, rate: float):
        self.rate = rate
        self.last_request = 0

    async def wait(self):
        elapsed = time.time() - self.last_request
        min_interval = 1.0 / self.rate
        if elapsed < min_interval:
            await asyncio.sleep(min_interval - elapsed)
        self.last_request = time.time()


class HTTPClient:
    """Async HTTP client with rate limiting, retries, and session management"""

    def __init__(self, config: ScraperConfig, region: RegionConfig):
        self.config = config
        self.region = region
        self.client: Optional[httpx.AsyncClient] = None
        self.rate_limiter = RateLimiter(region.rate_limit)
        self.logger = logging.getLogger(f"{__name__}.{region.code}")
        self.request_count = 0
        self.error_count = 0

    async def __aenter__(self):
        timeout = httpx.Timeout(self.region.timeout)
        headers = {
            'User-Agent': self.config.user_agent,
            'Accept-Language': f"{self.region.language},{self.region.language[:2]};q=0.9",
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
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

    def _is_retryable_error(self, exc: Exception) -> bool:
        """Check if an exception should trigger a retry"""
        if isinstance(exc, (httpx.TimeoutException, httpx.NetworkError)):
            return True
        if isinstance(exc, httpx.HTTPStatusError):
            # Only retry 5xx server errors, not 4xx client errors
            return 500 <= exc.response.status_code < 600
        return False

    @retry(
        stop=stop_after_attempt(3),
        wait=wait_exponential(multiplier=1, min=2, max=10),
        retry=retry_if_exception_type((httpx.TimeoutException, httpx.NetworkError))
    )
    async def get(self, url: str, **kwargs) -> httpx.Response:
        """GET request with rate limiting and retry (5xx only)"""
        await self.rate_limiter.wait()
        self.request_count += 1

        try:
            response = await self.client.get(url, **kwargs)
            response.raise_for_status()
            return response
        except httpx.HTTPStatusError as e:
            self.error_count += 1
            if 500 <= e.response.status_code < 600:
                # Retryable server error
                self.logger.warning(f"HTTP {e.response.status_code} for {url} (retrying)")
                raise
            else:
                # Non-retryable client error (4xx)
                self.logger.warning(f"HTTP {e.response.status_code} for {url} (non-retryable)")
                # Re-raise but don't trigger tenacity retry
                raise
        except Exception as e:
            self.error_count += 1
            if self._is_retryable_error(e):
                self.logger.warning(f"Request failed for {url}: {e} (retrying)")
                raise
            else:
                self.logger.error(f"Request failed for {url}: {e} (non-retryable)")
                raise

    async def get_soup(self, url: str, **kwargs) -> BeautifulSoup:
        """GET and parse as BeautifulSoup"""
        response = await self.get(url, **kwargs)
        return BeautifulSoup(response.text, 'html.parser')


# =============================================================================
# BASE SCRAPER
# =============================================================================

class BaseScraper(ABC):
    """Abstract base class for manufacturer scrapers"""

    def __init__(self, config: ScraperConfig, region: RegionConfig):
        self.config = config
        self.region = region
        self.logger = logging.getLogger(f"{self.__class__.__name__}.{region.code}")
        self.products: List[Product] = []
        self.progress = ScrapingProgress(region=region.code, manufacturer=config.manufacturer)
        self.http_client: Optional[HTTPClient] = None
        self._seen_urls: Set[str] = set()
        self._canonical_keys: Dict[str, Product] = {}

    @abstractmethod
    async def discover_categories(self) -> List[Dict[str, str]]:
        """Discover product categories from the website"""
        pass

    @abstractmethod
    async def discover_products(self, category_url: str, category_info: Dict) -> AsyncIterator[str]:
        """Discover product URLs within a category"""
        pass

    @abstractmethod
    async def extract_product(self, url: str, category_info: Dict) -> Optional[Product]:
        """Extract full product data from product page"""
        pass

    @abstractmethod
    def get_category_from_url(self, url: str) -> ProductCategory:
        """Map URL to product category"""
        pass

    async def scrape(self, categories: Optional[List[str]] = None) -> List[Product]:
        """Main scraping entry point"""
        self.logger.info(f"Starting scrape for {self.config.manufacturer} - {self.region.code}")

        async with HTTPClient(self.config, self.region) as http_client:
            self.http_client = http_client

            # Discover categories
            all_categories = await self.discover_categories()
            self.logger.info(f"Found {len(all_categories)} categories")

            # Filter categories if specified
            if categories:
                all_categories = [c for c in all_categories if c.get('name') in categories or c.get('slug') in categories]

            # Scrape each category
            for cat_info in all_categories:
                cat_name = cat_info.get('name', cat_info.get('slug', 'unknown'))

                # Skip already completed categories
                if cat_name in self.progress.completed_categories:
                    self.logger.info(f"Skipping already completed category: {cat_name}")
                    continue

                self.logger.info(f"Scraping category: {cat_name}")

                try:
                    await self._scrape_category(cat_info)
                    self.progress.completed_categories.append(cat_name)
                except Exception as e:
                    self.logger.error(f"Failed to scrape category {cat_name}: {e}")
                    self.progress.error_count += 1

                # Save checkpoint
                self._save_checkpoint()

        self.logger.info(f"Scraping complete: {len(self.products)} products")
        return self.products

    async def _scrape_category(self, category_info: Dict):
        """Scrape all products in a category"""
        category_url = category_info['url']

        async for product_url in self.discover_products(category_url, category_info):
            if product_url in self._seen_urls:
                continue

            self._seen_urls.add(product_url)

            try:
                product = await self.extract_product(product_url, category_info)
                if product:
                    self._add_product(product)
                    self.progress.scraped_products += 1

                    if self.progress.scraped_products % self.config.checkpoint_interval == 0:
                        self._save_checkpoint()

            except Exception as e:
                self.logger.error(f"Failed to extract product {product_url}: {e}")
                self.progress.failed_urls.append(product_url)
                self.progress.error_count += 1

    def _add_product(self, product: Product):
        """Add product with deduplication by canonical key"""
        key = product.canonical_key

        if key in self._canonical_keys:
            # Merge with existing
            existing = self._canonical_keys[key]
            self._merge_products(existing, product)
        else:
            self._canonical_keys[key] = product
            self.products.append(product)

    def _merge_products(self, existing: Product, new: Product):
        """Merge two products (same canonical key)"""
        # Add new source URL
        existing.add_source_url(new.url)
        for v in new.variants:
            existing.add_source_url(v.source_url)

        # Add new variants
        existing_variant_names = {v.name for v in existing.variants}
        for variant in new.variants:
            if variant.name not in existing_variant_names:
                existing.variants.append(variant)

        # Update metadata
        existing.metadata.update(new.metadata)

    def _save_checkpoint(self):
        """Save scraping progress checkpoint"""
        checkpoint_dir = Path(self.config.output_dir) / self.region.code
        checkpoint_dir.mkdir(parents=True, exist_ok=True)

        checkpoint_file = checkpoint_dir / f"checkpoint_{self.config.manufacturer}.json"
        self.progress.last_updated = datetime.now().isoformat()
        self.progress.total_products = len(self.products)

        import json
        with open(checkpoint_file, 'w') as f:
            json.dump({
                'region': self.progress.region,
                'manufacturer': self.progress.manufacturer,
                'completed_categories': self.progress.completed_categories,
                'completed_products': self.progress.completed_products,
                'failed_urls': self.progress.failed_urls,
                'total_products': self.progress.total_products,
                'scraped_products': self.progress.scraped_products,
                'last_updated': self.progress.last_updated,
                'error_count': self.progress.error_count
            }, f, indent=2)

    def load_checkpoint(self) -> bool:
        """Load checkpoint if exists"""
        checkpoint_file = Path(self.config.output_dir) / self.region.code / f"checkpoint_{self.config.manufacturer}.json"

        if not checkpoint_file.exists():
            return False

        import json
        with open(checkpoint_file, 'r') as f:
            data = json.load(f)

        self.progress.completed_categories = data.get('completed_categories', [])
        self.progress.completed_products = data.get('completed_products', [])
        self.progress.failed_urls = data.get('failed_urls', [])
        self.progress.scraped_products = data.get('scraped_products', 0)
        self.progress.error_count = data.get('error_count', 0)

        self.logger.info(f"Loaded checkpoint: {self.progress.scraped_products} products scraped")
        return True


# =============================================================================
# UTILITY FUNCTIONS
# =============================================================================

def clean_text(text: str) -> str:
    """Clean extracted text"""
    if not text:
        return ""
    import re
    text = re.sub(r'\s+', ' ', text)
    return text.strip()


def extract_price(text: str) -> Optional[float]:
    """Extract price from text"""
    import re
    # Match various price formats
    patterns = [
        r'[\$\€\£\¥]\s*([\d,]+\.?\d*)',
        r'([\d,]+\.?\d*)\s*[\$\€\£\¥]',
        r'Price[:\s]*[\$\€\£\¥]?\s*([\d,]+\.?\d*)',
    ]
    for pattern in patterns:
        match = re.search(pattern, text)
        if match:
            try:
                return float(match.group(1).replace(',', ''))
            except ValueError:
                continue
    return None


def parse_memory(text: str) -> Dict[str, Any]:
    """Parse memory specification"""
    import re
    result = {}
    # Capacity
    cap = re.search(r'(\d+)\s*GB', text, re.IGNORECASE)
    if cap:
        result['capacity_gb'] = int(cap.group(1))
    # Type
    type_match = re.search(r'(LPDDR\d+X?|DDR\d+|LPDDR\d+)', text, re.IGNORECASE)
    if type_match:
        result['type'] = type_match.group(1).upper()
    # Speed
    speed = re.search(r'(\d+)\s*MT/s|(\d+)\s*MHz', text, re.IGNORECASE)
    if speed:
        result['speed_mts'] = int(speed.group(1) or speed.group(2))
    # Form factor
    if 'on board' in text.lower() or 'soldered' in text.lower():
        result['form_factor'] = 'soldered'
    elif 'so-dimm' in text.lower() or 'sodimm' in text.lower():
        result['form_factor'] = 'sodimm'
    # Channels
    if 'dual' in text.lower() and 'channel' in text.lower():
        result['channels'] = 2
    return result


def parse_storage(text: str) -> Dict[str, Any]:
    """Parse storage specification"""
    import re
    result = {}
    # Capacity
    cap = re.search(r'(\d+)\s*(TB|GB)', text, re.IGNORECASE)
    if cap:
        size = int(cap.group(1))
        unit = cap.group(2).upper()
        result['capacity'] = f"{size}{unit}"
        result['capacity_gb'] = size * 1024 if unit == 'TB' else size
    # Interface
    if 'nvme' in text.lower():
        result['interface'] = 'NVMe'
    elif 'sata' in text.lower():
        result['interface'] = 'SATA'
    # PCIe version
    pcie = re.search(r'PCIe\s*(\d+\.?\d*)', text, re.IGNORECASE)
    if pcie:
        result['pcie_version'] = pcie.group(1)
    # Form factor
    if 'm.2' in text.lower() or 'm2' in text.lower():
        result['form_factor'] = 'M.2'
    elif '2.5' in text:
        result['form_factor'] = '2.5"'
    return result


def parse_display(text: str) -> Dict[str, Any]:
    """Parse display specification"""
    import re
    result = {}
    # Size
    size = re.search(r'(\d+\.?\d*)\s*[""inch]', text, re.IGNORECASE)
    if size:
        inches = float(size.group(1))
        if 8 <= inches <= 35:  # Sanity check
            result['size_inches'] = inches
    # Resolution
    res = re.search(r'(\d+)\s*x\s*(\d+)', text)
    if res:
        result['width_px'] = int(res.group(1))
        result['height_px'] = int(res.group(2))
        result['resolution'] = f"{res.group(1)}x{res.group(2)}"
    # Panel type
    for panel in ['OLED', 'IPS', 'TN', 'VA', 'Mini LED', 'Micro LED']:
        if panel.lower() in text.lower():
            result['panel_type'] = panel
            break
    # Aspect ratio
    ar = re.search(r'(\d+:\d+)', text)
    if ar:
        result['aspect_ratio'] = ar.group(1)
    # Refresh rate
    hz = re.search(r'(\d+)\s*Hz', text, re.IGNORECASE)
    if hz:
        result['refresh_rate_hz'] = int(hz.group(1))
    # Response time
    rt = re.search(r'(\d+\.?\d*)\s*ms', text, re.IGNORECASE)
    if rt:
        result['response_time_ms'] = float(rt.group(1))
    return result


def parse_processor(text: str) -> Dict[str, Any]:
    """Parse processor specification"""
    import re
    result = {}
    # Brand
    for brand in ['Intel', 'AMD', 'Apple', 'Qualcomm', 'Snapdragon', 'MediaTek']:
        if brand.lower() in text.lower():
            result['brand'] = brand
            break
    # Model
    model_patterns = [
        r'(Core\s+Ultra\s+\d+\s+\d+[A-Z]?)',
        r'(Ryzen\s+\w+\s+\d+[A-Z]?)',
        r'(M\d+\s+\w+)',
        r'(Snapdragon\s+\w+\s+\d+\s+\d+)',
    ]
    for pattern in model_patterns:
        match = re.search(pattern, text, re.IGNORECASE)
        if match:
            result['model'] = match.group(1).strip()
            break
    # Cores/threads
    cores = re.search(r'(\d+)\s*cores?', text, re.IGNORECASE)
    if cores:
        result['cores'] = int(cores.group(1))
    threads = re.search(r'(\d+)\s*threads?', text, re.IGNORECASE)
    if threads:
        result['threads'] = int(threads.group(1))
    # Frequencies
    base = re.search(r'(\d+\.?\d*)\s*GHz', text)
    if base:
        result['base_frequency_ghz'] = float(base.group(1))
    boost = re.search(r'up to\s+(\d+\.?\d*)\s*GHz', text, re.IGNORECASE)
    if boost:
        result['boost_frequency_ghz'] = float(boost.group(1))
    # Cache
    cache = re.search(r'(\d+)\s*MB\s*Cache', text, re.IGNORECASE)
    if cache:
        result['cache_mb'] = int(cache.group(1))
    # NPU
    npu = re.search(r'(?:NPU|AI Boost).*?(\d+\.?\d*)\s*TOPS', text, re.IGNORECASE)
    if npu:
        result['npu_tops'] = float(npu.group(1))
    return result


def parse_battery(text: str) -> Dict[str, Any]:
    """Parse battery specification"""
    import re
    result = {}
    wh = re.search(r'(\d+)\s*Wh', text, re.IGNORECASE)
    if wh:
        result['capacity_wh'] = int(wh.group(1))
    cells = re.search(r'(\d+)\s*cell', text, re.IGNORECASE)
    if cells:
        result['cells'] = int(cells.group(1))
    return result


def parse_weight(text: str) -> Dict[str, Any]:
    """Parse weight specification"""
    import re
    result = {}
    kg = re.search(r'(\d+\.?\d*)\s*kg', text, re.IGNORECASE)
    if kg:
        result['weight_kg'] = float(kg.group(1))
    lbs = re.search(r'(\d+\.?\d*)\s*lbs?', text, re.IGNORECASE)
    if lbs:
        result['weight_lbs'] = float(lbs.group(1))
    return result


def parse_dimensions(text: str) -> Dict[str, Any]:
    """Parse dimensions specification"""
    import re
    result = {}
    mm = re.search(r'(\d+\.?\d*)\s*x\s*(\d+\.?\d*)\s*x\s*(\d+\.?\d*)\s*mm', text, re.IGNORECASE)
    if mm:
        result['width_mm'] = float(mm.group(1))
        result['depth_mm'] = float(mm.group(2))
        result['height_mm'] = float(mm.group(3))
    inch = re.search(r'(\d+\.?\d*)\s*x\s*(\d+\.?\d*)\s*x\s*(\d+\.?\d*)\s*in', text, re.IGNORECASE)
    if inch:
        result['width_in'] = float(inch.group(1))
        result['depth_in'] = float(inch.group(2))
        result['height_in'] = float(inch.group(3))
    return result


# Field parser mapping
FIELD_PARSERS = {
    'processor': parse_processor,
    'cpu': parse_processor,
    'memory': parse_memory,
    'ram': parse_memory,
    'storage': parse_storage,
    'ssd': parse_storage,
    'hard drive': parse_storage,
    'display': parse_display,
    'screen': parse_display,
    'battery': parse_battery,
    'weight': parse_weight,
    'dimensions': parse_dimensions,
    'size': parse_dimensions,
}


def parse_spec_field(field_name: str, raw_value: str) -> SpecValue:
    """Parse a spec field using appropriate parser with standardized field names"""
    return SpecParser.parse_spec(field_name, raw_value)