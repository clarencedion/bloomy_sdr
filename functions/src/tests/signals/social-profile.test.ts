import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { SocialProfileProvider } from "../../providers/signals/social-profile-provider.js";
import { defaultSignalRegistry } from "../../providers/signals/signal-registry.js";

/**
 * This provider exists because for trades like tattoo studios and salons the
 * Instagram bio IS the business: no website, no LinkedIn, no database record,
 * but a "Contact" button and a Linktree they publish deliberately.
 *
 * It must stay strictly read-only. Automated cold DMs breach every platform's
 * terms and would risk the operator's own account, so sending is out of scope
 * by design - these tests pin that boundary.
 */
describe("Social profile provider", () => {
  const provider = new SocialProfileProvider();
  const source = fs.readFileSync(
    path.resolve(
      fs.existsSync(path.resolve(process.cwd(), "src/providers/signals"))
        ? process.cwd()
        : path.resolve(process.cwd(), "functions"),
      "src/providers/signals/social-profile-provider.ts"
    ),
    "utf8"
  );

  it("is registered and discoverable", () => {
    expect(defaultSignalRegistry.getAll().map((p) => p.id)).toContain("social_profile");
  });

  it("declares what it produces", () => {
    for (const key of ["social_email", "social_phone", "instagram_url", "link_in_bio_url"]) {
      expect(provider.capabilities).toContain(key);
    }
  });

  it("needs a website or domain to start from", () => {
    expect(provider.supports({ company: { id: "c", name: "X" } } as never)).toBe(false);
    expect(
      provider.supports({ company: { id: "c", name: "X", website: "https://x.fr" } } as never)
    ).toBe(true);
  });

  it("never sends, posts or authenticates — read-only by design", () => {
    // No credential handling and no write verbs anywhere in the provider.
    expect(source).not.toMatch(/\bsendMessage\b|\bsendDM\b|\bpostMessage\b/i);
    expect(source).not.toMatch(/method:\s*["']POST["']/i);
    expect(source).not.toMatch(/password|access_token|login\(/i);
  });

  it("costs nothing per execution", () => {
    expect(provider.costPerExecutionUsd).toBe(0);
  });

  it("returns cleanly when the URL is unusable rather than throwing", async () => {
    const result = await provider.collect({
      workspaceId: "ws",
      businessId: "b",
      company: { id: "c", name: "X", website: "not-a-url" }
    } as never);
    expect(result.providerId).toBe("social_profile");
    expect(result.evidence).toEqual([]);
    expect(result.error).toBeTruthy();
  });
});
