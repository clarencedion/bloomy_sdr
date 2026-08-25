import { logger } from "firebase-functions";
import { Timestamp } from "firebase-admin/firestore";
import { adminDb } from "../config/firebase.js";
import { getGlobalSettings, getIntegrationSecrets } from "../utils/settings.js";
import { writeLog } from "../utils/logger.js";

export async function runHourlyOutreachSync(): Promise<void> {
  const [settings, secrets] = await Promise.all([getGlobalSettings(), getIntegrationSecrets()]);

  if (settings.automationPaused) {
    logger.info("[hourly-outreach-sync] Automation paused — skipping.");
    return;
  }

  if (!secrets.instantlyApiKey) {
    logger.info("[hourly-outreach-sync] Instantly.ai not configured — skipping reply sync.");
    await writeLog({
      type: "automation.hourly_outreach_sync",
      level: "info",
      message: "Instantly.ai API key not configured. Configure it in Settings > Integrations to enable reply tracking.",
      metadata: {}
    });
    return;
  }

  const snapshot = await adminDb
    .collection("outreach")
    .where("status", "in", ["sent", "exported"])
    .limit(100)
    .get();

  if (snapshot.empty) {
    logger.info("[hourly-outreach-sync] No sent outreach to sync.");
    return;
  }

  logger.info(`[hourly-outreach-sync] Syncing ${snapshot.size} outreach records.`);

  let replied = 0;
  let bounced = 0;
  let errors = 0;

  for (const doc of snapshot.docs) {
    const data = doc.data();
    const contactId = typeof data.contactId === "string" ? data.contactId : undefined;
    if (!contactId) continue;

    try {
      const contactSnapshot = await adminDb.collection("contacts").doc(contactId).get();
      if (!contactSnapshot.exists) continue;
      const email = contactSnapshot.data()?.email as string | undefined;
      if (!email) continue;

      const status = await fetchInstantlyLeadStatus(secrets.instantlyApiKey, email);

      if (status === "replied") {
        await doc.ref.set({ status: "replied", lastInteractionAt: Timestamp.now(), updatedAt: Timestamp.now() }, { merge: true });
        if (data.companyId) {
          await adminDb.collection("companies").doc(data.companyId as string).set({ status: "replied", lastActivityAt: Timestamp.now(), updatedAt: Timestamp.now() }, { merge: true });
        }
        replied++;
      } else if (status === "bounced") {
        await doc.ref.set({ status: "bounced", lastInteractionAt: Timestamp.now(), updatedAt: Timestamp.now() }, { merge: true });
        bounced++;
      }
    } catch (error) {
      logger.warn(`[hourly-outreach-sync] Error syncing outreach ${doc.id}: ${error instanceof Error ? error.message : error}`);
      errors++;
    }
  }

  await writeLog({
    type: "automation.hourly_outreach_sync",
    level: "info",
    message: `Outreach sync completed. ${replied} replied, ${bounced} bounced, ${errors} errors.`,
    metadata: { checked: snapshot.size, replied, bounced, errors }
  });
}

async function fetchInstantlyLeadStatus(apiKey: string, email: string): Promise<"replied" | "bounced" | "active" | "unknown"> {
  const url = `https://api.instantly.ai/api/v1/lead/get?api_key=${encodeURIComponent(apiKey)}&email=${encodeURIComponent(email)}`;
  const res = await fetch(url, { signal: AbortSignal.timeout(10000) });
  if (!res.ok) return "unknown";
  const data = await res.json() as Record<string, unknown>;
  const replyStatus = data.reply_data as Record<string, unknown> | undefined;
  if (replyStatus?.replied) return "replied";
  if (data.status === "Bounced") return "bounced";
  return "active";
}
