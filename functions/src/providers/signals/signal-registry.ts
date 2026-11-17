import type { SignalContext, SignalProvider } from "./signal-provider.js";
import { RegistrySignalProvider } from "./registry-signal-provider.js";
import { PlacesSignalProvider } from "./places-signal-provider.js";
import { PagespeedSignalProvider } from "./pagespeed-provider.js";
import { WebsiteTechnicalProvider } from "./website-technical-provider.js";
import { WebsiteEcommerceProvider } from "./website-ecommerce-provider.js";
import { HiringSignalProvider } from "./hiring-signal-provider.js";
import { SocialProfileProvider } from "./social-profile-provider.js";

/**
 * Central registry for discovery and execution of pluggable signal providers
 */
/**
 * Ids that campaigns may request which do not map 1:1 onto a provider.
 * `website_presence` predates the technical audit provider that absorbed it.
 */
const SIGNAL_ID_ALIASES: Record<string, string> = {
  website_presence: "website_technical"
};

export class SignalRegistry {
  private providers = new Map<string, SignalProvider>();

  constructor(registerDefaults = true) {
    if (registerDefaults) {
      this.register(new RegistrySignalProvider());
      this.register(new PlacesSignalProvider());
      this.register(new PagespeedSignalProvider());
      this.register(new WebsiteTechnicalProvider());
      this.register(new WebsiteEcommerceProvider());
      this.register(new HiringSignalProvider());
      this.register(new SocialProfileProvider());
    }
  }

  /**
   * Registers a signal provider module
   */
  register(provider: SignalProvider): void {
    this.providers.set(provider.id, provider);
  }

  /**
   * Unregisters a provider by its identifier
   */
  unregister(id: string): boolean {
    return this.providers.delete(id);
  }

  /**
   * Gets a specific provider by identifier
   */
  get(id: string): SignalProvider | undefined {
    return this.providers.get(id);
  }

  /**
   * Checks if a provider identifier exists in the registry
   */
  has(id: string): boolean {
    return this.providers.has(id);
  }

  /**
   * Returns all registered providers
   */
  getAll(): SignalProvider[] {
    return Array.from(this.providers.values());
  }

  /**
   * Filters providers that are requested and capable of running for a given company context
   */
  getProvidersForContext(context: SignalContext, requestedIds?: string[]): SignalProvider[] {
    let candidateProviders = this.getAll();

    if (requestedIds && requestedIds.length > 0) {
      const resolved = requestedIds.map((id) => SIGNAL_ID_ALIASES[id] ?? id);
      const requestedSet = new Set(resolved);

      // A requested id with no implementation used to be dropped in silence, so
      // a campaign could ask for an audit that never ran and still look healthy.
      const known = new Set(this.getAll().map((p) => p.id));
      const unknown = [...requestedSet].filter((id) => !known.has(id));
      if (unknown.length) {
        console.warn(
          `[signal-registry] Ignoring signal providers with no implementation: ${unknown.join(", ")}. ` +
            `Known providers: ${[...known].join(", ")}.`
        );
      }

      candidateProviders = candidateProviders.filter((p) => requestedSet.has(p.id));
    }

    return candidateProviders.filter((provider) => {
      try {
        return provider.supports(context);
      } catch {
        return false;
      }
    });
  }

  /**
   * Clears all registered providers (primarily used in tests)
   */
  clear(): void {
    this.providers.clear();
  }
}

/**
 * Global default Signal Registry singleton
 */
export const defaultSignalRegistry = new SignalRegistry(true);

/**
 * Factory function to create a new isolated Signal Registry instance
 */
export function createSignalRegistry(registerDefaults = true): SignalRegistry {
  return new SignalRegistry(registerDefaults);
}
