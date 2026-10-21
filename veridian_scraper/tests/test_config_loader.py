"""
Tests for the YAML configuration loader.

The configuration files in ``veridian_scraper/config`` used to be dead weight:
they were written with a ``manufacturer:`` key while the loader looked for
``manufacturers:``, so every manufacturer silently fell back to an empty
configuration. These tests make sure every file is actually loaded and that
the YAML is authoritative for the values it supplies.
"""

from pathlib import Path

import pytest

from veridian_scraper.scrapers.base import (
    CONFIG_DIR,
    ConfigManager,
    RegionConfig,
    apply_yaml_config,
    get_config_manager,
)

MANUFACTURERS = [
    'acer', 'apple', 'asus', 'dell', 'framework', 'gigabyte', 'hp',
    'lenovo', 'lg', 'microsoft', 'msi', 'razer', 'samsung',
]


def test_config_directory_contains_a_file_for_every_manufacturer():
    files = {path.stem for path in CONFIG_DIR.glob('*.yaml')}
    assert set(MANUFACTURERS).issubset(files)


@pytest.mark.parametrize('manufacturer', MANUFACTURERS)
def test_every_yaml_file_is_loaded_and_the_manufacturer_is_found(manufacturer):
    manager = ConfigManager(str(CONFIG_DIR))
    block = manager.get_manufacturer_config(manufacturer)
    assert block is not None, f"{manufacturer}.yaml was not loaded"
    assert block.get('base_url')
    assert block.get('regions')


@pytest.mark.parametrize('manufacturer', MANUFACTURERS)
def test_every_manufacturer_has_usable_regions(manufacturer):
    manager = ConfigManager(str(CONFIG_DIR))
    regions = manager.get_region_configs(manufacturer)
    assert regions, f"{manufacturer} has no regions"
    for region in regions:
        assert isinstance(region, RegionConfig)
        assert region.code == region.code.lower()
        assert region.base_url.startswith('http')
        assert region.rate_limit > 0
        assert region.timeout > 0


def test_region_config_carries_the_category_paths():
    manager = ConfigManager(str(CONFIG_DIR))
    regions = manager.get_region_configs('asus')
    us = next(r for r in regions if r.code == 'us')
    # The path is relative to the regional base URL, so the listing stays
    # inside the region (https://www.asus.com/us/laptops/).
    assert us.category_paths['laptops'] == 'laptops/'
    assert us.currency == 'USD'


def test_single_manufacturer_document_shape_is_supported(tmp_path):
    path = tmp_path / 'toy.yaml'
    path.write_text(
        "manufacturer: \"toy\"\n"
        "brand: \"Toy\"\n"
        "base_url: \"https://toy.example/\"\n"
        "regions:\n"
        "  - code: \"US\"\n"
        "    name: \"United States\"\n"
        "    base_url: \"https://toy.example/us/\"\n"
        "    rate_limit: 0.25\n"
        "    timeout: 12\n"
    )
    manager = ConfigManager(str(path))
    assert manager.get_manufacturer_config('toy')['brand'] == 'Toy'
    regions = manager.get_region_configs('toy')
    assert len(regions) == 1
    # Region codes are normalised so that "--regions us" keeps working.
    assert regions[0].code == 'us'
    assert regions[0].rate_limit == 0.25
    assert regions[0].timeout == 12


def test_legacy_nested_document_shape_is_supported(tmp_path):
    path = tmp_path / 'legacy.yaml'
    path.write_text(
        "manufacturer:\n"
        "  toy:\n"
        "    brand: \"Toy\"\n"
        "    base_url: \"https://toy.example/\"\n"
        "    regions:\n"
        "      - code: \"us\"\n"
        "        name: \"United States\"\n"
        "        base_url: \"https://toy.example/us/\"\n"
    )
    manager = ConfigManager(str(path))
    assert manager.get_manufacturer_config('toy')['brand'] == 'Toy'
    assert manager.get_region_configs('toy')[0].code == 'us'


def test_manufacturers_mapping_document_shape_is_supported(tmp_path):
    path = tmp_path / 'multi.yaml'
    path.write_text(
        "manufacturers:\n"
        "  toy:\n"
        "    brand: \"Toy\"\n"
        "    base_url: \"https://toy.example/\"\n"
        "    regions:\n"
        "      - code: \"us\"\n"
        "        name: \"United States\"\n"
        "        base_url: \"https://toy.example/us/\"\n"
    )
    manager = ConfigManager(str(path))
    assert manager.get_manufacturer_config('toy')['brand'] == 'Toy'


def test_unknown_manufacturer_returns_nothing():
    manager = ConfigManager(str(CONFIG_DIR))
    assert manager.get_manufacturer_config('nintendo') is None
    assert manager.get_region_configs('nintendo') == []


@pytest.mark.parametrize('manufacturer', MANUFACTURERS)
def test_category_paths_stay_inside_the_region(manufacturer):
    """A leading slash would drop the regional prefix of the base URL.

    That is how the category listings ended up on the global site instead of
    the regional one (and how they 404'd).
    """
    from urllib.parse import urljoin

    manager = ConfigManager(str(CONFIG_DIR))
    for region in manager.get_region_configs(manufacturer):
        for category, path in region.category_paths.items():
            url = urljoin(region.base_url, path)
            assert url.startswith(region.base_url), (
                f"{manufacturer}/{region.code}/{category} leaves the region: {url}"
            )


@pytest.mark.parametrize('manufacturer', MANUFACTURERS)
def test_scraper_configs_use_the_yaml_values(manufacturer):
    """The YAML must win over the values that are built in code."""
    from veridian_scraper.scrapers import SCRAPER_REGISTRY
    import importlib

    module_name = {
        'asus': 'asus', 'lenovo': 'lenovo', 'hp': 'hp', 'dell': 'dell',
        'acer': 'acer', 'msi': 'msi', 'apple': 'apple', 'samsung': 'samsung',
        'microsoft': 'microsoft', 'lg': 'lg', 'razer': 'razer',
        'framework': 'framework', 'gigabyte': 'gigabyte',
    }[manufacturer]
    module = importlib.import_module(f"veridian_scraper.scrapers.{module_name}")
    create = getattr(module, f"create_{module_name}_config")
    config = create()

    manager = get_config_manager()
    block = manager.get_manufacturer_config(manufacturer)

    assert config.base_url == block['base_url']
    assert config.user_agent == block['user_agent']
    assert [r.code for r in config.regions] == [
        r['code'].lower() for r in block['regions']
    ]
    assert config.regions[0].base_url == block['regions'][0]['base_url']
    assert config.regions[0].rate_limit == block['regions'][0]['rate_limit']
    assert config.regions[0].category_paths == block['regions'][0]['category_paths']
    # The honest agent identifies Veridian; no browser impersonation.
    assert 'VeridianBot' in config.user_agent
    # Every registered scraper must be constructible.
    assert SCRAPER_REGISTRY[manufacturer] is not None


def test_apply_yaml_config_leaves_unknown_manufacturers_alone():
    from veridian_scraper.scrapers.base import ScraperConfig

    config = ScraperConfig(
        manufacturer='nintendo',
        brand='Nintendo',
        base_url='https://nintendo.example/',
        regions=[],
    )
    assert apply_yaml_config(config).base_url == 'https://nintendo.example/'
