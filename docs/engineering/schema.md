# Veridian Production Schema

This document defines the PostgreSQL schema for the Veridian production system, extending the MVP (Part A) to the full product vision (Part B).

## 1. Core Catalog Tables

### `manufacturers`
| Column | Type | Notes |
|---|---|---|
| id | uuid, PK | |
| name | text, NOT NULL | e.g., "ASUS" |
| slug | text, UNIQUE, NOT NULL | |
| country | text | HQ country |
| website_url | text | |
| created_at | timestamptz | DEFAULT NOW() |

### `product_categories`
Supports multi-category expansion (Laptops, Phones, Monitors, etc.).
| Column | Type | Notes |
|---|---|---|
| id | uuid, PK | |
| name | text, NOT NULL | e.g., "Ultrabooks" |
| slug | text, UNIQUE, NOT NULL | |
| parent_category_id | uuid, FK | Self-referencing for hierarchy |

### `series`
| Column | Type | Notes |
|---|---|---|
| id | uuid, PK | |
| manufacturer_id | uuid, FK | |
| category_id | uuid, FK | Links series to a category |
| name | text, NOT NULL | e.g., "Zenbook" |
| slug | text, NOT NULL | UNIQUE(manufacturer_id, slug) |

### `models`
| Column | Type | Notes |
|---|---|---|
| id | uuid, PK | |
| series_id | uuid, FK | |
| name | text, NOT NULL | |
| launch_date | date | |
| discontinued | boolean | DEFAULT false |
| successor_model_id | uuid, FK | Self-referencing |
| predecessor_model_id | uuid, FK | Self-referencing |

### `skus`
The primary filterable entity.
| Column | Type | Notes |
|---|---|---|
| id | uuid, PK | |
| model_id | uuid, FK | |
| sku_code | text, UNIQUE, NOT NULL | Manufacturer part number |
| cpu_id | uuid, FK | Reference to canonical `components` |
| gpu_id | uuid, FK | Reference to canonical `components` |
| ram_gb | int | |
| storage_gb | int | |
| display_size_in | numeric(3,1) | |
| weight_kg | numeric(4,2) | |
| battery_wh | numeric(5,1) | |
| specs_jsonb | jsonb | Category-specific fields (e.g., refresh_hz for laptops) |

## 2. Pricing & Ingestion Tables

### `sellers`
| Column | Type | Notes |
|---|---|---|
| id | uuid, PK | |
| name | text, NOT NULL | e.g., "Amazon India" |
| region | text, NOT NULL | e.g., "IN" |
| scrape_method | text | 'api' or 'scraper' |

### `retailer_listings`
Raw rows from scrapers.
| Column | Type | Notes |
|---|---|---|
| id | uuid, PK | |
| seller_id | uuid, FK | |
| retailer_sku_string | text, NOT NULL | |
| resolved_sku_id | uuid, FK | Nullable until matched |
| match_confidence | numeric(3,2) | |
| verified_by_human | boolean | DEFAULT false |

### `price_history`
Append-only price log.
| Column | Type | Notes |
|---|---|---|
| id | uuid, PK | |
| retailer_listing_id | uuid, FK | |
| price | numeric(10,2) | |
| currency | text | |
| scraped_at | timestamptz | NOT NULL |

### `price_rollups`
Materialized nightly.
| Column | Type | Notes |
|---|---|---|
| sku_id | uuid, FK | |
| seller_id | uuid, FK | |
| lowest_ever | numeric(10,2) | |
| current_price | numeric(10,2) | |
| avg_30d | numeric(10,2) | |

## 3. Provenance & Community Tables

### `field_provenance`
Tracks the source of every data point.
| Column | Type | Notes |
|---|---|---|
| id | uuid, PK | |
| entity_type | text | e.g., 'sku' |
| entity_id | uuid | |
| field_name | text | e.g., 'ram_gb' |
| source_url | text | |
| observed_at | timestamptz | |
| confidence | numeric(3,2) | |

### `users`
| Column | Type | Notes |
|---|---|---|
| id | uuid, PK | |
| email | text, UNIQUE | |
| reputation_score | int | DEFAULT 0 |

### `alerts`
| Column | Type | Notes |
|---|---|---|
| id | uuid, PK | |
| user_id | uuid, FK | |
| sku_id | uuid, FK | |
| threshold_value | numeric(10,2) | |
| channel | text | 'email', 'telegram', 'discord' |

## 4. Indexing Strategy
- **B-tree**: On all foreign keys and `sku_code`.
- **GIN**: On `specs_jsonb` for flexible filtering.
- **Trigram**: On `skus.sku_code` and `models.name` for identity resolution.
