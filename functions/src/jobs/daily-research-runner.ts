import { logger } from "firebase-functions";
import { Timestamp } from "firebase-admin/firestore";
import { adminDb } from "../config/firebase.js";
import { getGlobalSettings } from "../utils/settings.js";
import { writeLog } from "../utils/logger.js";
import { researchCompany } from "../services/research-company.js";
import { findContactsForCompany } from "../services/contact-discovery.js";
import { enrichCompanyWebsite } from "../services/company-enrichment.js";
import { generateOutreach, setOutreachStatus } from "../services/outreach-generation.js";
import { generateProposalPdf } from "../services/pdf-generator.js";
import { enqueueTask, processPendingTasksBatch } from "../services/task-queue-service.js";


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

  const toMillis = (value: unknown): number => {
    if (!value) return 0; // never touched -> treat as oldest
    if (value instanceof Timestamp) return value.toMillis();
    const parsed = new Date(value as string).getTime();
    return Number.isNaN(parsed) ? 0 : parsed;
  };

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

    // Step 1: Enqueue research for companies needing research
    const limit = Math.min(settings.dailyAiResearchLimit, 50);
    // No orderBy on an optional field: Firestore silently EXCLUDES documents
    // that lack the ordering field, which made every freshly discovered company
    // invisible to this job forever. Order oldest-first in memory instead.
    const snapshot = await fetchCompaniesNeedingResearch(limit);

    let enqueuedCount = 0;
    for (const doc of snapshot.docs) {
      const companyData = doc.data();
      await enqueueTask("TASK_PIPELINE_COMPANY", { companyId: doc.id }, {
        workspaceId: companyData.workspaceId || "ws_default",
        businessId: companyData.businessId || "biz_devcomm"
      });
      // Mark needsResearch: false so it's not re-enqueued on subsequent ticks
      await doc.ref.update({ needsResearch: false, status: "research_pending", updatedAt: Timestamp.now() });
      enqueuedCount++;
    }

    // Step 2: Enqueue outreach drafts for ready companies
    const outreachLimit = Math.min(settings.dailyEmailGenerationLimit, 50);
    const readyCompanies = await adminDb
      .collection("companies")
      .where("status", "in", ["outreach_ready", "researched", "qualified"])
      .limit(outreachLimit)
      .get();

    let enqueuedOutreach = 0;
    for (const companyDoc of readyCompanies.docs) {
      const companyId = companyDoc.id;
      const companyData = companyDoc.data();

      // Check if outreach record already exists
      const existingOutreach = await adminDb
        .collection("outreach")
        .where("companyId", "==", companyId)
        .limit(1)
        .get();

      if (existingOutreach.empty) {
        await enqueueTask("TASK_GENERATE_OUTREACH", {
          companyId,
          campaignId: companyData.discoveryCampaignId
        }, {
          workspaceId: companyData.workspaceId || "ws_default",
          businessId: companyData.businessId || "biz_devcomm"
        });
        enqueuedOutreach++;
      }
    }

    // Step 3: Process a bounded chunk of pending tasks
    const batchResult = await processPendingTasksBatch(Math.min(settings.maxConcurrentTasks ?? 10, 20));

    await writeLog({
      type: "automation.daily_research_runner",
      level: "info",
      message: `Daily research queue dispatched. ${enqueuedCount} research tasks enqueued, ${enqueuedOutreach} outreach tasks enqueued, ${batchResult.processed} tasks executed.`,
      metadata: { enqueuedCount, enqueuedOutreach, batchResult }
    });

    logger.info(`[daily-research-runner] Job finished successfully (Queue-backed: ${batchResult.processed} processed).`);
    return;
  }

  // Fallback synchronous execution path
  const limit = Math.min(settings.dailyAiResearchLimit, 50);

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
  const outreachLimit = Math.min(settings.dailyEmailGenerationLimit, 50);
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
            if (latestResearch.recommendedNextAction === "approve_outreach") {
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
