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

export async function runDailyResearchQueue(): Promise<void> {
  const settings = await getGlobalSettings();

  if (settings.automationPaused) {
    logger.info("[daily-research-runner] Automation paused — skipping.");
    return;
  }

  // Step 1: Process Research Queue
  const limit = Math.min(settings.dailyAiResearchLimit, 50);

  const snapshot = await adminDb
    .collection("companies")
    .where("needsResearch", "==", true)
    .orderBy("lastActivityAt", "asc")
    .limit(limit)
    .get();

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
                // 1. Scraping general emails/phones from website footer and /contact page
                await enrichCompanyWebsite(doc.id);
              } catch (err) {
                logger.warn(`[daily-research-runner] Website enrichment failed for ${doc.id}: ${err instanceof Error ? err.message : err}`);
              }

              try {
                // 2. Discovering employee contacts via Dropcontact
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

      // Check if an outreach record already exists for this company
      const existingOutreach = await adminDb
        .collection("outreach")
        .where("companyId", "==", companyId)
        .limit(1)
        .get();

      if (!existingOutreach.empty) {
        continue;
      }

      try {
        // Find the first contact for personalization
        const contactsSnap = await adminDb
          .collection("contacts")
          .where("companyId", "==", companyId)
          .limit(1)
          .get();

        const contactId = !contactsSnap.empty ? contactsSnap.docs[0].id : undefined;

        // 1. Generate outreach copy (subject/body/followups/etc.)
        const outreachResult = await generateOutreach({
          companyId,
          contactId,
          campaignId: companyDoc.data().discoveryCampaignId,
          force: true
        });

        // 2. Generate PDF proposal
        await generateProposalPdf(outreachResult.outreachId);
        draftsGenerated++;

        // 3. Conditional auto-approval and send
        if (settings.autoApproveOutreach) {
          const researchSnap = await adminDb
            .collection("leadResearch")
            .where("companyId", "==", companyId)
            .where("status", "==", "completed")
            .limit(5)
            .get();

          if (!researchSnap.empty) {
            // Sort by completedAt desc in JS to avoid needing a composite index in firestore
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
