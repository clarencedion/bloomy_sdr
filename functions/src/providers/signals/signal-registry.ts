import type { SignalContext, SignalProvider } from "./signal-provider.js";
import { RegistrySignalProvider } from "./registry-signal-provider.js";
import { PlacesSignalProvider } from "./places-signal-provider.js";

/**
 * Central registry for discovery and execution of pluggable signal providers
 */
export class SignalRegistry {
  private providers = new Map<string, SignalProvider>();

  constructor(registerDefaults = true) {
    if (registerDefaults) {
      this.register(new RegistrySignalProvider());
      this.register(new PlacesSignalProvider());
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
      const requestedSet = new Set(requestedIds);
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
