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


def test_server_error_robots_txt_refuses_the_fetch():
    policy = _policy("", status=503)
    with pytest.raises(RobotsUnavailableError):
        asyncio.run(policy.check("https://example.com/laptops/"))


def test_crawl_delay_is_read_from_the_policy():
    policy = _policy(WILDCARD_ROBOTS)
    delay = asyncio.run(policy.crawl_delay("https://example.com/laptops/"))
    assert delay == 5


def test_the_checked_agent_is_the_honest_veridian_bot():
    assert "VeridianBot" in ROBOTS_USER_AGENT
    assert "contact@veridian.dev" in ROBOTS_USER_AGENT
