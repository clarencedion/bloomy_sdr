import { describe, it, expect, vi, afterEach } from "vitest";
import { getIntegrationSecretsStatus, defaultSettings } from "../../utils/settings.js";
import { adminDb } from "../../config/firebase.js";

describe("Adversarial Security Audit: Secret Isolation & Zero Leakage (Invariant 2)", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("should return ONLY boolean status flags and ZERO plaintext secrets in getIntegrationSecretsStatus()", async () => {
    vi.spyOn(adminDb, "doc").mockImplementation((path: string) => {
      if (path === "settings/aiSecrets") {
        return {
          get: vi.fn().mockResolvedValue({
            exists: true,
            data: () => ({
              openAiApiKey: "sk-test-secret-openai-key-1234567890",
              anthropicApiKey: "sk-ant-secret-anthropic-key-0987654321"
            })
          })
        } as any;
      }
      if (path === "settings/integrationSecrets") {
        return {
          get: vi.fn().mockResolvedValue({
            exists: true,
            data: () => ({
              instantlyApiKey: "instantly-secret-token-xyz",
              dropcontactApiKey: "dropcontact-secret-token-abc",
              microsoftClientId: "ms-client-id-abc",
              microsoftRefreshToken: "ms-refresh-token-123",
              microsoftClientSecret: "ms-ultra-secret-value-never-leak",
              instantlyWebhookSecret: "whsec_supersecretkey"
            })
          })
        } as any;
      }
      return { get: vi.fn().mockResolvedValue({ exists: false }) } as any;
    });

    const status = await getIntegrationSecretsStatus();

    // Must have boolean properties
    expect(typeof status.openAiConfigured).toBe("boolean");
    expect(typeof status.anthropicConfigured).toBe("boolean");
    expect(typeof status.instantlyConfigured).toBe("boolean");
    expect(typeof status.dropcontactConfigured).toBe("boolean");
    expect(status.openAiConfigured).toBe(true);
    expect(status.outlookConfigured).toBe(true);

    // Must NOT contain any secret keys in keys or values
    const statusObj = status as Record<string, unknown>;
    const allValues = Object.values(statusObj);

    for (const val of allValues) {
      expect(typeof val).toBe("boolean");
    }

    const jsonStr = JSON.stringify(status);
    expect(jsonStr).not.toContain("sk-test-secret");
    expect(jsonStr).not.toContain("sk-ant-secret");
    expect(jsonStr).not.toContain("instantly-secret");
    expect(jsonStr).not.toContain("dropcontact-secret");
    expect(jsonStr).not.toContain("ms-ultra-secret");
    expect(jsonStr).not.toContain("whsec_");
  });

  it("should ensure default settings contain only public non-secret configuration", () => {
    const settingsObj = defaultSettings as Record<string, unknown>;
    expect(settingsObj.openAiApiKey).toBeUndefined();
    expect(settingsObj.anthropicApiKey).toBeUndefined();
    expect(settingsObj.instantlyApiKey).toBeUndefined();
    expect(settingsObj.microsoftClientSecret).toBeUndefined();
    expect(defaultSettings.openAiApiKeyConfigured).toBe(false);
    expect(defaultSettings.anthropicApiKeyConfigured).toBe(false);
  });

  it("should ensure Firestore rules disallow client access to secret collections and webhookEvents", async () => {
    const fs = await import("node:fs");
    const rulesContent = fs.readFileSync("/Users/clarencedion/CODING/produits/devcomm_os/firestore.rules", "utf-8");

    // Verify settings rule: only settingsId == 'global' is permitted
    expect(rulesContent).toContain('match /settings/{settingsId}');
    expect(rulesContent).toContain('settingsId == "global"');

    // Verify webhookEvents rule: strictly allow read, write: if false;
    expect(rulesContent).toContain('match /webhookEvents/{eventId}');
    expect(rulesContent).toMatch(/match\s+\/webhookEvents\/\{eventId\}\s*\{\s*allow\s+read,\s*write:\s*if\s+false;/);

    // Verify fallback match is false
    expect(rulesContent).toMatch(/match\s+\/\{document=\*\*\}\s*\{\s*allow\s+read,\s*write:\s*if\s+false;/);
  });
});
