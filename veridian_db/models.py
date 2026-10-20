"""
Veridian Database Schema - Product Knowledge Graph
Following the architecture from database-design.md
SQLite-compatible version
"""

from sqlalchemy import (
    Column, Integer, String, Text, DateTime, Float, Boolean, ForeignKey,
    Enum, JSON, UniqueConstraint, Index, Table, BigInteger, CHAR
)
from sqlalchemy.orm import declarative_base, relationship
import uuid
import enum
from datetime import datetime

from .clock import utcnow

# Use SQLite-compatible types
def UUID_COL():
    """SQLite-compatible UUID column (stored as CHAR(36))"""
    return Column(CHAR(36), primary_key=True, default=lambda: str(uuid.uuid4()))

def UUID_FK(table_name: str):
    """SQLite-compatible UUID foreign key"""
    return Column(CHAR(36), ForeignKey(f'{table_name}.id'))

Base = declarative_base()


class ProductCategory(str, enum.Enum):
    LAPTOPS = "laptops"
    DESKTOPS = "desktops"
    MONITORS = "monitors"
    TABLETS = "tablets"
    PHONES = "phones"
    SERVERS = "servers"
    COMPONENTS = "components"
    ACCESSORIES = "accessories"
    UNKNOWN = "unknown"


class ProductStatus(str, enum.Enum):
    CURRENT = "current"
    DISCONTINUED = "discontinued"
    ANNOUNCED = "announced"
    RUMORED = "rumored"
    REFURBISHED = "refurbished"
    UNKNOWN = "unknown"


class SourceType(str, enum.Enum):
    MANUFACTURER = "manufacturer"
    RETAILER = "retailer"
    REVIEW = "review"
    COMMUNITY = "community"
    BENCHMARK = "benchmark"
    MANUAL = "manual"


class VerificationStatus(str, enum.Enum):
    VERIFIED = "verified"
    PENDING = "pending"
    CONFLICTING = "conflicting"
    REJECTED = "rejected"


class ComponentType(str, enum.Enum):
    CPU = "cpu"
    GPU = "gpu"
    NPU = "npu"
    RAM = "ram"
    STORAGE = "storage"
    DISPLAY = "display"
    BATTERY = "battery"
    WIFI = "wifi"
    BLUETOOTH = "bluetooth"
    ETHERNET = "ethernet"
    CAMERA = "camera"
    FINGERPRINT = "fingerprint"
    KEYBOARD = "keyboard"
    TRACKPAD = "trackpad"
    SPEAKER = "speaker"
    MICROPHONE = "microphone"
    PORT = "port"
    POWER_ADAPTER = "power_adapter"
    OS = "os"
    COOLING = "cooling"
    HINGE = "hinge"
    CHASSIS = "chassis"


# ==================== CORE LAYER ====================

class Brand(Base):
    __tablename__ = 'brands'

    id = UUID_COL()
    name = Column(String(100), unique=True, nullable=False, index=True)
    slug = Column(String(100), unique=True, nullable=False, index=True)
    manufacturer_name = Column(String(200))
    website = Column(String(500))
    logo_url = Column(String(500))
    description = Column(Text)
    country = Column(String(100))
    founded_year = Column(Integer)
    is_active = Column(Boolean, default=True)
    created_at = Column(DateTime, default=utcnow)
    updated_at = Column(DateTime, default=utcnow, onupdate=utcnow)


class Category(Base):
    __tablename__ = 'categories'

    id = UUID_COL()
    name = Column(String(100), unique=True, nullable=False)
    slug = Column(String(100), unique=True, nullable=False, index=True)
    parent_id = Column(CHAR(36), ForeignKey('categories.id'), nullable=True)
    description = Column(Text)
    schema_json = Column(JSON)
    display_order = Column(Integer, default=0)
    is_active = Column(Boolean, default=True)
    created_at = Column(DateTime, default=utcnow)

    parent = relationship('Category', remote_side=[id], backref='children', foreign_keys=[parent_id])


class Region(Base):
    __tablename__ = 'regions'

    id = UUID_COL()
    code = Column(String(10), unique=True, nullable=False, index=True)
    name = Column(String(100), nullable=False)
    currency = Column(String(10), nullable=False)
    language = Column(String(10), nullable=False)
    is_active = Column(Boolean, default=True)


class ProductFamily(Base):
    """Product line/family (e.g., 'ThinkPad', 'MacBook Pro', 'XPS')"""
    __tablename__ = 'product_families'

    id = UUID_COL()
    brand_id = UUID_FK('brands')
    category_id = UUID_FK('categories')
    name = Column(String(200), nullable=False, index=True)
    slug = Column(String(200), nullable=False, index=True)
    description = Column(Text)
    marketing_description = Column(Text)
    first_release_date = Column(DateTime)
    is_active = Column(Boolean, default=True)
    created_at = Column(DateTime, default=utcnow)
    updated_at = Column(DateTime, default=utcnow, onupdate=utcnow)

    __table_args__ = (
        UniqueConstraint('brand_id', 'slug', name='uq_family_brand_slug'),
    )

    brand = relationship('Brand', backref='families')
    category = relationship('Category', backref='families')


class ProductModel(Base):
    """Specific model within a family (e.g., 'ThinkPad X1 Carbon Gen 11')"""
    __tablename__ = 'product_models'

    id = UUID_COL()
    family_id = UUID_FK('product_families')
    name = Column(String(300), nullable=False, index=True)
    slug = Column(String(300), nullable=False, index=True)
    generation = Column(String(50))
    release_date = Column(DateTime)
    discontinuation_date = Column(DateTime)
    status = Column(Enum(ProductStatus), default=ProductStatus.CURRENT, index=True)
    description = Column(Text)
    marketing_highlights = Column(JSON)
    target_audience = Column(JSON)
    predecessor_id = Column(CHAR(36), ForeignKey('product_models.id'), nullable=True)
    successor_id = Column(CHAR(36), ForeignKey('product_models.id'), nullable=True)
    created_at = Column(DateTime, default=utcnow)
    updated_at = Column(DateTime, default=utcnow, onupdate=utcnow)

    __table_args__ = (
        UniqueConstraint('family_id', 'slug', name='uq_model_family_slug'),
    )

    family = relationship('ProductFamily', backref='models')
    predecessor = relationship('ProductModel', remote_side=[id], backref='successor_model', foreign_keys=[predecessor_id])
    successor = relationship('ProductModel', remote_side=[id], backref='predecessor_model', foreign_keys=[successor_id])


class ProductVariant(Base):
    """Specific SKU/configuration (e.g., 'ThinkPad X1 Carbon Gen 11 i7-1365U 32GB 1TB')"""
    __tablename__ = 'product_variants'

    id = UUID_COL()
    model_id = UUID_FK('product_models')
    region_id = UUID_FK('regions')
    sku = Column(String(100), nullable=False, index=True)
    part_number = Column(String(100), index=True)
    name = Column(String(500))
    color = Column(String(50))
    launch_price = Column(JSON)
    current_price = Column(JSON)
    release_date = Column(DateTime)
    discontinuation_date = Column(DateTime)
    status = Column(Enum(ProductStatus), default=ProductStatus.CURRENT, index=True)
    is_configurable = Column(Boolean, default=False)
    configuration_options = Column(JSON)
    source_urls = Column(JSON)
    canonical_url = Column(String(1000))
    created_at = Column(DateTime, default=utcnow)
    updated_at = Column(DateTime, default=utcnow, onupdate=utcnow)

    __table_args__ = (
        UniqueConstraint('model_id', 'region_id', 'sku', name='uq_variant_model_region_sku'),
    )

    model = relationship('ProductModel', backref='variants')
    region = relationship('Region', backref='variants')


# ==================== COMPONENT LAYER ====================

class Component(Base):
    """Canonical component entity (e.g., 'Intel Core i7-1365U', 'Samsung 990 Pro 1TB')"""
    __tablename__ = 'components'

    id = UUID_COL()
    type = Column(Enum(ComponentType), nullable=False, index=True)
    manufacturer = Column(String(100), nullable=False, index=True)
    name = Column(String(300), nullable=False, index=True)
    slug = Column(String(300), nullable=False, index=True)
    model_number = Column(String(100), index=True)
    aliases = Column(JSON)
    release_date = Column(DateTime)
    architecture = Column(String(100))
    process_node_nm = Column(Integer)
    tdp_w = Column(Float)
    max_tdp_w = Column(Float)

    # CPU/GPU/NPU specific
    core_count = Column(Integer)
    thread_count = Column(Integer)
    base_clock_ghz = Column(Float)
    boost_clock_ghz = Column(Float)
    cache_mb = Column(Float)

    # Memory specific
    memory_type = Column(String(50), index=True)
    memory_capacity_gb = Column(Integer, index=True)
    memory_speed_mt_s = Column(Integer)
    memory_voltage_v = Column(Float)

    # Storage specific
    storage_type = Column(String(50), index=True)
    storage_capacity_gb = Column(Integer, index=True)
    storage_interface = Column(String(50))
    storage_form_factor = Column(String(50))

    # Display specific
    display_size_mm = Column(Float, index=True)
    display_resolution = Column(String(50))
    display_panel_type = Column(String(50))
    display_refresh_rate = Column(Integer)
    display_brightness_nits = Column(Integer)
    display_contrast_ratio = Column(String(50))
    display_color_gamut = Column(String(50))
    display_is_oled = Column(Boolean)

    # Battery specific
    battery_capacity_wh = Column(Float)
    battery_cells = Column(Integer)
    battery_chemistry = Column(String(50))

    specifications = Column(JSON)
    benchmarks = Column(JSON)
    marketing_description = Column(Text)
    product_page_url = Column(String(1000))
    datasheet_url = Column(String(1000))
    is_active = Column(Boolean, default=True)
    created_at = Column(DateTime, default=utcnow)
    updated_at = Column(DateTime, default=utcnow, onupdate=utcnow)

    __table_args__ = (
        UniqueConstraint('type', 'manufacturer', 'slug', name='uq_component_type_mfr_slug'),
    )


class ComponentRelationship(Base):
    """Relationships between components (replacement, upgrade, same architecture)"""
    __tablename__ = 'component_relationships'

    id = UUID_COL()
    source_id = UUID_FK('components')
    target_id = UUID_FK('components')
    relationship_type = Column(String(50), nullable=False)
    notes = Column(Text)
    created_at = Column(DateTime, default=utcnow)

    __table_args__ = (
        UniqueConstraint('source_id', 'target_id', 'relationship_type', name='uq_comp_rel'),
    )

    source = relationship('Component', foreign_keys=[source_id], backref='outgoing_relationships')
    target = relationship('Component', foreign_keys=[target_id], backref='incoming_relationships')


# ==================== PRODUCT CONFIGURATION LAYER ====================

class ProductConfiguration(Base):
    """How a product variant uses a component (the critical link)"""
    __tablename__ = 'product_configurations'

    id = UUID_COL()
    variant_id = UUID_FK('product_variants')
    component_id = UUID_FK('components')
    component_role = Column(String(50), nullable=False)
    quantity = Column(Integer, default=1)
    configuration = Column(JSON)
    slot_identifier = Column(String(50))
    is_user_upgradeable = Column(Boolean, default=False)
    max_supported = Column(JSON)
    source_urls = Column(JSON)
    confidence = Column(Float, default=1.0)
    verified = Column(Boolean, default=False)
    created_at = Column(DateTime, default=utcnow)
    updated_at = Column(DateTime, default=utcnow, onupdate=utcnow)

    __table_args__ = (
        UniqueConstraint('variant_id', 'component_id', 'slot_identifier', name='uq_config_variant_comp_slot'),
    )

    variant = relationship('ProductVariant', backref='configurations')
    component = relationship('Component', backref='product_configurations')


# ==================== SPECIFICATION LAYER ====================

class NormalizedSpec(Base):
    """Every specification as a normalized, searchable, typed field"""
    __tablename__ = 'normalized_specs'

    id = UUID_COL()
    variant_id = UUID_FK('product_variants')
    component_id = UUID_FK('components')
    spec_category = Column(String(50), nullable=False, index=True)
    spec_name = Column(String(100), nullable=False, index=True)
    spec_value = Column(JSON, nullable=False)
    spec_value_type = Column(String(20))
    raw_text = Column(Text)
    source_url = Column(String(1000))
    confidence = Column(Float, default=1.0)
    verification_status = Column(Enum(VerificationStatus), default=VerificationStatus.PENDING)
    verified_by = Column(String(100))
    verified_at = Column(DateTime)
    notes = Column(Text)
    created_at = Column(DateTime, default=utcnow)
    updated_at = Column(DateTime, default=utcnow, onupdate=utcnow)

    __table_args__ = (
        UniqueConstraint('variant_id', 'spec_category', 'spec_name', name='uq_spec_variant_cat_name'),
    )

    variant = relationship('ProductVariant', backref='normalized_specs')
    component = relationship('Component', backref='normalized_specs')


# ==================== RELATIONSHIP LAYER ====================

class ProductRelationship(Base):
    """Relationships between products"""
    __tablename__ = 'product_relationships'

    id = UUID_COL()
    source_variant_id = UUID_FK('product_variants')
    target_variant_id = UUID_FK('product_variants')
    relationship_type = Column(String(50), nullable=False)
    notes = Column(Text)
    confidence = Column(Float, default=1.0)
    created_at = Column(DateTime, default=utcnow)

    __table_args__ = (
        UniqueConstraint('source_variant_id', 'target_variant_id', 'relationship_type', name='uq_prod_rel'),
    )

    source = relationship('ProductVariant', foreign_keys=[source_variant_id], backref='outgoing_relationships')
    target = relationship('ProductVariant', foreign_keys=[target_variant_id], backref='incoming_relationships')


# ==================== PRICE LAYER ====================

class Seller(Base):
    __tablename__ = 'sellers'

    id = UUID_COL()
    name = Column(String(200), nullable=False, index=True)
    slug = Column(String(100), unique=True, nullable=False)
    website = Column(String(500))
    is_official = Column(Boolean, default=False)
    is_marketplace = Column(Boolean, default=False)
    region_id = UUID_FK('regions')
    affiliate_network = Column(String(100))
    created_at = Column(DateTime, default=utcnow)

    region = relationship('Region', backref='sellers')


class PriceListing(Base):
    __tablename__ = 'price_listings'

    id = UUID_COL()
    variant_id = UUID_FK('product_variants')
    seller_id = UUID_FK('sellers')
    listing_url = Column(String(1000), nullable=False)
    price_amount = Column(Float, nullable=False)
    price_currency = Column(String(10), nullable=False)
    original_price = Column(Float)
    discount_percent = Column(Float)
    availability = Column(String(50))
    shipping_cost = Column(Float)
    shipping_time = Column(String(100))
    condition = Column(String(50), default='new')
    is_affiliate = Column(Boolean, default=False)
    affiliate_commission = Column(Float)
    first_seen = Column(DateTime, default=utcnow, index=True)
    last_seen = Column(DateTime, default=utcnow, onupdate=utcnow)
    is_active = Column(Boolean, default=True, index=True)
    raw_data = Column(JSON)

    variant = relationship('ProductVariant', backref='price_listings')
    seller = relationship('Seller', backref='listings')


class PriceHistory(Base):
    """Every price change is recorded - never overwrite"""
    __tablename__ = 'price_history'

    id = UUID_COL()
    listing_id = UUID_FK('price_listings')
    price_amount = Column(Float, nullable=False)
    price_currency = Column(String(10), nullable=False)
    recorded_at = Column(DateTime, default=utcnow, index=True)
    change_type = Column(String(20))

    listing = relationship('PriceListing', backref='history')


# ==================== BENCHMARK LAYER ====================

class BenchmarkDefinition(Base):
    __tablename__ = 'benchmark_definitions'

    id = UUID_COL()
    name = Column(String(100), unique=True, nullable=False)
    slug = Column(String(100), unique=True, nullable=False)
    category = Column(String(50))
    version = Column(String(20))
    description = Column(Text)
    scoring_method = Column(String(50))
    unit = Column(String(50))
    reference_url = Column(String(1000))
    is_active = Column(Boolean, default=True)


class BenchmarkRun(Base):
    """A single benchmark execution"""
    __tablename__ = 'benchmark_runs'

    id = UUID_COL()
    definition_id = UUID_FK('benchmark_definitions')
    variant_id = UUID_FK('product_variants')
    configuration_id = UUID_FK('product_configurations')
    score = Column(Float, nullable=False)
    sub_scores = Column(JSON)
    test_conditions = Column(JSON)
    source_url = Column(String(1000))
    source_type = Column(Enum(SourceType))
    reviewer = Column(String(200))
    date_run = Column(DateTime)
    is_verified = Column(Boolean, default=False)
    notes = Column(Text)
    created_at = Column(DateTime, default=utcnow)

    __table_args__ = (
        UniqueConstraint('definition_id', 'variant_id', 'source_url', name='uq_bench_run'),
    )

    definition = relationship('BenchmarkDefinition', backref='runs')
    variant = relationship('ProductVariant', backref='benchmark_runs')
    configuration = relationship('ProductConfiguration', backref='benchmark_runs')


# ==================== REVIEW LAYER ====================

class Review(Base):
    __tablename__ = 'reviews'

    id = UUID_COL()
    variant_id = UUID_FK('product_variants')
    source_url = Column(String(1000), nullable=False)
    source_type = Column(Enum(SourceType), nullable=False)
    reviewer = Column(String(200))
    publication = Column(String(200))
    title = Column(String(500))
    summary = Column(Text)
    pros = Column(JSON)
    cons = Column(JSON)
    overall_score = Column(Float)
    category_scores = Column(JSON)
    verdict = Column(String(200))
    date_published = Column(DateTime, index=True)
    is_verified = Column(Boolean, default=False)
    confidence = Column(Float, default=1.0)
    language = Column(String(10), default='en')
    created_at = Column(DateTime, default=utcnow)

    __table_args__ = (
        UniqueConstraint('variant_id', 'source_url', name='uq_review'),
    )

    variant = relationship('ProductVariant', backref='reviews')


# ==================== COMMUNITY LAYER ====================

class CommunityReport(Base):
    __tablename__ = 'community_reports'

    id = UUID_COL()
    variant_id = UUID_FK('product_variants')
    reporter_id = Column(String(100), index=True)
    report_type = Column(String(50))
    title = Column(String(300))
    description = Column(Text)
    evidence_urls = Column(JSON)
    evidence_files = Column(JSON)
    status = Column(String(20), default='open')
    votes_up = Column(Integer, default=0)
    votes_down = Column(Integer, default=0)
    moderator_notes = Column(Text)
    created_at = Column(DateTime, default=utcnow)
    resolved_at = Column(DateTime)

    variant = relationship('ProductVariant', backref='community_reports')


# ==================== VALIDATION LAYER ====================

class FieldValidation(Base):
    """Validation metadata for every field"""
    __tablename__ = 'field_validations'

    id = UUID_COL()
    entity_type = Column(String(50), nullable=False, index=True)
    entity_id = Column(CHAR(36), nullable=False, index=True)
    field_name = Column(String(100), nullable=False, index=True)
    value = Column(JSON, nullable=False)
    source_url = Column(String(1000))
    source_type = Column(Enum(SourceType))
    confidence = Column(Float, default=1.0)
    verification_status = Column(Enum(VerificationStatus), default=VerificationStatus.PENDING, index=True)
    verified_by = Column(String(100))
    verified_at = Column(DateTime)
    conflict_details = Column(JSON)
    observed_at = Column(DateTime, default=utcnow)
    collector_version = Column(String(50))
    notes = Column(Text)


# ==================== SEARCH LAYER ====================

class SearchIndex(Base):
    """Pre-computed search index for fast filtering"""
    __tablename__ = 'search_index'

    id = UUID_COL()
    variant_id = UUID_FK('product_variants')
    brand = Column(String(100), index=True)
    family = Column(String(200), index=True)
    model = Column(String(300), index=True)
    category = Column(String(50), index=True)
    series = Column(String(200), index=True)
    region = Column(String(10), index=True)
    status = Column(String(20), index=True)
    price_min = Column(Float, index=True)
    price_max = Column(Float, index=True)
    cpu_manufacturer = Column(String(100), index=True)
    cpu_model = Column(String(200), index=True)
    gpu_manufacturer = Column(String(100), index=True)
    gpu_model = Column(String(200), index=True)
    ram_gb = Column(Integer, index=True)
    storage_gb = Column(Integer, index=True)
    display_size_mm = Column(Float, index=True)
    display_refresh_rate = Column(Integer, index=True)
    display_is_oled = Column(Boolean, index=True)
    battery_wh = Column(Float, index=True)
    weight_kg = Column(Float, index=True)
    thickness_mm = Column(Float, index=True)
    ports = Column(JSON)
    colors = Column(JSON)
    release_year = Column(Integer, index=True)
    updated_at = Column(DateTime, default=utcnow, onupdate=utcnow)

    __table_args__ = (
        Index('ix_search_price_range', 'price_min', 'price_max'),
        Index('ix_search_cpu', 'cpu_manufacturer', 'cpu_model'),
        Index('ix_search_gpu', 'gpu_manufacturer', 'gpu_model'),
        Index('ix_search_display', 'display_size_mm', 'display_refresh_rate', 'display_is_oled'),
    )


# ==================== COMPARISON LAYER ====================

class ComparisonMetric(Base):
    """Derived/computed metrics for comparison"""
    __tablename__ = 'comparison_metrics'

    id = UUID_COL()
    variant_id = UUID_FK('product_variants')
    metric_category = Column(String(50), nullable=False, index=True)
    metric_name = Column(String(100), nullable=False, index=True)
    metric_value = Column(JSON, nullable=False)
    calculation_method = Column(String(200))
    source_data = Column(JSON)
    confidence = Column(Float, default=1.0)
    computed_at = Column(DateTime, default=utcnow)

    __table_args__ = (
        UniqueConstraint('variant_id', 'metric_category', 'metric_name', name='uq_comp_metric'),
    )

    variant = relationship('ProductVariant', backref='comparison_metrics')


# ==================== KNOWLEDGE LAYER ====================

class KnowledgeEntry(Base):
    """Known issues, firmware, drivers, manuals, repair guides"""
    __tablename__ = 'knowledge_entries'

    id = UUID_COL()
    variant_id = UUID_FK('product_variants')
    entry_type = Column(String(50), nullable=False, index=True)
    title = Column(String(300), nullable=False)
    description = Column(Text)
    severity = Column(String(20))
    affected_configurations = Column(JSON)
    workaround = Column(Text)
    fix_version = Column(String(100))
    fix_date = Column(DateTime)
    source_urls = Column(JSON)
    is_verified = Column(Boolean, default=False)
    reported_by = Column(String(100))
    reported_at = Column(DateTime, default=utcnow)
    tags = Column(JSON)


# ==================== AUDIT LAYER ====================

class AuditLog(Base):
    """Complete change history - never lose history"""
    __tablename__ = 'audit_log'

    id = UUID_COL()
    entity_type = Column(String(50), nullable=False, index=True)
    entity_id = Column(CHAR(36), nullable=False, index=True)
    field_name = Column(String(100), nullable=False, index=True)
    old_value = Column(JSON)
    new_value = Column(JSON)
    changed_by = Column(String(100))
    change_reason = Column(Text)
    changed_at = Column(DateTime, default=utcnow, index=True)
    ip_address = Column(String(45))
    user_agent = Column(String(500))

    __table_args__ = (
        Index('ix_audit_entity', 'entity_type', 'entity_id'),
        Index('ix_audit_time', 'changed_at'),
    )


# ==================== ENTITY MATCHING LAYER ====================

class PendingEntity(Base):
    """Entities awaiting review before becoming canonical"""
    __tablename__ = 'pending_entities'

    id = UUID_COL()
    entity_type = Column(String(50), nullable=False, index=True)
    raw_data = Column(JSON, nullable=False)
    normalized_data = Column(JSON)
    matched_entity_id = Column(CHAR(36), nullable=True, index=True)
    match_confidence = Column(Float)
    match_method = Column(String(50))
    status = Column(String(20), default='pending')
    source_url = Column(String(1000))
    source_scraper = Column(String(100))
    reviewer = Column(String(100))
    reviewed_at = Column(DateTime)
    notes = Column(Text)
    created_at = Column(DateTime, default=utcnow, index=True)

    __table_args__ = (
        Index('ix_pending_status', 'status'),
        Index('ix_pending_type_status', 'entity_type', 'status'),
    )


# ==================== MEDIA/DOCUMENT LAYER ====================

class MediaAsset(Base):
    __tablename__ = 'media_assets'

    id = UUID_COL()
    variant_id = UUID_FK('product_variants')
    component_id = UUID_FK('components')
    asset_type = Column(String(50), nullable=False)
    asset_subtype = Column(String(50))
    url = Column(String(1000), nullable=False)
    local_path = Column(String(500))
    filename = Column(String(300))
    mime_type = Column(String(100))
    file_size = Column(BigInteger)
    width = Column(Integer)
    height = Column(Integer)
    duration = Column(Float)
    caption = Column(Text)
    alt_text = Column(String(500))
    is_primary = Column(Boolean, default=False)
    display_order = Column(Integer, default=0)
    source_url = Column(String(1000))
    license = Column(String(100))
    created_at = Column(DateTime, default=utcnow)

    variant = relationship('ProductVariant', backref='media_assets')
    component = relationship('Component', backref='media_assets')


# ==================== SCRAPER TRACKING ====================

class ScraperRun(Base):
    """Track each scraper execution"""
    __tablename__ = 'scraper_runs'

    id = UUID_COL()
    scraper_name = Column(String(100), nullable=False, index=True)
    region_code = Column(String(10), index=True)
    started_at = Column(DateTime, default=utcnow)
    completed_at = Column(DateTime)
    status = Column(String(20), default='running')
    products_discovered = Column(Integer, default=0)
    products_scraped = Column(Integer, default=0)
    products_new = Column(Integer, default=0)
    products_updated = Column(Integer, default=0)
    errors = Column(JSON)
    config_snapshot = Column(JSON)
    created_at = Column(DateTime, default=utcnow)


class ScrapedPage(Base):
    """Track every page scraped for debugging/incremental updates"""
    __tablename__ = 'scraped_pages'

    id = UUID_COL()
    run_id = UUID_FK('scraper_runs')
    url = Column(String(1000), nullable=False, index=True)
    url_hash = Column(CHAR(64), unique=True, nullable=False, index=True)
    page_type = Column(String(50))
    status_code = Column(Integer)
    content_hash = Column(CHAR(64))
    scraped_at = Column(DateTime, default=utcnow)
    response_time_ms = Column(Integer)
    error = Column(Text)

    run = relationship('ScraperRun', backref='pages')


# ==================== HELPER FUNCTIONS ====================

def create_all_tables(engine):
    """Create all tables in the database"""
    Base.metadata.create_all(engine)


def drop_all_tables(engine):
    """Drop all tables"""
    Base.metadata.drop_all(engine)