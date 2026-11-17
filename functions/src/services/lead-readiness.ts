import { Timestamp, type DocumentData } from "firebase-admin/firestore";
import { adminDb } from "../config/firebase.js";
import { isContactEligibleForOutreach } from "./contact-verifier.js";
import { getSegmentPolicy, resolveTargetSegment, type TargetSegment } from "./target-segment.js";

type CompanyRecord = Record<string, unknown> & {
  id: string;
  status?: string;
  fitScore?: number;
  website?: string;
  domain?: string;
  websiteEnrichmentStatus?: string;
};

function isUsableContact(contact: DocumentData, policy: { acceptPhoneOnly: boolean }) {
  if (contact.doNotContact === true) return false;
  if (typeof contact.email === "string" && contact.email.includes("@")) {
    return true;
  }
  // At a very small business the published phone number is often the only real
  // channel, and a lead we can actually call is not "unreachable".
  if (policy.acceptPhoneOnly && typeof contact.phone === "string" && contact.phone.trim().length >= 6) {
    return true;
  }
  return false;
}

export async function computeLeadReadiness(company: CompanyRecord, segmentOverride?: TargetSegment) {
  const reasons: string[] = [];
  const contactSnapshot = await adminDb.collection("contacts").where("companyId", "==", company.id).limit(50).get();

  // How reachable a lead needs to be depends on who we are selling to: a
  // published contact@ mailbox is the owner at a salon, but will not reach a
  // Directeur Commercial at a 200-person company.
  const segment = resolveTargetSegment({
    campaignSegment: segmentOverride ?? (company.targetSegment as string | undefined),
    employeeCount: typeof company.employeeCount === "number" ? company.employeeCount : undefined
  });
  const policy = getSegmentPolicy(segment);

  const contacts = contactSnapshot.docs.map((d) => d.data());
  let hasUsableContact = contacts.some((c) => isUsableContact(c, policy));

  // No email and no phone, but a public profile we can send a DM to by hand.
  // For a tattoo studio or a barber that profile is often the only channel that
  // exists, so treating it as unreachable would discard a real prospect.
  let socialProfileUrl: string | undefined;
  if (!hasUsableContact && policy.acceptSocialDm) {
    // Guarded end to end: readiness must never fail because an evidence
    // subcollection is unavailable. Worst case we fall back to "not reachable",
    // which is the safe answer.
    try {
      const evidence = await adminDb
        .collection("companies")
        .doc(company.id)
        .collection("evidence")
        .where("signalProvider", "==", "social_profile")
        .get();

      const byKey = new Map<string, unknown>();
      evidence.forEach((doc) => byKey.set(doc.data().key, doc.data().value));
      socialProfileUrl =
        (byKey.get("instagram_url") as string) ||
        (byKey.get("facebook_url") as string) ||
        (byKey.get("link_in_bio_url") as string) ||
        undefined;

      if (socialProfileUrl) hasUsableContact = true;
    } catch {
      // No evidence available; leave the lead as unreachable.
    }
  }
  const hasVerifiedContact = contacts.some((c) => c.emailVerified === true || c.emailQualification === "verified");
  const hasResearchStatus = ["researched", "qualified", "outreach_ready", "approved", "rejected"].includes(String(company.status));

  if (!hasResearchStatus) reasons.push("AI research is not completed yet.");
  if (company.status === "rejected") reasons.push("Company has been rejected by AI research.");
  if (!hasUsableContact) {
    reasons.push(
      policy.acceptPhoneOnly
        ? "No contact email, phone number or public profile found."
        : "No named professional contact email found."
    );
  } else if (!hasVerifiedContact && contacts.length > 0) {
    // If all contacts are unverified/guessed, warn about verification requirement
    const anyEligible = contacts.some((c) => isContactEligibleForOutreach(c as any).eligible);
    if (!anyEligible) {
      // Outreach requires verified email
      // Not a hard blocker if manually approved, but noted in reasons
    }
  }

  if (!company.website && !company.domain && !hasUsableContact) {
    reasons.push("No website, domain or contact details available.");
  }
  if (company.websiteEnrichmentStatus === "failed") reasons.push("Website enrichment failed.");
  if (company.websiteEnrichmentStatus === "missing_website") reasons.push("Website enrichment could not run without a website/domain.");

  return {
    leadReadyForOutreach: reasons.length === 0,
    leadReadinessReasons: reasons,
    contactCount: contactSnapshot.size,
    verifiedContactCount: contacts.filter((c) => c.emailVerified === true).length,
    targetSegment: segment,
    socialProfileUrl
  };
}

export async function updateCompanyLeadReadiness(companyId: string) {
  const companySnapshot = await adminDb.collection("companies").doc(companyId).get();
  if (!companySnapshot.exists) return { leadReadyForOutreach: false, leadReadinessReasons: ["Company not found."], contactCount: 0 };
  const company = { id: companySnapshot.id, ...companySnapshot.data() } as CompanyRecord;
  const readiness = await computeLeadReadiness(company);
  const nextStatus = readiness.leadReadyForOutreach && ["researched", "qualified", "enriched"].includes(String(company.status)) ? "outreach_ready" : company.status;
  await companySnapshot.ref.set({ ...readiness, status: nextStatus, updatedAt: Timestamp.now() }, { merge: true });
  return readiness;
}
