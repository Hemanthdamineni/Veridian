"""
Veridian Scraper - Base Scraper Classes
Abstract base classes for manufacturer scrapers

This module owns three cross-cutting concerns that every manufacturer scraper
depends on:

* **Configuration** - the YAML files in ``veridian_scraper/config`` are the
  source of truth for base URLs, regions and their category paths.
* **robots.txt compliance** - ADR-003 requires a robots.txt check before the
  first request and a refusal when the source policy does not permit the
  fetch. The HTTP client therefore consults the policy before every request
  and raises instead of trying to work around a block.
* **Health reporting** - every run is measured (pages, products, SKUs,
  failures) so an empty run can never be mistaken for a successful one.
"""

import asyncio
import logging
import time
import hashlib
import re
from abc import ABC, abstractmethod
from functools import lru_cache
from pathlib import Path
from dataclasses import dataclass, field
from typing import Optional, List, Dict, Any, Set, AsyncIterator, Callable, Tuple
from urllib.parse import urljoin, urlparse, parse_qs, unquote
from urllib.robotparser import RobotFileParser
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
from ..health import (
    ScraperHealth, SkuLedger, RunReport,
    SOURCE_FAILURE, PARSER_FAILURE,
    get_collector,
)


# =============================================================================
# CONFIGURATION
# =============================================================================

# Veridian identifies itself honestly to every site it talks to. ADR-003 and
# the data source register both require an identifiable agent with contact
# details, so the robots policy is always evaluated for this agent and no
# request is ever sent with a spoofed identity.
ROBOTS_USER_AGENT = "VeridianBot/1.0 (+https://veridian.dev; contact@veridian.dev)"

# Directory holding the per-manufacturer YAML configuration files.
CONFIG_DIR = Path(__file__).resolve().parent.parent / 'config'


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
    user_agent: str = ROBOTS_USER_AGENT
    robots_user_agent: str = ROBOTS_USER_AGENT
    output_dir: str = "./output"
    max_concurrent: int = 3
    retry_attempts: int = 3
    checkpoint_interval: int = 10


class ConfigManager:
    """Load and manage configuration from YAML.

    Veridian keeps one YAML file per manufacturer in ``veridian_scraper/config``.
    Three document shapes are accepted, because both the historical
    multi-vendor file and the per-manufacturer files exist in the repository:

    ``manufacturers: {asus: {...}}``
        A mapping of manufacturer name to its configuration block.
    ``manufacturer: asus``
        The file describes exactly one manufacturer; ``brand``, ``base_url``
        and ``regions`` sit next to the key.
    ``manufacturer: {asus: {...}}``
        The legacy nested form used by the first generation of config files.

    Passing a directory loads and merges every ``*.yaml`` file it contains,
    which is how the shared manager is built.
    """

    def __init__(self, config_path: str):
        self.logger = logging.getLogger(__name__)
        self.config_path = Path(config_path)
        self.config: Dict[str, Any] = {}
        self.manufacturers: Dict[str, Dict[str, Any]] = {}

        if self.config_path.is_dir():
            paths = sorted(self.config_path.glob('*.yaml')) + sorted(self.config_path.glob('*.yml'))
            for path in paths:
                document = self._read_yaml(path)
                self.config.setdefault('manufacturers', {}).update(self._normalize(document))
                self.manufacturers.update(self._normalize(document))
        else:
            self.config = self._read_yaml(self.config_path)
            self.manufacturers = self._normalize(self.config)

    @staticmethod
    def _read_yaml(path: Path) -> Dict[str, Any]:
        with open(path, 'r', encoding='utf-8') as handle:
            return yaml.safe_load(handle) or {}

    @staticmethod
    def _normalize(document: Dict[str, Any]) -> Dict[str, Dict[str, Any]]:
        """Flatten the accepted document shapes into {manufacturer: config}."""
        manufacturers: Dict[str, Dict[str, Any]] = {}
        if not isinstance(document, dict):
            return manufacturers

        nested = document.get('manufacturers')
        if isinstance(nested, dict):
            for name, block in nested.items():
                manufacturers[str(name).lower()] = dict(block or {})

        single = document.get('manufacturer')
        if isinstance(single, str):
            block = {k: v for k, v in document.items() if k != 'manufacturer'}
            manufacturers[single.lower()] = block
        elif isinstance(single, dict):
            for name, block in single.items():
                manufacturers[str(name).lower()] = dict(block or {})

        return manufacturers

    def get_manufacturer_config(self, manufacturer: str) -> Optional[Dict[str, Any]]:
        """Return the raw configuration block for a manufacturer (if any)."""
        return self.manufacturers.get(manufacturer.lower())

    def get_region_configs(self, manufacturer: str) -> List[RegionConfig]:
        """Build the region list for a manufacturer from the YAML."""
        mfg_config = self.get_manufacturer_config(manufacturer)
        if not mfg_config:
            return []

        regions = []
        for r in mfg_config.get('regions') or []:
            regions.append(RegionConfig(
                # Region codes are lower-cased so that a config file written as
                # "US" still matches the "--regions us" CLI flag.
                code=str(r.get('code', '')).strip().lower(),
                name=r.get('name', ''),
                base_url=r.get('base_url', ''),
                language=r.get('language', 'en'),
                currency=r.get('currency', 'USD'),
                category_paths=r.get('category_paths') or {},
                selectors=r.get('selectors') or {},
                rate_limit=float(r.get('rate_limit', 1.0)),
                timeout=int(r.get('timeout', 30)),
            ))
        return regions

    def get_scraper_config(self, manufacturer: str) -> Optional[ScraperConfig]:
        """Build a complete ScraperConfig from YAML, or None when unknown."""
        mfg_config = self.get_manufacturer_config(manufacturer)
        if not mfg_config:
            return None

        regions = self.get_region_configs(manufacturer)
        if not regions:
            return None

        return ScraperConfig(
            manufacturer=manufacturer.lower(),
            brand=mfg_config.get('brand', manufacturer.title()),
            base_url=mfg_config.get('base_url', ''),
            regions=regions,
            user_agent=mfg_config.get('user_agent', ROBOTS_USER_AGENT),
            robots_user_agent=mfg_config.get('robots_user_agent', ROBOTS_USER_AGENT),
            output_dir=mfg_config.get('output_dir', './output'),
            max_concurrent=int(mfg_config.get('max_concurrent', 3)),
            retry_attempts=int(mfg_config.get('retry_attempts', 3)),
            checkpoint_interval=int(mfg_config.get('checkpoint_interval', 10)),
        )


_CONFIG_MANAGER: Optional[ConfigManager] = None


def get_config_manager(config_dir: Optional[str] = None) -> ConfigManager:
    """Return the shared ConfigManager (loaded from veridian_scraper/config)."""
    global _CONFIG_MANAGER
    if _CONFIG_MANAGER is None or config_dir is not None:
        _CONFIG_MANAGER = ConfigManager(config_dir or str(CONFIG_DIR))
    return _CONFIG_MANAGER


def apply_yaml_config(config: ScraperConfig, manager: Optional[ConfigManager] = None) -> ScraperConfig:
    """Overlay the YAML configuration onto a scraper config.

    The YAML files are authoritative for the fields they can supply (the base
    URL and the region list with its category paths, rate limit and timeout);
    every other setting keeps the value that is built in code unless the YAML
    states it explicitly.
    """
    manager = manager or get_config_manager()
    mfg_config = manager.get_manufacturer_config(config.manufacturer)
    if not mfg_config:
        return config

    for field in ('brand', 'base_url', 'user_agent', 'robots_user_agent', 'output_dir'):
        value = mfg_config.get(field)
        if value:
            setattr(config, field, value)

    for field in ('max_concurrent', 'retry_attempts', 'checkpoint_interval'):
        value = mfg_config.get(field)
        if value is not None:
            setattr(config, field, int(value))

    regions = manager.get_region_configs(config.manufacturer)
    if regions:
        config.regions = regions

    return config


# =============================================================================
# ROBOTS.TXT POLICY
# =============================================================================

class RobotsPolicyError(RuntimeError):
    """Base class for robots.txt policy failures."""


class RobotsDisallowedError(RobotsPolicyError):
    """The site's robots.txt does not permit this path for the Veridian agent."""


class RobotsUnavailableError(RobotsPolicyError):
    """The site's robots.txt could not be read, so the policy is unknown."""


def _origin_of(url: str) -> str:
    """Return the scheme://host part of a URL (the robots.txt scope)."""
    parsed = urlparse(url)
    return f"{parsed.scheme}://{parsed.netloc}"


@lru_cache(maxsize=1024)
def _compile_robots_pattern(pattern: str) -> re.Pattern:
    """Compile a robots.txt path pattern into a regular expression.

    RFC 9309 allows ``*`` inside a path and a trailing ``$`` to anchor the
    match at the end of the path. ``urllib.robotparser`` grew support for
    those only in Python 3.13, so the pattern is compiled here to keep the
    behaviour identical on every supported Python version.
    """
    end_anchored = pattern.endswith('$')
    if end_anchored:
        pattern = pattern[:-1]
    regex = '.*'.join(re.escape(part) for part in pattern.split('*'))
    return re.compile('^' + regex + ('$' if end_anchored else ''))


class RobotsPolicy:
    """Fetches, caches and evaluates ``robots.txt`` per origin.

    ADR-003 requires a robots.txt check before the first request and a refusal
    when a source's robots policy does not permit the fetch, so the policy is
    consulted before *every* request and a refusal raises instead of trying to
    work around the block. There is no CAPTCHA solving, no login and no
    identity spoofing: if the policy does not allow the fetch, Veridian stops.

    The policy is always evaluated for the honest ``VeridianBot`` agent,
    because the rules a site publishes for crawlers are the rules Veridian has
    to obey.

    The file is parsed with :class:`urllib.robotparser.RobotFileParser`, but the
    decision is taken by the RFC 9309 evaluation implemented below: the
    stdlib's own ``can_fetch`` behaves differently on Python 3.12 and 3.14
    (longest match, path wildcards and the meaning of an empty ``Disallow:``
    all changed), and a compliance check must not depend on the interpreter
    version.
    """

    def __init__(
        self,
        user_agent: str = ROBOTS_USER_AGENT,
        timeout: float = 15.0,
        fetcher: Optional[Callable[[str], Any]] = None,
    ):
        self.user_agent = user_agent
        self.timeout = timeout
        self._fetcher = fetcher
        self._parsers: Dict[str, Optional[RobotFileParser]] = {}
        self._errors: Dict[str, RobotsPolicyError] = {}
        self._delays: Dict[str, Optional[float]] = {}
        self._client: Optional[httpx.AsyncClient] = None
        self.logger = logging.getLogger(f"{__name__}.{user_agent.split('/')[0]}")

    async def _client_or_new(self) -> httpx.AsyncClient:
        if self._client is None:
            self._client = httpx.AsyncClient(
                timeout=self.timeout,
                headers={'User-Agent': self.user_agent},
                follow_redirects=True,
            )
        return self._client

    async def close(self) -> None:
        """Release the underlying HTTP client."""
        if self._client is not None:
            await self._client.aclose()
            self._client = None

    async def _fetch(self, url: str) -> Tuple[int, str]:
        """Fetch a robots.txt file, returning (status_code, body)."""
        if self._fetcher is not None:
            status, text = await self._fetcher(url)
            return int(status), text or ""
        client = await self._client_or_new()
        response = await client.get(url)
        return response.status_code, response.text

    async def _parser_for(self, origin: str) -> Optional[RobotFileParser]:
        """Return the parser for an origin.

        ``None`` means "no robots.txt published", which RFC 9309 section
        2.3.1.3 defines as "everything is allowed". A robots.txt that cannot be
        read (403, 429, 5xx, network error) raises
        :class:`RobotsUnavailableError`: an unknown policy is not permission.
        The failure is remembered, so a later request for the same origin is
        refused as well instead of silently falling back to "allowed".
        """
        if origin in self._errors:
            raise self._errors[origin]
        if origin in self._parsers:
            return self._parsers[origin]

        robots_url = f"{origin}/robots.txt"
        try:
            status, text = await self._fetch(robots_url)
        except RobotsPolicyError as exc:
            self._errors[origin] = exc
            raise
        except Exception as exc:
            error = RobotsUnavailableError(
                f"robots.txt for {origin} could not be retrieved: {exc}"
            )
            self._errors[origin] = error
            self._delays[origin] = None
            raise error from exc

        if status in (404, 410):
            self._parsers[origin] = None
            self._delays[origin] = None
            return None

        if 200 <= status < 300:
            parser = RobotFileParser()
            parser.parse(text.splitlines())
            self._parsers[origin] = parser
            self._delays[origin] = self._crawl_delay_of(parser)
            return parser

        error = RobotsUnavailableError(
            f"robots.txt for {origin} returned HTTP {status}; refusing to fetch"
        )
        self._errors[origin] = error
        self._delays[origin] = None
        raise error

    @staticmethod
    def _iter_groups(parser: RobotFileParser) -> List[Any]:
        """All groups of a parsed robots.txt, on every supported Python version.

        Python 3.12 keeps the ``*`` group in ``default_entry`` while 3.14 keeps
        it in ``entries``, so both places are inspected.
        """
        groups: List[Any] = []
        seen = set()
        for entry in getattr(parser, 'entries', None) or []:
            if id(entry) in seen:
                continue
            seen.add(id(entry))
            groups.append(entry)
        default_entry = getattr(parser, 'default_entry', None)
        if default_entry is not None and id(default_entry) not in seen:
            groups.append(default_entry)
        return groups

    def _matching_groups(self, parser: RobotFileParser) -> List[Any]:
        """The group(s) that apply to the Veridian agent (RFC 9309 2.2.2).

        The most specific matching user-agent token wins; the ``*`` group is
        only used when no named group matches.
        """
        token = self.user_agent.split('/')[0].strip().lower()
        best = -1
        selected: List[Any] = []
        for group in self._iter_groups(parser):
            specificity = -1
            for agent in getattr(group, 'useragents', None) or []:
                agent = agent.strip().lower()
                if not agent:
                    continue
                if agent == '*':
                    candidate = 0
                elif token.startswith(agent):
                    candidate = len(agent)
                else:
                    continue
                specificity = max(specificity, candidate)
            if specificity < 0:
                continue
            if specificity > best:
                best = specificity
                selected = [group]
            elif specificity == best and not any(g is group for g in selected):
                selected.append(group)
        return selected

    @staticmethod
    def _rules(group: Any) -> List[Tuple[str, bool]]:
        """(pattern, allow) pairs of a group, decoded for matching."""
        rules: List[Tuple[str, bool]] = []
        for rule in getattr(group, 'rulelines', None) or []:
            pattern = unquote(getattr(rule, 'path', '') or '')
            rules.append((pattern, bool(getattr(rule, 'allowance', False))))
        return rules

    def _allows(self, parser: RobotFileParser, url: str) -> bool:
        """Is the URL allowed by the policy (RFC 9309 2.2)?"""
        groups = self._matching_groups(parser)
        if not groups:
            # No group applies to this agent: access is granted.
            return True

        parsed = urlparse(url)
        path = parsed.path or '/'
        query = parsed.query

        best_length = -1
        allowed = True
        for group in groups:
            for pattern, allow in self._rules(group):
                if not pattern:
                    # An empty "Disallow:" means "no restriction".
                    continue
                # RFC 9309 matches the path and the query, unless the pattern
                # is anchored at the end with "$".
                target = path
                if query and not pattern.endswith('$'):
                    target = f"{path}?{query}"
                if not _compile_robots_pattern(pattern).match(target):
                    continue
                length = len(pattern)
                if length > best_length:
                    best_length = length
                    allowed = allow
                elif length == best_length and allow:
                    # "Allow" wins a tie against "Disallow".
                    allowed = True
        return allowed

    def _crawl_delay_of(self, parser: RobotFileParser) -> Optional[float]:
        """Crawl delay declared for the Veridian agent, if any."""
        for group in self._matching_groups(parser):
            delay = getattr(group, 'delay', None)
            if delay:
                return float(delay)
        return None

    async def is_allowed(self, url: str) -> bool:
        """Is this URL permitted for the Veridian agent?"""
        origin = _origin_of(url)
        parser = await self._parser_for(origin)
        if parser is None:
            return True
        return self._allows(parser, url)

    async def crawl_delay(self, url: str) -> Optional[float]:
        """Crawl delay (seconds) declared for this origin, if any."""
        origin = _origin_of(url)
        await self._parser_for(origin)
        return self._delays.get(origin)

    async def check(self, url: str) -> None:
        """Raise unless the URL may be fetched.

        Raises:
            RobotsDisallowedError: the policy forbids this path.
            RobotsUnavailableError: the policy could not be determined.
        """
        if not await self.is_allowed(url):
            raise RobotsDisallowedError(
                f"robots.txt does not permit {self.user_agent} to fetch {url}"
            )


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
    """Async HTTP client with rate limiting, robots.txt compliance, retries and session management"""

    def __init__(
        self,
        config: ScraperConfig,
        region: RegionConfig,
        health: Optional[ScraperHealth] = None,
        robots: Optional[RobotsPolicy] = None,
    ):
        self.config = config
        self.region = region
        self.health = health
        self.client: Optional[httpx.AsyncClient] = None
        self.rate_limiter = RateLimiter(region.rate_limit)
        self.robots = robots or RobotsPolicy(user_agent=config.robots_user_agent)
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
        await self.robots.close()

    def _is_retryable_error(self, exc: Exception) -> bool:
        """Check if an exception should trigger a retry"""
        if isinstance(exc, (httpx.TimeoutException, httpx.NetworkError)):
            return True
        if isinstance(exc, httpx.HTTPStatusError):
            # Only retry 5xx server errors, not 4xx client errors
            return 500 <= exc.response.status_code < 600
        return False

    async def _respect_robots(self, url: str) -> None:
        """Refuse the request when the source's robots policy forbids it.

        The check happens before anything is fetched. A declared crawl delay
        always wins over Veridian's own rate limit.
        """
        await self.robots.check(url)
        delay = await self.robots.crawl_delay(url)
        if delay:
            elapsed = time.time() - self.rate_limiter.last_request
            if elapsed < delay:
                await asyncio.sleep(delay - elapsed)

    async def get(self, url: str, **kwargs) -> httpx.Response:
        """GET request with robots.txt compliance, rate limiting and retry.

        A page that cannot be fetched is reported to the health tracker, so an
        empty run can never be mistaken for a successful one.
        """
        try:
            await self._respect_robots(url)
        except RobotsPolicyError as exc:
            # The source policy forbids this fetch. Record it as a blocked run
            # and refuse - the fetch is not attempted at all.
            if self.health is not None:
                self.health.record_page_attempt()
                self.health.record_page_failure(url, exc, kind=SOURCE_FAILURE)
                self.health.record_blocked(str(exc))
            raise

        if self.health is not None:
            self.health.record_page_attempt()

        started = time.perf_counter()
        try:
            response = await self._get_with_retry(url, **kwargs)
        except Exception as exc:
            if self.health is not None:
                self.health.record_page_failure(url, exc, kind=SOURCE_FAILURE)
            raise

        if self.health is not None:
            self.health.record_page_success((time.perf_counter() - started) * 1000)
        return response

    @retry(
        stop=stop_after_attempt(3),
        wait=wait_exponential(multiplier=1, min=2, max=10),
        retry=retry_if_exception_type((httpx.TimeoutException, httpx.NetworkError))
    )
    async def _get_with_retry(self, url: str, **kwargs) -> httpx.Response:
        """GET request with retry (5xx only)"""
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
        self.health: Optional[ScraperHealth] = None
        self.report: Optional[RunReport] = None
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

    def _sku_ledger(self) -> Optional[SkuLedger]:
        """Ledger of SKUs seen in previous runs (used to tell new from updated)."""
        path = Path(self.config.output_dir) / 'health' / f"{self.config.manufacturer}.skus.json"
        try:
            return SkuLedger(path)
        except OSError as exc:  # pragma: no cover - defensive
            self.logger.warning("Could not open SKU ledger %s: %s", path, exc)
            return None

    async def scrape(self, categories: Optional[List[str]] = None) -> List[Product]:
        """Main scraping entry point.

        The run is measured from start to finish and always produces a health
        report, so "the process exited 0" can never be mistaken for "the run
        collected data".
        """
        self.logger.info(f"Starting scrape for {self.config.manufacturer} - {self.region.code}")

        health = ScraperHealth(self.config.manufacturer, self.region.code, ledger=self._sku_ledger())
        self.health = health

        try:
            async with HTTPClient(self.config, self.region, health=health) as http_client:
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
                    except RobotsPolicyError as e:
                        # The source policy forbids this fetch: stop, do not work
                        # around it, and record the run as blocked.
                        health.record_blocked(str(e))
                        self.logger.error(f"Refusing to continue with {cat_name}: {e}")
                        break
                    except Exception as e:
                        self.logger.error(f"Failed to scrape category {cat_name}: {e}")
                        self.progress.error_count += 1

                    # Save checkpoint
                    self._save_checkpoint()
        except RobotsPolicyError as e:
            health.record_blocked(str(e))
            self.logger.error(f"Refusing to scrape {self.config.manufacturer}: {e}")
        finally:
            self.report = health.build_report()
            collector = get_collector()
            collector.register(self.report)
            self._write_health_report(collector)
            if health.ledger is not None:
                health.ledger.save()

        self.logger.info(
            f"Scraping complete: {len(self.products)} products "
            f"({self.report.status}, {self.report.pages_succeeded} pages parsed)"
        )
        return self.products

    def _write_health_report(self, collector) -> None:
        """Write the merged per-manufacturer health report to disk."""
        report = collector.get(self.config.manufacturer)
        if report is None:
            return
        import json
        path = Path(self.config.output_dir) / 'health' / f"{self.config.manufacturer}.json"
        try:
            path.parent.mkdir(parents=True, exist_ok=True)
            with open(path, 'w', encoding='utf-8') as handle:
                json.dump(report.to_dict(), handle, indent=2)
        except OSError as exc:  # pragma: no cover - defensive
            self.logger.warning("Could not write health report %s: %s", path, exc)

    async def _scrape_category(self, category_info: Dict):
        """Scrape all products in a category"""
        category_url = category_info['url']

        async for product_url in self.discover_products(category_url, category_info):
            if product_url in self._seen_urls:
                if self.health is not None:
                    self.health.record_duplicate()
                continue

            self._seen_urls.add(product_url)
            if self.health is not None:
                self.health.record_pages_discovered()

            try:
                product = await self.extract_product(product_url, category_info)
                if product:
                    is_duplicate = self._add_product(product)
                    self.progress.scraped_products += 1

                    if self.health is not None:
                        if is_duplicate:
                            self.health.record_duplicate()
                        self.health.record_product(product)

                    if self.progress.scraped_products % self.config.checkpoint_interval == 0:
                        self._save_checkpoint()

            except RobotsPolicyError:
                # Policy refusals are not parser errors: let them abort the run.
                raise
            except Exception as e:
                self.logger.error(f"Failed to extract product {product_url}: {e}")
                self.progress.failed_urls.append(product_url)
                self.progress.error_count += 1
                if self.health is not None and not isinstance(e, httpx.HTTPError):
                    # HTTP failures are already counted by the client.
                    self.health.record_parser_failure(product_url, e)

    def _add_product(self, product: Product) -> bool:
        """Add product with deduplication by canonical key.

        Returns True when the product was a duplicate of one already seen.
        """
        key = product.canonical_key

        if key in self._canonical_keys:
            # Merge with existing
            existing = self._canonical_keys[key]
            self._merge_products(existing, product)
            return True

        self._canonical_keys[key] = product
        self.products.append(product)
        return False

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