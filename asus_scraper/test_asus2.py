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
    
    # Look for any links with 'asus' in them
    all_links = re.findall(r'href="([^"]*asus[^"]*)"', response.text, re.IGNORECASE)
    print(f'Found {len(all_links)} links with "asus" in them')
    for link in all_links[:10]:
        print(f'  {link}')
    
    # Look for any product-related links
    product_links = re.findall(r'href="([^"]*product[^"]*)"', response.text, re.IGNORECASE)
    print(f'Found {len(product_links)} product-related links')
    for link in product_links[:10]:
        print(f'  {link}')
    
    # Check if there's any JavaScript-rendered content
    if 'window.__NUXT__' in response.text:
        print('Found Nuxt.js data')
    elif 'window.__NEXT_DATA__' in response.text:
        print('Found Next.js data')
    
    await client.aclose()

asyncio.run(test())