import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { adminDb } from "../config/firebase.js";
import { getResearchProvider } from "../providers/ai/index.js";
import { getAiSecrets, getGlobalSettings } from "../utils/settings.js";
import { writeLog } from "../utils/logger.js";
import { OUTREACH_PROMPT_VERSION } from "./outreach-prompts.js";
import { outreachOutputSchema } from "./outreach-schema.js";
import { updateCompanyLeadReadiness } from "./lead-readiness.js";

type OutreachStatus = "draft" | "approved" | "rejected" | "needs_more_research";
type FirestoreRecord = Record<string, unknown> & { id: string; completedAt?: Timestamp; name?: string };

async function latestCompletedResearch(companyId: string) {
  const snapshot = await adminDb.collection("leadResearch").where("companyId", "==", companyId).where("status", "==", "completed").limit(10).get();
  return snapshot.docs
    .map((doc) => ({ id: doc.id, ...doc.data() }) as FirestoreRecord)
    .sort((a, b) => {
      const left = a.completedAt instanceof Timestamp ? a.completedAt.toMillis() : 0;
      const right = b.completedAt instanceof Timestamp ? b.completedAt.toMillis() : 0;
      return right - left;
    })[0];
}

function compact(value: FirestoreRecord | undefined) {
  if (!value) return undefined;
  const copy = { ...value };
  delete copy.rawProviderData;
  return copy;
}

async function assertGenerationLimit(limit: number) {
  const date = new Date();
  date.setHours(0, 0, 0, 0);
  const snapshot = await adminDb
    .collection("outreach")
    .where("createdAt", ">=", Timestamp.fromDate(date))
    .count()
    .get();
  const count = snapshot.data().count;
  if (count >= limit) throw new Error(`Daily email generation limit reached (${count}/${limit}).`);
}

export async function generateOutreach(input: { companyId: string; contactId?: string; campaignId?: string; force?: boolean; outreachId?: string }) {
  const startedAt = Date.now();
  const settings = await getGlobalSettings();
  if (settings.automationPaused && !input.force) throw new Error("Automation is paused. Use force only for an explicit manual generation.");
  await assertGenerationLimit(settings.dailyEmailGenerationLimit);

  const companySnapshot = await adminDb.collection("companies").doc(input.companyId).get();
  if (!companySnapshot.exists) throw new Error("Company not found.");
  const company = { id: companySnapshot.id, ...companySnapshot.data() } as FirestoreRecord;
  if (!company.name) throw new Error("Company must have a name before outreach generation.");
  const readiness = await updateCompanyLeadReadiness(input.companyId);
  if (!readiness.leadReadyForOutreach && !input.force) {
    throw new Error(`Lead is not ready for outreach: ${readiness.leadReadinessReasons.join(" ")}`);
  }

  const research = await latestCompletedResearch(input.companyId);
  if (!research && !input.force) throw new Error("Completed AI research is required before outreach generation.");

  const contactSnapshot = input.contactId ? await adminDb.collection("contacts").doc(input.contactId).get() : undefined;
  const contact = contactSnapshot?.exists ? ({ id: contactSnapshot.id, ...contactSnapshot.data() } as FirestoreRecord) : undefined;
  const campaignSnapshot = input.campaignId ? await adminDb.collection("campaigns").doc(input.campaignId).get() : undefined;
  const campaign = campaignSnapshot?.exists ? ({ id: campaignSnapshot.id, ...campaignSnapshot.data() } as FirestoreRecord) : undefined;

  const provider = getResearchProvider(settings, await getAiSecrets());
  await writeLog({
    type: "outreach.generation.start",
    level: "info",
    message: "Outreach generation started.",
    metadata: { companyId: input.companyId, contactId: input.contactId, campaignId: input.campaignId, provider: provider.name, model: provider.model }
  });

  const rawInput = {
    company: compact(company),
    contact: compact(contact),
    research: compact(research),
    campaign: compact(campaign),
    devcommContext: settings.companyContext,
    promptVersion: OUTREACH_PROMPT_VERSION
  };

  try {
    const result = await provider.generateStructuredOutreach({
      company: rawInput.company ?? {},
      contact: rawInput.contact,
      research: rawInput.research ?? { status: "missing", note: "No completed research was available." },
      campaign: rawInput.campaign,
      devcommContext: settings.companyContext,
      promptVersion: OUTREACH_PROMPT_VERSION,
      settings
    });
    const output = outreachOutputSchema.parse(result.output);
    const now = Timestamp.now();
    const data: Record<string, any> = {
      companyId: input.companyId,
      contactId: input.contactId,
      campaignId: input.campaignId,
      researchId: typeof research?.id === "string" ? research.id : undefined,
      status: "draft" as OutreachStatus,
      generatedSubject: output.subject,
      generatedBody: output.body,
      followUp1: output.followUp1,
      followUp2: output.followUp2,
      linkedinNote: output.linkedinConnectionNote,
      linkedinFollowUp: output.linkedinFollowUp,
      internalSalesNotes: output.internalSalesNotes,
      suggestedPersona: output.suggestedPersona,
      cta: output.cta,
      personalizationNotes: output.personalizationNotes,
      riskWarnings: output.riskWarnings,
      landingPageDraft: output.landingPageDraft,
      aiProvider: result.provider,
      model: result.model,
      promptVersion: OUTREACH_PROMPT_VERSION,
      rawInput,
      rawOutput: result.rawOutput,
      createdAt: now,
      updatedAt: now,
      estimatedInputTokens: result.estimatedInputTokens,
      estimatedOutputTokens: result.estimatedOutputTokens,
      estimatedCost: result.estimatedCost ?? 0
    };

    const outreachRef = input.outreachId ? adminDb.collection("outreach").doc(input.outreachId) : adminDb.collection("outreach").doc();
    if (input.outreachId) {
      data.rejectionReason = FieldValue.delete();
      data.approvedAt = FieldValue.delete();
      data.approvedBy = FieldValue.delete();
      await outreachRef.update(data);
    } else {
      await outreachRef.set(data);
    }
    await adminDb.collection("companies").doc(input.companyId).set({ lastActivityAt: now, updatedAt: now }, { merge: true });
    await writeLog({
      type: "outreach.generation.completed",
      level: "info",
      message: "Outreach draft generated.",
      metadata: { companyId: input.companyId, outreachId: outreachRef.id, provider: result.provider, model: result.model, durationMs: Date.now() - startedAt }
    });
    return { outreachId: outreachRef.id, status: "draft" };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Outreach generation failed.";
    await writeLog({ type: "outreach.generation.failed", level: "error", message, metadata: { companyId: input.companyId, durationMs: Date.now() - startedAt } });
    throw error;
  }
}

export async function updateOutreachDraft(outreachId: string, fields: Record<string, unknown>) {
  const snapshot = await adminDb.collection("outreach").doc(outreachId).get();
  if (!snapshot.exists) throw new Error("Outreach not found.");
  const current = snapshot.data();
  const allowed = [
    "generatedSubject",
    "generatedBody",
    "followUp1",
    "followUp2",
    "linkedinNote",
    "linkedinFollowUp",
    "internalSalesNotes",
    "suggestedPersona",
    "cta",
    "personalizationNotes",
    "riskWarnings"
  ];
  const updates = Object.fromEntries(Object.entries(fields).filter(([key]) => allowed.includes(key)));
  await snapshot.ref.set({ ...updates, status: current?.status === "approved" ? "draft" : current?.status ?? "draft", updatedAt: Timestamp.now() }, { merge: true });
  await writeLog({ type: "outreach.updated", level: "info", message: "Outreach draft edited.", metadata: { outreachId } });
  return { outreachId, status: current?.status === "approved" ? "draft" : current?.status ?? "draft" };
}

export async function setOutreachStatus(outreachId: string, status: OutreachStatus, userId?: string, reason?: string) {
  const settings = await getGlobalSettings();
  const snapshot = await adminDb.collection("outreach").doc(outreachId).get();
  if (!snapshot.exists) throw new Error("Outreach not found.");
  const updates: Record<string, unknown> = { status, updatedAt: Timestamp.now() };
  if (status === "approved") {
    updates.approvedAt = Timestamp.now();
    updates.approvedBy = userId ?? "unknown";
    updates.rejectionReason = FieldValue.delete();
  }
  if (status === "rejected") updates.rejectionReason = reason ?? "Rejected manually.";
  if (status === "needs_more_research") updates.rejectionReason = reason ?? "Needs more research before outreach.";
  await snapshot.ref.set(updates, { merge: true });
  await writeLog({ type: `outreach.${status}`, level: status === "approved" ? "info" : "warning", message: `Outreach marked ${status}.`, metadata: { outreachId, reason } });

  if (status === "approved" && settings.autoSendAfterApproval) {
    try {
      const { sendApprovedOutreach } = await import("./send-outreach.js");
      await sendApprovedOutreach(outreachId);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      await writeLog({
        type: "outreach.auto_send.failed",
        level: "error",
        message: `Failed to auto-send approved outreach: ${msg}`,
        metadata: { outreachId }
      });
    }
  }

  return { outreachId, status };
}
