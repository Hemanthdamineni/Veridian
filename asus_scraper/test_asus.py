import httpx
import asyncio
import yaml
import re

async def test():
    with open('config.yaml') as f:
        config = yaml.safe_load(f)
    
    client = httpx.AsyncClient(
        headers={
            'User-Agent': config['user_agent'],
            'Accept-Language': config['accept_language']
        },
        follow_redirects=True
    )
    
    url = 'https://www.asus.com/in/laptops/'
    response = await client.get(url)
    print(f'Final URL: {response.url}')
    print(f'Status: {response.status_code}')
    print(f'Content length: {len(response.text)}')
    
    # Look for product links
    product_links = re.findall(r'href="(/in/[^"]*asus-[^"]*)"', response.text)
    print(f'Found {len(product_links)} product links')
    for link in product_links[:5]:
        print(f'  {link}')
    
    await client.aclose()

asyncio.run(test())