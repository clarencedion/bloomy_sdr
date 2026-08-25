import { Timestamp } from "firebase-admin/firestore";
import type { EvidenceItem } from "../types/domain.js";
import { getEvidenceForCompany } from "./evidence-service.js";

/**
 * Service managing freshness and caching of collected signals
 */
export class SignalCache {
  /**
   * Checks whether a specific evidence item is currently unexpired
   */
  isFresh(item: EvidenceItem): boolean {
    if (!item.expiresAt) return true;
    const now = Date.now();
    const expireTime =
      item.expiresAt instanceof Timestamp
        ? item.expiresAt.toMillis()
        : item.expiresAt instanceof Date
          ? item.expiresAt.getTime()
          : 0;
    return expireTime > now;
  }

  /**
   * Retrieves cached unexpired evidence for a specific company and provider
   */
  async getCachedEvidence(companyId: string, providerId: string): Promise<EvidenceItem[] | null> {
    if (!companyId || !providerId) return null;

    try {
      const items = await getEvidenceForCompany(companyId, {
        signalProviders: [providerId],
        unexpiredOnly: true
      });

      if (items && items.length > 0) {
        return items;
      }
      return null;
    } catch {
      return null;
    }
  }
}

export const signalCache = new SignalCache();
