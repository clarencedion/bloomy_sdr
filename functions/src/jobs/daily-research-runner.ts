import { logger } from "firebase-functions";
import { Timestamp, type QueryDocumentSnapshot } from "firebase-admin/firestore";
import { adminDb } from "../config/firebase.js";
import { getGlobalSettings } from "../utils/settings.js";
import { writeLog } from "../utils/logger.js";
import { researchCompany } from "../services/research-company.js";
import { findContactsForCompany } from "../services/contact-discovery.js";
import { enrichCompanyWebsite } from "../services/company-enrichment.js";
import { generateOutreach, setOutreachStatus } from "../services/outreach-generation.js";
import { generateProposalPdf } from "../services/pdf-generator.js";
import { enqueueTask, processPendingTasksBatch } from "../services/task-queue-service.js";
import { countResearchToday } from "../services/research-company.js";
import { getDailyUsage } from "../services/daily-quota.js";
import { listBusinesses, listWorkspaces } from "../services/business-service.js";

/** Most companies one pass may enqueue (Invariant 7: bounded per invocation). */
export const RUN_BATCH_CAP = 50;

type Scope = { workspaceId: string; businessId: string };

/** Outreach is not re-enqueued for a company already enqueued this recently. */
const OUTREACH_ENQUEUE_COOLDOWN_MS = 6 * 60 * 60 * 1000;
const NO_CHANNEL_RETRY_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Per-business remaining allowance for the day, read once per business per
 * pass and decremented as work is enqueued. An unreadable counter allows the
 * work — it is enforced again atomically at execution (daily-quota.ts), and a
 * job that hits it returns to the backlog — but is reported in `unreadable` so
 * the pass can say so instead of failing open silently.
 */
export function createDailyBudget(
  dailyLimit: number,
  countToday: (scope: Scope) => Promise<number | null>
) {
  const left = new Map<string, number>();
  const unreadable = new Set<string>();
  const load = async (scope: Scope): Promise<number> => {
    const key = `${scope.workspaceId}/${scope.businessId}`;
    if (!left.has(key)) {
      const used = await countToday(scope).catch(() => null);
      if (used === null) unreadable.add(key);
      left.set(key, used === null ? Number.POSITIVE_INFINITY : Math.max(0, dailyLimit - used));
    }
    return left.get(key) ?? 0;
  };
  return {
    unreadable,
    async remaining(scope: Scope): Promise<number> {
      return load(scope);
    },
    async take(scope: Scope): Promise<boolean> {
      const available = await load(scope);
      if (available <= 0) return false;
      left.set(`${scope.workspaceId}/${scope.businessId}`, available - 1);
      return true;
    }
  };
}

/** Every business of every workspace (ws_default included even if its doc is a phantom parent). */
async function listBusinessScopes(): Promise<Scope[]> {
  const workspaceIds = new Set<string>(["ws_default"]);
  for (const workspace of await listWorkspaces().catch(() => [])) workspaceIds.add(workspace.id);
  const scopes: Scope[] = [];
  for (const workspaceId of workspaceIds) {
    for (const business of await listBusinesses(workspaceId).catch(() => [])) {
      scopes.push({ workspaceId, businessId: business.id });
    }
  }
  return scopes;
}

const toMillis = (value: unknown): number => {
  if (!value) return 0; // never touched -> treat as oldest
  if (value instanceof Timestamp) return value.toMillis();
  const parsed = new Date(value as string).getTime();
  return Number.isNaN(parsed) ? 0 : parsed;
};

/**
 * Companies awaiting research, oldest activity first.
 *
 * Deliberately avoids `orderBy("lastActivityAt")`: that required a composite
 * index (which was never declared, so this job failed every run) and, worse,
 * Firestore omits documents missing the ordering field entirely - so newly
 * discovered companies could never be picked up. Sorting in memory is correct
 * for the small page size this job uses.
 */
async function fetchCompaniesNeedingResearch(limit: number) {
  const snapshot = await adminDb
    .collection("companies")
    .where("needsResearch", "==", true)
    .limit(limit)
    .get();

  const docs = [...snapshot.docs].sort(
    (a, b) => toMillis(a.data().lastActivityAt) - toMillis(b.data().lastActivityAt)
  );

  return { docs, size: docs.length, empty: docs.length === 0 };
}

export async function runDailyResearchQueue(): Promise<void> {
  const settings = await getGlobalSettings();

  if (settings.automationPaused) {
    logger.info("[daily-research-runner] Automation paused — skipping.");
    return;
  }

  // Queue-backed execution path (REQ-080)
  if (settings.enableTaskQueues !== false) {
    logger.info("[daily-research-runner] Executing with queue-backed decoupling.");

    // Step 1: Enqueue research, business by business.
    //
    // Runs hourly (index.ts). Each pass enqueues at most RUN_BATCH_CAP companies
    // in total (Invariant 7), shared across businesses, and for each business
    // only what is left of its daily limit — so Settings, not the number of
    // passes, decides the day's volume. Querying per business means a business
    // that is over its limit cannot fill the page and starve the others, and
    // its backlog is simply not read until tomorrow.
    const scopes = await listBusinessScopes();
    const share = Math.max(1, Math.floor(RUN_BATCH_CAP / Math.max(1, scopes.length)));
    const researchBudget = createDailyBudget(settings.dailyAiResearchLimit, countResearchToday);
    const outreachBudget = createDailyBudget(settings.dailyEmailGenerationLimit, (scope) =>
      getDailyUsage("outreach_generation", scope)
    );

    let enqueuedCount = 0;
    let businessesAtLimit = 0;
    for (const scope of scopes) {
      const allowance = Math.min(share, RUN_BATCH_CAP - enqueuedCount, await researchBudget.remaining(scope));
      if (allowance <= 0) {
        if ((await researchBudget.remaining(scope)) <= 0) businessesAtLimit++;
        continue;
      }
      // Equality filters only: served by single-field indexes, no composite.
      // By businessId, then the workspace checked in memory: legacy companies
      // without a workspaceId belong to the default workspace and must not be
      // stranded in the backlog.
      const backlog = await adminDb
        .collection("companies")
        .where("businessId", "==", scope.businessId)
        .where("needsResearch", "==", true)
        .limit(allowance)
        .get();
      const docs = [...backlog.docs]
        .filter((doc) => ((doc.data().workspaceId as string) || "ws_default") === scope.workspaceId)
        .sort((a, b) => toMillis(a.data().lastActivityAt) - toMillis(b.data().lastActivityAt));
      for (const doc of docs) {
        if (!(await researchBudget.take(scope))) break;
        await enqueueTask("TASK_PIPELINE_COMPANY", { companyId: doc.id }, scope);
        // Mark needsResearch: false so it's not re-enqueued on subsequent ticks
        await doc.ref.update({ needsResearch: false, status: "research_pending", updatedAt: Timestamp.now() });
        enqueuedCount++;
      }
    }

    // Unattributed companies are never selected above. A small sweep records
    // the verdict on them, so they stop showing as "research pending" with no
    // one ever picking them up.
    const unattributedSweep = await adminDb.collection("companies").where("needsResearch", "==", true).limit(25).get();
    let unattributedResearch = 0;
    for (const doc of unattributedSweep.docs) {
      if (doc.data().businessId) continue;
      await doc.ref.update({
        needsResearch: false,
        outreachBlockedReason: "Not attributed to any business.",
        outreachBlockedAt: Timestamp.now(),
        updatedAt: Timestamp.now()
      });
      unattributedResearch++;
    }

    // Step 2: Enqueue outreach drafts. Per business first, the companies whose
    // draft was deferred by the daily generation limit (needsOutreachRetry);
    // then the global status sweep. Each enqueue spends that business's
    // remaining generation allowance, so a business at its limit is not
    // re-enqueued every hour only to fail again.
    const outreachCap = Math.min(settings.dailyEmailGenerationLimit, RUN_BATCH_CAP);
    const candidates: QueryDocumentSnapshot[] = [];
    for (const scope of scopes) {
      const retry = await adminDb
        .collection("companies")
        .where("workspaceId", "==", scope.workspaceId)
        .where("businessId", "==", scope.businessId)
        .where("needsOutreachRetry", "==", true)
        .limit(share)
        .get();
      candidates.push(...retry.docs);
    }
    const sweep = await adminDb
      .collection("companies")
      .where("status", "in", ["outreach_ready", "researched", "qualified"])
      .limit(outreachCap)
      .get();
    const seen = new Set<string>();
    const readyCompanies = candidates.concat(sweep.docs).filter((d) => !seen.has(d.id) && seen.add(d.id));

    let enqueuedOutreach = 0;
    let skippedBlocked = 0;
    let skippedUnattributed = 0;
    let heldForTomorrow = 0;
    const now = Date.now();
    for (const companyDoc of readyCompanies) {
      if (enqueuedOutreach >= outreachCap) break;
      const companyId = companyDoc.id;
      const companyData = companyDoc.data();

      // A company whose outreach already failed permanently must not be
      // re-enqueued to fail identically tomorrow. Without this, the same 21
      // companies dead-lettered every day for as long as the campaign lived,
      // burning writes, worker time and log volume for a verdict already known.
      // The block is cleared whenever a contact is found, so this delays
      // nothing that could actually succeed.
      if (companyData.outreachBlockedAt) {
        skippedBlocked++;
        continue;
      }

      // Unattributed: outreach is written in a business's name, so it can
      // never succeed. Recorded once on the company (Live-Run contract #4).
      const businessId = companyData.businessId as string | undefined;
      if (!businessId) {
        await companyDoc.ref.update({
          outreachBlockedReason: "Not attributed to any business.",
          outreachBlockedAt: Timestamp.now(),
          updatedAt: Timestamp.now()
        });
        skippedUnattributed++;
        continue;
      }
      const scope = { workspaceId: (companyData.workspaceId as string) || "ws_default", businessId };

      // Already enqueued recently (by this runner or the research chain):
      // a second job would only race the first into a duplicate draft.
      if (now - toMillis(companyData.outreachEnqueuedAt) < OUTREACH_ENQUEUE_COOLDOWN_MS) continue;
      // Nobody to write to when it was last tried (no email, profile or form):
      // offered again only after a week, or sooner if research finds a channel
      // (the research chain drafts directly).
      if (now - toMillis(companyData.noChannelAt) < NO_CHANNEL_RETRY_MS) continue;

      const existingOutreach = await adminDb
        .collection("outreach")
        .where("companyId", "==", companyId)
        .limit(1)
        .get();
      if (!existingOutreach.empty) {
        if (companyData.needsOutreachRetry) await companyDoc.ref.update({ needsOutreachRetry: false }).catch(() => undefined);
        continue;
      }

      // Over today's generation limit: keep the retry flag for tomorrow.
      if (!(await outreachBudget.take(scope))) {
        heldForTomorrow++;
        continue;
      }

      await enqueueTask("TASK_GENERATE_OUTREACH", { companyId, campaignId: companyData.discoveryCampaignId }, scope);
      await companyDoc.ref.update({ needsOutreachRetry: false, outreachEnqueuedAt: Timestamp.now() }).catch(() => undefined);
      enqueuedOutreach++;
    }

    const unreadableCounters = [...researchBudget.unreadable, ...outreachBudget.unreadable];
    if (unreadableCounters.length) {
      await writeLog({
        type: "automation.daily_counter_unreadable",
        level: "warning",
        message: `Daily usage counter unreadable for ${unreadableCounters.join(", ")}; work was enqueued and the limit is enforced at execution.`,
        metadata: { scopes: unreadableCounters }
      });
    }

    // Step 3: Process a bounded chunk of pending tasks
    const batchResult = await processPendingTasksBatch(Math.min(settings.maxConcurrentTasks ?? 10, 20));

    await writeLog({
      type: "automation.daily_research_runner",
      level: "info",
      message: `Daily research queue dispatched. ${enqueuedCount} research tasks enqueued (${businessesAtLimit} businesses at their daily limit), ${enqueuedOutreach} outreach tasks enqueued, ${heldForTomorrow} held over today's generation limit, ${skippedUnattributed + unattributedResearch} unattributed, ${skippedBlocked} skipped as already blocked, ${batchResult.processed} tasks executed.`,
      metadata: { enqueuedCount, businessesAtLimit, enqueuedOutreach, heldForTomorrow, skippedUnattributed, unattributedResearch, skippedBlocked, batchResult }
    });

    logger.info(`[daily-research-runner] Job finished successfully (Queue-backed: ${batchResult.processed} processed).`);
    return;
  }

  // Fallback synchronous execution path
  const limit = Math.min(settings.dailyAiResearchLimit, RUN_BATCH_CAP);

  const snapshot = await fetchCompaniesNeedingResearch(limit);

  let completed = 0;
  let failed = 0;
  let limitReached = false;

  if (snapshot.empty) {
    logger.info("[daily-research-runner] No companies queued for research.");
    await writeLog({ type: "automation.daily_research_runner", level: "info", message: "No companies queued for research.", metadata: { limit } });
  } else {
    logger.info(`[daily-research-runner] Processing ${snapshot.size} companies.`);

    for (const doc of snapshot.docs) {
      if (limitReached) break;

      try {
        const result = await researchCompany(doc.id);

        if (result.status === "completed") {
          completed++;

          if (settings.autoFindContactsAfterResearch) {
            const contactCount = await adminDb
              .collection("contacts")
              .where("companyId", "==", doc.id)
              .limit(1)
              .get();

            if (contactCount.empty) {
              try {
                await enrichCompanyWebsite(doc.id);
              } catch (err) {
                logger.warn(`[daily-research-runner] Website enrichment failed for ${doc.id}: ${err instanceof Error ? err.message : err}`);
              }

              try {
                await findContactsForCompany(doc.id);
              } catch (err) {
                logger.warn(`[daily-research-runner] Dropcontact lookup failed for ${doc.id}: ${err instanceof Error ? err.message : err}`);
                await adminDb.collection("companies").doc(doc.id).set(
                  { needsContactDiscovery: true, updatedAt: Timestamp.now() },
                  { merge: true }
                );
              }
            }
          }
        } else {
          failed++;
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);

        if (message.includes("Daily AI research limit reached")) {
          logger.info("[daily-research-runner] Daily research limit reached, stopping.");
          limitReached = true;
          break;
        }

        logger.warn(`[daily-research-runner] Research failed for ${doc.id}: ${message}`);
        failed++;
      }
    }

    await writeLog({
      type: "automation.daily_research_runner",
      level: "info",
      message: `Daily research runner completed. ${completed} researched, ${failed} failed.`,
      metadata: { queued: snapshot.size, completed, failed, limitReached }
    });
  }

  // Step 2: Automated Outreach Draft Generation & PDF Pre-generation
  const outreachLimit = Math.min(settings.dailyEmailGenerationLimit, RUN_BATCH_CAP);
  const readyCompanies = await adminDb
    .collection("companies")
    .where("status", "in", ["outreach_ready", "researched", "qualified"])
    .limit(outreachLimit)
    .get();

  if (!readyCompanies.empty) {
    logger.info(`[daily-research-runner] Generating outreach drafts for up to ${readyCompanies.size} ready companies.`);
    let draftsGenerated = 0;
    let draftsFailed = 0;

    for (const companyDoc of readyCompanies.docs) {
      const companyId = companyDoc.id;

      const existingOutreach = await adminDb
        .collection("outreach")
        .where("companyId", "==", companyId)
        .limit(1)
        .get();

      if (!existingOutreach.empty) {
        continue;
      }

      try {
        const contactsSnap = await adminDb
          .collection("contacts")
          .where("companyId", "==", companyId)
          .limit(1)
          .get();

        const contactId = !contactsSnap.empty ? contactsSnap.docs[0].id : undefined;

        const outreachResult = await generateOutreach({
          companyId,
          contactId,
          campaignId: companyDoc.data().discoveryCampaignId,
          force: true
        });

        await generateProposalPdf(outreachResult.outreachId);
        draftsGenerated++;

        if (settings.autoApproveOutreach) {
          const researchSnap = await adminDb
            .collection("leadResearch")
            .where("companyId", "==", companyId)
            .where("status", "==", "completed")
            .limit(5)
            .get();

          if (!researchSnap.empty) {
            const docs = researchSnap.docs.sort((a, b) => {
              const aTime = a.data().completedAt?.toMillis() ?? 0;
              const bTime = b.data().completedAt?.toMillis() ?? 0;
              return bTime - aTime;
            });
            const latestResearch = docs[0].data();
            // Fail-closed (ADR-019): a draft stating commercial terms is
            // never approved without a person, whatever the research says.
            // It also needs a clean detector and claim check.
            const draft = (await adminDb.collection("outreach").doc(outreachResult.outreachId).get()).data() ?? {};
            const autoApprovable =
              draft.mentionsCommercialTerms === false &&
              draft.pricingGuardrailPassed !== false &&
              ["VALID", "WARNINGS_ONLY"].includes(String(draft.claimValidationStatus));
            if (latestResearch.recommendedNextAction === "approve_outreach" && autoApprovable) {
              await setOutreachStatus(outreachResult.outreachId, "approved", "system");
            }
          }
        }
      } catch (err) {
        logger.error(`[daily-research-runner] Failed to auto-generate outreach/pdf for company ${companyId}: ${err instanceof Error ? err.message : err}`);
        draftsFailed++;
      }
    }

    if (draftsGenerated > 0 || draftsFailed > 0) {
      await writeLog({
        type: "automation.auto_outreach_generation",
        level: "info",
        message: `Auto outreach generation complete. ${draftsGenerated} generated, ${draftsFailed} failed.`,
        metadata: { checked: readyCompanies.size, generated: draftsGenerated, failed: draftsFailed }
      });
    }
  }

  logger.info(`[daily-research-runner] Job finished successfully.`);
}
