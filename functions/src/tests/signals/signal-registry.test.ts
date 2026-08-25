import { describe, it, expect } from "vitest";
import { createSignalRegistry } from "../../providers/signals/signal-registry.js";
import type { SignalContext, SignalProvider } from "../../providers/signals/signal-provider.js";

describe("SignalRegistry (REQ-019 & REQ-020)", () => {
  it("initializes with default built-in signal providers", () => {
    const registry = createSignalRegistry(true);
    expect(registry.has("company_registry")).toBe(true);
    expect(registry.has("google_places")).toBe(true);
    expect(registry.getAll().length).toBeGreaterThanOrEqual(2);
  });

  it("supports dynamic registration and unregistration of custom providers", () => {
    const registry = createSignalRegistry(false);
    expect(registry.getAll().length).toBe(0);

    const mockProvider: SignalProvider = {
      id: "custom_certifications",
      name: "ISO Certifications Provider",
      description: "Extracts ISO 9001 and safety certifications",
      capabilities: ["has_iso9001", "certification_valid_until"],
      costPerExecutionUsd: 0.005,
      supports: (context) => Boolean(context.company.siren),
      collect: async () => ({
        providerId: "custom_certifications",
        evidence: [],
        costEstimateUsd: 0.005,
        durationMs: 10
      })
    };

    registry.register(mockProvider);
    expect(registry.has("custom_certifications")).toBe(true);
    expect(registry.get("custom_certifications")?.name).toBe("ISO Certifications Provider");

    registry.unregister("custom_certifications");
    expect(registry.has("custom_certifications")).toBe(false);
  });

  it("filters providers matching company context capabilities", () => {
    const registry = createSignalRegistry(true);

    const contextWithSiren: SignalContext = {
      workspaceId: "ws_1",
      businessId: "biz_1",
      company: {
        id: "comp_1",
        name: "Acme Logistics",
        siren: "123456789"
      }
    };

    const contextWithPlaces: SignalContext = {
      workspaceId: "ws_1",
      businessId: "biz_1",
      company: {
        id: "comp_2",
        name: "Fleuriste Rose",
        city: "Nantes"
      }
    };

    const providersForSiren = registry.getProvidersForContext(contextWithSiren);
    expect(providersForSiren.some((p) => p.id === "company_registry")).toBe(true);

    const providersForPlaces = registry.getProvidersForContext(contextWithPlaces);
    expect(providersForPlaces.some((p) => p.id === "google_places")).toBe(true);
  });

  it("restricts execution to requested provider IDs when specified", () => {
    const registry = createSignalRegistry(true);

    const context: SignalContext = {
      workspaceId: "ws_1",
      businessId: "biz_1",
      company: {
        id: "comp_1",
        name: "Acme Logistics",
        siren: "123456789",
        city: "Paris"
      }
    };

    // Both company_registry and google_places support this context, but we only request company_registry
    const providers = registry.getProvidersForContext(context, ["company_registry"]);
    expect(providers.length).toBe(1);
    expect(providers[0].id).toBe("company_registry");
  });
});
