"""
Veridian Database Package
"""

from .models import *
from .normalizer import *

__all__ = [
    # Models
    'Base',
    'Brand', 'Category', 'Region', 'ProductFamily', 'ProductModel', 'ProductVariant',
    'Component', 'ComponentType', 'ComponentRelationship',
    'ProductConfiguration', 'NormalizedSpec',
    'ProductRelationship', 'Seller', 'PriceListing', 'PriceHistory',
    'BenchmarkDefinition', 'BenchmarkRun', 'Review', 'CommunityReport',
    'FieldValidation', 'SearchIndex', 'ComparisonMetric', 'KnowledgeEntry',
    'MediaAsset', 'AuditLog', 'PendingEntity', 'ScraperRun', 'ScrapedPage',
    'VerificationStatus', 'ProductStatus', 'SourceType',
    # Functions
    'create_all_tables', 'drop_all_tables',
    # Normalizer
    'SpecNormalizer', 'ComponentMatcher', 'DataNormalizer', 'normalize_scraped_data',
    'NormalizedValue',
]