import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { adminDb } from "../config/firebase.js";
import { getResearchProvider } from "../providers/ai/index.js";
import { getAiSecrets, getGlobalSettings } from "../utils/settings.js";
import { writeLog } from "../utils/logger.js";
import { OUTREACH_PROMPT_VERSION } from "./outreach-prompts.js";
import { outreachOutputSchema } from "./outreach-schema.js";
import { updateCompanyLeadReadiness } from "./lead-readiness.js";
import { getBusiness, getKnowledgeBase, listOffers } from "./business-service.js";
import { extractPersonalizationFacts, getValidEvidence } from "./evidence-service.js";
import { validateOutreachClaims } from "./claim-validator.js";
import { generateProposalPdf } from "./pdf-generator.js";

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

export async function generateOutreach(input: {
  companyId: string;
  contactId?: string;
  campaignId?: string;
  force?: boolean;
  outreachId?: string;
}) {
  const startedAt = Date.now();
  const settings = await getGlobalSettings();
  if (settings.automationPaused && !input.force) {
    throw new Error("Automation is paused. Use force only for an explicit manual generation.");
  }
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

  // Retrieve Multi-Business context
  const workspaceId = (campaign?.workspaceId as string) || (company.workspaceId as string) || "ws_default";
  const businessId = (campaign?.businessId as string) || (company.businessId as string) || "biz_devcomm";
  const offerId = (campaign?.offerId as string) || (company.bestOffer as string) || undefined;

  const [business, offers, evidenceItems, knowledgeBase] = await Promise.all([
    getBusiness(workspaceId, businessId),
    listOffers(workspaceId, businessId),
    getValidEvidence(input.companyId),
    getKnowledgeBase(workspaceId, businessId)
  ]);

  const selectedOffer = offerId ? offers.find((o) => o.id === offerId) : offers[0] || null;

  // Extract high-confidence personalization facts (confidence >= 70)
  const personalizationFacts = extractPersonalizationFacts(evidenceItems, company);

  const provider = getResearchProvider(settings, await getAiSecrets());
  await writeLog({
    type: "outreach.generation.start",
    level: "info",
    message: "Outreach generation started with evidence grounding.",
    metadata: {
      companyId: input.companyId,
      contactId: input.contactId,
      campaignId: input.campaignId,
      businessId,
      offerId: selectedOffer?.id,
      factCount: personalizationFacts.length,
      provider: provider.name,
      model: provider.model
    }
  });

  const rawInput = {
    company: compact(company),
    contact: compact(contact),
    research: compact(research),
    campaign: compact(campaign),
    personalizationFacts,
    offer: selectedOffer,
    business,
    devcommContext: settings.companyContext,
    promptVersion: OUTREACH_PROMPT_VERSION
  };

  try {
    // ── PASS 1: Structured AI Sequence Generation ─────────────
    const result = await provider.generateStructuredOutreach({
      company: rawInput.company ?? {},
      contact: rawInput.contact,
      research: rawInput.research ?? { status: "missing", note: "No completed research was available." },
      campaign: rawInput.campaign,
      personalizationFacts,
      offer: selectedOffer,
      business,
      devcommContext: settings.companyContext,
      promptVersion: OUTREACH_PROMPT_VERSION,
      settings
    });
    const output = outreachOutputSchema.parse(result.output);

    // ── PASS 2: Factual Claim Validation Gate (REQ-050) ───────
    const validationResult = validateOutreachClaims({
      sequence: {
        subject: output.subject,
        body: output.body,
        followUp1: output.followUp1,
        followUp2: output.followUp2,
        linkedinNote: output.linkedinConnectionNote,
        linkedinFollowUp: output.linkedinFollowUp
      },
      company: {
        id: company.id,
        name: typeof company.name === "string" ? company.name : undefined,
        city: typeof company.city === "string" ? company.city : undefined,
        employeeCount: typeof company.employeeCount === "number" ? company.employeeCount : undefined,
        establishmentCount: typeof company.establishmentCount === "number" ? company.establishmentCount : undefined,
        industry: typeof company.industry === "string" ? company.industry : undefined,
        domain: typeof company.domain === "string" ? company.domain : undefined,
        website: typeof company.website === "string" ? company.website : undefined
      },
      evidenceItems,
      personalizationFacts,
      offer: selectedOffer,
      knowledgeBase
    });

    const combinedRiskWarnings = [...(output.riskWarnings ?? [])];
    if (validationResult.unsupportedClaims.length > 0) {
      combinedRiskWarnings.push(...validationResult.unsupportedClaims);
    }
    if (validationResult.prohibitedPromisesDetected.length > 0) {
      combinedRiskWarnings.push(
        ...validationResult.prohibitedPromisesDetected.map((p) => `Promesse interdite détectée : "${p}"`)
      );
    }

    const now = Timestamp.now();
    const data: Record<string, any> = {
      workspaceId,
      businessId,
      offerId: selectedOffer?.id,
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
      personalizationFacts,
      claimValidationStatus: validationResult.status,
      claimValidationDetails: validationResult,
      riskWarnings: combinedRiskWarnings,
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

    // Auto-generate proposal PDF (REQ-054)
    try {
      const pdfResult = await generateProposalPdf(outreachRef.id);
      data.pdfStorageUrl = pdfResult.downloadUrl;
      data.pdfDocumentId = pdfResult.documentId;
    } catch (pdfErr) {
      const pdfMsg = pdfErr instanceof Error ? pdfErr.message : String(pdfErr);
      await writeLog({
        type: "outreach.pdf.failed",
        level: "warning",
        message: `PDF generation deferred or failed: ${pdfMsg}`,
        metadata: { outreachId: outreachRef.id, error: pdfMsg }
      });
    }

    await adminDb.collection("companies").doc(input.companyId).set({ lastActivityAt: now, updatedAt: now }, { merge: true });
    await writeLog({
      type: "outreach.generation.completed",
      level: "info",
      message: "Outreach draft generated with validation.",
      metadata: {
        companyId: input.companyId,
        outreachId: outreachRef.id,
        claimValidationStatus: validationResult.status,
        provider: result.provider,
        model: result.model,
        durationMs: Date.now() - startedAt
      }
    });

    return {
      outreachId: outreachRef.id,
      status: "draft" as OutreachStatus,
      claimValidationStatus: validationResult.status
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Outreach generation failed.";
    await writeLog({
      type: "outreach.generation.failed",
      level: "error",
      message,
      metadata: { companyId: input.companyId, durationMs: Date.now() - startedAt }
    });
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
    "riskWarnings",
    "personalizationFacts"
  ];
  const updates = Object.fromEntries(Object.entries(fields).filter(([key]) => allowed.includes(key)));

  // Re-run claim validation on manual edits
  const companySnapshot = current?.companyId
    ? await adminDb.collection("companies").doc(String(current.companyId)).get()
    : null;
  const company = companySnapshot?.exists ? companySnapshot.data() : {};
  const evidenceItems = current?.companyId ? await getValidEvidence(String(current.companyId)) : [];

  const validationResult = validateOutreachClaims({
    sequence: {
      subject: String(updates.generatedSubject ?? current?.generatedSubject ?? ""),
      body: String(updates.generatedBody ?? current?.generatedBody ?? ""),
      followUp1: String(updates.followUp1 ?? current?.followUp1 ?? ""),
      followUp2: String(updates.followUp2 ?? current?.followUp2 ?? ""),
      linkedinNote: String(updates.linkedinNote ?? current?.linkedinNote ?? ""),
      linkedinFollowUp: String(updates.linkedinFollowUp ?? current?.linkedinFollowUp ?? "")
    },
    company: {
      id: current?.companyId,
      name: company?.name,
      city: company?.city,
      employeeCount: company?.employeeCount,
      establishmentCount: company?.establishmentCount,
      industry: company?.industry
    },
    evidenceItems,
    personalizationFacts: (updates.personalizationFacts ?? current?.personalizationFacts ?? []) as any
  });

  updates.claimValidationStatus = validationResult.status;
  updates.claimValidationDetails = validationResult;

  await snapshot.ref.set(
    {
      ...updates,
      status: current?.status === "approved" ? "draft" : current?.status ?? "draft",
      updatedAt: Timestamp.now()
    },
    { merge: true }
  );

  await writeLog({
    type: "outreach.updated",
    level: "info",
    message: "Outreach draft edited and re-validated.",
    metadata: { outreachId, claimValidationStatus: validationResult.status }
  });

  return {
    outreachId,
    status: current?.status === "approved" ? "draft" : current?.status ?? "draft",
    claimValidationStatus: validationResult.status
  };
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
  await writeLog({
    type: `outreach.${status}`,
    level: status === "approved" ? "info" : "warning",
    message: `Outreach marked ${status}.`,
    metadata: { outreachId, reason }
  });

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
