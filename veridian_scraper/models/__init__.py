"""
Veridian Scraper - Base Models and Interfaces
Shared data models for all manufacturer scrapers
"""

from dataclasses import dataclass, field, asdict
from typing import Optional, List, Dict, Any, Set
from datetime import datetime
from enum import Enum
from urllib.parse import urlparse
import hashlib
import json
import re


# =============================================================================
# ENUMS
# =============================================================================

class ProductCategory(Enum):
    """Product categories"""
    LAPTOPS = "laptops"
    DESKTOPS = "desktops"
    MONITORS = "monitors"
    TABLETS = "tablets"
    PHONES = "phones"
    ACCESSORIES = "accessories"
    COMPONENTS = "components"
    PERIPHERALS = "peripherals"
    SERVERS = "servers"
    WORKSTATIONS = "workstations"
    NETWORKING = "networking"
    UNKNOWN = "other"
    OTHER = "other"


class ProductStatus(Enum):
    """Product lifecycle status"""
    CURRENT = "current"
    DISCONTINUED = "discontinued"
    ANNOUNCED = "announced"
    REFURBISHED = "refurbished"
    UNKNOWN = "unknown"


# =============================================================================
# DATA MODELS
# =============================================================================

@dataclass
class SpecValue:
    """Structured specification value with metadata"""
    raw: str
    structured: Optional[Dict[str, Any]] = None
    unit: Optional[str] = None
    is_multi_option: bool = False
    options: List[str] = field(default_factory=list)
    confidence: float = 1.0
    source_field: str = ""

    def to_dict(self) -> Dict[str, Any]:
        return {
            'raw': self.raw,
            'structured': self.structured,
            'unit': self.unit,
            'is_multi_option': self.is_multi_option,
            'options': self.options,
            'confidence': self.confidence,
            'source_field': self.source_field
        }

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> 'SpecValue':
        """Create SpecValue from dictionary"""
        return cls(
            raw=data.get('raw', ''),
            structured=data.get('structured'),
            unit=data.get('unit'),
            is_multi_option=data.get('is_multi_option', False),
            options=data.get('options', []),
            confidence=data.get('confidence', 1.0),
            source_field=data.get('source_field', '')
        )


@dataclass
class ProductVariant:
    """Individual product variant (SKU) with specifications"""
    variant_id: str
    name: str
    sku: str = ""
    specs: Dict[str, SpecValue] = field(default_factory=dict)
    price: Optional[float] = None
    currency: str = "USD"
    availability: Optional[str] = None
    launch_date: Optional[str] = None
    status: ProductStatus = ProductStatus.UNKNOWN
    source_url: str = ""
    scraped_at: str = field(default_factory=lambda: datetime.now().isoformat())

    def to_dict(self) -> Dict[str, Any]:
        return {
            'variant_id': self.variant_id,
            'name': self.name,
            'sku': self.sku,
            'specs': {k: v.to_dict() for k, v in self.specs.items()},
            'price': self.price,
            'currency': self.currency,
            'availability': self.availability,
            'launch_date': self.launch_date,
            'status': self.status.value,
            'source_url': self.source_url,
            'scraped_at': self.scraped_at
        }

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> 'ProductVariant':
        """Create ProductVariant from dictionary"""
        specs = {}
        for k, v in data.get('specs', {}).items():
            if isinstance(v, dict):
                specs[k] = SpecValue(**v)
            else:
                specs[k] = SpecValue(raw=str(v))

        status = ProductStatus(data.get('status', 'unknown'))
        if isinstance(status, str):
            status = ProductStatus(status)

        return cls(
            variant_id=data.get('variant_id', ''),
            name=data.get('name', ''),
            sku=data.get('sku', ''),
            specs=specs,
            price=data.get('price'),
            currency=data.get('currency', 'USD'),
            availability=data.get('availability'),
            launch_date=data.get('launch_date'),
            status=status,
            source_url=data.get('source_url', ''),
            scraped_at=data.get('scraped_at', datetime.now().isoformat())
        )


@dataclass
class Product:
    """Master product record with all variants"""
    product_id: str
    canonical_key: str  # Deduplication key across regions/sources
    manufacturer: str
    brand: str  # e.g., "ASUS", "Lenovo", "HP", "Dell"
    name: str
    category: ProductCategory
    series: str = ""
    subcategory: str = ""
    url: str = ""
    region: str = ""
    variants: List[ProductVariant] = field(default_factory=list)
    metadata: Dict[str, Any] = field(default_factory=dict)
    scraped_at: str = field(default_factory=lambda: datetime.now().isoformat())
    source_urls: List[str] = field(default_factory=list)
    # New fields for enhanced product information
    msrp: Optional[float] = None
    currency: str = "USD"
    launch_date: Optional[str] = None
    availability: Optional[str] = None
    status: ProductStatus = ProductStatus.UNKNOWN
    family_id: Optional[str] = None

    def add_source_url(self, url: str):
        """Add a source URL for this product"""
        canonical = canonicalize_url(url)
        if canonical not in self.source_urls:
            self.source_urls.append(canonical)

    def get_best_variant(self) -> Optional[ProductVariant]:
        """Get variant with most specs"""
        if not self.variants:
            return None
        return max(self.variants, key=lambda v: len(v.specs))

    def to_dict(self) -> Dict[str, Any]:
        return {
            'product_id': self.product_id,
            'canonical_key': self.canonical_key,
            'manufacturer': self.manufacturer,
            'brand': self.brand,
            'name': self.name,
            'category': self.category.value,
            'series': self.series,
            'subcategory': self.subcategory,
            'url': self.url,
            'region': self.region,
            'variants': [v.to_dict() for v in self.variants],
            'metadata': self.metadata,
            'scraped_at': self.scraped_at,
            'source_urls': self.source_urls,
            'msrp': self.msrp,
            'currency': self.currency,
            'launch_date': self.launch_date,
            'availability': self.availability,
            'status': self.status.value,
            'family_id': self.family_id
        }

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> 'Product':
        """Create Product from dictionary"""
        variants = [ProductVariant.from_dict(v) for v in data.get('variants', [])]

        category = ProductCategory(data.get('category', 'unknown'))
        if isinstance(category, str):
            category = ProductCategory(category)

        status = ProductStatus(data.get('status', 'unknown'))
        if isinstance(status, str):
            status = ProductStatus(status)

        return cls(
            product_id=data.get('product_id', ''),
            canonical_key=data.get('canonical_key', ''),
            manufacturer=data.get('manufacturer', ''),
            brand=data.get('brand', ''),
            name=data.get('name', ''),
            category=category,
            series=data.get('series', ''),
            subcategory=data.get('subcategory', ''),
            url=data.get('url', ''),
            region=data.get('region', ''),
            variants=variants,
            metadata=data.get('metadata', {}),
            scraped_at=data.get('scraped_at', datetime.now().isoformat()),
            source_urls=data.get('source_urls', []),
            msrp=data.get('msrp'),
            currency=data.get('currency', 'USD'),
            launch_date=data.get('launch_date'),
            availability=data.get('availability'),
            status=status,
            family_id=data.get('family_id')
        )


@dataclass
class ScrapingProgress:
    """Track scraping progress for resumability"""
    region: str
    manufacturer: str
    completed_categories: List[str] = field(default_factory=list)
    completed_products: List[str] = field(default_factory=list)
    failed_urls: List[str] = field(default_factory=list)
    total_products: int = 0
    scraped_products: int = 0
    last_updated: str = field(default_factory=lambda: datetime.now().isoformat())
    error_count: int = 0


# =============================================================================
# UTILITY FUNCTIONS
# =============================================================================

def generate_product_id(manufacturer: str, canonical_key: str) -> str:
    """Generate consistent product ID from manufacturer and canonical key"""
    combined = f"{manufacturer.lower()}:{canonical_key.lower()}"
    return hashlib.md5(combined.encode()).hexdigest()[:16]


def generate_variant_id(manufacturer: str, canonical_key: str, variant_name: str) -> str:
    """Generate consistent variant ID"""
    combined = f"{manufacturer.lower()}:{canonical_key.lower()}:{variant_name.lower()}"
    return hashlib.md5(combined.encode()).hexdigest()[:12]


def canonicalize_url(url: str) -> str:
    """Normalize URL for consistent comparison"""
    parsed = urlparse(url)
    # Remove fragment and normalize
    normalized = parsed._replace(fragment='', query='').geturl()
    # Ensure trailing slash for directory-like URLs
    if not normalized.endswith('/') and '.' not in parsed.path.split('/')[-1]:
        normalized += '/'
    return normalized.lower()


def extract_canonical_key(url: str, manufacturer: str) -> str:
    """Extract canonical key from product URL for deduplication"""
    parsed = urlparse(url)
    path = parsed.path.strip('/')

    # Remove common prefixes
    prefixes_to_remove = [
        'laptops', 'desktops', 'monitors', 'tablets', 'phones',
        'for-home', 'for-work', 'for-creators', 'for-gaming',
        'rog-republic-of-gamers', 'tuf-gaming', 'proart',
        'displays-desktops', 'accessories', 'components',
    ]

    parts = [p for p in path.split('/') if p and p not in prefixes_to_remove]

    # Get product-specific parts (usually last 2-3 segments)
    if len(parts) >= 2:
        # Take last 2-3 meaningful parts
        key_parts = []
        for part in reversed(parts):
            if len(part) > 2 and not part.isdigit():
                key_parts.insert(0, part)
                if len(key_parts) >= 3:
                    break
        return '-'.join(key_parts).lower()

    # Fallback: use last meaningful path part
    for part in reversed(path.split('/')):
        if len(part) > 5 and not part.isdigit():
            return part.lower()

    return parsed.path.strip('/').lower()


# =============================================================================
# SPEC PARSING BASE CLASS
# =============================================================================

class SpecParser:
    """Base class for parsing specification values into structured data"""

    # Field-specific extraction patterns
    EXTRACTION_RULES = {
        'processor': {
            'brand_patterns': ['Intel', 'AMD', 'Apple', 'Qualcomm', 'Snapdragon', 'MediaTek'],
            'model_patterns': [
                r'(Core\s+Ultra\s+\d+\s+\d+[A-Z]?)',
                r'(Ryzen\s+\w+\s+\d+[A-Z]?)',
                r'(M\d+\s+\w+)',
                r'(Snapdragon\s+\w+\s+\d+\s+\d+)',
                r'(X\s+\w+\s+\d+\s+\d+)',
            ],
            'extractors': {
                'cores': r'(\d+)\s*cores?',
                'threads': r'(\d+)\s*threads?',
                'base_freq_ghz': r'(\d+\.?\d*)\s*GHz',
                'boost_freq_ghz': r'up to\s+(\d+\.?\d*)\s*GHz',
                'cache_mb': r'(\d+)\s*MB\s*Cache',
                'npu_tops': r'(?:NPU|AI Boost).*?(\d+\.?\d*)\s*TOPS',
            }
        },
        'memory': {
            'extractors': {
                'capacity_gb': r'(\d+)\s*GB',
                'type': r'(LPDDR\d+X?|DDR\d+|LPDDR\d+)',
                'speed_mts': r'(\d+)\s*MT/s|(\d+)\s*MHz',
            },
            'flags': {
                'soldered': ['on board', 'soldered', 'onboard'],
                'sodimm': ['so-dimm', 'sodimm', 'dimm'],
            }
        },
        'storage': {
            'extractors': {
                'capacity_gb': r'(\d+)\s*(TB|GB)',
                'interface': r'(NVMe|SATA|PCIe\s+\d+\.?\d*)',
            },
            'flags': {
                'nvme': ['nvme'],
                'sata': ['sata'],
                'pcie_gen': [r'PCIe\s+(\d+\.?\d*)'],
            }
        },
        'display': {
            'extractors': {
                'size_inches': r'(\d+\.?\d*)\s*(?:"|inch)',
                'width_px': r'(\d+)\s*[x×]\s*(\d+)',
                'height_px': r'(\d+)\s*[x×]\s*(\d+)',
                'refresh_rate_hz': r'(\d+)\s*Hz',
                'response_time_ms': r'(\d+\.?\d*)\s*ms',
            },
            'panel_types': ['OLED', 'IPS', 'TN', 'VA', 'Mini LED', 'Micro LED']
        },
        'graphics': {
            'extractors': {
                'vram_gb': r'(\d+)\s*GB\s*GDDR',
                'brand': r'(NVIDIA|AMD|Intel)',
                'model': r'(RTX\s+\d{4}[A-Z]?|GTX\s+\d{4}[A-Z]?|Radeon\s+\w+\s+\d{4}[A-Z]?|Arc\s+\w+\s+\d+)',
            },
            'flags': {
                'dedicated': ['dedicated', 'discrete'],
                'integrated': ['integrated', 'igp', 'uHD', 'iris', 'radeon graphics'],
            }
        },
        'battery': {
            'extractors': {
                'capacity_wh': r'(\d+)\s*Wh',
                'cells': r'(\d+)\s*cell',
            }
        },
        'weight': {
            'extractors': {
                'weight_kg': r'(\d+\.?\d*)\s*kg',
                'weight_lbs': r'(\d+\.?\d*)\s*lbs?',
            }
        },
        'dimensions': {
            'extractors': {
                'mm': r'(\d+\.?\d*)\s*x\s*(\d+\.?\d*)\s*x\s*(\d+\.?\d*)\s*mm',
                'in': r'(\d+\.?\d*)\s*x\s*(\d+\.?\d*)\s*x\s*(\d+\.?\d*)\s*in',
            }
        },
    }

    @classmethod
    def standardize_field_name(cls, name: str) -> str:
        """Map manufacturer-specific field names to standard names"""
        field_mappings = {
            # Processor
            'processor': 'processor',
            'cpu': 'processor',
            'chipset': 'processor',

            # Memory
            'memory': 'memory',
            'ram': 'memory',
            'system_memory': 'memory',

            # Storage
            'storage': 'storage',
            'ssd': 'storage',
            'hard_drive': 'storage',
            'hdd': 'storage',

            # Display
            'display': 'display',
            'screen': 'display',
            'panel': 'display',

            # Graphics
            'graphics': 'graphics',
            'gpu': 'graphics',
            'video_card': 'graphics',
            'graphics_card': 'graphics',

            # Battery
            'battery': 'battery',
            'battery_capacity': 'battery',

            # Weight
            'weight': 'weight',
            'mass': 'weight',

            # Dimensions
            'dimensions': 'dimensions',
            'size': 'dimensions',
            'physical_dimensions': 'dimensions',

            # OS
            'operating_system': 'operating_system',
            'os': 'operating_system',

            # Network
            'wireless': 'network',
            'wifi': 'network',
            'bluetooth': 'network',
            'lan': 'network',
            'connectivity': 'network',
            'network_and_communication': 'network',

            # Ports
            'ports': 'ports_and_interfaces',
            'interfaces': 'ports_and_interfaces',
            'connectivity': 'ports_and_interfaces',
            'i/o_ports': 'ports_and_interfaces',
            'io_ports': 'ports_and_interfaces',

            # Network
            'wireless': 'network',
            'wifi': 'network',
            'bluetooth': 'network',
            'lan': 'network',

            # Color
            'color': 'color',
            'colour': 'color',
            'chassis_color': 'color',

            # Warranty
            'warranty': 'warranty',
            'warranty_period': 'warranty',
        }

        return field_mappings.get(name, name)

    @classmethod
    def parse_spec(cls, field_name: str, raw_value: str) -> SpecValue:
        """Parse a raw spec value into structured SpecValue"""
        import re

        if not raw_value or not raw_value.strip():
            return SpecValue(raw=raw_value, confidence=0.0)

        # Standardize the field name
        standardized_field = cls.standardize_field_name(field_name)
        value = raw_value.strip()
        field_lower = standardized_field.lower()

        # Check for multi-option
        options = cls._split_multi_option(value, field_lower)
        is_multi = len(options) > 1

        # Parse structured data for single option or first option
        primary_value = options[0] if options else value
        structured = cls._extract_structured(primary_value, field_lower)

        # Get unit if applicable
        unit = cls._extract_unit(primary_value, field_lower)

        return SpecValue(
            raw=value,
            structured=structured if structured else None,
            unit=unit,
            is_multi_option=is_multi,
            options=options if is_multi else [],
            confidence=0.9 if structured else 0.5,
            source_field=standardized_field
        )

    @classmethod
    def _split_multi_option(cls, value: str, field_name: str) -> List[str]:
        """Split concatenated spec values into options"""
        import re

        # Normalize field name for matching
        field_normalized = field_name.lower().replace(' ', '_').replace('-', '_')

        # Field-specific splitting for known problematic fields
        if field_normalized in ('operating_system', 'os', 'operating_system_os'):
            # Extract OS names using known patterns
            os_patterns = [
                r'(Windows\s+\d+\s+\w+)',
                r'(macOS\s+\w+\s*\d*\.?\d*)',
                r'(Chrome\s+OS)',
                r'(Ubuntu\s+\d+\.?\d*)',
                r'(No\s+preinstalled\s+OS)',
                r'(FreeDOS)',
            ]
            found = []
            for pattern in os_patterns:
                matches = re.findall(pattern, value, re.IGNORECASE)
                for match in matches:
                    if match not in found:
                        found.append(match)
            if len(found) > 1:
                return found
            if len(found) == 1:
                return found

        if field_normalized in ('display', 'screen'):
            # Extract display specs - handle patterns like "16\" OLED 3840x2400... 120Hz..."
            # Common pattern: size + panel type + resolution + refresh rate
            display_patterns = [
                r'\b(\d+\.?\d*\s*(?:-\s*)?(?:"|inch)\s*(?:OLED|IPS|TN|VA|Mini\s+LED|Micro\s+LED)[^;]*?(?:\d+\s*x\s*\d+)[^;]*?(?:\d+\s*Hz)[^;]*?)(?:\s*;|\s*$)'
            ]
            found_displays = []
            for pattern in display_patterns:
                matches = re.findall(pattern, value, re.IGNORECASE)
                for match in matches:
                    match = match.strip().rstrip(';').strip()
                    if match not in found_displays and len(match) > 10:
                        found_displays.append(match)
            if len(found_displays) > 1:
                return found_displays

        if field_normalized in ('memory', 'ram'):
            # Extract memory configurations - e.g., "16GB LPDDR5X... 32GB LPDDR5X..."
            mem_patterns = [
                r'\b(\d+\s*GB\s+(?:LPDDR\d+X?|DDR\d+)[^;]*?)(?:\s*;|\s*$)'
            ]
            found_mem = []
            for pattern in mem_patterns:
                matches = re.findall(pattern, value, re.IGNORECASE)
                for match in matches:
                    match = match.strip().rstrip(';').strip()
                    if match not in found_mem and len(match) > 5:
                        found_mem.append(match)
            if len(found_mem) > 1:
                return found_mem

        if field_normalized in ('storage', 'ssd', 'hdd'):
            # Extract storage configurations - e.g., "1TB NVMe... 2TB NVMe..."
            storage_patterns = [
                r'\b(\d+\s*(?:TB|GB)\s+(?:NVMe|SATA|PCIe)[^;]*?)(?:\s*;|\s*$)'
            ]
            found_storage = []
            for pattern in storage_patterns:
                matches = re.findall(pattern, value, re.IGNORECASE)
                for match in matches:
                    match = match.strip().rstrip(';').strip()
                    if match not in found_storage and len(match) > 5:
                        found_storage.append(match)
            if len(found_storage) > 1:
                return found_storage

        if field_normalized in ('graphics', 'gpu'):
            # Extract GPU configurations
            gpu_patterns = [
                r'\b(NVIDIA\s+GeForce\s+RTX\s+\d{4}[A-Z]?[^;]*?)(?:\s*;|\s*$)',
                r'\b(AMD\s+Radeon\s+[\w\s]+?[^;]*?)(?:\s*;|\s*$)',
                r'\b(Intel\s+(?:Arc|Iris|UHD|HD)\s+[\w\s]+?[^;]*?)(?:\s*;|\s*$)',
                r'\b(Apple\s+GPU\s+[\w\d\-]+?[^;]*?)(?:\s*;|\s*$)',
            ]
            found_gpus = []
            for pattern in gpu_patterns:
                matches = re.findall(pattern, value, re.IGNORECASE)
                for match in matches:
                    match = match.strip().rstrip(';').strip()
                    if match not in found_gpus and len(match) > 10:
                        found_gpus.append(match)
            if len(found_gpus) > 1:
                return found_gpus

        # Common separators
        separators = [
            r'\.{3,}',      # ... ellipsis
            r'\s*/\s*',     # / slash
            r'\s*\|\s*',    # | pipe
            r'\s*;\s*',     # ; semicolon
            r'\s*\+\s*',    # + plus
        ]

        # Try to split by each separator
        for sep in separators:
            parts = re.split(sep, value)
            parts = [p.strip() for p in parts if p.strip() and len(p.strip()) > 3]
            if len(parts) > 1:
                return parts

        # No split found, return original as single option
        return [value]

    @classmethod
    def _extract_structured(cls, value: str, field_name: str) -> Optional[Dict]:
        """Extract structured data based on field type"""
        import re

        result = {}
        rules = cls.EXTRACTION_RULES.get(field_name, {})

        # Apply extractors
        extractors = rules.get('extractors', {})
        for key, pattern in extractors.items():
            match = re.search(pattern, value, re.IGNORECASE)
            if match:
                if match.lastindex and match.lastindex >= 2:
                    # Multiple capture groups - use first
                    result[key] = match.group(1)
                elif match.lastindex and match.lastindex >= 3:
                    # For dimensions
                    result['width_mm'] = float(match.group(1))
                    result['depth_mm'] = float(match.group(2))
                    result['height_mm'] = float(match.group(3))
                else:
                    val = match.group(1)
                    try:
                        result[key] = float(val) if '.' in val else int(val)
                    except ValueError:
                        result[key] = val

        # Check flags
        flags = rules.get('flags', {})
        for flag, keywords in flags.items():
            if any(kw in value.lower() for kw in keywords):
                result[flag] = True

        # Panel type detection
        if field_name == 'display':
            panel_types = rules.get('panel_types', [])
            for panel in panel_types:
                if panel.lower() in value.lower():
                    result['panel_type'] = panel
                    break

        # Brand/model extraction for processor
        if field_name == 'processor':
            brand_patterns = rules.get('brand_patterns', [])
            for brand in brand_patterns:
                if brand.lower() in value.lower():
                    result['brand'] = brand
                    break

            model_patterns = rules.get('model_patterns', [])
            for pattern in model_patterns:
                match = re.search(pattern, value, re.IGNORECASE)
                if match:
                    result['model'] = match.group(1).strip()
                    break

        # Resolution splitting for display
        if field_name == 'display' and 'width_px' in result and 'height_px' in result:
            result['resolution'] = f"{result['width_px']}x{result['height_px']}"

        return result if result else None

    @classmethod
    def _extract_unit(cls, value: str, field_name: str) -> Optional[str]:
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
            'size': 'mm',
        }
        return units.get(field_normalized)


# =============================================================================
# EXPORT FUNCTIONS
# =============================================================================

def export_products_json(products: List[Product], filepath: str):
    """Export products to JSON"""
    with open(filepath, 'w', encoding='utf-8') as f:
        json.dump([p.to_dict() for p in products], f, indent=2, ensure_ascii=False)


def export_products_csv(products: List[Product], filepath: str):
    """Export products to flattened CSV"""
    import csv

    rows = []
    for product in products:
        for variant in product.variants:
            row = {
                'product_id': product.product_id,
                'canonical_key': product.canonical_key,
                'manufacturer': product.manufacturer,
                'brand': product.brand,
                'product_name': product.name,
                'category': product.category.value,
                'series': product.series,
                'subcategory': product.subcategory,
                'product_url': product.url,
                'region': product.region,
                'source_urls': '|'.join(product.source_urls),
                'msrp': product.msrp,
                'product_currency': product.currency,
                'launch_date': product.launch_date,
                'availability': product.availability,
                'status': product.status.value,
                'family_id': product.family_id,
                'variant_id': variant.variant_id,
                'variant_name': variant.name,
                'variant_sku': variant.sku,
                'price': variant.price,
                'currency': variant.currency,
                'availability': variant.availability,
                'launch_date': variant.launch_date,
                'status': variant.status.value,
                'variant_source_url': variant.source_url,
            }

            # Add specs
            for spec_name, spec_value in variant.specs.items():
                if spec_value.structured:
                    row[spec_name] = json.dumps(spec_value.structured)
                else:
                    row[spec_name] = spec_value.raw

            rows.append(row)

    if rows:
        all_columns = set()
        for row in rows:
            all_columns.update(row.keys())

        # Priority columns first
        priority = [
            'product_id', 'canonical_key', 'manufacturer', 'brand', 'product_name',
            'category', 'series', 'subcategory', 'product_url', 'region',
            'msrp', 'product_currency', 'launch_date', 'availability', 'status', 'family_id',
            'variant_id', 'variant_name', 'variant_sku', 'price', 'currency',
            'availability', 'launch_date', 'status',
            'processor', 'memory', 'storage', 'display', 'graphics', 'battery',
            'weight', 'dimensions', 'operating_system', 'chipset', 'network',
            'wireless', 'bluetooth', 'io_ports', 'audio', 'camera', 'security',
            'keyboard_and_touchpad', 'power_supply', 'form_factor', 'model',
            'color', 'expansion_slots', 'software', 'built_in_apps'
        ]
        other = sorted(all_columns - set(priority))
        columns = [c for c in priority if c in all_columns] + other

        with open(filepath, 'w', newline='', encoding='utf-8') as f:
            writer = csv.DictWriter(f, fieldnames=columns, extrasaction='ignore')
            writer.writeheader()
            writer.writerows(rows)