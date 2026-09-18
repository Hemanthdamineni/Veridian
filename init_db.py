"""
Veridian - Database Initialization and Setup
"""

import os
import sys
from pathlib import Path

# Add project root to path
sys.path.insert(0, str(Path(__file__).parent))

from veridian_db import create_all_tables
from veridian_db.models import Base, Brand, Category, Region
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker


def init_database(db_url: str = 'sqlite:///veridian.db'):
    """Initialize the database with tables and seed data"""
    print(f"Initializing database: {db_url}")

    engine = create_engine(db_url, echo=True)
    create_all_tables(engine)

    Session = sessionmaker(bind=engine)
    session = Session()

    # Seed regions
    regions_data = [
        {'code': 'us', 'name': 'United States', 'currency': 'USD', 'language': 'en'},
        {'code': 'in', 'name': 'India', 'currency': 'INR', 'language': 'en'},
        {'code': 'uk', 'name': 'United Kingdom', 'currency': 'GBP', 'language': 'en'},
        {'code': 'de', 'name': 'Germany', 'currency': 'EUR', 'language': 'de'},
        {'code': 'fr', 'name': 'France', 'currency': 'EUR', 'language': 'fr'},
        {'code': 'jp', 'name': 'Japan', 'currency': 'JPY', 'language': 'ja'},
        {'code': 'cn', 'name': 'China', 'currency': 'CNY', 'language': 'zh'},
        {'code': 'au', 'name': 'Australia', 'currency': 'AUD', 'language': 'en'},
        {'code': 'ca', 'name': 'Canada', 'currency': 'CAD', 'language': 'en'},
        {'code': 'sg', 'name': 'Singapore', 'currency': 'SGD', 'language': 'en'},
    ]

    for rdata in regions_data:
        region = session.query(Region).filter(Region.code == rdata['code']).first()
        if not region:
            region = Region(**rdata)
            session.add(region)

    # Seed categories
    categories_data = [
        {'name': 'Laptops', 'slug': 'laptops'},
        {'name': 'Desktops', 'slug': 'desktops'},
        {'name': 'Monitors', 'slug': 'monitors'},
        {'name': 'Tablets', 'slug': 'tablets'},
        {'name': 'Phones', 'slug': 'phones'},
        {'name': 'Servers', 'slug': 'servers'},
        {'name': 'Components', 'slug': 'components'},
        {'name': 'Accessories', 'slug': 'accessories'},
    ]

    for cdata in categories_data:
        cat = session.query(Category).filter(Category.slug == cdata['slug']).first()
        if not cat:
            cat = Category(**cdata)
            session.add(cat)

    session.commit()
    print("Database initialized with seed data!")
    session.close()


def reset_database(db_url: str = 'sqlite:///veridian.db'):
    """Drop and recreate all tables"""
    print(f"Resetting database: {db_url}")
    engine = create_engine(db_url, echo=True)
    Base.metadata.drop_all(engine)
    create_all_tables(engine)
    print("Database reset complete!")


if __name__ == '__main__':
    import argparse

    parser = argparse.ArgumentParser(description='Veridian Database Management')
    parser.add_argument('--db-url', default='sqlite:///veridian.db', help='Database URL')
    parser.add_argument('--reset', action='store_true', help='Reset database (drop all tables)')
    parser.add_argument('--init', action='store_true', help='Initialize database (create tables + seed)')

    args = parser.parse_args()

    if args.reset:
        reset_database(args.db_url)
    elif args.init:
        init_database(args.db_url)
    else:
        init_database(args.db_url)