# ASUS India Product Scraper

A comprehensive, production-grade web scraper for extracting all product listings with detailed specifications (RAM, storage, CPU, GPU, display, battery, etc.) from asus.com/in.

## Features

- **Complete Category Discovery** - Automatically discovers all product categories and subcategories
- **Pagination Handling** - Handles multi-page product listings
- **Detailed Spec Extraction** - Extracts all specifications from `/techspec/` pages including multiple variants per product
- **Resumable Checkpoints** - Saves progress automatically, can resume after interruption
- **Multiple Export Formats** - JSON and CSV output with normalized field names
- **Rate Limiting & Retries** - Respectful scraping with configurable delays and exponential backoff
- **Structured Data Models** - Clean dataclasses for products, variants, and specifications
- **Concurrent Scraping** - Configurable concurrency for faster scraping

## Quick Start

```bash
# 1. Install dependencies
pip install -r requirements.txt

# 2. Run the scraper (will scrape all categories)
python scraper.py

# 3. Or scrape specific categories
python scraper.py --categories "https://www.asus.com/in/laptops/for-home/vivobook/"

# 4. Resume from checkpoint
python scraper.py --resume
```

## Output

Results are saved to `./output/` directory:
- `asus_products_YYYYMMDD_HHMMSS.json` - Full structured data
- `asus_products_YYYYMMDD_HHMMSS.csv` - Flattened variant rows for analysis
- `checkpoint.json` - Progress tracking for resumability

## CSV Format

The CSV exports one row per product variant with columns:
- Product metadata: `product_id`, `product_url`, `category`, `subcategory`, `series`, `product_name`
- Variant info: `variant_id`, `variant_name`
- All specifications: `processor`, `memory`, `storage`, `display`, `graphics`, `battery`, `weight`, `dimensions`, `operating_system`, `ports`, `camera`, `audio`, `network`, etc.

## Configuration

Edit `config.yaml` to customize:
- `concurrency`: Parallel requests (default: 3)
- `rate_limit_delay`: Delay between requests in seconds (default: 2.0)
- `checkpoint_interval`: Save progress every N products (default: 50)
- `output_dir`: Output directory
- `categories`: Limit to specific categories (optional)

## Architecture

```
scraper.py
├── Config           # YAML configuration management
├── HTTPClient       # Async HTTP with rate limiting & retries
├── CategoryDiscoverer  # Discovers category/subcategory URLs
├── ProductLister    # Extracts product URLs with pagination
├── SpecExtractor    # Parses techspec pages for detailed specs
├── ProductParser    # Extracts metadata from product URLs
├── DataExporter     # JSON/CSV export with checkpointing
└── ASUSScraper      # Main orchestrator
```

## Spec Fields Extracted

The scraper normalizes these specification fields:
- `model`, `color`, `operating_system`, `processor`, `graphics`, `neural_processor`
- `display`, `memory`, `storage`, `expansion_slots`, `io_ports`
- `keyboard_touchpad`, `camera`, `audio`, `network`, `battery`, `power_supply`
- `weight`, `dimensions`, `built_in_apps`, `myasus_features`
- `subscription_offers`, `microsoft_office`, `military_grade`, `ecolabels`
- `security`, `disclaimer`, `included_in_box`

## Legal Notice

This scraper is for educational and personal use only. Please:
- Respect ASUS's `robots.txt` and Terms of Service
- Use appropriate rate limiting (default 2s delay)
- Don't overload their servers
- Consider using official APIs if available

## Requirements

- Python 3.10+
- httpx, beautifulsoup4, pyyaml, tenacity, lxml

## Example Usage

```python
# Quick test with a single category
async with ASUSScraper('config.yaml') as scraper:
    products = await scraper.run(categories=[
        "https://www.asus.com/in/laptops/for-home/vivobook/"
    ])
    print(f"Scraped {len(products)} products")
```