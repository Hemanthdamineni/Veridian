#!/usr/bin/env python3
"""
Normalize and export scraped ASUS data
Run after scraping to clean and deduplicate the data
"""

import json
import sys
from pathlib import Path
from datetime import datetime

# Add the current directory to path
sys.path.insert(0, str(Path(__file__).parent))

from data_normalizer import (
    normalize_product_list,
    flatten_variant_for_csv,
    canonicalize_url,
)


def normalize_region_data(region_dir: Path) -> dict:
    """
    Normalize all data files in a region directory.
    """
    # Find the largest valid JSON file (not empty, not already normalized)
    json_files = list(region_dir.glob('asus_products_*.json'))
    if not json_files:
        return {'error': f'No JSON files found in {region_dir}'}

    # Filter out empty files (size < 100 bytes = likely empty array) and already normalized files
    valid_files = [f for f in json_files if f.stat().st_size > 100 and '_normalized_' not in f.name]
    if not valid_files:
        return {'error': f'No valid JSON files found in {region_dir}'}

    # Get the largest file (most data)
    latest_file = max(valid_files, key=lambda f: f.stat().st_size)

    with open(latest_file, 'r', encoding='utf-8') as f:
        data = json.load(f)

    print(f"Processing {latest_file.name}: {len(data)} products")

    # Normalize
    normalized = normalize_product_list(data)

    print(f"  After normalization: {len(normalized)} products")
    variants = sum(len(p['variants']) for p in normalized)
    print(f"  Total variants: {variants}")

    # Export normalized JSON
    timestamp = datetime.now().strftime('%Y%m%d_%H%M%S')
    output_json = region_dir / f"asus_products_{region_dir.name}_normalized_{timestamp}.json"

    with open(output_json, 'w', encoding='utf-8') as f:
        json.dump(normalized, f, indent=2, ensure_ascii=False)

    print(f"  Exported normalized JSON to {output_json}")

    # Export normalized CSV
    rows = []
    for product in normalized:
        for variant in product['variants']:
            rows.append(flatten_variant_for_csv(product, variant))

    if rows:
        # Get all unique columns
        all_columns = set()
        for row in rows:
            all_columns.update(row.keys())

        # Sort columns logically
        priority_cols = [
            'product_id', 'product_url', 'region', 'category', 'subcategory', 'series',
            'product_name', 'canonical_key', 'variant_id', 'variant_name',
            'processor', 'memory', 'storage', 'display', 'graphics', 'battery',
            'weight', 'dimensions', 'color', 'operating_system', 'chipset',
            'network', 'wireless', 'bluetooth', 'io_ports', 'front_io_ports', 'rear_io_ports',
            'audio', 'camera', 'security', 'keyboard_and_touchpad', 'power_supply',
            'form_factor', 'model', 'expansion_slots', 'interface', 'software',
            'built_in_apps', 'subscription_offers', 'microsoft_office',
            'military_grade', 'ecolabels', 'sustainable_material', 'disclaimer',
            'note', 'myasus_features', 'myexpert_features', 'xbox_game_pass',
            'neural_processor', 'rf_distance', 'tracking', 'switch', 'button',
            'key_style', 'sensor', 'operating_temperature', 'battery_life', 'battery_type',
            'resolution', 'wireless_data_network', 'ecolabels_compliances'
        ]
        other_cols = sorted(all_columns - set(priority_cols))
        columns = [c for c in priority_cols if c in all_columns] + other_cols

        output_csv = region_dir / f"asus_products_{region_dir.name}_normalized_{timestamp}.csv"
        import csv
        with open(output_csv, 'w', newline='', encoding='utf-8') as f:
            writer = csv.DictWriter(f, fieldnames=columns, extrasaction='ignore')
            writer.writeheader()
            writer.writerows(rows)

        print(f"  Exported normalized CSV to {output_csv}")

    return {
        'region': region_dir.name,
        'original_products': len(data),
        'normalized_products': len(normalized),
        'variants': variants,
        'json_output': str(output_json),
        'csv_output': str(output_csv) if rows else None,
    }


def main():
    output_root = Path(__file__).parent / 'output'

    if not output_root.exists():
        print(f"Output directory not found: {output_root}")
        return 1

    # Process all region directories
    region_dirs = [d for d in output_root.iterdir() if d.is_dir()]

    if not region_dirs:
        print("No region directories found")
        return 1

    results = []
    for region_dir in sorted(region_dirs):
        print(f"\n{'='*60}")
        print(f"Processing region: {region_dir.name}")
        print(f"{'='*60}")
        result = normalize_region_data(region_dir)
        if 'error' not in result:
            results.append(result)
        else:
            print(f"  SKIPPED: {result['error']}")

    # Summary
    print(f"\n{'='*60}")
    print("SUMMARY")
    print(f"{'='*60}")
    total_original = 0
    total_normalized = 0
    total_variants = 0

    for r in results:
        print(f"  {r['region']}: {r['original_products']} -> {r['normalized_products']} products, {r['variants']} variants")
        total_original += r['original_products']
        total_normalized += r['normalized_products']
        total_variants += r['variants']

    if total_original > 0:
        print(f"\n  TOTAL: {total_original} -> {total_normalized} products, {total_variants} variants")
        print(f"  Deduplication rate: {((total_original - total_normalized) / total_original * 100):.1f}%")
    else:
        print("\n  No data processed")

    return 0


if __name__ == '__main__':
    sys.exit(main())