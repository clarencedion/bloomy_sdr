import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { adminDb } from "../config/firebase.js";
import { resolveTargetSegment, shouldSkipPaidEnrichment } from "./target-segment.js";
import { DropcontactProvider } from "../providers/enrichment/dropcontact-provider.js";
import { SecondaryEnrichmentProvider } from "../providers/enrichment/secondary-provider.js";
import type { EnrichmentProvider } from "../providers/enrichment/enrichment-provider.js";
import type { OfferDoc } from "../types/domain.js";
import { getIntegrationSecrets } from "../utils/settings.js";
import { writeLog } from "../utils/logger.js";
import { rankContactsForOffer, isJobTitleIrrelevant, type CandidateContact, type RankedCandidateContact } from "./persona-ranker.js";
import { verifyContactEmail } from "./contact-verifier.js";
import { updateCompanyLeadReadiness } from "./lead-readiness.js";

export type WaterfallResult = {
  found: number;
  created: number;
  updated: number;
  skipped: number;
  stageReached: "pre_enrichment_gate" | "segment_gate" | "website" | "dropcontact" | "secondary" | "completed";
  primaryContact?: RankedCandidateContact;
  contacts: RankedCandidateContact[];
  error?: string;
};

export type WaterfallOptions = {
  offerId?: string;
  offer?: OfferDoc | null;
  secondaryProvider?: EnrichmentProvider;
  forceSecondary?: boolean;
};

type CompanyRecord = {
  id: string;
  workspaceId?: string;
  businessId?: string;
  name?: string;
  domain?: string;
  website?: string;
  siren?: string;
  siret?: string;
  status?: string;
  fitScore?: number;
  qualificationState?: string;
  bestOffer?: string;
  offerId?: string;
  opportunityScore?: {
    overallScore?: number;
    qualificationState?: string;
  };
};

function normEmail(email: string): string {
  return email.trim().toLowerCase().replace(/^mailto:/, "");
}

function stripUndefined<T extends Record<string, unknown>>(obj: T): T {
  return Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined)) as T;
}

/**
 * REQ-047: Multi-Provider Contact Waterfall
 * Cascading search: Website Contacts -> Dropcontact -> Secondary Provider
 * with negative role filtering (REQ-044), offer persona ranking (REQ-043),
 * and strict email verification (REQ-048).
 */
export async function runContactWaterfall(
  companyId: string,
  options: WaterfallOptions = {}
): Promise<WaterfallResult> {
  const companySnapshot = await adminDb.collection("companies").doc(companyId).get();
  if (!companySnapshot.exists) {
    throw new Error(`Company not found: ${companyId}`);
  }

  const company = { id: companySnapshot.id, ...companySnapshot.data() } as CompanyRecord;
  if (!company.name) {
    throw new Error("Company must have a name for contact discovery.");
  }

  // 1. REQ-040: Cost-Saving Pre-Enrichment Gate
  const isDisqualified =
    company.qualificationState === "DISQUALIFIED" ||
    company.opportunityScore?.qualificationState === "DISQUALIFIED" ||
    company.status === "rejected" ||
    (typeof company.opportunityScore?.overallScore === "number" && company.opportunityScore.overallScore < 40);

  // Paid person-lookup is skipped entirely for very small businesses: measured
  // against French salons it returned organisation-only data every time, so the
  // credits buy nothing. Their contact comes from the website and the registry.
  const companyFields = company as unknown as Record<string, unknown>;
  const targetSegment = resolveTargetSegment({
    campaignSegment: companyFields.targetSegment as string | undefined,
    employeeCount:
      typeof companyFields.employeeCount === "number" ? (companyFields.employeeCount as number) : undefined
  });

  if (
    shouldSkipPaidEnrichment({
      campaignSegment: companyFields.targetSegment as string | undefined,
      employeeCount:
        typeof companyFields.employeeCount === "number" ? (companyFields.employeeCount as number) : undefined
    })
  ) {
    await writeLog({
      type: "contact_waterfall.skipped_small_business",
      level: "info",
      message: `${company.name}: small-business segment — using published contact details instead of paid enrichment.`,
      workspaceId: companyFields.workspaceId as string | undefined,
      businessId: companyFields.businessId as string | undefined,
      metadata: { companyId, targetSegment, employeeCount: companyFields.employeeCount ?? null }
    });
    return {
      found: 0,
      created: 0,
      updated: 0,
      skipped: 0,
      stageReached: "segment_gate",
      contacts: []
    };
  }

  if (isDisqualified) {
    const reason = `Company is DISQUALIFIED (score: ${company.opportunityScore?.overallScore ?? company.fitScore ?? 0}). Skipped waterfall to save API costs.`;
    await writeLog({
      type: "contact_waterfall.pre_enrichment_gate_blocked",
      level: "info",
      message: reason,
      metadata: { companyId, qualificationState: company.qualificationState ?? company.opportunityScore?.qualificationState }
    });
    return {
      found: 0,
      created: 0,
      updated: 0,
      skipped: 1,
      stageReached: "pre_enrichment_gate",
      contacts: [],
      error: reason
    };
  }

  // 2. Resolve target Offer for Persona Priority Ranking (REQ-043)
  let offerDoc: OfferDoc | null = options.offer ?? null;
  if (!offerDoc) {
    const targetOfferId = options.offerId || company.offerId || company.bestOffer;
    if (targetOfferId && company.businessId) {
      // Offers are workspace-scoped, not a top-level collection.
      const offerSnap = await adminDb
        .doc(`workspaces/${company.workspaceId || "ws_default"}/businesses/${company.businessId}/offers/${targetOfferId}`)
        .get();
      if (offerSnap.exists) {
        offerDoc = { id: offerSnap.id, ...offerSnap.data() } as OfferDoc;
      }
    }
  }

  const candidatePool: CandidateContact[] = [];
  let stageReached: WaterfallResult["stageReached"] = "website";

  // Stage 1: Load any existing crawled website contacts for this company
  const existingContactsSnap = await adminDb
    .collection("contacts")
    .where("companyId", "==", companyId)
    .get();

  for (const doc of existingContactsSnap.docs) {
    const data = doc.data();
    candidatePool.push({
      id: doc.id,
      fullName: data.fullName,
      role: data.role,
      jobTitle: data.role,
      email: data.email,
      phone: data.phone,
      emailVerified: data.emailVerified,
      emailQualification: data.emailQualification,
      source: data.source ?? "website",
      sourceType: data.sourceType ?? "website",
      confidence: data.sourceConfidence ?? 0.7
    });
  }

  // Stage 2: Dropcontact Primary Enrichment Client (REQ-045)
  const secrets = await getIntegrationSecrets();
  let dropcontactFound = 0;

  if (secrets.dropcontactApiKey) {
    stageReached = "dropcontact";
    const dropcontactProvider = new DropcontactProvider(secrets.dropcontactApiKey);

    try {
      const dropcontactResults = await dropcontactProvider.findContactsForCompany({
        companyName: company.name,
        domain: company.domain,
        siren: company.siren,
        siret: company.siret
      });

      dropcontactFound = dropcontactResults.length;

      for (const item of dropcontactResults) {
        candidatePool.push({
          firstName: item.firstName,
          lastName: item.lastName,
          fullName: item.fullName ?? ([item.firstName, item.lastName].filter(Boolean).join(" ") || undefined),
          role: item.jobTitle,
          jobTitle: item.jobTitle,
          email: item.email,
          phone: item.phone,
          emailQualification: item.emailQualification,
          emailVerified: item.emailQualification === "verified",
          confidence: item.confidence,
          source: "dropcontact",
          sourceType: "enrichment"
        });
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await writeLog({
        type: "contact_waterfall.dropcontact_failed",
        level: "warning",
        message: `Dropcontact enrichment error: ${message}`,
        metadata: { companyId }
      });
    }
  }

  // Stage 3: Secondary Provider Fallback (REQ-047)
  const secondaryProvider = options.secondaryProvider ?? (options.forceSecondary ? new SecondaryEnrichmentProvider() : undefined);
  if (dropcontactFound === 0 && secondaryProvider) {
    stageReached = "secondary";
    try {
      const secondaryResults = await secondaryProvider.findContactsForCompany({
        companyName: company.name,
        domain: company.domain,
        siren: company.siren,
        siret: company.siret
      });

      for (const item of secondaryResults) {
        candidatePool.push({
          firstName: item.firstName,
          lastName: item.lastName,
          fullName: item.fullName ?? ([item.firstName, item.lastName].filter(Boolean).join(" ") || undefined),
          role: item.jobTitle,
          jobTitle: item.jobTitle,
          email: item.email,
          phone: item.phone,
          emailQualification: item.emailQualification,
          emailVerified: item.emailQualification === "verified",
          confidence: item.confidence,
          source: secondaryProvider.name,
          sourceType: "enrichment"
        });
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await writeLog({
        type: "contact_waterfall.secondary_failed",
        level: "warning",
        message: `Secondary provider error: ${message}`,
        metadata: { companyId }
      });
    }
  }

  // 4. Negative Role Filtering (REQ-044)
  const filteredCandidates = candidatePool.filter((contact) => {
    const title = contact.role ?? contact.jobTitle;
    return !isJobTitleIrrelevant(title);
  });

  // 5. Deduplicate candidates across sources
  // Key: normalized email if present, else normalized fullName
  const deduplicatedMap = new Map<string, CandidateContact>();

  for (const candidate of filteredCandidates) {
    const emailKey = candidate.email ? normEmail(candidate.email) : undefined;
    const nameKey = candidate.fullName ? candidate.fullName.trim().toLowerCase() : undefined;
    const key = emailKey || nameKey;

    if (!key) continue;

    const existing = deduplicatedMap.get(key);
    if (!existing) {
      deduplicatedMap.set(key, candidate);
    } else {
      // Merge records, giving precedence to verified email / more complete data
      const preferCandidate =
        (!existing.emailVerified && candidate.emailVerified) ||
        (!existing.email && candidate.email) ||
        (existing.emailQualification !== "verified" && candidate.emailQualification === "verified");

      if (preferCandidate) {
        deduplicatedMap.set(key, {
          ...existing,
          ...candidate,
          id: existing.id || candidate.id
        });
      }
    }
  }

  const uniqueCandidates = Array.from(deduplicatedMap.values());

  // 6. Offer Persona Priority Ranking (REQ-043)
  const rankedContacts = rankContactsForOffer(uniqueCandidates, offerDoc);

  // 7. Strict Email Verification Gating (REQ-048) & Persistence
  let created = 0;
  let updated = 0;
  let skipped = 0;
  const now = Timestamp.now();

  for (const contact of rankedContacts) {
    const emailVerification = verifyContactEmail({
      email: contact.email,
      emailQualification: contact.emailQualification,
      source: String(contact.source ?? ""),
      sourceType: String(contact.sourceType ?? "")
    });

    const contactDocData = {
      workspaceId: company.workspaceId,
      businessId: company.businessId,
      companyId,
      firstName: contact.firstName,
      lastName: contact.lastName,
      fullName: contact.fullName,
      role: contact.role ?? contact.jobTitle,
      email: emailVerification.normalizedEmail ?? contact.email,
      normalizedEmail: emailVerification.normalizedEmail,
      phone: contact.phone,
      status: emailVerification.emailVerified ? ("verified" as const) : ("new" as const),
      emailVerified: emailVerification.emailVerified,
      emailQualification: emailVerification.emailQualification,
      requiresVerification: emailVerification.requiresVerification,
      personaMatched: contact.personaMatched,
      personaPriority: contact.personaPriority,
      personaMatchScore: contact.personaMatchScore,
      isPrimaryDecisionMaker: contact.isPrimaryDecisionMaker ?? false,
      source: contact.source ?? "enrichment",
      sourceType: contact.sourceType ?? "enrichment",
      sourceConfidence: typeof contact.confidence === "number" ? contact.confidence : 0.8,
      qualityScore: emailVerification.emailVerified ? 90 : 65,
      dataQualityWarnings: emailVerification.requiresVerification ? ["unverified_email"] : [],
      doNotContact: false,
      updatedAt: now
    };

    if (contact.id) {
      await adminDb.collection("contacts").doc(contact.id).set(stripUndefined(contactDocData), { merge: true });
      updated++;
    } else {
      const newDocRef = await adminDb.collection("contacts").add(stripUndefined({
        ...contactDocData,
        createdAt: now
      }));
      contact.id = newDocRef.id;
      created++;
    }
  }

  // 8. Update Company metadata & lead readiness
  await adminDb.collection("companies").doc(companyId).set(
    {
      lastActivityAt: now,
      updatedAt: now,
      needsContactDiscovery: FieldValue.delete(),
      // Finding a contact is exactly the change that makes a previously
      // impossible outreach possible, so the permanent block is lifted here and
      // the daily runner will pick the company up again.
      ...(created + updated > 0
        ? { outreachBlockedReason: FieldValue.delete(), outreachBlockedAt: FieldValue.delete() }
        : {})
    },
    { merge: true }
  );

  await updateCompanyLeadReadiness(companyId);

  stageReached = "completed";

  await writeLog({
    type: "contact_waterfall.completed",
    level: "info",
    message: `Contact waterfall completed for ${company.name}: ${created} created, ${updated} updated, ${rankedContacts.length} total qualified contacts.`,
    metadata: {
      companyId,
      found: rankedContacts.length,
      created,
      updated,
      skipped,
      primaryContact: rankedContacts.find((c) => c.isPrimaryDecisionMaker)?.fullName
    }
  });

  return {
    found: rankedContacts.length,
    created,
    updated,
    skipped,
    stageReached,
    primaryContact: rankedContacts.find((c) => c.isPrimaryDecisionMaker),
    contacts: rankedContacts
  };
}
