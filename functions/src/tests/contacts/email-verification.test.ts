import { describe, it, expect } from "vitest";
import {
  DnsEmailVerifier,
  MockEmailVerificationProvider
} from "../../providers/enrichment/email-verification-provider.js";

/**
 * Outreach lists built from scraped pages contain dead domains and typos.
 * Hard bounces above roughly 5% degrade the sending domain's reputation, which
 * then hurts delivery of every later message - so an address is checked
 * immediately before dispatch, and a domain that publishes no mail server is
 * refused outright.
 */
describe("Email deliverability verification", () => {
  const dns = new DnsEmailVerifier();

  it("works with no API key at all", () => {
    expect(dns.isConfigured()).toBe(true);
  });

  it("refuses a domain that cannot receive mail", async () => {
    const result = await dns.verify("hello@this-domain-does-not-exist-4f2a9b.fr");
    expect(result.verdict).toBe("undeliverable");
    expect(result.verified).toBe(false);
    expect(result.costUsd).toBe(0);
  }, 20000);

  it("does not claim a live domain is deliverable", async () => {
    // MX records prove the domain accepts mail, never that the mailbox exists.
    // Claiming otherwise would send to addresses we have not actually checked.
    const result = await dns.verify("someone@google.com");
    expect(result.verdict).not.toBe("undeliverable");
    expect(result.verdict).not.toBe("deliverable");
    expect(result.verified).toBe(false);
  }, 20000);

  it("flags consumer mailboxes as risky rather than confirmed", async () => {
    const result = await dns.verify("quelquun@gmail.com");
    expect(result.verdict).toBe("risky");
    expect(result.verified).toBe(false);
  }, 20000);

  it("rejects a malformed address without a network call", async () => {
    const result = await dns.verify("not-an-email");
    expect(result.verdict).toBe("undeliverable");
  });

  it("has an offline companion so the pipeline is testable without keys", async () => {
    const mock = new MockEmailVerificationProvider({ "bad@x.fr": "undeliverable" });
    expect((await mock.verify("bad@x.fr")).verdict).toBe("undeliverable");
    expect((await mock.verify("good@x.fr")).verified).toBe(true);
  });

  it("blocks the send path when the verdict is undeliverable", async () => {
    const fs = await import("node:fs");
    const path = await import("node:path");
    const root = fs.existsSync(path.resolve(process.cwd(), "src/services"))
      ? process.cwd()
      : path.resolve(process.cwd(), "functions");
    const send = fs.readFileSync(path.resolve(root, "src/services/send-outreach.ts"), "utf8");
    expect(send).toMatch(/verifyContactBeforeSend/);
    expect(send).toMatch(/verification\?\.blocked/);
  });
});
