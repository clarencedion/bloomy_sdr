import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { adminDb } from "../config/firebase.js";
import { getResearchProvider } from "../providers/ai/index.js";
import { getAiSecrets, getGlobalSettings } from "../utils/settings.js";
import { writeLog } from "../utils/logger.js";
import { OUTREACH_PROMPT_VERSION } from "./outreach-prompts.js";
import { outreachOutputSchema } from "./outreach-schema.js";
import { updateCompanyLeadReadiness } from "./lead-readiness.js";
import { getBusiness, getKnowledgeBase, listOffers } from "./business-service.js";
import { buildBusinessContext } from "./business-context.js";
import { recordAiSpend } from "./cost-guardrail-service.js";
import { isThirdPartyEmail } from "./third-party-domains.js";
import { extractPersonalizationFacts, getValidEvidence } from "./evidence-service.js";
import { validateOutreachClaims } from "./claim-validator.js";
import { reserveDailyQuota } from "./daily-quota.js";
import { checkPricingStatements } from "./pricing-guardrail.js";
import { generateProposalPdf } from "./pdf-generator.js";
import { resolveOfferAssignment } from "./offer-experiment.js";
import { EXPERIMENT_WITHOUT_LINE, modelCopyIssues, modelPartsOf, reviewSocialDmText, TERMS_LINE_UNUSED } from "./social-dm-terms.js";
import { judgeDmCopy } from "./social-dm-judge.js";
import { conversationPartsOf, INTRO_LINE_UNUSED, reviewConversationDm } from "./social-dm-conversation.js";

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

/**
 * Strips fields the copywriter cannot use from a document before it is sent.
 *
 * Measured on a real prospect: the research document sent into every draft was
 * 4,454 tokens, of which `rawInput` (2,206) and `rawOutput` (1,123) were the
 * request and response payloads of the *previous* AI call being echoed straight
 * back into the next one - 75% of that block, carrying nothing the parsed
 * fields beside them do not already say. The company document was 1,109 tokens
 * where the writer uses about 108.
 *
 * This is not a quality tradeoff. Nothing removed here is a fact about the
 * prospect; every one is bookkeeping about how the fact was produced.
 */
const NON_CONTENT_FIELDS = [
  "rawProviderData",
  // The previous call's own prompt and raw HTTP response.
  "rawInput",
  "rawOutput",
  // Internal plumbing the writer never quotes.
  "embedding",
  "normalizedName",
  "dedupeKey",
  "sourceConfidence",
  "needsResearch",
  "needsContactDiscovery",
  "lockedAt",
  "startedAt"
] as const;

/** Research's free-text guess at which offer fits (offer-experiment drafts drop it). */
const RESEARCH_OFFER_GUESS_FIELDS = ["bestOffer", "bestDevcommOffer"] as const;

function compact(value: FirestoreRecord | undefined) {
  if (!value) return undefined;
  const copy = { ...value };
  for (const field of NON_CONTENT_FIELDS) delete copy[field];
  return copy;
}

/**
 * Daily generation quota, counted per business.
 *
 * This used to count EVERY outreach document created today across the whole
 * database - other businesses and test fixtures included - so a handful of real
 * drafts reported "105/50" and every further generation was refused. The quota
 * exists to bound one business's spend, so that is what it must measure.
 */

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

  let contactSnapshot = input.contactId ? await adminDb.collection("contacts").doc(input.contactId).get() : undefined;

  // No contact was named: pick the best one we found for this company, so the
  // draft records who it is addressed to instead of leaving the reviewer to
  // guess.
  if (!contactSnapshot?.exists) {
    const candidates = await adminDb
      .collection("contacts")
      .where("companyId", "==", input.companyId)
      .limit(20)
      .get();

    const ranked = candidates.docs
      .filter((doc) => typeof doc.data().email === "string" && doc.data().email.includes("@"))
      // A booking platform's support address is not the prospect.
      .filter((doc) => !isThirdPartyEmail(doc.data().email))
      .sort((a, b) => {
        const rank = (d: { data: () => Record<string, unknown> }) => {
          const data = d.data();
          return (data.isPrimaryDecisionMaker ? 2 : 0) + (data.emailVerified ? 1 : 0);
        };
        return rank(b) - rank(a);
      });

    contactSnapshot = ranked[0];
  }

  const contact = contactSnapshot?.exists
    ? ({ id: contactSnapshot.id, ...contactSnapshot.data() } as FirestoreRecord)
    : undefined;
  const resolvedContactId = (contact?.id as string | undefined) ?? input.contactId;
  const campaignSnapshot = input.campaignId ? await adminDb.collection("campaigns").doc(input.campaignId).get() : undefined;
  const campaign = campaignSnapshot?.exists ? ({ id: campaignSnapshot.id, ...campaignSnapshot.data() } as FirestoreRecord) : undefined;
  // The pipeline passes a *discovery* campaign id (company.discoveryCampaignId),
  // which never resolves in `campaigns`. Read it for attribution only — the
  // prompt still receives `campaign`, unchanged.
  const discoverySnapshot =
    !campaign && input.campaignId ? await adminDb.collection("discoveryCampaigns").doc(input.campaignId).get().catch(() => null) : null;
  const discoveryCampaign = discoverySnapshot?.exists ? (discoverySnapshot.data() as FirestoreRecord) : undefined;

  // Retrieve Multi-Business context
  const workspaceId =
    (campaign?.workspaceId as string) || (discoveryCampaign?.workspaceId as string) || (company.workspaceId as string) || "ws_default";
  const businessId =
    (campaign?.businessId as string) || (discoveryCampaign?.businessId as string) || (company.businessId as string) || undefined;
  // Copy is written in a business's name, about its offer, under its approved
  // terms. Without one, the only possible pitch is someone else's (ADR-016 #6).
  if (!businessId) {
    throw new Error(`Company ${input.companyId} is not attributed to any business; outreach is written in a business's name.`);
  }
  const [business, offers, evidenceItems, knowledgeBase] = await Promise.all([
    getBusiness(workspaceId, businessId),
    listOffers(workspaceId, businessId),
    getValidEvidence(input.companyId),
    getKnowledgeBase(workspaceId, businessId)
  ]);

  // An offer experiment picks the offer of a never-contacted prospect first;
  // a prospect already assigned keeps its variant (offer-experiment.ts).
  const assignment = await resolveOfferAssignment({
    workspaceId,
    businessId,
    companyId: input.companyId,
    preloaded: { business, offers }
  });
  // company.offerId is stamped at discovery; bestOffer is free text from
  // research and only matches when the model happened to echo an id.
  const offerId =
    (assignment.experimentId ? assignment.offerId : undefined) ||
    (campaign?.offerId as string) ||
    (discoveryCampaign?.offerId as string) ||
    (company.offerId as string) ||
    (company.bestOffer as string) ||
    undefined;

  // An id that matches no offer falls back to the business's first offer —
  // never to none, which validated every draft against empty terms and flagged
  // each honest statement of the offer as unsupported.
  const selectedOffer = (offerId ? offers.find((o) => o.id === offerId) : undefined) ?? offers[0] ?? null;
  // Stamped only when the draft really pitches the assigned variant.
  const offerExperimentId =
    assignment.experimentId && selectedOffer?.id === assignment.offerId ? assignment.experimentId : undefined;

  // Never describe "our company" from the workspace-wide default: it names a
  // single business and made every other business pitch the wrong thing.
  const businessContext = await buildBusinessContext({
    workspaceId,
    businessId,
    offerId: selectedOffer?.id
  });

  // One unit of today's generation quota, taken atomically right before the
  // model call — after every check that could still refuse this company.
  await reserveDailyQuota("outreach_generation", { workspaceId, businessId }, settings.dailyEmailGenerationLimit, (used, limit) =>
    `Daily email generation limit reached (${used}/${limit}).`
  );

  // Extract high-confidence personalization facts (confidence >= 70)
  const personalizationFacts = extractPersonalizationFacts(evidenceItems, company);

  const provider = getResearchProvider(settings, await getAiSecrets());
  await writeLog({
    type: "outreach.generation.start",
    level: "info",
    message: "Outreach generation started with evidence grounding.",
    metadata: {
      companyId: input.companyId,
      contactId: resolvedContactId,
      campaignId: input.campaignId,
      businessId,
      offerId: selectedOffer?.id,
      ...(offerExperimentId ? { offerExperimentId } : {}),
      factCount: personalizationFacts.length,
      provider: provider.name,
      model: provider.model
    }
  });

  // Under an offer experiment the offer is decided above, not by research:
  // research's `bestOffer` names the offer it was run against — often with its
  // price — and would put another variant's terms into this prompt.
  const withoutOfferGuess = (record: FirestoreRecord | undefined) => {
    if (!record || !assignment.experimentId) return record;
    const copy = { ...record };
    for (const field of RESEARCH_OFFER_GUESS_FIELDS) delete copy[field];
    return copy;
  };

  const rawInput = {
    company: withoutOfferGuess(compact(company)),
    contact: compact(contact),
    research: withoutOfferGuess(compact(research)),
    campaign: compact(campaign),
    personalizationFacts,
    offer: selectedOffer,
    business,
    devcommContext: businessContext,
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
      devcommContext: businessContext,
      promptVersion: OUTREACH_PROMPT_VERSION,
      settings
    });
    const output = outreachOutputSchema.parse(result.output);

    // Real tokens, real model. This used to be recorded as a flat $0.015
    // attributed to "openai" regardless of what actually ran.
    await recordAiSpend({
      workspaceId,
      businessId,
      provider: result.provider,
      model: result.model,
      operation: "outreach_generation",
      companyId: input.companyId,
      usage: {
        inputTokens: result.estimatedInputTokens,
        outputTokens: result.estimatedOutputTokens
      }
    }).catch(() => undefined);


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
      offerExperimentId,
      companyId: input.companyId,
      contactId: resolvedContactId,
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
      // Surfaced on the approval card for every channel (pricing-guardrail.ts).
      // The detector is advisory; mentionsCommercialTerms is the fail-closed
      // flag automation must respect.
      ...(() => {
        const pricing = checkPricingStatements(
          [output.subject, output.body, output.followUp1, output.followUp2, output.linkedinConnectionNote, output.linkedinFollowUp]
            .filter(Boolean)
            .join("\n"),
          selectedOffer?.pricingGuardrails
        );
        return { pricingGuardrailPassed: pricing.passed, mentionsCommercialTerms: pricing.mentionsCommercialTerms };
      })(),
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

    // Regenerating replaces the draft under review; it does not queue a second
    // one. Without this, `force` only reused a document when the caller already
    // knew its id, so regenerating by companyId appended a draft every time —
    // three regeneration rounds over ten companies left thirty surplus drafts
    // in the approval queue, and the badge counted more messages to approve
    // than there were people to send them to.
    //
    // Only a *draft* may be replaced. An approved or sent message is a record
    // of something that happened and must never be overwritten by a new draft.
    let targetId = input.outreachId;
    if (!targetId && input.force) {
      // This tenant's email draft only: a DM or contact-form draft of the
      // same company is another channel's message, never rewritten as an email.
      const existingDraft = await adminDb
        .collection("outreach")
        .where("workspaceId", "==", workspaceId)
        .where("companyId", "==", input.companyId)
        .where("status", "==", "draft")
        .limit(20)
        .get();
      targetId = existingDraft.docs.find((doc) => doc.data().channel !== "social_dm" && doc.data().channel !== "contact_form")?.id;
    }

    const outreachRef = targetId ? adminDb.collection("outreach").doc(targetId) : adminDb.collection("outreach").doc();
    if (targetId) {
      data.rejectionReason = FieldValue.delete();
      data.approvedAt = FieldValue.delete();
      data.approvedBy = FieldValue.delete();
      // A redraft outside the experiment must not keep the old draft's tag.
      if (!offerExperimentId) data.offerExperimentId = FieldValue.delete();
      // The draft keeps the date it first appeared, so the approval queue stays
      // ordered by when the SDR found the prospect, not by when it last rewrote.
      delete data.createdAt;
      await outreachRef.update(data);
    } else {
      await outreachRef.set(data);
    }

    // Auto-generate proposal PDF (REQ-054), unless this business does not send
    // one. A document is a real commitment - it is what the prospect forwards
    // internally - so attaching one is a choice, not a default.
    // Not generating one is a decision, not a failure: routing it through the
    // catch below would log a warning for something that went exactly as asked.
    if (business?.proposalDocument?.enabled !== false) {
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
  // A manual edit is checked against the same offer terms as the generated
  // draft; without them every honest statement of the offer was flagged.
  const draftWorkspaceId = (current?.workspaceId as string) || "ws_default";
  const draftBusinessId = current?.businessId as string | undefined;
  const [draftOffers, draftKnowledgeBase] = draftBusinessId
    ? await Promise.all([listOffers(draftWorkspaceId, draftBusinessId), getKnowledgeBase(draftWorkspaceId, draftBusinessId)])
    : [[], null];
  const draftOffer = draftOffers.find((o) => o.id === current?.offerId) ?? draftOffers[0] ?? null;

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
    personalizationFacts: (updates.personalizationFacts ?? current?.personalizationFacts ?? []) as any,
    offer: draftOffer,
    knowledgeBase: draftKnowledgeBase
  });

  updates.claimValidationStatus = validationResult.status;
  updates.claimValidationDetails = validationResult;
  // The approval card's badges follow the edited text, not the original draft.
  const editedPricing = checkPricingStatements(
    [
      updates.generatedSubject ?? current?.generatedSubject,
      updates.generatedBody ?? current?.generatedBody,
      updates.followUp1 ?? current?.followUp1,
      updates.followUp2 ?? current?.followUp2,
      updates.linkedinNote ?? current?.linkedinNote,
      updates.linkedinFollowUp ?? current?.linkedinFollowUp
    ]
      .filter(Boolean)
      .join("\n"),
    draftOffer?.pricingGuardrails
  );
  updates.pricingGuardrailPassed = editedPricing.passed;
  updates.mentionsCommercialTerms = editedPricing.mentionsCommercialTerms;
  // Only a person edits through here (the update callable): a redraft script
  // must never overwrite this text.
  updates.humanEditedAt = Timestamp.now();
  if (current?.channel === "social_dm") {
    const previousBody = String(current?.generatedBody ?? "");
    const editedBody = String(updates.generatedBody ?? previousBody);
    if (editedBody.trim() === previousBody.trim()) {
      // Nothing the prospect reads changed: the stored review stands (a
      // re-check of the same text would only lose what generation knew).
      delete updates.pricingGuardrailPassed;
      delete updates.mentionsCommercialTerms;
      delete updates.riskWarnings;
    } else {
      // The same review as generation (social-dm-terms.ts): with the terms
      // line intact, the line against the offer and the rest by the strict
      // money check; otherwise the whole text against the offer. Warnings
      // about the offer itself (unusable line, experiment without one) are
      // not about the text and are kept.
      const termsLine = typeof current?.offerTermsLine === "string" ? current.offerTermsLine : undefined;
      // A conversation-style draft (social-dm-conversation.ts) carries the
      // sender's introduction instead of a terms line; the text around it is
      // judged and reviewed the same way.
      const introLine = !termsLine && typeof current?.dmIntroLine === "string" && current.dmIntroLine ? current.dmIntroLine : undefined;
      // The model judge reads the text around the terms line again: a person's
      // one-word fix must not erase what it found in the rest (fail-closed).
      const storedObservation =
        introLine && typeof current?.dmObservationLine === "string" && current.dmObservationLine ? current.dmObservationLine : undefined;
      // A person who deletes the observation (it may be wrong for this
      // prospect) gets a draft without one: reviewed and judged like any
      // other, not flagged for ever. Altered or moved, it is flagged.
      const observationLine = storedObservation && editedBody.includes(storedObservation) ? storedObservation : undefined;
      if (storedObservation && !observationLine) {
        updates.dmObservationLine = FieldValue.delete();
        updates.dmObservationKind = FieldValue.delete();
      }
      const parts = introLine ? conversationPartsOf(editedBody, introLine, observationLine) : modelPartsOf(editedBody, termsLine);
      const partsText = parts ? `${parts.opening}\n${parts.question}` : "";
      const verdict =
        parts && !modelCopyIssues(partsText).length
          ? await judgeDmCopy({
              text: partsText,
              workspaceId: draftWorkspaceId,
              businessId: draftBusinessId,
              companyId: current?.companyId as string | undefined
            })
          : undefined;
      const judged = verdict?.status === "states_terms" ? [`AI judge ("${verdict.quote}")`] : [];
      const conversationReview = introLine
        ? reviewConversationDm({
            body: editedBody,
            introLine,
            observationLine,
            terms: draftOffer?.pricingGuardrails,
            checkShape: true,
            extraIssues: judged
          })
        : undefined;
      const review =
        conversationReview ??
        reviewSocialDmText({
          body: editedBody,
          termsLine,
          terms: draftOffer?.pricingGuardrails,
          checkShape: true,
          extraIssues: judged
        });
      if (conversationReview) updates.dmIntroLineIntact = conversationReview.dmIntroLineIntact;
      const unjudged = verdict?.status === "unavailable";
      const offerWarnings = ((current?.riskWarnings ?? []) as unknown[])
        .map(String)
        .filter(
          (warning) =>
            warning.startsWith(TERMS_LINE_UNUSED) || warning.startsWith(EXPERIMENT_WITHOUT_LINE) || warning.startsWith(INTRO_LINE_UNUSED)
        );
      updates.pricingGuardrailPassed = review.pricingGuardrailPassed && !unjudged && !offerWarnings.length;
      updates.mentionsCommercialTerms = review.mentionsCommercialTerms;
      updates.riskWarnings = [
        ...offerWarnings,
        ...review.riskWarnings,
        ...(unjudged
          ? [
              introLine
                ? "Relecture par l'IA de contrôle indisponible : vérifiez qu'aucune condition commerciale n'est sous-entendue dans ce message."
                : "Relecture par l'IA de contrôle indisponible : vérifiez qu'aucune condition commerciale n'est sous-entendue hors de la phrase de l'offre."
            ]
          : [])
      ];
      // A conversation draft that looks clean after the edit and that an
      // automatic session would still hold says why, as at generation.
      if (introLine && updates.pricingGuardrailPassed === true && !(updates.riskWarnings as string[]).length) {
        const { autoSendVerdict, describeAutoHold } = await import("./social/social-session-service.js");
        const verdict = await autoSendVerdict({ ...current, ...updates, generatedBody: editedBody }).catch(
          (): { allowed: boolean; reason?: string; detail?: string } => ({ allowed: false, reason: "claims_not_checkable" })
        );
        if (!verdict.allowed) (updates.riskWarnings as string[]).push(describeAutoHold(verdict));
      }
      if (review.offerTermsLineIntact !== undefined) updates.offerTermsLineIntact = review.offerTermsLineIntact;
    }
  }

  const written = {
    ...updates,
    status: current?.status === "approved" ? "draft" : current?.status ?? "draft",
    updatedAt: Timestamp.now()
  };
  // Only over the text this review was made of: a send, a redraft or another
  // edit saved since it was read wins, and this edit is refused.
  await adminDb.runTransaction(async (transaction) => {
    const fresh = await transaction.get(snapshot.ref);
    const readAt = snapshot.updateTime;
    const nowAt = fresh.updateTime;
    if (readAt && nowAt && !readAt.isEqual(nowAt)) {
      throw new Error("This draft changed while it was being edited (sent, regenerated or edited elsewhere): reload it and edit again.");
    }
    transaction.set(snapshot.ref, written, { merge: true });
  });

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
