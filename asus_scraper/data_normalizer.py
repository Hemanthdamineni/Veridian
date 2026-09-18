"""
Data Normalization Module for ASUS Scraper
Handles URL canonicalization, spec parsing, field standardization, and data cleaning
"""

import re
from typing import Dict, List, Any, Optional, Set
from urllib.parse import urlparse, urlunparse
from dataclasses import dataclass, field
from datetime import datetime
import hashlib


@dataclass
class NormalizedSpec:
    """Normalized specification with structured values"""
    field_name: str
    display_name: str
    value: Any  # Can be str, List[str], or Dict
    unit: Optional[str] = None
    is_multi_option: bool = False


# =============================================================================
# URL CANONICALIZATION
# =============================================================================

def canonicalize_url(url: str) -> str:
    """
    Normalize URL to prevent duplicates:
    - Remove trailing slash
    - Lowercase domain and path
    - Remove fragment
    - Normalize query parameters (sort them)
    """
    parsed = urlparse(url)

    # Normalize scheme and netloc
    scheme = parsed.scheme.lower()
    netloc = parsed.netloc.lower()

    # Normalize path - remove trailing slash, lowercase
    path = parsed.path.rstrip('/').lower()

    # Normalize query - sort parameters
    query = parsed.query
    if query:
        params = []
        for param in query.split('&'):
            if '=' in param:
                k, v = param.split('=', 1)
                params.append((k.lower(), v))
            else:
                params.append((param.lower(), ''))
        params.sort(key=lambda x: x[0])
        query = '&'.join(f"{k}={v}" if v else k for k, v in params)

    # Remove fragment
    fragment = ''

    return urlunparse((scheme, netloc, path, parsed.params, query, fragment))


def extract_canonical_product_key(url: str) -> str:
    """
    Extract a canonical product identifier from URL.
    For ASUS product URLs, the key is the product slug (e.g., asus-vivobook-s16-s3607)
    Handles both main site (asus.com) and store site (store.asus.com) URLs
    """
    parsed = urlparse(url)
    path_parts = [p for p in parsed.path.strip('/').split('/') if p]

    # Handle store.asus.com URLs - they have format like "ai-powered-light-weight-laptop-asus-vivobook-s14-s3407ca-ly084ws.html"
    if 'store' in parsed.netloc:
        for part in path_parts:
            if 'asus-vivobook' in part or 'asus-zenbook' in part or 'asus-rog' in part or 'asus-tuf' in part or 'asus-expertbook' in part:
                # Extract the model part
                part = part.replace('.html', '')
                # Find the model identifier
                match = re.search(r'(asus-vivobook-[a-z0-9-]+|asus-zenbook-[a-z0-9-]+|asus-rog-[a-z0-9-]+|asus-tuf-[a-z0-9-]+|asus-expertbook-[a-z0-9-]+)', part, re.IGNORECASE)
                if match:
                    return match.group(1).lower()

    # Find the product slug (usually the last meaningful part)
    for part in reversed(path_parts):
        part_lower = part.lower()
        if part_lower.startswith('asus-') or re.match(r'^[a-z0-9-]+$', part_lower):
            if len(part) > 5:  # Valid product slug
                return part_lower

    return parsed.path.strip('/').lower()


# =============================================================================
# SPEC VALUE PARSING
# =============================================================================

# Patterns for splitting multi-option values
MULTI_OPTION_PATTERNS = [
    # Pattern: "Option1...Option2...Option3" (multiple ellipsis separators)
    (r'\.{3,}', '...'),
    # Pattern: "Option1 / Option2 / Option3" (slash separator)
    (r'\s*/\s*', ' / '),
    # Pattern: "Option1 | Option2 | Option3" (pipe separator)
    (r'\s*\|\s*', ' | '),
    # Pattern: "Option1; Option2; Option3" (semicolon separator)
    (r'\s*;\s*', '; '),
    # Pattern: "Option1, Option2, Option3" with specific context
]

# Field-specific parsing rules
SPEC_PARSING_RULES = {
    'processor': {
        'split_patterns': [r'\.\.\.+', r'\s*\|\s*', r'\s*;\s*'],
        'extract': ['brand', 'series', 'model', 'cores', 'threads', 'base_freq', 'boost_freq', 'cache'],
    },
    'memory': {
        'split_patterns': [r'\.\.\.+', r'\s*\|\s*', r'\s*;\s*'],
        'extract': ['capacity', 'type', 'speed', 'form_factor', 'channels'],
    },
    'storage': {
        'split_patterns': [r'\.\.\.+', r'\s*\+\s*', r'\s*\|\s*', r'\s*;\s*'],
        'extract': ['capacity', 'type', 'interface', 'form_factor'],
    },
    'display': {
        'split_patterns': [r'\.\.\.+', r'\s*\|\s*', r'\s*;\s*'],
        'extract': ['size', 'resolution', 'panel_type', 'aspect_ratio', 'refresh_rate', 'response_time', 'color_gamut'],
    },
    'graphics': {
        'split_patterns': [r'\.\.\.+', r'\s*\|\s*', r'\s*;\s*'],
        'extract': ['gpu_model', 'vram', 'type'],
    },
    'battery': {
        'split_patterns': [r'\.\.\.+', r'\s*\|\s*', r'\s*;\s*'],
        'extract': ['capacity_wh', 'cells', 'type'],
    },
    'weight': {
        'split_patterns': [r'\.\.\.+', r'\s*\|\s*', r'\s*;\s*'],
        'extract': ['value_kg', 'value_lbs'],
    },
    'dimensions': {
        'split_patterns': [r'\.\.\.+', r'\s*\|\s*', r'\s*;\s*'],
        'extract': ['width_mm', 'depth_mm', 'height_mm', 'width_in', 'depth_in', 'height_in'],
    },
}


def parse_multi_option_value(raw_value: str, field_name: str = '') -> List[str]:
    """
    Split a concatenated spec value into individual options.
    Handles patterns like "16GB LPDDR5X...32GB LPDDR5X..." or "Option1 / Option2 / Option3"
    """
    if not raw_value or not raw_value.strip():
        return []

    value = raw_value.strip()

    # Get field-specific split patterns
    rules = SPEC_PARSING_RULES.get(field_name.lower(), {})
    split_patterns = rules.get('split_patterns', [r'\.{3,}', r'\s*/\s*', r'\s*\|\s*', r'\s*;\s*'])

    # Try each pattern
    for pattern in split_patterns:
        parts = re.split(pattern, value)
        if len(parts) > 1:
            # Clean each part
            cleaned = [p.strip() for p in parts if p.strip() and len(p.strip()) > 2]
            # Filter out obvious garbage
            filtered = [p for p in cleaned if not re.match(r'^[\.\s]+$', p)]
            if len(filtered) > 1:
                return filtered

    # For processor fields, try to split on common separators even if not in patterns
    if field_name.lower() == 'processor':
        # Try splitting on "Intel" or "AMD" or "Snapdragon" occurrences
        parts = re.split(r'(?=(?:Intel|AMD|Snapdragon)\s)', value)
        if len(parts) > 1:
            cleaned = [p.strip() for p in parts if p.strip() and len(p.strip()) > 5]
            filtered = [p for p in cleaned if not re.match(r'^[\.\s]+$', p)]
            if len(filtered) > 1:
                return filtered

    # Single value - return as list
    return [value]


def parse_spec_value(raw_value: str, field_name: str = '') -> Any:
    """
    Parse a raw spec value into structured data.
    Returns either a string (for simple values) or a dict/List for complex values.
    """
    if not raw_value or not raw_value.strip():
        return None

    value = raw_value.strip()

    # Check if it's a multi-option value
    options = parse_multi_option_value(value, field_name)
    if len(options) > 1:
        return {
            'type': 'multi_option',
            'options': options,
            'raw': value
        }

    # Single value - try to extract structured data based on field
    rules = SPEC_PARSING_RULES.get(field_name.lower(), {})
    extract_fields = rules.get('extract', [])

    if extract_fields:
        parsed = extract_structured_spec(value, field_name)
        if parsed:
            return parsed

    return value


def extract_structured_spec(value: str, field_name: str) -> Optional[Dict]:
    """
    Extract structured data from a spec value based on field type.
    """
    result = {}

    if field_name.lower() == 'processor':
        # Extract: Intel Core Ultra 7 155H 1.4 GHz (24MB Cache, up to 4.8 GHz, 16 cores)
        brand_match = re.search(r'(Intel|AMD|Apple|Snapdragon)\s+', value, re.IGNORECASE)
        if brand_match:
            result['brand'] = brand_match.group(1)

        # Model pattern - more comprehensive
        model_patterns = [
            r'(Core\s+Ultra\s+\d+\s+\d+[A-Z]?)',
            r'(Ryzen\s+\w+\s+\d+[A-Z]?)',
            r'(M\d+\s+\w+)',
            r'(Snapdragon\s+\w+\s+\d+\s+\d+)',
            r'(X\s+\w+\s+\d+\s+\d+)',
        ]
        for pattern in model_patterns:
            model_match = re.search(pattern, value, re.IGNORECASE)
            if model_match:
                result['model'] = model_match.group(1).strip()
                break

        # Cores/threads
        cores_match = re.search(r'(\d+)\s*cores?', value, re.IGNORECASE)
        if cores_match:
            result['cores'] = int(cores_match.group(1))

        threads_match = re.search(r'(\d+)\s*threads?', value, re.IGNORECASE)
        if threads_match:
            result['threads'] = int(threads_match.group(1))

        # Frequencies - base
        base_freq = re.search(r'(\d+\.?\d*)\s*GHz', value)
        if base_freq:
            result['base_frequency_ghz'] = float(base_freq.group(1))

        # Boost frequency
        boost_match = re.search(r'up to\s+(\d+\.?\d*)\s*GHz', value, re.IGNORECASE)
        if boost_match:
            result['boost_frequency_ghz'] = float(boost_match.group(1))

        # Cache
        cache_match = re.search(r'(\d+)\s*MB\s*Cache', value, re.IGNORECASE)
        if cache_match:
            result['cache_mb'] = int(cache_match.group(1))

        # NPU / AI Boost
        npu_match = re.search(r'(NPU|AI Boost)\s*(?:up to\s*)?(\d+\.?\d*)\s*TOPS', value, re.IGNORECASE)
        if npu_match:
            result['npu_tops'] = float(npu_match.group(2))
            result['npu_type'] = npu_match.group(1)

        # Neural processor
        neural_match = re.search(r'neural\s+processor\s*[:]?\s*([^;.]+)', value, re.IGNORECASE)
        if neural_match:
            result['neural_processor'] = neural_match.group(1).strip()

    elif field_name.lower() == 'memory':
        # Extract: 16GB LPDDR5X on board (dual-channel)
        capacity_match = re.search(r'(\d+)\s*GB', value, re.IGNORECASE)
        if capacity_match:
            result['capacity_gb'] = int(capacity_match.group(1))

        type_match = re.search(r'(LPDDR\d+X?|DDR\d+|LPDDR\d+)', value, re.IGNORECASE)
        if type_match:
            result['type'] = type_match.group(1).upper()

        speed_match = re.search(r'(\d+)\s*MT/s|(\d+)\s*MHz', value, re.IGNORECASE)
        if speed_match:
            result['speed_mts'] = int(speed_match.group(1) or speed_match.group(2))

        if 'on board' in value.lower():
            result['form_factor'] = 'soldered'
        elif 'so-dimm' in value.lower() or 'sodimm' in value.lower():
            result['form_factor'] = 'sodimm'

        if 'dual' in value.lower() and 'channel' in value.lower():
            result['channels'] = 2

    elif field_name.lower() == 'storage':
        # Extract: 1TB M.2 NVMe PCIe 4.0 SSD
        capacity_match = re.search(r'(\d+)\s*(TB|GB)', value, re.IGNORECASE)
        if capacity_match:
            size = int(capacity_match.group(1))
            unit = capacity_match.group(2).upper()
            result['capacity'] = f"{size}{unit}"
            result['capacity_gb'] = size * 1024 if unit == 'TB' else size

        if 'nvme' in value.lower():
            result['interface'] = 'NVMe'
        elif 'sata' in value.lower():
            result['interface'] = 'SATA'

        if 'pcie' in value.lower():
            pcie_match = re.search(r'PCIe\s*(\d+\.?\d*)', value, re.IGNORECASE)
            if pcie_match:
                result['pcie_version'] = pcie_match.group(1)

        if 'm.2' in value.lower() or 'm2' in value.lower():
            result['form_factor'] = 'M.2'
        elif '2.5' in value:
            result['form_factor'] = '2.5"'

    elif field_name.lower() == 'display':
        # Extract: 14", 2.8K (2880 x 1800) OLED 16:10, 120Hz, 0.2ms
        size_match = re.search(r'(\d+\.?\d*)\s*[""inch]', value, re.IGNORECASE)
        if size_match:
            inches = float(size_match.group(1))
            # Sanity check: laptop displays are typically 10-20 inches
            if 8 <= inches <= 35:
                result['size_inches'] = inches
        else:
            # Check for cm values and convert
            cm_match = re.search(r'(\d+\.?\d*)\s*cm', value, re.IGNORECASE)
            if cm_match:
                cm = float(cm_match.group(1))
                inches = cm / 2.54
                if 8 <= inches <= 35:
                    result['size_inches'] = inches

        # Resolution
        res_match = re.search(r'(\d+)\s*x\s*(\d+)', value)
        if res_match:
            result['resolution'] = f"{res_match.group(1)}x{res_match.group(2)}"
            result['width_px'] = int(res_match.group(1))
            result['height_px'] = int(res_match.group(2))

        # Panel type
        for panel in ['OLED', 'IPS', 'TN', 'VA', 'Mini LED', 'Micro LED']:
            if panel.lower() in value.lower():
                result['panel_type'] = panel
                break

        # Aspect ratio
        ar_match = re.search(r'(\d+:\d+)', value)
        if ar_match:
            result['aspect_ratio'] = ar_match.group(1)

        # Refresh rate
        hz_match = re.search(r'(\d+)\s*Hz', value, re.IGNORECASE)
        if hz_match:
            result['refresh_rate_hz'] = int(hz_match.group(1))

        # Response time
        rt_match = re.search(r'(\d+\.?\d*)\s*ms', value, re.IGNORECASE)
        if rt_match:
            result['response_time_ms'] = float(rt_match.group(1))

    elif field_name.lower() == 'battery':
        # Extract: 70Wh, 4-cell
        wh_match = re.search(r'(\d+)\s*Wh', value, re.IGNORECASE)
        if wh_match:
            result['capacity_wh'] = int(wh_match.group(1))

        cell_match = re.search(r'(\d+)\s*cell', value, re.IGNORECASE)
        if cell_match:
            result['cells'] = int(cell_match.group(1))

    elif field_name.lower() == 'weight':
        # Extract: 1.2 kg (2.65 lbs)
        kg_match = re.search(r'(\d+\.?\d*)\s*kg', value, re.IGNORECASE)
        if kg_match:
            result['weight_kg'] = float(kg_match.group(1))

        lbs_match = re.search(r'(\d+\.?\d*)\s*lbs?', value, re.IGNORECASE)
        if lbs_match:
            result['weight_lbs'] = float(lbs_match.group(1))

    elif field_name.lower() == 'dimensions':
        # Extract: 312 x 220 x 15.9 mm (12.3 x 8.7 x 0.63 in)
        mm_match = re.search(r'(\d+\.?\d*)\s*x\s*(\d+\.?\d*)\s*x\s*(\d+\.?\d*)\s*mm', value, re.IGNORECASE)
        if mm_match:
            result['width_mm'] = float(mm_match.group(1))
            result['depth_mm'] = float(mm_match.group(2))
            result['height_mm'] = float(mm_match.group(3))

        in_match = re.search(r'(\d+\.?\d*)\s*x\s*(\d+\.?\d*)\s*x\s*(\d+\.?\d*)\s*in', value, re.IGNORECASE)
        if in_match:
            result['width_in'] = float(in_match.group(1))
            result['depth_in'] = float(in_match.group(2))
            result['height_in'] = float(in_match.group(3))

    return result if result else None


# =============================================================================
# FIELD NAME STANDARDIZATION
# =============================================================================

# Canonical field name mapping
FIELD_NAME_MAPPING = {
    # Keyboard/Touchpad
    'keyboard_touchpad': 'keyboard_and_touchpad',
    'keyboard_and_touchpad': 'keyboard_and_touchpad',
    'keyboard': 'keyboard_and_touchpad',
    'touchpad': 'keyboard_and_touchpad',

    # Included in box
    'included_in_box': 'included_in_box',
    'included_in_the_box_optional': 'included_in_box',
    'included_in_the_box': 'included_in_box',
    'package_content': 'included_in_box',
    'contents': 'included_in_box',

    # OS
    'operating_system': 'operating_system',
    'os': 'operating_system',
    'os_support': 'operating_system',

    # Processor
    'processor': 'processor',
    'cpu': 'processor',
    'chipset': 'chipset',

    # Graphics
    'graphics': 'graphics',
    'gpu': 'graphics',
    'graphic': 'graphics',
    'video': 'graphics',

    # Memory
    'memory': 'memory',
    'ram': 'memory',

    # Storage
    'storage': 'storage',
    'hard_drive': 'storage',
    'ssd': 'storage',

    # Display
    'display': 'display',
    'screen': 'display',
    'monitor': 'display',

    # Battery
    'battery': 'battery',
    'battery_life': 'battery_life',
    'battery_type': 'battery_type',

    # Weight/Dimensions
    'weight': 'weight',
    'dimensions': 'dimensions',
    'dimension': 'dimensions',
    'size': 'dimensions',

    # Connectivity
    'network': 'network',
    'lan': 'lan',
    'wireless': 'wireless',
    'wifi': 'wireless',
    'bluetooth': 'bluetooth',
    'connectivity': 'connectivity',

    # Ports
    'io_ports': 'io_ports',
    'i_o_ports': 'io_ports',
    'ports': 'io_ports',
    'front_i_o_ports': 'front_io_ports',
    'frontside_i_o_ports': 'front_io_ports',
    'back_i_o_ports': 'rear_io_ports',
    'rear_io_ports': 'rear_io_ports',

    # Audio
    'audio': 'audio',
    'speaker': 'audio',

    # Camera
    'camera': 'camera',
    'webcam': 'camera',

    # Security
    'security': 'security',
    'fingerprint': 'security',
    'tpm': 'security',

    # Other
    'color': 'color',
    'model': 'model',
    'form_factor': 'form_factor',
    'power_supply': 'power_supply',
    'power': 'power_supply',
    'software': 'software',
    'built_in_apps': 'built_in_apps',
    'subscription_offers': 'subscription_offers',
    'microsoft_office': 'microsoft_office',
    'military_grade': 'military_grade',
    'ecolabels': 'ecolabels',
    'sustainable_material': 'sustainable_material',
    'disclaimer': 'disclaimer',
    'note': 'note',
    'myasus_features': 'myasus_features',
    'myexpert_features': 'myexpert_features',
    'expansion_slots': 'expansion_slots',
    'interface': 'interface',
    'rf_distance': 'rf_distance',
    'tracking': 'tracking',
    'switch': 'switch',
    'button': 'button',
    'key_style': 'key_style',
    'sensor': 'sensor',
    'operating_temperature': 'operating_temperature',
    'neural_processor': 'neural_processor',
    'xbox_game_pass': 'xbox_game_pass',
    'wireless_data_network': 'wireless_data_network',
    'resolution': 'resolution',
    'ecolabels_compliances': 'ecolabels',
}


def standardize_field_name(raw_name: str) -> str:
    """
    Map a raw field name to its canonical form.
    """
    # First, normalize the raw name
    normalized = raw_name.lower().strip()
    normalized = re.sub(r'[^\w]+', '_', normalized)
    normalized = re.sub(r'_+', '_', normalized).strip('_')

    # Check mapping
    if normalized in FIELD_NAME_MAPPING:
        return FIELD_NAME_MAPPING[normalized]

    # Check if it's already a known canonical name
    canonical_names = set(FIELD_NAME_MAPPING.values())
    if normalized in canonical_names:
        return normalized

    # Return normalized version as fallback
    return normalized


# =============================================================================
# TEXT CLEANING
# =============================================================================

# Patterns to remove boilerplate/disclaimer text
BOILERPLATE_PATTERNS = [
    r'with copilot key\.?',
    r'copilot\+?\s*pc\.?',
    r'\(.*?\)',  # Parenthetical disclaimers
    r'\[.*?\]',  # Bracketed notes
    r'\*.*?\*',  # Asterisk notes
    r'※.*?※',  # Japanese note markers
    r'actual.*?may vary\.?',
    r'specifications.*?subject to change\.?',
    r'product.*?availability.*?may vary\.?',
    r'colors.*?may vary\.?',
    r'bundled.*?software.*?may vary\.?',
    r'google.*?drive.*?terms',
    r'microsoft.*?365.*?terms',
    r'100gb.*?cloud.*?storage',
]

COMPILED_BOILERPLATE = [re.compile(p, re.IGNORECASE) for p in BOILERPLATE_PATTERNS]


def clean_spec_value(value: str) -> str:
    """
    Remove boilerplate text and clean up spec values.
    """
    if not value:
        return value

    cleaned = value

    # Remove boilerplate patterns
    for pattern in COMPILED_BOILERPLATE:
        cleaned = pattern.sub('', cleaned)

    # Normalize whitespace
    cleaned = re.sub(r'\s+', ' ', cleaned)

    # Remove trailing punctuation artifacts
    cleaned = re.sub(r'[\.,;:\|\-\+\*]+$', '', cleaned)
    cleaned = re.sub(r'^[\.,;:\|\-\+\*]+', '', cleaned)

    return cleaned.strip()


def clean_product_name(name: str) -> str:
    """
    Clean product name from website formatting.
    """
    if not name:
        return name

    # Remove common suffixes
    name = re.sub(r'\s*[\(\[].*?[\)\]]\s*$', '', name)
    name = re.sub(r'\s*-\s*ASUS.*$', '', name, flags=re.IGNORECASE)
    name = re.sub(r'\s*\|\s*ASUS.*$', '', name, flags=re.IGNORECASE)

    return name.strip()


# =============================================================================
# PRODUCT DEDUPLICATION
# =============================================================================

def deduplicate_products(products: List[Dict]) -> List[Dict]:
    """
    Remove duplicate products based on canonical product key.
    Keeps the product with the most variants/specs.
    """
    seen = {}

    for product in products:
        # Generate canonical key
        url = product.get('url', '') or product.get('source_url', '')
        key = extract_canonical_product_key(url)

        # Also consider product name as fallback
        if not key:
            key = product.get('name', '').lower().replace(' ', '-')

        # Skip noise products
        name = product.get('name', '').lower()
        noise_keywords = [
            'where to buy', 'techspec', 'helpdesk', 'review', 'filter', 'shop',
            'offers', 'adobe', 'creative', 'cloud', 'for education', 'carbon partner',
            'power sync', 'digital product passport', 'dropzone', 'all in one pc',
            'pad_register', 'asus_pad_register', 'reliancedigital', 's70293',
            'carbon', 'partner services', 'asus-', 'qualcomm ai powered'
        ]
        if any(kw in name for kw in noise_keywords):
            continue

        # Skip non-product categories
        category = product.get('category', '').lower()
        non_product_categories = ['api', 'business', 'product', 'services', 'blog', 'content', 'in', 'api', 'us']
        if category in non_product_categories:
            continue

        # Handle shop.asus.com URLs - categorize them properly
        url = product.get('url', '') or product.get('source_url', '')
        if 'shop.asus.com' in url:
            name = product.get('name', '').lower()
            if any(kw in name for kw in ['zenbook', 'vivobook', 'rog', 'tuf', 'expertbook', 'chromebook', 'laptop']):
                product['category'] = 'laptops'

        if key not in seen:
            seen[key] = product
        else:
            # Keep the one with more variants or more specs
            existing = seen[key]
            existing_variants = len(existing.get('variants', []))
            new_variants = len(product.get('variants', []))

            if new_variants > existing_variants:
                seen[key] = product
            elif new_variants == existing_variants:
                # Compare total spec count
                existing_specs = sum(len(v.get('specs', {})) for v in existing.get('variants', []))
                new_specs = sum(len(v.get('specs', {})) for v in product.get('variants', []))
                if new_specs > existing_specs:
                    seen[key] = product

    return list(seen.values())


# =============================================================================
# FULL NORMALIZATION PIPELINE
# =============================================================================

def normalize_product(product: Dict) -> Dict:
    """
    Apply full normalization pipeline to a product.
    """
    # Clean product name
    if 'name' in product:
        product['name'] = clean_product_name(product['name'])

    # Canonicalize URL
    if 'url' in product:
        product['url'] = canonicalize_url(product['url'])
    if 'source_url' in product:
        product['source_url'] = canonicalize_url(product['source_url'])

    # Add canonical product key
    product['canonical_key'] = extract_canonical_product_key(
        product.get('url', '') or product.get('source_url', '')
    )

    # Fix empty categories from URL path
    if not product.get('category') or product.get('category') == '':
        url = product.get('url', '') or product.get('source_url', '')
        parsed = urlparse(url)
        path_parts = [p for p in parsed.path.strip('/').split('/') if p]

        # Handle store.asus.com URLs - they don't have category paths
        if 'store' in parsed.netloc:
            # Infer category from product name/URL
            name = product.get('name', '').lower()
            if any(kw in name for kw in ['vivobook', 'zenbook', 'rog', 'tuf', 'expertbook', 'chromebook', 'laptop']):
                product['category'] = 'laptops'
            elif any(kw in name for kw in ['pad', 'tablet']):
                product['category'] = 'mobile-handhelds'
            elif any(kw in name for kw in ['monitor', 'display']):
                product['category'] = 'displays-desktops'
            elif any(kw in name for kw in ['motherboard', 'component']):
                product['category'] = 'motherboards-components'
            elif any(kw in name for kw in ['router', 'network', 'wifi']):
                product['category'] = 'networking-iot-servers'
            elif any(kw in name for kw in ['nuc', 'mini-pc', 'mini pc']):
                product['category'] = 'displays-desktops'
            elif any(kw in name for kw in ['mouse', 'keyboard', 'headset', 'accessory', 'charger', 'adapter']):
                product['category'] = 'accessories'
            else:
                product['category'] = 'unknown'
        elif len(path_parts) >= 2:
            product['category'] = path_parts[0] if len(path_parts) > 0 else ''
            product['subcategory'] = path_parts[1] if len(path_parts) > 1 else ''
            product['series'] = path_parts[2] if len(path_parts) > 2 else ''

    # Normalize variants
    for variant in product.get('variants', []):
        normalize_variant(variant)

    return product


def normalize_variant(variant: Dict) -> Dict:
    """
    Apply normalization to a variant's specs.
    """
    if 'specs' not in variant:
        return variant

    normalized_specs = {}

    for raw_name, raw_value in variant['specs'].items():
        # Standardize field name
        canonical_name = standardize_field_name(raw_name)

        # Clean value
        if isinstance(raw_value, str):
            cleaned_value = clean_spec_value(raw_value)
        else:
            cleaned_value = raw_value

        # Parse into structured data
        structured_value = parse_spec_value(cleaned_value, canonical_name)

        # Handle duplicate field names (take the most complete one)
        if canonical_name in normalized_specs:
            existing = normalized_specs[canonical_name]
            # Prefer structured data over raw string
            if isinstance(structured_value, dict) and not isinstance(existing, dict):
                normalized_specs[canonical_name] = structured_value
            elif isinstance(existing, dict) and not isinstance(structured_value, dict):
                pass  # Keep existing structured data
            elif isinstance(structured_value, dict) and isinstance(existing, dict):
                # Merge structured data
                merged = existing.copy()
                merged.update(structured_value)
                normalized_specs[canonical_name] = merged
            else:
                # Both strings - keep longer one
                if len(str(structured_value)) > len(str(existing)):
                    normalized_specs[canonical_name] = structured_value
        else:
            normalized_specs[canonical_name] = structured_value

    variant['specs'] = normalized_specs
    variant['specs_normalized'] = True

    return variant


def normalize_product_list(products: List[Dict]) -> List[Dict]:
    """
    Normalize a list of products: deduplicate, clean, standardize.
    """
    # First pass: normalize each product
    normalized = [normalize_product(p) for p in products]

    # Second pass: deduplicate
    deduplicated = deduplicate_products(normalized)

    return deduplicated


# =============================================================================
# EXPORT HELPERS
# =============================================================================

def flatten_variant_for_csv(product: Dict, variant: Dict) -> Dict:
    """
    Flatten a variant for CSV export with normalized field names.
    """
    row = {
        'product_id': product.get('product_id', ''),
        'product_url': product.get('url', ''),
        'region': product.get('region', ''),
        'category': product.get('category', ''),
        'subcategory': product.get('subcategory', ''),
        'series': product.get('series', ''),
        'product_name': product.get('name', ''),
        'canonical_key': product.get('canonical_key', ''),
        'variant_id': variant.get('variant_id', ''),
        'variant_name': variant.get('name', ''),
    }

    # Add specs with normalized names
    for spec_name, spec_value in variant.get('specs', {}).items():
        if isinstance(spec_value, dict):
            # Structured data - add as JSON string for CSV
            import json
            row[spec_name] = json.dumps(spec_value, ensure_ascii=False)
        else:
            row[spec_name] = spec_value

    return row


# =============================================================================
# USAGE EXAMPLE
# =============================================================================

if __name__ == '__main__':
    # Test the normalization
    test_specs = {
        'processor': 'Intel® Core™ Ultra 7 Processor 155H 1.4 GHz (24MB Cache, up to 4.8 GHz, 16 cores)...Intel® Core™ Ultra 5 Processor 125H 1.2 GHz (18MB Cache, up to 4.5 GHz, 14 cores)',
        'memory': '16GB LPDDR5X on board...32GB LPDDR5X on board',
        'storage': '1TB M.2 NVMe™ PCIe® 4.0 SSD + 100GB Cloud Storage...512GB M.2 NVMe™ PCIe® 4.0 SSD + 100GB Cloud Storage',
        'display': '14", 3K (2880 x 1800) OLED 16:10...14", 2.8K (2880 x 1800) OLED 16:10',
        'keyboard_touchpad': 'Backlit chiclet keyboard with 1.4mm travel',
        'keyboard_and_touchpad': 'Backlit keyboard with Copilot key',
        'included_in_box': 'Laptop, Power adapter, Documentation',
        'included_in_the_box_optional': 'Laptop, 65W USB-C adapter, Sleeve',
    }

    print("=== Testing Spec Parsing ===")
    for field, value in test_specs.items():
        print(f"\nField: {field}")
        print(f"  Raw: {value[:100]}...")
        canonical = standardize_field_name(field)
        print(f"  Canonical: {canonical}")
        parsed = parse_spec_value(value, canonical)
        print(f"  Parsed: {parsed}")

    print("\n=== Testing URL Canonicalization ===")
    test_urls = [
        'https://www.asus.com/in/laptops/for-home/vivobook/asus-vivobook-s16-s3607/',
        'https://www.asus.com/in/laptops/for-home/vivobook/asus-vivobook-s16-s3607',
        'https://www.asus.com/IN/LAPTOPS/FOR-HOME/VIVOBOOK/ASUS-VIVOBOOK-S16-S3607/',
    ]
    for url in test_urls:
        print(f"  {url} -> {canonicalize_url(url)}")

    print("\n=== Testing Deduplication ===")
    test_products = [
        {'url': 'https://www.asus.com/in/laptops/for-home/vivobook/asus-vivobook-s16-s3607/', 'name': 'ASUS Vivobook S16 S3607', 'variants': [{'name': 'S3607VA', 'specs': {'processor': 'Intel...'}}]},
        {'url': 'https://www.asus.com/in/laptops/for-home/vivobook/asus-vivobook-s16-s3607', 'name': 'ASUS Vivobook S16 S3607', 'variants': [{'name': 'S3607VA', 'specs': {'processor': 'Intel...'}}, {'name': 'S3607CA', 'specs': {'processor': 'AMD...'}}]},
    ]
    deduped = deduplicate_products(test_products)
    print(f"  Input: {len(test_products)} products")
    print(f"  Output: {len(deduped)} products")