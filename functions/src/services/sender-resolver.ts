import { adminDb } from "../config/firebase.js";
import { getBusiness, listSenderIdentities } from "./business-service.js";

/**
 * Resolves the address a business sends from.
 *
 * The sending address used to be hardcoded to one business's mailbox in three
 * places, so every business in the workspace would have emailed prospects from
 * that company's address - wrong branding at best, and a deliverability and
 * trust problem at worst.
 *
 * Resolution order, most specific first:
 *   1. the business's configured default sender
 *   2. its default sender identity, else its first one
 *   3. the workspace fallback in settings/global
 */
export interface ResolvedSender {
  email: string;
  name?: string;
  /** False when we had to fall back to the workspace default. */
  businessSpecific: boolean;
}

const WORKSPACE_FALLBACK_KEY = "defaultSenderEmail";

export async function resolveSender(input: {
  workspaceId?: string;
  businessId?: string;
}): Promise<ResolvedSender | null> {
  const workspaceId = input.workspaceId || "ws_default";

  if (input.businessId) {
    try {
      const business = await getBusiness(workspaceId, input.businessId);
      const configured = business?.senderConfig?.defaultSenderEmail?.trim();
      if (configured) {
        return {
          email: configured,
          name: business?.senderConfig?.defaultSenderName || business?.name,
          businessSpecific: true
        };
      }

      const identities = await listSenderIdentities(workspaceId, input.businessId);
      const chosen = identities.find((identity) => identity.isDefault) ?? identities[0];
      if (chosen?.email) {
        return { email: chosen.email, name: chosen.name || business?.name, businessSpecific: true };
      }
    } catch {
      // Fall through to the workspace default.
    }
  }

  try {
    const settings = (await adminDb.doc("settings/global").get()).data() ?? {};
    const fallback = String(settings[WORKSPACE_FALLBACK_KEY] ?? "").trim();
    if (fallback) {
      return {
        email: fallback,
        name: String(settings.defaultSenderName ?? "").trim() || undefined,
        businessSpecific: false
      };
    }
  } catch {
    // No settings document; nothing to fall back to.
  }

  return null;
}

/**
 * Sender address for storing an outbound message. Returns an explicit
 * placeholder rather than another business's real address when nothing is
 * configured, so a missing configuration is visible instead of silently
 * impersonating someone.
 */
export async function resolveSenderEmail(input: {
  workspaceId?: string;
  businessId?: string;
  override?: string;
}): Promise<string> {
  if (input.override?.trim()) return input.override.trim();
  const sender = await resolveSender(input);
  return sender?.email ?? "sender-not-configured@localhost";
}
