"""
Tests for the robots.txt policy check.

ADR-003 requires a robots.txt check before the first request and a refusal
when the source policy does not permit the fetch. These tests use small inline
robots.txt fixtures so the behaviour is verified without touching the network.
"""

import asyncio

import pytest

from veridian_scraper.scrapers.base import (
    ROBOTS_USER_AGENT,
    RobotsDisallowedError,
    RobotsPolicy,
    RobotsUnavailableError,
)

# A general policy: everything is allowed except a private and an admin area.
WILDCARD_ROBOTS = """
User-agent: *
Disallow: /private/
Disallow: /admin/
Allow: /private/public/
Crawl-delay: 5
"""

# A policy with a group for VeridianBot next to the wildcard group.
VERIDIAN_GROUP_ROBOTS = """
User-agent: VeridianBot
Disallow: /internal/
Crawl-delay: 2

User-agent: *
Disallow: /private/
"""

# A policy that forbids crawling everything for other agents only.
OTHER_AGENT_ROBOTS = """
User-agent: SomeOtherBot
Disallow: /

User-agent: *
Disallow: /private/
"""


def _policy(robots: str, status: int = 200) -> RobotsPolicy:
    """Build a policy whose robots.txt fetch is stubbed out."""
    calls = []

    async def fetcher(url: str):
        calls.append(url)
        return status, robots

    policy = RobotsPolicy(user_agent=ROBOTS_USER_AGENT, fetcher=fetcher)
    policy.calls = calls  # type: ignore[attr-defined]
    return policy


def test_allowed_path_is_permitted():
    policy = _policy(WILDCARD_ROBOTS)
    allowed = asyncio.run(policy.is_allowed("https://example.com/laptops/zenbook/"))
    assert allowed is True


def test_disallowed_path_is_refused():
    policy = _policy(WILDCARD_ROBOTS)
    allowed = asyncio.run(policy.is_allowed("https://example.com/private/secret"))
    assert allowed is False

    with pytest.raises(RobotsDisallowedError):
        asyncio.run(policy.check("https://example.com/admin/"))


def test_allow_rule_wins_over_the_longer_disallow():
    policy = _policy(WILDCARD_ROBOTS)
    allowed = asyncio.run(policy.is_allowed("https://example.com/private/public/"))
    assert allowed is True


def test_the_longest_matching_rule_decides():
    """RFC 9309: the longest matching path wins, "Allow" wins a tie."""
    policy = _policy(
        "User-agent: *\n"
        "Disallow: /shop/\n"
        "Allow: /shop/public/\n"
    )
    assert asyncio.run(policy.is_allowed("https://example.com/shop/private/")) is False
    assert asyncio.run(policy.is_allowed("https://example.com/shop/public/item")) is True


def test_a_wildcard_pattern_is_honoured():
    policy = _policy(
        "User-agent: *\n"
        "Disallow: /*?session=\n"
    )
    assert asyncio.run(policy.is_allowed("https://example.com/x?session=1")) is False
    assert asyncio.run(policy.is_allowed("https://example.com/x")) is True


def test_an_empty_disallow_means_no_restriction():
    policy = _policy(
        "User-agent: *\n"
        "Disallow:\n"
    )
    assert asyncio.run(policy.is_allowed("https://example.com/anything")) is True


def test_wildcard_group_applies_to_the_veridian_agent():
    policy = _policy(WILDCARD_ROBOTS)
    assert asyncio.run(policy.is_allowed("https://example.com/laptops/")) is True
    assert asyncio.run(policy.is_allowed("https://example.com/private/x")) is False


def test_specific_veridian_group_is_used():
    policy = _policy(VERIDIAN_GROUP_ROBOTS)
    # The VeridianBot group forbids /internal/
    assert asyncio.run(policy.is_allowed("https://example.com/internal/secret")) is False
    assert asyncio.run(policy.is_allowed("https://example.com/laptops/")) is True


def test_other_agent_groups_do_not_apply_to_veridian():
    policy = _policy(OTHER_AGENT_ROBOTS)
    # "SomeOtherBot" may not crawl anything, VeridianBot still may.
    assert asyncio.run(policy.is_allowed("https://example.com/laptops/")) is True
    assert asyncio.run(policy.is_allowed("https://example.com/private/x")) is False


def test_robots_txt_is_fetched_once_per_origin():
    policy = _policy(WILDCARD_ROBOTS)
    asyncio.run(policy.is_allowed("https://example.com/a"))
    asyncio.run(policy.is_allowed("https://example.com/b"))
    assert policy.calls == ["https://example.com/robots.txt"]


def test_missing_robots_txt_allows_everything():
    policy = _policy("", status=404)
    assert asyncio.run(policy.is_allowed("https://example.com/laptops/")) is True


def test_unreadable_robots_txt_refuses_the_fetch():
    # A 403 means the policy is unknown; an unknown policy is not permission.
    policy = _policy("", status=403)
    with pytest.raises(RobotsUnavailableError):
        asyncio.run(policy.check("https://example.com/laptops/"))


def test_an_unreadable_robots_txt_keeps_refusing():
    """The refusal must not decay into "allowed" for the next request."""
    policy = _policy("", status=403)
    for _ in range(3):
        with pytest.raises(RobotsUnavailableError):
            asyncio.run(policy.check("https://example.com/laptops/"))
    # The robots.txt is only fetched once; the refusal is remembered.
    assert policy.calls == ["https://example.com/robots.txt"]


def test_server_error_robots_txt_refuses_the_fetch():
    policy = _policy("", status=503)
    with pytest.raises(RobotsUnavailableError):
        asyncio.run(policy.check("https://example.com/laptops/"))


def test_crawl_delay_is_read_from_the_policy():
    policy = _policy(WILDCARD_ROBOTS)
    delay = asyncio.run(policy.crawl_delay("https://example.com/laptops/"))
    assert delay == 5


def test_the_evaluation_does_not_depend_on_the_stdlib_version():
    """The stdlib parser stores the ``*`` group differently per version.

    Python 3.12 keeps it in ``default_entry`` and encodes the rule paths,
    Python 3.14 keeps it in ``entries``. The decision must be the same.
    """
    from urllib.parse import quote

    from veridian_scraper.scrapers.base import RobotsPolicy

    class _OldRuleLine:
        def __init__(self, path, allowance):
            self.path = quote(path)
            self.allowance = allowance

    class _OldEntry:
        def __init__(self, useragents, rules):
            self.useragents = useragents
            self.rulelines = [_OldRuleLine(path, allow) for path, allow in rules]
            self.delay = None

    class _OldParser:
        """A parser shaped like the Python 3.12 one."""

        def __init__(self):
            self.entries = [_OldEntry(['VeridianBot'], [('/internal/', False)])]
            self.default_entry = _OldEntry(['*'], [('/private/', False)])

    policy = RobotsPolicy(user_agent=ROBOTS_USER_AGENT)
    old_style = policy._allows(_OldParser(), "https://example.com/internal/x")
    assert old_style is False
    assert policy._allows(_OldParser(), "https://example.com/private/x") is True
    assert policy._allows(_OldParser(), "https://example.com/other") is True


def test_the_checked_agent_is_the_honest_veridian_bot():
    assert "VeridianBot" in ROBOTS_USER_AGENT
    assert "contact@veridian.dev" in ROBOTS_USER_AGENT


def test_the_http_client_refuses_a_disallowed_fetch():
    """A disallowed URL must not be fetched at all, and the run is blocked."""
    import asyncio as _asyncio

    from veridian_scraper.scrapers.base import (
        HTTPClient,
        RegionConfig,
        ScraperConfig,
        ScraperHealth,
    )

    async def fetcher(url: str):
        return 200, WILDCARD_ROBOTS

    robots = RobotsPolicy(user_agent=ROBOTS_USER_AGENT, fetcher=fetcher)
    health = ScraperHealth('toy', 'us')
    config = ScraperConfig(
        manufacturer='toy',
        brand='Toy',
        base_url='https://example.com/',
        regions=[RegionConfig(code='us', name='United States', base_url='https://example.com/')],
    )

    async def run():
        async with HTTPClient(config, config.regions[0], health=health, robots=robots) as client:
            import httpx

            calls = []

            async def handler(request):
                calls.append(str(request.url))
                return httpx.Response(200, text="<html></html>")

            # The stub transport records every request that is actually made.
            client.client = httpx.AsyncClient(transport=httpx.MockTransport(handler))
            with pytest.raises(RobotsDisallowedError):
                await client.get("https://example.com/private/secret")
            assert calls == []

    _asyncio.run(run())

    report = health.build_report()
    assert report.status == 'blocked'
    assert report.success is False
    assert report.pages_attempted == 1
    assert report.pages_failed == 1
    assert report.pages_succeeded == 0


def test_the_http_client_fetches_an_allowed_url():
    """The happy path: an allowed URL is fetched and counted as a success."""
    import asyncio as _asyncio

    import httpx

    from veridian_scraper.scrapers.base import (
        HTTPClient,
        RegionConfig,
        ScraperConfig,
        ScraperHealth,
    )

    async def fetcher(url: str):
        return 200, WILDCARD_ROBOTS

    robots = RobotsPolicy(user_agent=ROBOTS_USER_AGENT, fetcher=fetcher)
    health = ScraperHealth('toy', 'us')
    config = ScraperConfig(
        manufacturer='toy',
        brand='Toy',
        base_url='https://example.com/',
        regions=[RegionConfig(code='us', name='United States', base_url='https://example.com/')],
    )

    async def run():
        async with HTTPClient(config, config.regions[0], health=health, robots=robots) as client:
            # Replace the transport with a stub so nothing hits the network.
            async def handler(request):
                return httpx.Response(200, text="<html></html>")

            client.client = httpx.AsyncClient(transport=httpx.MockTransport(handler))
            response = await client.get("https://example.com/laptops/")
            assert response.status_code == 200

    _asyncio.run(run())

    report = health.build_report()
    assert report.pages_succeeded == 1
    assert report.pages_failed == 0
    assert report.status == 'success'
