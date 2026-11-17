import { createHash } from "node:crypto";
import { Timestamp } from "firebase-admin/firestore";
import { adminDb } from "../../config/firebase.js";
import { getGlobalSettings } from "../../utils/settings.js";
import type { SocialNetwork } from "../../types/domain.js";
import { isSuppressed } from "../can-contact.js";
import { isThirdPartyPresence } from "../third-party-domains.js";
import { normaliseSocialHandle } from "./social-profile.js";

/**
 * The contactability gate for direct messages (Invariant 3).
 *
 * `canContact(contactId, …)` cannot serve here: a DM prospect has no contact
 * record and no email, so it refuses every one of them. This gate applies the
 * same rules to what a DM prospect does have — the company, its domain and
 * SIREN, and the handle on the network — and is called right before every
 * first DM and every reply, never once per batch.
 */

export type SocialContactPurpose = "first_dm" | "reply";

export interface SocialGateVerdict {
  allowed: boolean;
  reason?: string;
}

/** Outreach in one of these states means the company has already heard from us. */
const CONTACTED_OUTREACH_STATUSES = new Set(["sent", "replied", "exported"]);
/** Company states reached only after a first message went out. */
const CONTACTED_COMPANY_STATUSES = new Set(["contacted", "replied", "meeting_booked"]);

export function socialHandleSuppressionValue(network: SocialNetwork, handle: string): string {
  return `${network}:${normaliseSocialHandle(handle)}`;
}

/**
 * The one-first-DM lock of a social account, server-only (the catch-all
 * Firestore rule denies clients).
 *
 * The company lock (`company.socialDmSentAt`) is not enough on its own:
 * discovery dedupes companies by SIREN, SIRET or domain, and a social-only
 * business has none of those, so two campaigns can create two company
 * documents for one Instagram account. Both would pass the company lock. The
 * account's handle is the only identity they share, so the lock is taken on
 * it too, in the same transaction that records the send.
 */
export const SOCIAL_DM_LOCKS = "socialDmLocks";

/**
 * Scoped to one business, like every other first-DM rule: each business
 * writes from its own account, so one business having messaged an account
 * does not stop another business of the workspace from doing so (an opt-out
 * still does — handle suppression is shared). Injective: the scope is a
 * fixed-length hash with no "_", the network is a fixed word, and
 * `encodeURIComponent` keeps "foo.bar" and "foo_bar" apart.
 */
export function socialDmLockId(workspaceId: string, businessId: string, network: SocialNetwork, handle: string): string {
  const scope = createHash("sha256")
    .update(`${workspaceId || "ws_default"}\u0000${businessId}`)
    .digest("hex")
    .slice(0, 24);
  return `${scope}_${network}_${encodeURIComponent(normaliseSocialHandle(handle))}`;
}

/**
 * The domain a suppression entry would name for this company, or undefined
 * when it has none of its own. A social or directory host is never one: for
 * an Instagram-only business "website" is instagram.com, and checking that
 * domain would test every Instagram business at once.
 */
function ownDomainOf(company: Record<string, unknown>): string | undefined {
  const candidate = (company.domain as string | undefined) || (company.website as string | undefined);
  if (!candidate || typeof candidate !== "string") return undefined;
  return isThirdPartyPresence(candidate) ? undefined : candidate;
}

export async function canContactSocial(input: {
  workspaceId: string;
  businessId: string;
  companyId: string;
  network: SocialNetwork;
  handle: string;
  purpose: SocialContactPurpose;
}): Promise<SocialGateVerdict> {
  const handle = normaliseSocialHandle(input.handle);
  if (!handle) return { allowed: false, reason: "invalid_handle" };
  if (!input.businessId) return { allowed: false, reason: "not_attributed" };

  const companySnap = await adminDb.collection("companies").doc(input.companyId).get();
  if (!companySnap.exists) return { allowed: false, reason: "company_not_found" };
  const company = companySnap.data() ?? {};

  // A message is written in one business's name; a company owned by another
  // business (or another workspace) is not ours to contact.
  if ((company.workspaceId || "ws_default") !== input.workspaceId) return { allowed: false, reason: "company_other_workspace" };
  if (!company.businessId) return { allowed: false, reason: "company_not_attributed" };
  if (company.businessId !== input.businessId) return { allowed: false, reason: "company_other_business" };

  if (company.doNotContact === true) return { allowed: false, reason: "company_marked_do_not_contact" };
  if (company.status === "disqualified") return { allowed: false, reason: "company_disqualified" };

  // Equality on both fields: served by single-field indexes, no composite.
  const handleSuppression = await adminDb
    .collection("suppressionList")
    .where("targetType", "==", "social_handle")
    .where("targetValue", "==", socialHandleSuppressionValue(input.network, handle))
    .limit(1)
    .get();
  if (!handleSuppression.empty) {
    const reason = String(handleSuppression.docs[0].data().reason || "handle in suppression list");
    return { allowed: false, reason: `suppressed: ${reason}` };
  }

  const companySuppression = await isSuppressed({
    domain: ownDomainOf(company),
    siren: (company.siren as string | undefined) || undefined,
    businessId: input.businessId
  });
  if (companySuppression.suppressed) {
    return { allowed: false, reason: `suppressed: ${companySuppression.reason ?? companySuppression.rule ?? "company"}` };
  }

  // Replies continue a conversation the prospect is having with us; the
  // first-contact rules below would refuse every one of them.
  if (input.purpose === "reply") return { allowed: true };

  // Safe mode contains outbound email by address allowlist. A DM has no
  // address to check, so — as for contact forms — the only honest
  // containment is refusing first messages altogether.
  const settings = await getGlobalSettings();
  if (settings.testModeEnabled) return { allowed: false, reason: "test_mode_enabled" };

  // One first message per company, on any channel, ever.
  if (company.socialDmSentAt || company.contactFormSentAt) return { allowed: false, reason: "already_contacted" };
  if (CONTACTED_COMPANY_STATUSES.has(String(company.status))) return { allowed: false, reason: "already_contacted" };

  // Filtered on companyId alone, on purpose: the company was just verified to
  // belong to this workspace and business, and an outreach written before
  // tenant stamping existed must still count — a workspace filter would hide
  // it and let a second first message through.
  const outreach = await adminDb.collection("outreach").where("companyId", "==", input.companyId).get();
  if (outreach.docs.some((doc) => CONTACTED_OUTREACH_STATUSES.has(String(doc.data().status)))) {
    return { allowed: false, reason: "already_contacted" };
  }

  // One first message per account, too: a second company document for the
  // same Instagram or Facebook account must not get a second "first" DM from
  // this business.
  const lock = await adminDb
    .collection(SOCIAL_DM_LOCKS)
    .doc(socialDmLockId(input.workspaceId, input.businessId, input.network, handle))
    .get();
  if (lock.exists) return { allowed: false, reason: "already_contacted_handle" };
  // A thread this business opened before the lock existed still counts.
  // Equality only: served by single-field indexes, no composite.
  const thread = await adminDb
    .collection("conversations")
    .where("workspaceId", "==", input.workspaceId)
    .where("businessId", "==", input.businessId)
    .where("channel", "==", input.network)
    .where("socialHandle", "==", handle)
    .limit(1)
    .get();
  if (!thread.empty) return { allowed: false, reason: "already_contacted_handle" };

  return { allowed: true };
}

/**
 * Suppresses one handle on one network. Called when a prospect asks, in a DM,
 * not to be contacted again.
 *
 * The document id is derived from the handle, so a second "stop" from the
 * same person changes nothing. `encodeURIComponent` keeps the id injective:
 * "foo.bar" and "foo_bar" are different Instagram accounts and must never
 * share (and overwrite) one entry.
 */
export async function suppressSocialHandle(input: {
  workspaceId: string;
  businessId?: string;
  network: SocialNetwork;
  handle: string;
  reason: string;
  companyId?: string;
  conversationId?: string;
}): Promise<void> {
  const handle = normaliseSocialHandle(input.handle);
  if (!handle) throw new Error("A handle is required to suppress a social account.");

  const ref = adminDb.collection("suppressionList").doc(`supp_social_${input.network}_${encodeURIComponent(handle)}`);
  try {
    await ref.create({
      id: ref.id,
      workspaceId: input.workspaceId || "ws_default",
      ...(input.businessId ? { businessId: input.businessId } : {}),
      targetType: "social_handle",
      targetValue: socialHandleSuppressionValue(input.network, handle),
      reason: input.reason,
      ...(input.companyId ? { companyId: input.companyId } : {}),
      ...(input.conversationId ? { sourceConversationId: input.conversationId } : {}),
      createdBy: "system",
      createdAt: Timestamp.now()
    });
  } catch (error) {
    // ALREADY_EXISTS: the handle is suppressed already, which is the goal.
    if ((error as { code?: unknown }).code === 6) return;
    throw error;
  }
}
