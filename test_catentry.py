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
        soup = await http_client.get_soup(test_url)

        # Check for catEntryId
        text = soup.get_text()
        match = re.search(r'catEntryId["\']?\s*[:=]\s*["\']?(\d+)', text)
        if match:
            print(f'catEntryId found: {match.group(1)}')
        else:
            print('No catEntryId in page text')

        # Check for any GraphQL endpoint references
        scripts = soup.find_all('script')
        for s in scripts:
            if s.string and ('graphql' in s.string.lower() or 'ConfigureView' in s.string):
                print(f'Found relevant script: {s.string[:500]}')
                break

        # Also check for ConfigureView link
        for link in soup.find_all('a', href=True):
            if 'ConfigureView' in link['href']:
                print(f'ConfigureView link: {link["href"]}')
                break

asyncio.run(main())