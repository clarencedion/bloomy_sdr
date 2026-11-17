/**
 * Drafts waiting for a human decision.
 *
 * Only relevant while the business runs in "Draft only" autonomy: the SDR
 * prepares everything and sends nothing until a person says yes.
 */

import { collection, getCountFromServer, getDocs, query, where } from "firebase/firestore";
import { db } from "@/lib/firebase/client";
import { collections } from "@/lib/firebase/firestore";
import type { Company, Contact, Outreach } from "@/types/firestore";
import { describeOpportunity, type OpportunitySummary } from "./opportunity-language";
import type { Scope } from "./aggregations";
import { cachedRead } from "./query-cache";
import { socialProfileLinks } from "./channel";

export interface PendingApproval {
  outreach: Outreach;
  company: Company | null;
  contact: Contact | null;
  /** Why this company was picked, in plain language. */
  opportunity: OpportunitySummary | null;
  /** Who the email would go to, ready to display. */
  recipient: string;
}

function matchesBusiness(doc: { businessId?: string }, businessId?: string): boolean {
  if (!businessId) return true;
  return !doc.businessId || doc.businessId === businessId;
}

async function fetchAll<T>(path: string, workspaceId: string, extraWhere?: [string, string]): Promise<T[]> {
  const constraints = [where("workspaceId", "==", workspaceId)];
  if (extraWhere) constraints.push(where(extraWhere[0], "==", extraWhere[1]));
  const snapshot = await getDocs(query(collection(db, path), ...constraints));
  return snapshot.docs.map((docSnap) => ({ id: docSnap.id, ...docSnap.data() })) as T[];
}

/** Shares the workspace-wide reads with the rest of the app's screens. */
function fetchCached<T>(path: string, workspaceId: string, extraWhere?: [string, string]): Promise<T[]> {
  const key = `scoped:${path}:${workspaceId}${extraWhere ? `:${extraWhere[0]}=${extraWhere[1]}` : ""}`;
  return cachedRead(key, () => fetchAll<T>(path, workspaceId, extraWhere));
}

/**
 * Drafts the SDR has written and is holding. Newest first, because a fresh
 * draft is the one most likely to still be worth sending.
 */
export async function getPendingApprovals(scope: Scope): Promise<PendingApproval[]> {
  // Only drafts are ever shown here, so only drafts are read. Fetching the whole
  // outreach collection and filtering in memory billed a read per sent email.
  const [outreach, companies, contacts] = await Promise.all([
    fetchCached<Outreach>(collections.outreach, scope.workspaceId, ["status", "draft"]),
    fetchCached<Company>(collections.companies, scope.workspaceId),
    fetchCached<Contact>(collections.contacts, scope.workspaceId)
  ]);

  const companyById = new Map(companies.map((company) => [company.id, company]));
  const contactById = new Map(contacts.map((contact) => [contact.id, contact]));

  const toMillis = (value: unknown): number => {
    if (!value) return 0;
    if (typeof value === "object" && typeof (value as { toMillis?: () => number }).toMillis === "function") {
      return (value as { toMillis: () => number }).toMillis();
    }
    const parsed = new Date(value as string).getTime();
    return Number.isNaN(parsed) ? 0 : parsed;
  };

  return outreach
    .filter((item) => item.status === "draft")
    .filter((item) => matchesBusiness(item, scope.businessId))
    .sort((a, b) => toMillis(b.createdAt) - toMillis(a.createdAt))
    .map((item) => {
      const company = companyById.get(item.companyId) ?? null;
      const contact = item.contactId ? contactById.get(item.contactId) ?? null : null;

      return {
        outreach: item,
        company,
        contact,
        opportunity: describeOpportunity(company?.opportunityScore),
        recipient:
          item.channel === "social_dm"
            ? socialProfileLinks(item)[0]?.url ?? "their public profile"
            : contact?.email ||
              [contact?.firstName, contact?.lastName].filter(Boolean).join(" ") ||
              company?.name ||
              "this prospect"
      };
    });
}

/**
 * The fields an edit on the approval card actually changes, or null when there
 * is nothing to save.
 *
 * DM and contact-form messages are sent from the stored `generatedBody` (the
 * session runner types it, the form submitter posts it), so an edit that is
 * not saved here is an edit the prospect never sees. They have no subject, so
 * none is written for them.
 */
export function draftEditFields(
  outreach: Pick<Outreach, "channel" | "generatedSubject" | "generatedBody">,
  edit: { subject: string; body: string } | undefined
): { generatedBody?: string; generatedSubject?: string } | null {
  if (!edit) return null;
  const fields: { generatedBody?: string; generatedSubject?: string } = {};
  if (edit.body !== (outreach.generatedBody ?? "")) fields.generatedBody = edit.body;
  const hasSubject = outreach.channel !== "social_dm" && outreach.channel !== "contact_form";
  if (hasSubject && edit.subject !== (outreach.generatedSubject ?? "")) fields.generatedSubject = edit.subject;
  return Object.keys(fields).length > 0 ? fields : null;
}

/**
 * The navigation badge.
 *
 * This runs on every screen, so it must not read documents. A count aggregation
 * is billed at one read per 1000 index entries matched, where the previous
 * whole-collection read was billed per outreach document that had ever existed.
 *
 * The count cannot filter by business without a composite index that also
 * covers legacy unstamped documents, so the badge counts the workspace's
 * drafts. It is an invitation to look, not a figure anyone acts on; the page
 * itself is scoped exactly.
 */
export async function getPendingApprovalCount(scope: Scope): Promise<number> {
  return cachedRead(`draftCount:${scope.workspaceId}`, async () => {
    const snapshot = await getCountFromServer(
      query(
        collection(db, collections.outreach),
        where("workspaceId", "==", scope.workspaceId),
        where("status", "==", "draft")
      )
    );
    return snapshot.data().count;
  });
}

/**
 * Approvals only make sense while the SDR is not allowed to send on its own.
 * In assisted/autonomous mode the surface would always be empty, so it is
 * hidden entirely rather than shown as a dead end.
 */
export function approvalsEnabled(policy?: { mode?: string; requireApprovalBeforeSend?: boolean }): boolean {
  if (!policy) return false;
  return policy.mode === "manual" || policy.requireApprovalBeforeSend === true;
}
