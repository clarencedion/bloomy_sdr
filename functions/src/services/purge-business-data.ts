import type { QueryDocumentSnapshot } from "firebase-admin/firestore";
import { adminDb } from "../config/firebase.js";
import { writeLog } from "../utils/logger.js";

/**
 * Deletes a business's prospecting data while leaving the business itself set up.
 *
 * The purpose is to start over without re-configuring anything: after a purge
 * the business, its offers, its knowledge base, its sender identities, its
 * autonomy setting and every API key are exactly as they were, and the
 * companies, contacts, drafts, conversations, meetings, campaigns, evidence,
 * queued jobs and logs are gone.
 *
 * Two things are deliberately NOT deleted:
 *
 *  - **The suppression list.** Someone who asked never to be contacted must
 *    stay suppressed. A purge that forgets them would let the SDR mail them
 *    again on the next run, which is the one outcome nobody may choose - so
 *    this is not offered as an option.
 *  - **Spend history** (`apiSpendDaily`). It is an accounting record of money
 *    already spent, not prospecting data, and the budget guardrails read it.
 */

/** Collections holding prospecting data, all scoped by `businessId`. */
const SCOPED_COLLECTIONS = [
  "companies",
  "contacts",
  "outreach",
  "conversations",
  "meetings",
  "discoveryCampaigns",
  "discoveryRuns",
  "discoveryRejected",
  "leadResearch",
  "companyEvidence",
  "jobQueue",
  "logs",
  "analyticsDaily",
  "performanceInsights"
] as const;

/** Never removed by a purge, whatever is asked. */
export const PURGE_PROTECTED_COLLECTIONS = ["suppressionList", "apiSpendDaily", "settings"] as const;

const BATCH_SIZE = 300;

/**
 * Deletes a page of documents.
 *
 * Firestore caps a write batch at 500 operations, and a conversation carries a
 * `messages` subcollection that does not cascade — so a document that may have
 * children is removed with `recursiveDelete`, and the rest in bulk.
 */
async function deleteDocs(
  docs: QueryDocumentSnapshot[],
  hasSubcollections: boolean
): Promise<void> {
  if (docs.length === 0) return;

  if (hasSubcollections) {
    await Promise.all(docs.map((doc) => adminDb.recursiveDelete(doc.ref)));
    return;
  }

  const batch = adminDb.batch();
  docs.forEach((doc) => batch.delete(doc.ref));
  await batch.commit();
}

/** Deletes everything in one collection carrying this businessId. */
async function deleteByBusiness(
  collectionName: string,
  businessId: string,
  hasSubcollections: boolean
): Promise<number> {
  let deleted = 0;

  for (;;) {
    const snapshot = await adminDb
      .collection(collectionName)
      .where("businessId", "==", businessId)
      .limit(BATCH_SIZE)
      .get();

    if (snapshot.empty) break;

    await deleteDocs(snapshot.docs, hasSubcollections);
    deleted += snapshot.size;

    if (snapshot.size < BATCH_SIZE) break;
  }

  return deleted;
}

/**
 * Deletes documents in the workspace that carry no businessId at all.
 *
 * These exist because early jobs stamped only `workspaceId`, and the app treats
 * an unstamped document as belonging to whichever business is being viewed —
 * `matchesBusiness()` returns true when `businessId` is absent. Measured on a
 * real workspace, a businessId-only purge left 43 companies, 44 contacts and
 * 5,747 logs behind, all of which kept rendering as if nothing had been purged.
 *
 * An absent field cannot be queried in Firestore — it is not in the index — so
 * this pages through the workspace and filters in memory. That costs a read per
 * document, which is acceptable for an action a person triggers by hand and
 * confirms by typing a name.
 */
async function deleteUnassigned(
  collectionName: string,
  workspaceId: string,
  hasSubcollections: boolean
): Promise<number> {
  let deleted = 0;
  let cursor: QueryDocumentSnapshot | undefined;

  for (;;) {
    let q = adminDb
      .collection(collectionName)
      .where("workspaceId", "==", workspaceId)
      .orderBy("__name__")
      .limit(BATCH_SIZE);

    if (cursor) q = q.startAfter(cursor);

    const snapshot = await q.get();
    if (snapshot.empty) break;

    const orphans = snapshot.docs.filter((doc) => {
      const businessId = doc.data().businessId;
      return businessId === undefined || businessId === null || businessId === "";
    });

    await deleteDocs(orphans, hasSubcollections);
    deleted += orphans.length;

    // Paginate past the documents that were kept, not the ones just removed.
    cursor = snapshot.docs[snapshot.docs.length - 1];
    if (snapshot.size < BATCH_SIZE) break;
  }

  return deleted;
}

export interface PurgeResult {
  deleted: Record<string, number>;
  total: number;
  /** Documents removed because they belonged to no business at all. */
  unassignedDeleted: number;
  kept: string[];
}

export async function purgeBusinessData(input: {
  workspaceId: string;
  businessId: string;
  /** The business name, retyped by the user. A purge is not undoable. */
  confirmName: string;
  /**
   * Also remove workspace documents carrying no businessId. On by default,
   * because the app shows them under every business — leaving them makes a
   * purge look like it did nothing. Turned off automatically when another
   * business exists, since those documents are equally visible from there.
   */
  includeUnassigned?: boolean;
  requestedByUserId?: string;
}): Promise<PurgeResult> {
  const businessRef = adminDb.doc(`workspaces/${input.workspaceId}/businesses/${input.businessId}`);
  const businessSnap = await businessRef.get();
  if (!businessSnap.exists) throw new Error("Business not found.");

  const business = businessSnap.data() ?? {};
  const name = String(business.name ?? "");

  // Retyping the name is the whole safety mechanism: it makes deleting the
  // wrong business's data require a deliberate act rather than a stray click.
  if (input.confirmName.trim().toLowerCase() !== name.trim().toLowerCase()) {
    throw new Error(`Type the business name exactly to confirm: ${name}`);
  }

  // Sweeping unassigned documents is only safe while this is the workspace's
  // only business. With a second one, "belongs to nobody" means "shows up in
  // both", and this purge has no mandate over the other business's screens.
  const businessCount = (
    await adminDb.collection(`workspaces/${input.workspaceId}/businesses`).count().get()
  ).data().count;
  const sweepUnassigned = (input.includeUnassigned ?? true) && businessCount <= 1;

  const deleted: Record<string, number> = {};
  let unassignedDeleted = 0;

  for (const collectionName of SCOPED_COLLECTIONS) {
    // Conversations own a `messages` subcollection that would otherwise be
    // orphaned — unreachable, still billed, and still counted by any query.
    const hasSubcollections = collectionName === "conversations" || collectionName === "companies";

    let count = await deleteByBusiness(collectionName, input.businessId, hasSubcollections);

    if (sweepUnassigned) {
      const orphans = await deleteUnassigned(collectionName, input.workspaceId, hasSubcollections);
      unassignedDeleted += orphans;
      count += orphans;
    }

    if (count > 0) deleted[collectionName] = count;
  }

  const total = Object.values(deleted).reduce((sum, n) => sum + n, 0);

  // Written after the deletion so the record survives the purge it describes.
  await writeLog({
    type: "workspace.data_purged",
    level: "warning",
    message: `Prospecting data purged for ${name}: ${total} documents deleted.`,
    workspaceId: input.workspaceId,
    businessId: input.businessId,
    metadata: {
      deleted,
      total,
      unassignedDeleted,
      requestedByUserId: input.requestedByUserId,
      kept: [...PURGE_PROTECTED_COLLECTIONS]
    }
  });

  return { deleted, total, unassignedDeleted, kept: [...PURGE_PROTECTED_COLLECTIONS] };
}
