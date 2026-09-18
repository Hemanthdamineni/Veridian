"""
Veridian - Unified Multi-Manufacturer Scraper Runner
"""

import asyncio
import sys
import os
from typing import List, Dict, Any, Optional
from datetime import datetime
from pathlib import Path

# Add project root to path
sys.path.insert(0, str(Path(__file__).parent.parent))

# Import all scrapers
from veridian_scraper.scrapers.asus import run_asus_scraper
from veridian_scraper.scrapers.lenovo import run_lenovo_scraper
from veridian_scraper.scrapers.hp import run_hp_scraper
from veridian_scraper.scrapers.dell import run_dell_scraper
from veridian_scraper.scrapers.acer import run_acer_scraper
from veridian_scraper.scrapers.msi import run_msi_scraper
from veridian_scraper.scrapers.apple import run_apple_scraper
from veridian_scraper.scrapers.samsung import run_samsung_scraper
from veridian_scraper.scrapers.microsoft import run_microsoft_scraper
from veridian_scraper.scrapers.lg import run_lg_scraper
from veridian_scraper.scrapers.razer import run_razer_scraper
from veridian_scraper.scrapers.framework import run_framework_scraper
from veridian_scraper.scrapers.gigabyte import run_gigabyte_scraper

# Import database
from veridian_db import create_all_tables, normalize_scraped_data
from veridian_db.models import Base
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

# Scraper registry
SCRAPERS = {
    'asus': run_asus_scraper,
    'lenovo': run_lenovo_scraper,
    'hp': run_hp_scraper,
    'dell': run_dell_scraper,
    'acer': run_acer_scraper,
    'msi': run_msi_scraper,
    'apple': run_apple_scraper,
    'samsung': run_samsung_scraper,
    'microsoft': run_microsoft_scraper,
    'lg': run_lg_scraper,
    'razer': run_razer_scraper,
    'framework': run_framework_scraper,
    'gigabyte': run_gigabyte_scraper,
}

TIER_1 = ['asus', 'lenovo', 'hp', 'dell', 'acer', 'msi', 'apple']
TIER_2 = ['samsung', 'microsoft', 'lg', 'razer', 'framework', 'gigabyte']


async def run_scraper(
    name: str,
    regions: List[str] = None,
    exclusion_list: Optional[set] = None
) -> List:
    """Run a single scraper and return products

    Args:
        name: Manufacturer name
        regions: List of region codes to scrape
        exclusion_list: Set of URLs to skip
    """
    if name not in SCRAPERS:
        print(f"Unknown scraper: {name}")
        return []

    print(f"\n{'='*60}")
    print(f"Running {name.upper()} scraper...")
    print(f"{'='*60}")

    try:
        # Pass exclusion list if scraper supports it
        import inspect
        scraper_sig = inspect.signature(SCRAPERS[name])
        if 'exclusion_list' in scraper_sig.parameters:
            products = await SCRAPERS[name](regions, exclusion_list=exclusion_list)
        else:
            products = await SCRAPERS[name](regions)
        print(f"✓ {name}: {len(products)} products scraped")
        return products
    except Exception as e:
        print(f"✗ {name} failed: {e}")
        import traceback
        traceback.print_exc()
        return []


async def run_all_scrapers(
    manufacturers: List[str] = None,
    regions: List[str] = None,
    tier: str = 'all',
    save_to_db: bool = True,
    db_url: str = 'sqlite:///veridian.db',
    exclusion_list: Optional[set] = None
) -> Dict[str, List]:
    """Run multiple scrapers

    Args:
        exclusion_list: Set of URLs to skip (for incremental updates)
    """

    if manufacturers:
        targets = manufacturers
    elif tier == 'tier1':
        targets = TIER_1
    elif tier == 'tier2':
        targets = TIER_2
    else:
        targets = TIER_1 + TIER_2

    print(f"Target manufacturers: {targets}")
    print(f"Regions: {regions or 'all'}")
    print(f"Save to DB: {save_to_db}")
    if exclusion_list:
        print(f"Exclusion list: {len(exclusion_list)} URLs to skip")

    # Setup database if needed
    session = None
    if save_to_db:
        engine = create_engine(db_url, echo=False)
        create_all_tables(engine)
        Session = sessionmaker(bind=engine)
        session = Session()

    all_results = {}

    for name in targets:
        products = await run_scraper(name, regions, exclusion_list)
        all_results[name] = products

        # Normalize and save to database
        if save_to_db and products:
            try:
                for region in (regions or ['us']):
                    normalize_scraped_data(products, session, region_code=region)
                print(f"  → Saved to database")
            except Exception as e:
                print(f"  → DB save failed: {e}")
                session.rollback()

    if session:
        session.close()

    # Summary
    print(f"\n{'='*60}")
    print("SCRAPING SUMMARY")
    print(f"{'='*60}")
    total = 0
    for name, products in all_results.items():
        count = len(products)
        total += count
        print(f"  {name:15s}: {count:4d} products")
    print(f"  {'TOTAL':15s}: {total:4d} products")

    return all_results


async def run_incremental_update(
    manufacturers: List[str] = None,
    regions: List[str] = None,
    db_url: str = 'sqlite:///veridian.db',
    max_age_hours: int = 24
):
    """Run incremental update - only scrape products that haven't been seen recently"""
    from veridian_db.models import ScrapedPage, ScraperRun
    from sqlalchemy import create_engine, func
    from sqlalchemy.orm import sessionmaker
    from datetime import timedelta

    engine = create_engine(db_url)
    Session = sessionmaker(bind=engine)
    session = Session()

    # Find recently scraped URLs
    cutoff = datetime.utcnow() - timedelta(hours=max_age_hours)
    recent_urls = set(
        url for (url,) in session.query(ScrapedPage.url).filter(
            ScrapedPage.scraped_at > cutoff,
            ScrapedPage.status_code == 200
        ).all()
    )

    print(f"Found {len(recent_urls)} recently scraped URLs (last {max_age_hours}h)")

    # Pass exclusion list to scrapers
    exclusion_list = recent_urls
    session.close()

    # Run scrapers with exclusion list
    return await run_all_scrapers(
        manufacturers,
        regions,
        save_to_db=True,
        db_url=db_url,
        exclusion_list=exclusion_list
    )


def main():
    """Main entry point"""
    import argparse

    parser = argparse.ArgumentParser(description='Veridian Multi-Manufacturer Scraper')
    parser.add_argument('manufacturers', nargs='*', help='Specific manufacturers to scrape')
    parser.add_argument('--regions', '-r', nargs='+', help='Regions to scrape (e.g., us in uk)')
    parser.add_argument('--tier', choices=['tier1', 'tier2', 'all'], default='all', help='Tier to scrape')
    parser.add_argument('--no-db', action='store_true', help='Do not save to database')
    parser.add_argument('--db-url', default='sqlite:///veridian.db', help='Database URL')
    parser.add_argument('--incremental', action='store_true', help='Run incremental update')

    args = parser.parse_args()

    manufacturers = args.manufacturers if args.manufacturers else None

    if args.incremental:
        asyncio.run(run_incremental_update(manufacturers, args.regions, args.db_url))
    else:
        asyncio.run(run_all_scrapers(
            manufacturers=manufacturers,
            regions=args.regions,
            tier=args.tier,
            save_to_db=not args.no_db,
            db_url=args.db_url
        ))


if __name__ == '__main__':
    main()