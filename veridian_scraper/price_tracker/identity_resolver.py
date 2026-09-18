"""
Identity Resolution Pipeline

Resolves retailer product listings to canonical SKUs using:
1. String normalization
2. SKU-like token extraction
3. Trigram similarity matching (pg_trgm)
4. Confidence thresholding

Based on Veridian-spec.md B.3
"""

import re
import logging
from dataclasses import dataclass
from typing import List, Optional, Tuple
from difflib import SequenceMatcher


@dataclass
class MatchResult:
    """Result of identity resolution."""
    retailer_sku_string: str
    resolved_sku_id: Optional[str]
    match_confidence: float
    match_method: str  # "exact", "trigram", "fuzzy", "manual"
    verified_by_human: bool = False


class IdentityResolver:
    """
    Resolves retailer product listings to canonical SKUs.

    Uses a multi-step approach:
    1. Normalize the retailer string
    2. Extract SKU-like tokens
    3. Match against known SKUs using similarity
    4. Apply confidence thresholds
    """

    # Confidence thresholds (from spec B.3)
    AUTO_MATCH_THRESHOLD = 0.6      # Auto-match if >= 0.6
    MANUAL_REVIEW_MIN = 0.3         # Flag for review if 0.3-0.6
    REJECT_THRESHOLD = 0.3          # Reject if < 0.3

    def __init__(self, canonical_skus: List[dict]):
        """
        Initialize with canonical SKU data.

        Args:
            canonical_skus: List of dicts with 'id', 'sku_code', 'name', 'brand'
        """
        self.canonical_skus = canonical_skus
        self.logger = logging.getLogger(__name__)
        self._cache: dict = {}  # Cache for resolved strings

    def resolve(self, retailer_sku_string: str) -> MatchResult:
        """
        Resolve a retailer product string to a canonical SKU.

        Args:
            retailer_sku_string: The retailer's product name/SKU string

        Returns:
            MatchResult with resolution details
        """
        # Check cache first
        if retailer_sku_string in self._cache:
            return self._cache[retailer_sku_string]

        # Step 1: Normalize
        normalized = self._normalize(retailer_sku_string)

        # Step 2: Extract SKU-like tokens
        tokens = self._extract_sku_tokens(normalized)

        # Step 3: Try exact match first
        exact_match = self._try_exact_match(tokens, normalized)
        if exact_match:
            result = MatchResult(
                retailer_sku_string=retailer_sku_string,
                resolved_sku_id=exact_match[0],
                match_confidence=1.0,
                match_method="exact"
            )
            self._cache[retailer_sku_string] = result
            return result

        # Step 4: Fuzzy match using similarity
        fuzzy_match = self._try_fuzzy_match(normalized)
        if fuzzy_match:
            sku_id, confidence = fuzzy_match
            if confidence >= self.AUTO_MATCH_THRESHOLD:
                result = MatchResult(
                    retailer_sku_string=retailer_sku_string,
                    resolved_sku_id=sku_id,
                    match_confidence=confidence,
                    match_method="fuzzy"
                )
            elif confidence >= self.MANUAL_REVIEW_MIN:
                result = MatchResult(
                    retailer_sku_string=retailer_sku_string,
                    resolved_sku_id=sku_id,
                    match_confidence=confidence,
                    match_method="fuzzy"
                )
            else:
                result = MatchResult(
                    retailer_sku_string=retailer_sku_string,
                    resolved_sku_id=None,
                    match_confidence=confidence,
                    match_method="fuzzy"
                )
            self._cache[retailer_sku_string] = result
            return result

        # No match found
        result = MatchResult(
            retailer_sku_string=retailer_sku_string,
            resolved_sku_id=None,
            match_confidence=0.0,
            match_method="none"
        )
        self._cache[retailer_sku_string] = result
        return result

    def resolve_batch(self, retailer_strings: List[str]) -> List[MatchResult]:
        """Resolve multiple retailer strings."""
        return [self.resolve(s) for s in retailer_strings]

    def _normalize(self, text: str) -> str:
        """
        Normalize a retailer product string.

        - Lowercase
        - Strip whitespace
        - Remove common retailer boilerplate
        - Normalize punctuation
        """
        # Lowercase
        text = text.lower().strip()

        # Remove common boilerplate
        boilerplate = [
            r'\blaptop\b', r'\bnotebook\b', r'\bpc\b',
            r'\bgaming\b', r'\bnew\b', r'\bsale\b',
            r'\bfree shipping\b', r'\bbest seller\b',
            r'\bamazon choice\b', r'\b\'s choice\b',
        ]
        for pattern in boilerplate:
            text = re.sub(pattern, '', text, flags=re.IGNORECASE)

        # Normalize whitespace
        text = re.sub(r'\s+', ' ', text).strip()

        # Remove special characters but keep alphanumeric, spaces, hyphens
        text = re.sub(r'[^\w\s-]', ' ', text)
        text = re.sub(r'\s+', ' ', text).strip()

        return text

    def _extract_sku_tokens(self, text: str) -> List[str]:
        """
        Extract SKU-like tokens from text.

        Looks for patterns like:
        - 2+ letters followed by 4+ digits (e.g., "UX3407")
        - Alphanumeric codes with hyphens (e.g., "UX3407QA-QD123WS")
        """
        tokens = []

        # Pattern 1: Standard manufacturer SKU patterns
        # e.g., UX3407QA, 21KC000UUS, 9G1D5UA
        sku_patterns = [
            r'\b[A-Z]{2,4}\d{3,5}[A-Z]{0,4}\b',  # ASUS, Lenovo style
            r'\b\d{4,5}[A-Z]{2,4}\b',              # Dell style
            r'\b[A-Z]{1,2}\d{3,4}[A-Z]{0,2}\b',    # HP style
        ]

        for pattern in sku_patterns:
            matches = re.findall(pattern, text.upper())
            tokens.extend(matches)

        # Pattern 2: Hyphenated codes
        hyphen_pattern = r'\b[A-Z0-9]+-[A-Z0-9]+\b'
        hyphen_matches = re.findall(hyphen_pattern, text.upper())
        tokens.extend(hyphen_matches)

        return list(set(tokens))

    def _try_exact_match(self, tokens: List[str], normalized: str) -> Optional[Tuple[str, float]]:
        """Try to find an exact match using SKU tokens."""
        for token in tokens:
            for sku in self.canonical_skus:
                sku_code = sku.get('sku_code', '').upper()
                if token in sku_code or sku_code in token:
                    return (sku['id'], 1.0)
        return None

    def _try_fuzzy_match(self, normalized: str) -> Optional[Tuple[str, float]]:
        """Try fuzzy matching against canonical SKU names and codes."""
        best_match = None
        best_score = 0.0

        for sku in self.canonical_skus:
            # Match against SKU code
            sku_code = sku.get('sku_code', '').lower()
            code_score = SequenceMatcher(None, normalized, sku_code).ratio()

            # Match against product name
            name = sku.get('name', '').lower()
            name_score = SequenceMatcher(None, normalized, name).ratio()

            # Use the higher score
            score = max(code_score, name_score)

            if score > best_score:
                best_score = score
                best_match = sku['id']

        if best_match and best_score >= self.MANUAL_REVIEW_MIN:
            return (best_match, best_score)

        return None

    def get_manual_review_queue(self, retailer_strings: List[str]) -> List[MatchResult]:
        """Get items that need manual review (confidence 0.3-0.6)."""
        results = self.resolve_batch(retailer_strings)
        return [
            r for r in results
            if r.match_confidence >= self.MANUAL_REVIEW_MIN
            and r.match_confidence < self.AUTO_MATCH_THRESHOLD
        ]

    def get_unresolved(self, retailer_strings: List[str]) -> List[MatchResult]:
        """Get items that couldn't be resolved (confidence < 0.3)."""
        results = self.resolve_batch(retailer_strings)
        return [r for r in results if r.resolved_sku_id is None]
