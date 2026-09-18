import asyncio
import re
from veridian_scraper.scrapers.hp import HPScraper, create_hp_config
from veridian_scraper.scrapers.base import HTTPClient

async def main():
    config = create_hp_config()
    region = config.regions[0]
    scraper = HPScraper(config, region)

    async with HTTPClient(config, region) as http_client:
        scraper.http_client = http_client

        # Test the GraphQL PDP API
        test_url = 'https://www.hp.com/us-en/shop/pdp/hp-omnibook-7-173-inch-laptop-next-gen-ai-pc-al2b7av-1'
        response = await http_client.get(test_url)

        # Save full HTML
        with open('/tmp/hp_full.html', 'w') as f:
            f.write(response.text)

        print(f'Page length: {len(response.text)}')

        # Check for catEntryId
        match = re.search(r'catEntryId["\']?\s*[:=]\s*["\']?(\d+)', response.text)
        if match:
            print(f'catEntryId found: {match.group(1)}')
        else:
            print('No catEntryId in page')

        # Check for ConfigureView
        if 'ConfigureView' in response.text:
            print('ConfigureView found in page')
        else:
            print('No ConfigureView in page')

        # Check for GraphQL
        if 'graphql' in response.text.lower():
            print('GraphQL found in page')
        else:
            print('No GraphQL in page')

        # Look for product data in meta tags
        for line in response.text.split('\n'):
            if 'catentryid' in line.lower() or 'catEntryId' in line:
                print(f'Found: {line[:200]}')
            if 'product' in line.lower() and ('data-' in line or 'id=' in line):
                print(f'Product data attr: {line[:200]}')

asyncio.run(main())