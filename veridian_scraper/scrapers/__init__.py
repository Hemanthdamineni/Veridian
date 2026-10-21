"""
Veridian Scraper Package

All manufacturer scrapers for laptop data collection.
"""

from .base import BaseScraper, HTTPClient, ScrapingProgress
from .asus import AsusScraper
from .lenovo import LenovoScraper
from .hp import HPScraper
from .dell import DellScraper
from .acer import AcerScraper
from .msi import MsiScraper
from .apple import AppleScraper
from .samsung import SamsungScraper
from .microsoft import MicrosoftScraper
from .lg import LGScraper

# Backwards-compatible aliases (class names are HPScraper/LGScraper).
HpScraper = HPScraper
LgScraper = LGScraper
from .razer import RazerScraper
from .framework import FrameworkScraper
from .gigabyte import GigabyteScraper

__all__ = [
    "BaseScraper",
    "HTTPClient",
    "ScrapingProgress",
    "AsusScraper",
    "LenovoScraper",
    "HpScraper",
    "DellScraper",
    "AcerScraper",
    "MsiScraper",
    "AppleScraper",
    "SamsungScraper",
    "MicrosoftScraper",
    "LgScraper",
    "RazerScraper",
    "FrameworkScraper",
    "GigabyteScraper",
]

# Registry for easy lookup
SCRAPER_REGISTRY = {
    "asus": AsusScraper,
    "lenovo": LenovoScraper,
    "hp": HpScraper,
    "dell": DellScraper,
    "acer": AcerScraper,
    "msi": MsiScraper,
    "apple": AppleScraper,
    "samsung": SamsungScraper,
    "microsoft": MicrosoftScraper,
    "lg": LgScraper,
    "razer": RazerScraper,
    "framework": FrameworkScraper,
    "gigabyte": GigabyteScraper,
}


def get_scraper(manufacturer: str) -> type[BaseScraper]:
    """Get scraper class by manufacturer name."""
    manufacturer = manufacturer.lower()
    if manufacturer not in SCRAPER_REGISTRY:
        raise ValueError(
            f"Unknown manufacturer: {manufacturer}. "
            f"Available: {', '.join(SCRAPER_REGISTRY.keys())}"
        )
    return SCRAPER_REGISTRY[manufacturer]
