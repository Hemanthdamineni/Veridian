/**
 * Notification channels.
 *
 * The alert engine decides *whether* a price is worth telling someone about.
 * This module decides *how* the message travels. The two are kept apart on
 * purpose: a rule that fires must be true whether or not a channel happens
 * to be configured, and a channel that cannot deliver must say so rather
 * than pretend it did.
 *
 * A channel is anything that can turn an alert into a delivered message. The
 * interface is small on purpose so that a new transport — a chat app, a
 * browser push service, an email provider — can be added later without
 * touching the rules.
 *
 * Two channels ship here, and neither needs a credential:
 *
 *   * `console` writes one structured line per notification. It is the
 *     channel a development machine uses.
 *   * `webhook` POSTs the notification as JSON to a URL the alert carries.
 *
 * There is no email provider in this project and none is added here. An
 * alert that asks for one is reported as skipped, with the reason, and is
 * never counted as delivered.
 */

/**
 * The `RawObservation.source` under which deliveries are recorded.
 *
 * The schema has no dedicated table for what was sent, so a delivery is
 * written as an append-only receipt under this source. The receipt carries
 * the fingerprint of the firing, which is what makes a duplicate delivery
 * detectable after a restart. A receipt only exists for a delivery that
 * happened: a failed attempt is recorded with the status `rejected` and
 * does not count as delivered.
 */
export const DISPATCH_SOURCE = "alert-dispatch";

/** How a delivery attempt ended. */
export type NotificationOutcome = "delivered" | "skipped" | "failed";

/** The reference a notification reports, when the rule used one. */
export interface NotificationReference {
  label: string;
  value: number;
  currency: string;
  kind: string;
  source: string;
  observedAt: string;
}

/** The message a channel delivers. */
export interface AlertNotification {
  alertId: string;
  userId: string;
  skuId: string;
  region: string;
  /** The rule that fired. */
  rule: string;
  /** The channel named on the alert. */
  channel: string;
  subject: string;
  body: string;
  /** The price that triggered the alert. */
  price: number | null;
  currency: string | null;
  /** The evidence class of that price: retail, manufacturer or review. */
  evidenceClass: string | null;
  /** Where the price was read. */
  source: string | null;
  sourceUrl: string | null;
  /** The reference value the rule measured against. */
  reference: NotificationReference | null;
  /** The sentence the evaluation produced. */
  explanation: string;
  /** Identifies this firing, so the same one is never delivered twice. */
  fingerprint: string;
  /** When the price was observed. */
  observedAt: string | null;
  /** When the alert was evaluated. */
  firedAt: string;
  /** The URL the alert carries, for channels that post to one. */
  targetUrl: string | null;
}

/** What a channel reports after trying to deliver. */
export interface NotificationResult {
  channel: string;
  outcome: NotificationOutcome;
  /** Why the notification was not attempted. */
  reason?: string;
  /** Why the attempt failed. */
  error?: string;
  /** Anything else worth knowing, such as the HTTP status. */
  detail?: string;
  /** When the message was handed over. */
  deliveredAt?: string;
}

/** A transport an alert can be delivered through. */
export interface NotificationChannel {
  /** The name the alert stores in `Alert.channel`. */
  readonly name: string;
  /** Whether this channel can deliver this notification at all. */
  isConfigured(notification: AlertNotification): boolean;
  /** Why the channel cannot deliver, when it cannot. */
  notConfiguredReason(notification: AlertNotification): string;
  /** Try to deliver. A failure is reported, never swallowed. */
  send(notification: AlertNotification): Promise<NotificationResult>;
}

/**
 * Writes one structured line per notification.
 *
 * The line is JSON so that it can be read by a person and by a log
 * pipeline alike. This channel never fails: if the line was written, the
 * notification was delivered to the console.
 */
export class ConsoleNotificationChannel implements NotificationChannel {
  readonly name = "console";

  isConfigured(): boolean {
    return true;
  }

  notConfiguredReason(): string {
    return "the console channel is always available";
  }

  async send(notification: AlertNotification): Promise<NotificationResult> {
    const line = JSON.stringify({
      channel: this.name,
      alertId: notification.alertId,
      skuId: notification.skuId,
      userId: notification.userId,
      region: notification.region,
      rule: notification.rule,
      price: notification.price,
      currency: notification.currency,
      evidenceClass: notification.evidenceClass,
      source: notification.source,
      reference: notification.reference,
      subject: notification.subject,
      explanation: notification.explanation,
      fingerprint: notification.fingerprint,
      observedAt: notification.observedAt,
      firedAt: notification.firedAt,
    });
    console.log(line);
    return {
      channel: this.name,
      outcome: "delivered",
      detail: "one structured line written to the console",
      deliveredAt: new Date().toISOString(),
    };
  }
}

/**
 * Posts the notification as JSON to a URL the alert carries.
 *
 * The URL comes from the alert: either the alert's channel is stored as
 * `webhook:<url>`, or the notification carries a target URL. When no URL is
 * available the channel reports that it skipped, because a delivery that
 * never left the process is not a delivery.
 */
export class WebhookNotificationChannel implements NotificationChannel {
  readonly name = "webhook";

  private readonly url: string | null;
  private readonly timeoutMs: number;

  constructor(options: { url?: string | null; timeoutMs?: number } = {}) {
    this.url = options.url ?? null;
    this.timeoutMs = options.timeoutMs ?? 10_000;
  }

  /** The URL this channel posts to. */
  resolveUrl(notification: AlertNotification): string | null {
    const carried = notification.targetUrl?.trim();
    if (carried) return carried;
    const configured = this.url?.trim();
    return configured ? configured : null;
  }

  isConfigured(notification: AlertNotification): boolean {
    return this.resolveUrl(notification) !== null;
  }

  notConfiguredReason(): string {
    return (
      "no webhook URL is available for this alert — store the alert's channel as " +
      '"webhook:<url>", or set VERIDIAN_ALERT_WEBHOOK_URL'
    );
  }

  async send(notification: AlertNotification): Promise<NotificationResult> {
    const url = this.resolveUrl(notification);
    if (!url) {
      return {
        channel: this.name,
        outcome: "skipped",
        reason: this.notConfiguredReason(),
      };
    }

    let response: Response;
    try {
      response = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(notification),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (error) {
      return {
        channel: this.name,
        outcome: "failed",
        error: error instanceof Error ? `${error.name}: ${error.message}` : String(error),
        detail: `POST ${url}`,
      };
    }

    if (!response.ok) {
      return {
        channel: this.name,
        outcome: "failed",
        error: `the webhook responded with HTTP ${response.status} ${response.statusText}`.trim(),
        detail: `POST ${url}`,
      };
    }

    return {
      channel: this.name,
      outcome: "delivered",
      detail: `HTTP ${response.status}`,
      deliveredAt: new Date().toISOString(),
    };
  }
}

/**
 * A channel that is not available.
 *
 * It exists so that an alert asking for a transport this deployment does not
 * have is reported rather than ignored. The notification is skipped, with
 * the reason, and it is never counted as delivered.
 */
export class UnconfiguredChannel implements NotificationChannel {
  readonly name: string;

  private readonly reason: string;

  constructor(name: string, reason: string) {
    this.name = name;
    this.reason = reason;
  }

  isConfigured(): boolean {
    return false;
  }

  notConfiguredReason(): string {
    return this.reason;
  }

  async send(): Promise<NotificationResult> {
    return {
      channel: this.name,
      outcome: "skipped",
      reason: this.reason,
    };
  }
}

/**
 * The channels that need a provider this project does not have.
 *
 * The alert model inherited these names from the Python engine. None of them
 * is configured here, and adding a provider is deliberately out of scope, so
 * they resolve to a channel that reports the gap.
 */
const UNCONFIGURED_CHANNELS: Readonly<Record<string, string>> = {
  email:
    "no email provider is configured in this project — an alert on the email channel is " +
    "skipped, not delivered",
  telegram: "no Telegram bot is configured in this project",
  discord: "no Discord webhook is configured in this project",
  push: "no Web Push service is configured in this project",
};

/** The environment variable that carries a default webhook URL. */
export const WEBHOOK_URL_ENV = "VERIDIAN_ALERT_WEBHOOK_URL";

/**
 * Resolve the channel an alert names.
 *
 * `console` and `webhook` work without credentials. `webhook:<url>` posts to
 * the URL the alert carries. Anything else resolves to a channel that reports
 * that it is not configured, so an alert is never silently dropped.
 */
export function resolveChannel(
  channelName: string | null | undefined,
  options: { webhookUrl?: string | null } = {}
): NotificationChannel {
  const name = (channelName ?? "").trim();

  if (name === "console") {
    return new ConsoleNotificationChannel();
  }

  if (name === "webhook") {
    const fromEnv = options.webhookUrl ?? process.env[WEBHOOK_URL_ENV] ?? null;
    return new WebhookNotificationChannel({ url: fromEnv });
  }

  if (name.startsWith("webhook:")) {
    const url = name.slice("webhook:".length).trim();
    return new WebhookNotificationChannel({ url: url || null });
  }

  const gap = UNCONFIGURED_CHANNELS[name];
  if (gap) {
    return new UnconfiguredChannel(name, gap);
  }

  return new UnconfiguredChannel(
    name || "(none)",
    `no notification channel named "${name}" is registered in this deployment`
  );
}
