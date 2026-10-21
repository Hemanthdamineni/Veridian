/**
 * The alert engine's rules.
 *
 * The engine exists to stop a price alert from saying something the data
 * does not support, so most of these tests are about what must NOT fire:
 * a rule with no price, a rule with no history, a rule that would call a
 * manufacturer's list price a street price, and a rule that fires twice for
 * the same state.
 */

import { describe, it, expect } from "vitest";
import { createServer, type Server } from "node:http";
import { AddressInfo } from "node:net";
import {
  evaluateAlert,
  markDispatched,
  normalizeRule,
  summarize,
  type AlertInput,
  type PriceObservationInput,
} from "@/lib/alerts";
import {
  ConsoleNotificationChannel,
  UnconfiguredChannel,
  WebhookNotificationChannel,
  resolveChannel,
  type AlertNotification,
} from "@/lib/notifications";

function makeAlert(overrides: Partial<AlertInput> = {}): AlertInput {
  return {
    id: "alert-1",
    userId: "user-1",
    skuId: "sku-1",
    region: "US",
    conditionType: "below_price",
    thresholdValue: 1000,
    channel: "console",
    active: true,
    lastTriggered: null,
    ...overrides,
  };
}

function makeObservation(overrides: Partial<PriceObservationInput> = {}): PriceObservationInput {
  return {
    id: "obs-1",
    price: 899.99,
    currency: "USD",
    kind: "retail",
    sourceName: "Newegg",
    retailer: "Newegg",
    sourceUrl: "https://www.newegg.com/p/1",
    region: "US",
    timestamp: new Date("2026-01-10T00:00:00.000Z"),
    inStock: true,
    ...overrides,
  };
}

describe("below_price", () => {
  it("fires when the current price is below the threshold", () => {
    const evaluation = evaluateAlert({
      alert: makeAlert({ thresholdValue: 1000 }),
      observations: [makeObservation({ price: 899.99 })],
    });

    expect(evaluation.fired).toBe(true);
    expect(evaluation.outcome).toBe("fired");
    expect(evaluation.rule).toBe("below_price");
    expect(evaluation.currentPrice).toBe(899.99);
    expect(evaluation.currentPriceCurrency).toBe("USD");
    expect(evaluation.evidenceClass).toBe("retail");
    expect(evaluation.explanation).toContain("899.99 USD");
    expect(evaluation.explanation).toContain("1000.00 USD");
  });

  it("does not fire when the current price is above the threshold", () => {
    const evaluation = evaluateAlert({
      alert: makeAlert({ thresholdValue: 500 }),
      observations: [makeObservation({ price: 899.99 })],
    });

    expect(evaluation.fired).toBe(false);
    expect(evaluation.outcome).toBe("condition_not_met");
  });

  it("does not fire when there is no current price at all", () => {
    const evaluation = evaluateAlert({
      alert: makeAlert(),
      observations: [],
    });

    expect(evaluation.fired).toBe(false);
    expect(evaluation.outcome).toBe("no_current_price");
    expect(evaluation.currentPrice).toBeNull();
    expect(evaluation.explanation).toMatch(/no price has been recorded/i);
  });

  it("does not fire when the only observation has no evidence class", () => {
    const evaluation = evaluateAlert({
      alert: makeAlert(),
      observations: [makeObservation({ kind: null })],
    });

    expect(evaluation.fired).toBe(false);
    expect(evaluation.outcome).toBe("no_current_price");
    expect(evaluation.explanation).toMatch(/evidence class/i);
  });

  it("does not fire when the observation names no source", () => {
    const evaluation = evaluateAlert({
      alert: makeAlert(),
      observations: [makeObservation({ sourceName: null, retailer: null })],
    });

    expect(evaluation.fired).toBe(false);
    expect(evaluation.outcome).toBe("no_current_price");
    expect(evaluation.explanation).toMatch(/names no source/i);
  });

  it("does not fire when the alert carries no threshold price", () => {
    const evaluation = evaluateAlert({
      alert: makeAlert({ thresholdValue: null }),
      observations: [makeObservation()],
    });

    expect(evaluation.fired).toBe(false);
    expect(evaluation.outcome).toBe("no_threshold");
    expect(evaluation.explanation).toMatch(/no threshold price/i);
  });
});

describe("lowest_ever", () => {
  it("does not fire with fewer than two observations", () => {
    const evaluation = evaluateAlert({
      alert: makeAlert({ conditionType: "lowest_ever" }),
      observations: [makeObservation({ price: 899.99 })],
    });

    expect(evaluation.fired).toBe(false);
    expect(evaluation.outcome).toBe("insufficient_data");
    expect(evaluation.observationCount).toBe(1);
    expect(evaluation.explanation).toMatch(/no lowest price/i);
  });

  it("fires when the current price is below every price recorded before it", () => {
    const evaluation = evaluateAlert({
      alert: makeAlert({ conditionType: "lowest_ever" }),
      observations: [
        makeObservation({ id: "obs-old", price: 1200, timestamp: new Date("2025-12-01") }),
        makeObservation({ id: "obs-new", price: 899.99, timestamp: new Date("2026-01-10") }),
      ],
    });

    expect(evaluation.fired).toBe(true);
    expect(evaluation.observationCount).toBe(2);
    expect(evaluation.references[0].value).toBe(1200);
    expect(evaluation.explanation).toContain("lowest of 2 recorded");
  });

  it("does not fire when the current price is not a new low", () => {
    const evaluation = evaluateAlert({
      alert: makeAlert({ conditionType: "lowest_ever" }),
      observations: [
        makeObservation({ id: "obs-old", price: 800, timestamp: new Date("2025-12-01") }),
        makeObservation({ id: "obs-new", price: 899.99, timestamp: new Date("2026-01-10") }),
      ],
    });

    expect(evaluation.fired).toBe(false);
    expect(evaluation.outcome).toBe("condition_not_met");
  });
});

describe("pct_off", () => {
  it("names the reference it measured the discount against", () => {
    const evaluation = evaluateAlert({
      alert: makeAlert({ conditionType: "pct_off", thresholdValue: 20 }),
      observations: [
        makeObservation({
          id: "obs-old",
          price: 2000,
          sourceName: "Best Buy",
          retailer: "Best Buy",
          timestamp: new Date("2025-12-01"),
        }),
        makeObservation({ id: "obs-new", price: 1500, timestamp: new Date("2026-01-10") }),
      ],
    });

    expect(evaluation.fired).toBe(true);
    expect(evaluation.references).toHaveLength(1);
    expect(evaluation.references[0].value).toBe(2000);
    expect(evaluation.references[0].currency).toBe("USD");
    expect(evaluation.references[0].source).toBe("Best Buy");
    expect(evaluation.references[0].observedAt.toISOString()).toBe("2025-12-01T00:00:00.000Z");
    expect(evaluation.explanation).toContain("2000.00 USD");
    expect(evaluation.explanation).toContain("Best Buy");
    expect(evaluation.explanation).toMatch(/25\.0%/);
  });

  it("does not fire when there is no reference to measure against", () => {
    const evaluation = evaluateAlert({
      alert: makeAlert({ conditionType: "pct_off", thresholdValue: 20 }),
      observations: [makeObservation({ price: 1500 })],
    });

    expect(evaluation.fired).toBe(false);
    expect(evaluation.outcome).toBe("insufficient_data");
    expect(evaluation.explanation).toMatch(/no reference price/i);
  });

  it("does not fire when the discount is smaller than the threshold", () => {
    const evaluation = evaluateAlert({
      alert: makeAlert({ conditionType: "pct_off", thresholdValue: 40 }),
      observations: [
        makeObservation({ id: "obs-old", price: 2000, timestamp: new Date("2025-12-01") }),
        makeObservation({ id: "obs-new", price: 1500, timestamp: new Date("2026-01-10") }),
      ],
    });

    expect(evaluation.fired).toBe(false);
    expect(evaluation.outcome).toBe("condition_not_met");
    expect(evaluation.references[0].value).toBe(2000);
  });
});

describe("evidence classes", () => {
  const manufacturerHistory = [
    makeObservation({
      id: "m-1",
      price: 1999,
      kind: "manufacturer",
      sourceName: "Asus",
      retailer: null,
      timestamp: new Date("2025-12-01"),
    }),
    makeObservation({
      id: "m-2",
      price: 1499,
      kind: "manufacturer",
      sourceName: "Asus",
      retailer: null,
      timestamp: new Date("2026-01-10"),
    }),
  ];

  it("labels a manufacturer-only history as a list price and never as a street price", () => {
    const evaluation = evaluateAlert({
      alert: makeAlert({ conditionType: "lowest_ever" }),
      observations: manufacturerHistory,
    });

    expect(evaluation.fired).toBe(true);
    expect(evaluation.evidenceClass).toBe("manufacturer");
    expect(evaluation.explanation).toContain("manufacturer list price");
    expect(evaluation.explanation).not.toContain("street price");
  });

  it("never measures a discount against a reference of another evidence class", () => {
    const evaluation = evaluateAlert({
      alert: makeAlert({ conditionType: "pct_off", thresholdValue: 10 }),
      observations: [
        makeObservation({
          id: "m-1",
          price: 1999,
          kind: "manufacturer",
          sourceName: "Asus",
          retailer: null,
          timestamp: new Date("2025-12-01"),
        }),
        makeObservation({ id: "r-1", price: 1499, timestamp: new Date("2026-01-10") }),
      ],
    });

    // The street price is the current one, and the manufacturer list price
    // is a different kind of number, so it is not a reference.
    expect(evaluation.references).toHaveLength(0);
    expect(evaluation.outcome).toBe("insufficient_data");
  });
});

describe("any_price_drop", () => {
  it("fires when the price is lower than the price recorded before it", () => {
    const evaluation = evaluateAlert({
      alert: makeAlert({ conditionType: "any_price_drop" }),
      observations: [
        makeObservation({ id: "obs-old", price: 1000, timestamp: new Date("2025-12-01") }),
        makeObservation({ id: "obs-new", price: 900, timestamp: new Date("2026-01-10") }),
      ],
    });

    expect(evaluation.fired).toBe(true);
    expect(evaluation.references[0].value).toBe(1000);
    expect(evaluation.explanation).toMatch(/dropped from 1000\.00 USD/);
  });

  it("does not fire when the price did not drop", () => {
    const evaluation = evaluateAlert({
      alert: makeAlert({ conditionType: "any_price_drop" }),
      observations: [
        makeObservation({ id: "obs-old", price: 900, timestamp: new Date("2025-12-01") }),
        makeObservation({ id: "obs-new", price: 1000, timestamp: new Date("2026-01-10") }),
      ],
    });

    expect(evaluation.fired).toBe(false);
    expect(evaluation.outcome).toBe("condition_not_met");
  });

  it("does not fire with a single observation", () => {
    const evaluation = evaluateAlert({
      alert: makeAlert({ conditionType: "any_price_drop" }),
      observations: [makeObservation()],
    });

    expect(evaluation.fired).toBe(false);
    expect(evaluation.outcome).toBe("insufficient_data");
  });
});

describe("dispatching the same firing twice", () => {
  it("does not fire a second time for the same state", () => {
    const input = {
      alert: makeAlert({ thresholdValue: 1000 }),
      observations: [makeObservation({ price: 899.99 })],
    };

    const first = evaluateAlert(input);
    expect(first.fired).toBe(true);

    const second = markDispatched(first, [first.fingerprint]);
    expect(second.fired).toBe(false);
    expect(second.outcome).toBe("already_dispatched");
    expect(second.explanation).toMatch(/already dispatched/i);
    expect(second.fingerprint).toBe(first.fingerprint);
  });

  it("gives the same state the same fingerprint and a new state a new one", () => {
    const alert = makeAlert({ thresholdValue: 1000 });
    const before = evaluateAlert({
      alert,
      observations: [makeObservation({ price: 899.99 })],
    });
    const same = evaluateAlert({
      alert,
      observations: [makeObservation({ price: 899.99, id: "obs-2" })],
    });
    const different = evaluateAlert({
      alert,
      observations: [makeObservation({ price: 850 })],
    });

    expect(same.fingerprint).toBe(before.fingerprint);
    expect(different.fingerprint).not.toBe(before.fingerprint);
  });

  it("counts an already dispatched firing apart from a new one", () => {
    const alert = makeAlert({ thresholdValue: 1000 });
    const fired = evaluateAlert({
      alert,
      observations: [makeObservation({ price: 899.99 })],
    });
    const duplicate = markDispatched(fired, [fired.fingerprint]);
    const quiet = evaluateAlert({
      alert: makeAlert({ id: "alert-2", thresholdValue: 100 }),
      observations: [makeObservation({ price: 899.99 })],
    });

    const summary = summarize([duplicate, quiet]);
    expect(summary.alertsEvaluated).toBe(2);
    expect(summary.fired).toBe(0);
    expect(summary.skippedAlreadyDispatched).toBe(1);
    expect(summary.skippedConditionNotMet).toBe(1);
  });
});

describe("the rules the engine accepts", () => {
  it("accepts the project's own spellings, including the legacy discount name", () => {
    expect(normalizeRule("below_price")).toBe("below_price");
    expect(normalizeRule("lowest_ever")).toBe("lowest_ever");
    expect(normalizeRule("pct_off")).toBe("pct_off");
    expect(normalizeRule("pct_off_msrp")).toBe("pct_off");
    expect(normalizeRule("any_price_drop")).toBe("any_price_drop");
    expect(normalizeRule("whenever_it_is_cheapest")).toBeNull();
  });

  it("does not fire a rule it does not know, and says so", () => {
    const evaluation = evaluateAlert({
      alert: makeAlert({ conditionType: "whenever_it_is_cheapest" }),
      observations: [makeObservation()],
    });

    expect(evaluation.fired).toBe(false);
    expect(evaluation.outcome).toBe("unknown_rule");
    expect(evaluation.explanation).toMatch(/not a rule this engine can evaluate/i);
  });
});

describe("notification channels", () => {
  function makeNotification(overrides: Partial<AlertNotification> = {}): AlertNotification {
    return {
      alertId: "alert-1",
      userId: "user-1",
      skuId: "sku-1",
      region: "US",
      rule: "below_price",
      channel: "console",
      subject: "IdeaPad Slim 5: below_price alert — 749.00 USD",
      body: "The current manufacturer list price of 749.00 USD is at or below the threshold.",
      price: 749,
      currency: "USD",
      evidenceClass: "manufacturer",
      source: "Veridian reference dataset",
      sourceUrl: null,
      reference: null,
      explanation: "The alert fired.",
      fingerprint: "fingerprint-1",
      observedAt: "2023-01-01T00:00:00.000Z",
      firedAt: "2026-01-10T00:00:00.000Z",
      targetUrl: null,
      ...overrides,
    };
  }

  async function withServer(
    handler: (body: string) => number,
    run: (url: string) => Promise<void>
  ): Promise<void> {
    const server: Server = createServer((request, response) => {
      let body = "";
      request.on("data", (chunk) => {
        body += String(chunk);
      });
      request.on("end", () => {
        const status = handler(body);
        response.writeHead(status, { "content-type": "text/plain" });
        response.end(String(status));
      });
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const port = (server.address() as AddressInfo).port;
    try {
      await run(`http://127.0.0.1:${port}/hook`);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  }

  it("writes one structured line for a console delivery", async () => {
    const channel = new ConsoleNotificationChannel();
    const lines: string[] = [];
    const original = console.log;
    console.log = (line: string) => lines.push(line);
    try {
      const result = await channel.send(makeNotification());
      expect(result.outcome).toBe("delivered");
    } finally {
      console.log = original;
    }
    expect(lines).toHaveLength(1);
    const written = JSON.parse(lines[0]);
    expect(written.channel).toBe("console");
    expect(written.alertId).toBe("alert-1");
    expect(written.price).toBe(749);
  });

  it("posts the notification as JSON to the URL the alert carries", async () => {
    let received: { body: string; contentType: string | undefined } | null = null;
    await withServer(
      (body) => {
        received = { body, contentType: "application/json" };
        return 200;
      },
      async (url) => {
        const channel = new WebhookNotificationChannel({ url });
        const result = await channel.send(makeNotification());
        expect(result.outcome).toBe("delivered");
        expect(result.detail).toBe("HTTP 200");
      }
    );
    expect(received).not.toBeNull();
    const body = JSON.parse((received as unknown as { body: string }).body);
    expect(body.alertId).toBe("alert-1");
    expect(body.fingerprint).toBe("fingerprint-1");
  });

  it("reports a skipped delivery when no webhook URL is available", async () => {
    const channel = new WebhookNotificationChannel();
    expect(channel.isConfigured(makeNotification())).toBe(false);
    const result = await channel.send(makeNotification());
    expect(result.outcome).toBe("skipped");
    expect(result.reason).toMatch(/no webhook URL/i);
  });

  it("reports a failed delivery with the error instead of swallowing it", async () => {
    await withServer(
      () => 500,
      async (url) => {
        const channel = new WebhookNotificationChannel({ url });
        const result = await channel.send(makeNotification());
        expect(result.outcome).toBe("failed");
        expect(result.error).toMatch(/HTTP 500/);
      }
    );
  });

  it("reports a failure when the webhook cannot be reached", async () => {
    const channel = new WebhookNotificationChannel({ url: "http://127.0.0.1:1/hook" });
    const result = await channel.send(makeNotification());
    expect(result.outcome).toBe("failed");
    expect(result.error).toBeTruthy();
  });

  it("never reports a channel that is not configured as delivered", async () => {
    const channel = resolveChannel("email");
    expect(channel.isConfigured(makeNotification())).toBe(false);
    const result = await channel.send(makeNotification());
    expect(result.outcome).toBe("skipped");
    expect(result.reason).toMatch(/no email provider/i);
  });

  it("reports an unknown channel rather than dropping the alert", async () => {
    const channel = resolveChannel("carrier-pigeon");
    const result = await channel.send(makeNotification());
    expect(result.outcome).toBe("skipped");
    expect(result.reason).toMatch(/no notification channel named/i);
  });

  it("resolves the webhook channel from the URL the alert carries", () => {
    const channel = resolveChannel("webhook:https://example.test/hook");
    expect(channel).toBeInstanceOf(WebhookNotificationChannel);
    const webhook = channel as WebhookNotificationChannel;
    // The URL comes from the alert's own channel.
    expect(webhook.resolveUrl(makeNotification())).toBe("https://example.test/hook");
    expect(webhook.isConfigured(makeNotification())).toBe(true);

    // A webhook alert with no URL anywhere has nothing to post to.
    const bare = resolveChannel("webhook") as WebhookNotificationChannel;
    expect(bare.resolveUrl(makeNotification())).toBeNull();
    expect(bare.isConfigured(makeNotification())).toBe(false);
  });

  it("keeps the unconfigured channel honest about its name", () => {
    const channel = new UnconfiguredChannel("email", "no email provider");
    expect(channel.name).toBe("email");
    expect(channel.notConfiguredReason()).toBe("no email provider");
  });
});
