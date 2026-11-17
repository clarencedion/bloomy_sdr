import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { adminDb } from "../config/firebase.js";
import { getResearchProvider } from "../providers/ai/index.js";
import type { SocialNetwork, SocialProfileRef } from "../types/domain.js";
import { getAiSecrets, getGlobalSettings } from "../utils/settings.js";
import { writeLog } from "../utils/logger.js";
import { extractPersonalizationFacts, getValidEvidence } from "./evidence-service.js";
import { buildBusinessContext } from "./business-context.js";

import { getBusiness, listOffers } from "./business-service.js";
import { resolveOfferAssignment } from "./offer-experiment.js";
import { recordAiSpend } from "./cost-guardrail-service.js";
import { AiUnavailableError } from "./ai-structured-call.js";
import { SOCIAL_DM_LOCKS, socialDmLockId } from "./social/social-gate.js";
import { parseSocialProfileUrl, resolveCompanySocialProfiles, type CompanySocialProfiles } from "./social/social-profile.js";
import {
  DEFAULT_SOCIAL_DM_SYSTEM_PROMPT,
  DEFAULT_SOCIAL_DM_USER_PROMPT,
  SOCIAL_DM_CODE_TERMS_SYSTEM_PROMPT,
  SOCIAL_DM_CONVERSATION_SYSTEM_PROMPT,
  socialDmCodeTermsUserPrompt,
  socialDmConversationUserPrompt
} from "./outreach-prompts.js";
import {
  approvedIntroLine,
  composeConversationDm,
  conversationFacts,
  conversationShapeProblems,
  reviewConversationDm
} from "./social-dm-conversation.js";
import {
  approvedTermsLine,
  composeSocialDm,
  dmShapeProblems,
  EXPERIMENT_WITHOUT_LINE,
  modelCopyIssues,
  offerWithoutTerms,
  reviewSocialDmText,
  splitModelDm
} from "./social-dm-terms.js";
import { judgeDmCopy } from "./social-dm-judge.js";
import { pickObservation, presenceWordIn } from "./social/dm-observations.js";
import { commercialWordIn } from "./pricing-guardrail.js";

/**
 * Drafts a direct message for a prospect whose only reachable channel is a
 * public social profile.
 *
 * Nothing here sends it. A person sends every DM from the business's own
 * account: either by hand ("I sent it") or from a local session that types
 * the message and waits for a key press (Phase 23). Unattended DMs breach the
 * platforms' terms and would risk the operator's account, so no code path
 * ever sends one without that person.
 */

export interface SocialDmResult {
  outreachId: string;
  channel: "social_dm";
  profileUrl: string;
  body: string;
}

/**
 * A DM that already reached the prospect (or that they refused). Redrafting
 * it would put the company back in the queue for a second first message.
 */
const SETTLED_DM_STATUSES = new Set(["sent", "replied", "exported", "meeting_booked", "bounced", "suppressed"]);

/** States in which marking the draft sent again would record a second send. */
const ALREADY_SENT_STATUSES = new Set(["sent", "replied", "exported", "meeting_booked"]);

/**
 * Fields only an email draft has. A forced regeneration of a DM removes
 * them: if the email generator ever overwrote this draft, its subject and
 * follow-ups must not survive into a direct message.
 */
const EMAIL_ONLY_FIELDS = [
  "generatedSubject",
  "followUp1",
  "followUp2",
  "linkedinNote",
  "linkedinFollowUp",
  "cta",
  "suggestedPersona",
  "landingPageDraft",
  "pdfStorageUrl",
  "pdfDocumentId",
  "claimValidationStatus",
  "claimValidationDetails"
] as const;

/**
 * The best public profile we can point a person at: Instagram first (for
 * these trades it is where the owner actually reads), then Facebook. Never a
 * link-in-bio page, which cannot receive a message.
 */
export async function findSocialProfileUrl(companyId: string): Promise<string | undefined> {
  // Callers treat "no profile" as "no DM channel"; an unreadable company is the same answer.
  const profiles = await resolveCompanySocialProfiles(companyId).catch((): CompanySocialProfiles => ({}));
  return profiles.instagram?.url ?? profiles.facebook?.url;
}

export async function generateSocialDm(input: {
  companyId: string;
  campaignId?: string;
  force?: boolean;
  /**
   * With `force`: rewrite only a draft nobody has reviewed — still "draft",
   * never edited by a person. Operator redraft scripts set it.
   */
  onlyIfUnreviewed?: boolean;
}): Promise<SocialDmResult> {
  const settings = await getGlobalSettings();
  // Same rule as email generation: a paused SDR drafts nothing on its own.
  if (settings.automationPaused && !input.force) {
    throw new Error("Automation is paused. Use force only for an explicit manual generation.");
  }

  const companySnapshot = await adminDb.collection("companies").doc(input.companyId).get();
  if (!companySnapshot.exists) throw new Error("Company not found.");
  const company = { id: companySnapshot.id, ...companySnapshot.data() } as Record<string, unknown>;

  const workspaceId = (company.workspaceId as string) || "ws_default";
  const businessId = (company.businessId as string) || "";
  // Copy is written in a business's name, about its offer, under its approved
  // terms. Without one, the only possible pitch is someone else's (ADR-016 #6).
  if (!businessId) {
    throw new Error(`Company ${input.companyId} is not attributed to any business; outreach is written in a business's name.`);
  }

  // Both networks are stored, so a session on either one can send the draft.
  const profiles = await resolveCompanySocialProfiles(input.companyId);
  const profileUrl = profiles.instagram?.url ?? profiles.facebook?.url;
  if (!profileUrl) throw new Error("No public social profile found for this company.");

  const existing = await adminDb
    .collection("outreach")
    .where("workspaceId", "==", workspaceId)
    .where("companyId", "==", input.companyId)
    .where("channel", "==", "social_dm")
    .limit(1)
    .get();
  if (!existing.empty && !input.force) {
    const doc = existing.docs[0];
    return {
      outreachId: doc.id,
      channel: "social_dm",
      profileUrl,
      body: String(doc.data().generatedBody ?? "")
    };
  }
  if (!existing.empty && SETTLED_DM_STATUSES.has(String(existing.docs[0].data().status))) {
    throw new Error(
      `The direct message to ${String(company.name ?? input.companyId)} is already ${String(existing.docs[0].data().status)}; it cannot be drafted again.`
    );
  }
  if (!existing.empty && input.onlyIfUnreviewed) {
    const current = existing.docs[0].data();
    // Edits keep the status "draft": `humanEditedAt` marks them, and older
    // ones the claim validation only the edit path writes.
    // The old email generator also wrote claimValidationStatus when it took
    // over a DM draft; with its subject or follow-up there, nobody edited it.
    const emailOverwrite = Boolean(current.generatedSubject || current.followUp1);
    if (current.status !== "draft" || current.humanEditedAt || (current.claimValidationStatus && !emailOverwrite)) {
      throw new Error(
        `The direct message to ${String(company.name ?? input.companyId)} was reviewed by a person (${String(current.status)}${current.humanEditedAt || current.claimValidationStatus ? ", edited" : ""}); it is left as it is.`
      );
    }
  }

  // The mock provider would write canned consulting text in this prospect's
  // name, one key press away from being sent. A DM is written by a real
  // model or not at all.
  const provider = getResearchProvider(settings, await getAiSecrets());
  if (provider.name === "mock") {
    throw new AiUnavailableError(
      "No AI provider is configured, so no direct message can be drafted: add a Qwen or Anthropic key in Settings."
    );
  }

  const [business, offers, evidenceItems] = await Promise.all([
    getBusiness(workspaceId, businessId),
    listOffers(workspaceId, businessId),
    getValidEvidence(input.companyId)
  ]);

  // An offer experiment picks the offer of a never-contacted prospect before
  // anything else does; a prospect already assigned keeps its variant.
  const assignment = await resolveOfferAssignment({
    workspaceId,
    businessId,
    companyId: input.companyId,
    preloaded: { business, offers }
  });
  const offerId = (assignment.experimentId ? assignment.offerId : undefined) || (company.offerId as string) || undefined;

  const offer = offerId ? offers.find((o) => o.id === offerId) ?? offers[0] : offers[0];
  // Stamped only when the draft really pitches the assigned variant.
  const offerExperimentId = assignment.experimentId && offer?.id === assignment.offerId ? assignment.experimentId : undefined;

  const offerContext = await buildBusinessContext({
    workspaceId,
    businessId,
    offerId: offer?.id
  });

  // Only high-confidence verified facts reach the prompt: a DM that cites
  // something wrong is worse than no DM at all. Labelled like the email
  // path's ("154 avis clients sur Google"): a bare value lets the model guess
  // what 154 counts.
  const allFacts = extractPersonalizationFacts(evidenceItems, company);

  // An offer that declares a terms line states its terms in the business's
  // own words, inserted by code: the model writes around it, reads the line
  // only to lead into it, and sees no other phrasing of the terms
  // (social-dm-terms.ts). Without one, the model states the terms itself, as
  // before, and the check below is all that stands behind them.
  //
  // A business that opens a conversation instead (`socialDmOpening`,
  // social-dm-conversation.ts) states no term at all in its first message:
  // the model writes one true thing about the prospect and one question, code
  // inserts the sender's own introduction, and the offer's terms wait for the
  // reply. The prospect is still assigned its variant above.
  const intro = approvedIntroLine(business?.socialDmOpening);
  const introLine = intro.line;
  const terms = introLine ? {} : approvedTermsLine(offer?.pricingGuardrails);
  const termsLine = terms.line;
  const promptVersion = introLine ? "social-dm-v3-conversation" : termsLine ? "social-dm-v2-terms" : "social-dm-v1";
  // What the message says of the prospect's online presence is written here,
  // from the evidence, or not at all (social/dm-observations.ts): at most one
  // sentence, of a kind the business asked for, that the evidence states
  // plainly. The model is kept off that subject.
  const observation = introLine ? pickObservation(business?.socialDmOpening?.observations, evidenceItems, company) : undefined;
  // A conversation opens on something worth saying: never an address or a
  // registration number, which the plain list puts first.
  const facts = introLine ? conversationFacts(allFacts) : allFacts.slice(0, 12);

  // The provider builds its prompt from `settings`, so swapping in the DM
  // prompts reuses the whole generation path without a new provider method.
  const dmSettings = {
    ...settings,
    outreachSystemPrompt: introLine
      ? SOCIAL_DM_CONVERSATION_SYSTEM_PROMPT
      : termsLine
        ? SOCIAL_DM_CODE_TERMS_SYSTEM_PROMPT
        : DEFAULT_SOCIAL_DM_SYSTEM_PROMPT,
    outreachUserPrompt: introLine
      ? socialDmConversationUserPrompt(input.companyId)
      : termsLine
        ? socialDmCodeTermsUserPrompt(termsLine, input.companyId)
        : DEFAULT_SOCIAL_DM_USER_PROMPT
  };

  type DmOutput = { body?: string; cta?: string; internalSalesNotes?: string; personalizationNotes?: string[] };
  const generate = async (): Promise<DmOutput> => {
    const result = await provider.generateStructuredOutreach({
      // Conversation style: the model is kept off the prospect's online
      // presence, so it is handed nothing about it — not their address, not
      // the needs and the angle research derived from their page ("refonte
      // du site vieillissant…"), which carry no confidence at all.
      company: introLine ? { name: company.name, city: company.city } : { name: company.name, city: company.city, website: company.website },
      contact: undefined,
      research: introLine
        ? { detectedNeeds: [], angle: "" }
        : {
            detectedNeeds: (company.opportunityScore as { detectedNeeds?: string[] })?.detectedNeeds ?? [],
            angle: (company.opportunityScore as { recommendedAngle?: string })?.recommendedAngle ?? ""
          },
      campaign: input.campaignId ? { id: input.campaignId } : undefined,
      personalizationFacts: facts,
      // No priced line of the offer reaches a model that must not state a term.
      offer: (termsLine || introLine) && offer ? offerWithoutTerms(offer) : offer,
      business,
      devcommContext: offerContext,
      promptVersion,
      settings: dmSettings
    } as never);

    // Real tokens, real model, like every other generation; a failed spend
    // record never costs the draft.
    await recordAiSpend({
      workspaceId,
      businessId,
      provider: result.provider,
      model: result.model,
      operation: "social_dm_generation",
      companyId: input.companyId,
      usage: { inputTokens: result.estimatedInputTokens, outputTokens: result.estimatedOutputTokens }
    }).catch(() => undefined);

    return result.output as DmOutput;
  };

  let parsed: DmOutput;
  let body: string;
  const shapeWarnings: string[] = [];
  let judgeIssues: string[] = [];
  let judgeUnavailable = false;
  if (termsLine || introLine) {
    // At most two drafts: a second one when the model talked money, left a
    // part empty, asked two questions or wrote a bare greeting. The better
    // of the two is kept — any money talk ranks below any shape problem,
    // since money talk is what corrupts the comparison — and whatever is
    // still wrong is shown on the draft: a person reads every DM before it
    // goes.
    const attempt = async () => {
      const output = await generate();
      const parts = splitModelDm(output);
      const words = modelCopyIssues(`${parts.opening}\n${parts.question}`);
      // The judge reads for paraphrases only when the words are clean: a draft
      // already caught is redrafted anyway.
      const verdict = words.length
        ? undefined
        : await judgeDmCopy({ text: `${parts.opening}\n${parts.question}`, workspaceId, businessId, companyId: input.companyId });
      const judged = verdict?.status === "states_terms" ? [`AI judge ("${verdict.quote}")`] : [];
      const issues = [...words, ...judged];
      const shape = introLine ? conversationShapeProblems(parts, { businessName: business?.name }) : dmShapeProblems(parts);
      // The model's parts say nothing of the prospect's online presence
      // (closed vocabulary, like money): a word of that subject is redrafted,
      // and named on the draft if it stays.
      const modelText = `${parts.opening}\n${parts.question}`;
      const presence = introLine ? presenceWordIn(modelText) : undefined;
      // A word of the broad commercial vocabulary the prompt does not name
      // ("café", "toute la semaine") keeps the message out of automatic
      // sessions (conversationAutoHoldReason). Unsaid, the draft would look
      // clean and never leave: it is redrafted too.
      const broadWord = introLine && !issues.length ? commercialWordIn(modelText) : undefined;
      const score =
        (parts.opening ? 0 : 1000) +
        (issues.length ? 100 + issues.length : 0) +
        (presence ? 50 : 0) +
        (broadWord ? 30 : 0) +
        shape.length * 10;
      return { output, parts, judged, unjudged: verdict?.status === "unavailable", shape, score };
    };
    let best = await attempt();
    if (best.score > 0) {
      // A failed second call must not cost a usable first draft.
      const second = await attempt().catch(() => undefined);
      if (second && second.score < best.score) best = second;
    }
    if (!best.parts.opening) throw new Error("The model returned an empty direct message.");
    parsed = best.output;
    body = introLine
      ? composeConversationDm({ opening: best.parts.opening, observationLine: observation?.line, introLine, question: best.parts.question })
      : composeSocialDm({ opening: best.parts.opening, termsLine: termsLine as string, question: best.parts.question });
    shapeWarnings.push(...best.shape);
    judgeIssues = best.judged;
    if (best.unjudged) judgeUnavailable = true;
  } else {
    parsed = await generate();
    body = String(parsed.body ?? "").trim();
    if (!body) throw new Error("The model returned an empty direct message.");
  }

  // Same commercial-terms check as email (pricing-guardrail.ts). A person
  // sends these, so a violation is shown on the draft rather than blocking it.
  // With a terms line, the line is checked against the offer and the model's
  // text by the strict money check (reviewSocialDmText) — the same review a
  // person's edit gets.
  // A conversation-style message states no term: everything around the
  // business's intro line is held to the strict money check instead.
  // (Its review names a word of the two closed vocabularies itself.)
  const conversationReview = introLine
    ? reviewConversationDm({ body, introLine, observationLine: observation?.line, terms: offer?.pricingGuardrails, extraIssues: judgeIssues })
    : undefined;
  const review = conversationReview ?? reviewSocialDmText({ body, termsLine, terms: offer?.pricingGuardrails, extraIssues: judgeIssues });
  // A text nobody could read for paraphrases is not "checked": the operator confirms it.
  const judgeWarnings = judgeUnavailable
    ? [
        introLine
          ? "Relecture par l'IA de contrôle indisponible : vérifiez qu'aucune condition commerciale n'est sous-entendue dans ce message."
          : "Relecture par l'IA de contrôle indisponible : vérifiez qu'aucune condition commerciale n'est sous-entendue hors de la phrase de l'offre."
      ]
    : [];
  // Not in the conversation style: that message states no term, so the model
  // wrote none and the variants are compared on what the reply says.
  const experimentWithoutLine =
    offerExperimentId && !termsLine && !introLine
      ? [`${EXPERIMENT_WITHOUT_LINE} : les conditions de ce DM sont rédigées par l'IA, la comparaison des offres est faussée.`]
      : [];
  // The business asked for the conversation style and its intro line cannot
  // be used: the draft falls back to the offer's terms and says why.
  const introProblem = intro.problem ? [intro.problem] : [];

  const now = Timestamp.now();
  const payload = {
    workspaceId,
    businessId,
    offerId: offer?.id,
    offerExperimentId,
    companyId: input.companyId,
    campaignId: input.campaignId ?? (company.discoveryCampaignId as string | undefined),
    // Marks this as a message a person sends from the business's own account.
    channel: "social_dm" as const,
    // Kept for the approvals card and older readers: Instagram first.
    socialProfileUrl: profileUrl,
    socialProfiles: {
      ...(profiles.instagram ? { instagram: profiles.instagram } : {}),
      ...(profiles.facebook ? { facebook: profiles.facebook } : {})
    },
    status: "draft" as const,
    generatedBody: body,
    internalSalesNotes: parsed.internalSalesNotes ?? "",
    personalizationNotes: parsed.personalizationNotes ?? [],
    // An experiment draft whose terms the model wrote (no usable line) is not
    // the variant's message: the operator confirms it like a failed check.
    // prettier-ignore
    pricingGuardrailPassed: review.pricingGuardrailPassed && !judgeUnavailable && !terms.problem && !experimentWithoutLine.length && !introProblem.length,
    mentionsCommercialTerms: review.mentionsCommercialTerms,
    riskWarnings: [
      ...introProblem,
      ...(terms.problem ? [terms.problem] : []),
      ...experimentWithoutLine,
      ...review.riskWarnings,
      ...judgeWarnings,
      ...shapeWarnings
    ],
    // The exact sentence code put in the message, for the A/B report and audit.
    offerTermsLine: termsLine,
    offerTermsLineIntact: review.offerTermsLineIntact,
    // Conversation style: the sender's introduction code put in the message,
    // and the observation it stated from the evidence, if any.
    dmIntroLine: introLine,
    dmIntroLineIntact: conversationReview?.dmIntroLineIntact,
    dmObservationLine: observation?.line,
    dmObservationKind: observation?.kind,
    aiProvider: provider.name,
    model: provider.model,
    promptVersion,
    updatedAt: now
  };
  // A conversation draft that looks clean and that an automatic session would
  // still hold (a figure no evidence holds, a town, a promise…) says so: a
  // clean-looking draft that never leaves is a bug, and the person who then
  // sends it with a key should know what to look at.
  if (introLine && payload.pricingGuardrailPassed && !payload.riskWarnings.length) {
    const { autoSendVerdict, describeAutoHold } = await import("./social/social-session-service.js");
    const verdict = await autoSendVerdict(
      Object.fromEntries(Object.entries(payload).filter(([, value]) => value !== undefined))
    ).catch((): { allowed: boolean; reason?: string; detail?: string } => ({ allowed: false, reason: "claims_not_checkable" }));
    if (!verdict.allowed) payload.riskWarnings.push(describeAutoHold(verdict));
  }
  // Firestore is set to ignore undefined values; stripping them here keeps
  // that true whatever the client settings.
  const fields = Object.fromEntries(Object.entries(payload).filter(([, value]) => value !== undefined));

  const ref = existing.empty ? adminDb.collection("outreach").doc() : existing.docs[0].ref;
  if (existing.empty) {
    await ref.set({ ...fields, createdAt: now });
  } else {
    // `update` replaces each field it names as a whole. A merging `set` would
    // deep-merge `socialProfiles` and keep a network research no longer
    // finds (a wrong page scraped earlier), which a session would then DM.
    //
    // Only if the draft is still the one read before the model call: a send
    // recorded, an edit or an approval made meanwhile wins over this text.
    const update = {
      ...fields,
      ...Object.fromEntries(EMAIL_ONLY_FIELDS.map((field) => [field, FieldValue.delete()])),
      // A redraft outside the experiment must not keep the old draft's tag.
      ...(offerExperimentId ? {} : { offerExperimentId: FieldValue.delete() }),
      // Nor a terms line its offer no longer declares.
      ...(termsLine ? {} : { offerTermsLine: FieldValue.delete(), offerTermsLineIntact: FieldValue.delete() }),
      // Nor an introduction its business no longer asks for.
      ...(introLine ? {} : { dmIntroLine: FieldValue.delete(), dmIntroLineIntact: FieldValue.delete() }),
      ...(observation ? {} : { dmObservationLine: FieldValue.delete(), dmObservationKind: FieldValue.delete() }),
      // A new text replaces the person's edit along with its marker.
      humanEditedAt: FieldValue.delete()
    };
    const unchangedSince = existing.docs[0].updateTime;
    await (unchangedSince ? ref.update(update, { lastUpdateTime: unchangedSince }) : ref.update(update)).catch((error: unknown) => {
      const code = (error as { code?: unknown })?.code;
      if (code === 9 || code === "failed-precondition" || code === "FAILED_PRECONDITION") {
        throw new Error(
          `The direct message to ${String(company.name ?? input.companyId)} changed while it was being rewritten (sent, edited or reviewed); the new text was not saved.`
        );
      }
      throw error;
    });
  }

  await writeLog({
    type: "outreach.social_dm.drafted",
    level: "info",
    message: `Direct message prepared for ${company.name}.`,
    workspaceId,
    businessId,
    metadata: {
      companyId: input.companyId,
      outreachId: ref.id,
      profileUrl,
      businessName: business?.name,
      offerId: offer?.id,
      ...(offerExperimentId ? { offerExperimentId } : {})
    }
  });

  return { outreachId: ref.id, channel: "social_dm", profileUrl, body };
}

type ParsedProfile = SocialProfileRef & { network: SocialNetwork };

/** Every profile a draft names, at most one per network (the stored map first, then the legacy link). */
function draftProfiles(draft: Record<string, unknown>): Partial<Record<SocialNetwork, ParsedProfile>> {
  const stored = (draft.socialProfiles ?? {}) as Record<string, { url?: unknown } | undefined>;
  const found: Partial<Record<SocialNetwork, ParsedProfile>> = {};
  for (const raw of [stored.instagram?.url, stored.facebook?.url, draft.socialProfileUrl]) {
    const parsed = typeof raw === "string" ? parseSocialProfileUrl(raw) : null;
    if (parsed && !found[parsed.network]) found[parsed.network] = parsed;
  }
  return found;
}

/**
 * The profile a hand-sent DM went to. The network is the one the person
 * names; without it, only a draft with a single network is unambiguous. A
 * draft that names both and a caller that does not say which one was used
 * gets no conversation rather than one on the wrong network, where the
 * prospect's reply would never be swept.
 */
function handSentProfile(draft: Record<string, unknown>, network: SocialNetwork | undefined): ParsedProfile | undefined {
  const profiles = draftProfiles(draft);
  if (network) return profiles[network];
  const all = Object.values(profiles);
  return all.length === 1 ? all[0] : undefined;
}

/**
 * Records that a person sent the message by hand, so the prospect leaves the
 * queue and the company — and the social account — take their one-message
 * lock.
 *
 * `network` is the network the person used ("I sent it on Facebook"). When
 * it is known, the DM opens a conversation on that network exactly like a
 * session send, so the reply has somewhere to land. Otherwise (or for a
 * contact form, or an account already messaged from another draft) the draft
 * is only marked sent.
 *
 * Idempotent: a second click, or a second tab, records nothing and logs
 * nothing. Sends made from a local session are recorded by
 * `recordSocialDmSent`.
 */
export async function markSocialDmSent(input: {
  outreachId: string;
  sentByUserId?: string;
  network?: SocialNetwork;
}): Promise<{ success: boolean; alreadySent?: boolean }> {
  if (input.network !== undefined && input.network !== "instagram" && input.network !== "facebook") {
    throw new Error(`Unknown social network: ${String(input.network)}.`);
  }
  const ref = adminDb.collection("outreach").doc(input.outreachId);
  const now = Timestamp.now();

  const current = (await ref.get()).data();
  const company = current?.companyId
    ? (await adminDb.collection("companies").doc(String(current.companyId)).get()).data()
    : undefined;
  const workspaceId = (current?.workspaceId as string | undefined) || "ws_default";
  // A company whose first DM came from another draft keeps that lock and its
  // conversation; this hand-sent one is still recorded below (it was sent).
  const lockedByAnother = Boolean(company?.socialDmSentAt) && company?.socialDmOutreachId !== input.outreachId;
  if (
    current?.channel === "social_dm" &&
    current.businessId &&
    !lockedByAnother &&
    !ALREADY_SENT_STATUSES.has(String(current.status))
  ) {
    const profile = handSentProfile(current, input.network);
    const body = String(current.generatedBody ?? "").trim();
    // The account's own lock: another company document for the same account
    // already opened the conversation there.
    const accountLockRef = profile
      ? adminDb.collection(SOCIAL_DM_LOCKS).doc(socialDmLockId(workspaceId, String(current.businessId), profile.network, profile.handle))
      : undefined;
    const accountLock = accountLockRef ? (await accountLockRef.get()).data() : undefined;
    const accountLockedByAnother = Boolean(accountLock) && accountLock?.outreachId !== input.outreachId;
    if (profile && body && !accountLockedByAnother) {
      const { recordSocialDmSent } = await import("./social/social-session-service.js");
      await recordSocialDmSent({
        outreachId: input.outreachId,
        network: profile.network,
        profile: { url: profile.url, handle: profile.handle },
        finalBody: body,
        edited: false,
        verified: true,
        operator: input.sentByUserId,
        via: "by_hand"
      });
      return { success: true };
    }
  }

  const marked = await adminDb.runTransaction(async (transaction) => {
    const snap = await transaction.get(ref);
    if (!snap.exists) throw new Error("Draft not found.");
    const data = snap.data() ?? {};
    // The same button confirms a hand-sent DM and a hand-filled contact form —
    // both are channels a person completes off-platform.
    const isForm = data.channel === "contact_form";
    if (ALREADY_SENT_STATUSES.has(String(data.status))) return { data, isForm, alreadySent: true };

    const companyRef = data.companyId ? adminDb.collection("companies").doc(String(data.companyId)) : null;
    const companySnap = companyRef ? await transaction.get(companyRef) : null;

    // Which account got the DM is unknown here (no network given, or no
    // profile on it), so every account the draft names takes the lock: none
    // of them may get another "first" message from a duplicate company.
    const dmWorkspaceId = (data.workspaceId as string | undefined) || "ws_default";
    const accountLocks =
      data.channel === "social_dm"
        ? Object.values(draftProfiles(data)).map((profile) => ({
            profile,
            ref: adminDb
              .collection(SOCIAL_DM_LOCKS)
              .doc(socialDmLockId(dmWorkspaceId, String(data.businessId ?? ""), profile.network, profile.handle))
          }))
        : [];
    const lockSnaps: Array<{ exists: boolean }> = [];
    for (const lock of accountLocks) lockSnaps.push(await transaction.get(lock.ref));

    transaction.set(
      ref,
      {
        status: "sent",
        sentAt: now,
        ...(input.sentByUserId ? { sentByUserId: input.sentByUserId } : {}),
        sentVia: "by_hand",
        ...(input.network && !isForm ? { sentNetwork: input.network } : {}),
        updatedAt: now
      },
      { merge: true }
    );

    if (companyRef && companySnap?.exists) {
      const company = companySnap.data() ?? {};
      transaction.set(
        companyRef,
        {
          status: "contacted",
          lastActivityAt: now,
          updatedAt: now,
          // Holds the one-message-per-company limit on both channels. The
          // first DM keeps the lock; a later one never moves it.
          ...(isForm
            ? { contactFormSentAt: now }
            : company.socialDmSentAt
            ? {}
            : { socialDmSentAt: now, socialDmOutreachId: input.outreachId })
        },
        { merge: true }
      );
    }

    accountLocks.forEach((lock, index) => {
      // An account already locked keeps the draft that locked it first.
      if (lockSnaps[index].exists) return;
      transaction.set(lock.ref, {
        id: lock.ref.id,
        workspaceId: dmWorkspaceId,
        ...(data.businessId ? { businessId: data.businessId } : {}),
        network: lock.profile.network,
        handle: lock.profile.handle,
        ...(data.companyId ? { companyId: data.companyId } : {}),
        outreachId: input.outreachId,
        lockedAt: now
      });
    });

    return { data, isForm, alreadySent: false };
  });

  if (marked.alreadySent) return { success: true, alreadySent: true };

  const { data, isForm } = marked;
  await writeLog({
    type: isForm ? "outreach.contact_form.sent" : "outreach.social_dm.sent",
    level: "info",
    message: isForm ? "Contact form sent by hand." : "Direct message sent by hand.",
    workspaceId: data.workspaceId as string | undefined,
    businessId: data.businessId as string | undefined,
    metadata: {
      outreachId: input.outreachId,
      companyId: data.companyId,
      ...(isForm
        ? { pageUrl: data.contactFormUrl, byHand: true }
        : { profileUrl: data.socialProfileUrl, byHand: true, ...(input.network ? { channel: input.network } : {}) })
    }
  });

  return { success: true };
}
