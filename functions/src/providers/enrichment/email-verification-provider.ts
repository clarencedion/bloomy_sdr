import { promises as dns } from "node:dns";

/**
 * Checks whether an address can actually receive mail, before we send to it.
 *
 * Why this matters more than it looks: outreach lists built from scraped web
 * pages contain dead domains, typos and role accounts that no longer exist.
 * Sending to them produces hard bounces, and a bounce rate above roughly 5%
 * damages the sending domain's reputation - which then degrades delivery for
 * every message that follows, including the good ones.
 *
 * Two tiers, because the free one already removes most of the risk:
 *  - DNS/MX: free, no key, catches domains that cannot receive mail at all.
 *  - A paid verifier: catches mailboxes that don't exist on a live domain.
 */

export type EmailVerdict = "deliverable" | "undeliverable" | "risky" | "unknown";

export interface EmailVerificationResult {
  email: string;
  verdict: EmailVerdict;
  /** Provider that produced the verdict, for auditing. */
  provider: string;
  reason?: string;
  /** True only when a positive check succeeded, never merely "not disproven". */
  verified: boolean;
  costUsd: number;
}

export interface EmailVerificationProvider {
  readonly name: string;
  isConfigured(): boolean;
  verify(email: string): Promise<EmailVerificationResult>;
}

/** Domains that accept anything and tell us nothing about the mailbox. */
const CATCH_ALL_FREE_PROVIDERS = new Set([
  "gmail.com",
  "googlemail.com",
  "outlook.com",
  "outlook.fr",
  "hotmail.com",
  "hotmail.fr",
  "yahoo.com",
  "yahoo.fr",
  "orange.fr",
  "wanadoo.fr",
  "free.fr",
  "sfr.fr",
  "laposte.net",
  "icloud.com"
]);

function domainOf(email: string): string {
  return email.split("@").pop()?.trim().toLowerCase() ?? "";
}

/**
 * Free tier. Confirms the domain publishes mail exchangers.
 *
 * A domain with no MX record cannot receive mail at all, so this is a hard
 * negative and the single highest-yield check available for scraped lists.
 * A domain that does have MX records is only "not disproven" - the mailbox
 * itself may still be dead - so this never returns `deliverable`.
 */
export class DnsEmailVerifier implements EmailVerificationProvider {
  readonly name = "dns_mx";

  isConfigured(): boolean {
    return true; // no credentials needed
  }

  async verify(email: string): Promise<EmailVerificationResult> {
    const domain = domainOf(email);
    if (!domain) {
      return { email, verdict: "undeliverable", provider: this.name, reason: "No domain in address.", verified: false, costUsd: 0 };
    }

    try {
      const records = await Promise.race([
        dns.resolveMx(domain),
        new Promise<never>((_, reject) => setTimeout(() => reject(new Error("MX lookup timed out")), 8000))
      ]);

      if (!records || records.length === 0) {
        return {
          email,
          verdict: "undeliverable",
          provider: this.name,
          reason: `${domain} publishes no mail server.`,
          verified: false,
          costUsd: 0
        };
      }

      // Free mailbox providers accept mail for any address, so a live MX record
      // says nothing about whether this particular mailbox exists.
      const risky = CATCH_ALL_FREE_PROVIDERS.has(domain);
      return {
        email,
        verdict: risky ? "risky" : "unknown",
        provider: this.name,
        reason: risky
          ? `${domain} is a consumer mailbox provider; existence cannot be confirmed without a verifier.`
          : `${domain} accepts mail; mailbox existence unconfirmed.`,
        verified: false,
        costUsd: 0
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : "DNS lookup failed";
      // NXDOMAIN means the domain does not exist - a hard negative.
      if (/ENOTFOUND|NXDOMAIN/i.test(message)) {
        return { email, verdict: "undeliverable", provider: this.name, reason: `${domain} does not exist.`, verified: false, costUsd: 0 };
      }
      return { email, verdict: "unknown", provider: this.name, reason: message, verified: false, costUsd: 0 };
    }
  }
}

/**
 * Paid tier (Bouncer-compatible). Confirms the mailbox itself.
 *
 * Only this tier can return `deliverable`, because only it actually probes the
 * mailbox. Roughly $0.0005 per address.
 */
export class BouncerEmailVerifier implements EmailVerificationProvider {
  readonly name = "bouncer";

  constructor(private readonly apiKey?: string) {}

  isConfigured(): boolean {
    return Boolean(this.apiKey);
  }

  async verify(email: string): Promise<EmailVerificationResult> {
    if (!this.apiKey) {
      return { email, verdict: "unknown", provider: this.name, reason: "No verifier API key configured.", verified: false, costUsd: 0 };
    }

    const url = new URL("https://api.usebouncer.com/v1.1/email/verify");
    url.searchParams.set("email", email);

    // Exponential backoff on 429, per the provider-integration rules.
    let response: Response | null = null;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      response = await fetch(url.toString(), {
        signal: AbortSignal.timeout(12000),
        headers: { "x-api-key": this.apiKey, Accept: "application/json" }
      });
      if (response.status !== 429 || attempt === 2) break;
      await new Promise((resolve) => setTimeout(resolve, 600 * 2 ** attempt));
    }

    if (!response || !response.ok) {
      return {
        email,
        verdict: "unknown",
        provider: this.name,
        reason: `Verifier returned status ${response?.status ?? 0}.`,
        verified: false,
        costUsd: 0
      };
    }

    const payload = (await response.json()) as { status?: string; reason?: string };
    const status = String(payload.status ?? "").toLowerCase();

    const verdict: EmailVerdict =
      status === "deliverable" ? "deliverable"
      : status === "undeliverable" ? "undeliverable"
      : status === "risky" ? "risky"
      : "unknown";

    return {
      email,
      verdict,
      provider: this.name,
      reason: payload.reason,
      verified: verdict === "deliverable",
      costUsd: 0.0005
    };
  }
}

/** Offline companion so the whole pipeline is testable without credentials. */
export class MockEmailVerificationProvider implements EmailVerificationProvider {
  readonly name = "mock";

  constructor(private readonly verdicts: Record<string, EmailVerdict> = {}) {}

  isConfigured(): boolean {
    return true;
  }

  async verify(email: string): Promise<EmailVerificationResult> {
    const verdict = this.verdicts[email] ?? "deliverable";
    return { email, verdict, provider: this.name, verified: verdict === "deliverable", costUsd: 0 };
  }
}
