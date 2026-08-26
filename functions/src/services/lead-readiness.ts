import { Timestamp, type DocumentData } from "firebase-admin/firestore";
import { adminDb } from "../config/firebase.js";
import { isContactEligibleForOutreach } from "./contact-verifier.js";

type CompanyRecord = Record<string, unknown> & {
  id: string;
  status?: string;
  fitScore?: number;
  website?: string;
  domain?: string;
  websiteEnrichmentStatus?: string;
};

function isUsableContact(contact: DocumentData) {
  if (contact.doNotContact === true) return false;
  if (typeof contact.email === "string" && contact.email.includes("@")) {
    return true;
  }
  return false;
}

export async function computeLeadReadiness(company: CompanyRecord) {
  const reasons: string[] = [];
  const contactSnapshot = await adminDb.collection("contacts").where("companyId", "==", company.id).limit(50).get();
  
  const contacts = contactSnapshot.docs.map((d) => d.data());
  const hasUsableContact = contacts.some((c) => isUsableContact(c));
  const hasVerifiedContact = contacts.some((c) => c.emailVerified === true || c.emailQualification === "verified");
  const hasResearchStatus = ["researched", "qualified", "outreach_ready", "approved", "rejected"].includes(String(company.status));

  if (!hasResearchStatus) reasons.push("AI research is not completed yet.");
  if (company.status === "rejected") reasons.push("Company has been rejected by AI research.");
  if (!hasUsableContact) {
    reasons.push("No usable professional contact email found.");
  } else if (!hasVerifiedContact && contacts.length > 0) {
    // If all contacts are unverified/guessed, warn about verification requirement
    const anyEligible = contacts.some((c) => isContactEligibleForOutreach(c as any).eligible);
    if (!anyEligible) {
      // Outreach requires verified email
      // Not a hard blocker if manually approved, but noted in reasons
    }
  }

  if (!company.website && !company.domain) reasons.push("No website/domain available for enrichment.");
  if (company.websiteEnrichmentStatus === "failed") reasons.push("Website enrichment failed.");
  if (company.websiteEnrichmentStatus === "missing_website") reasons.push("Website enrichment could not run without a website/domain.");

  return {
    leadReadyForOutreach: reasons.length === 0,
    leadReadinessReasons: reasons,
    contactCount: contactSnapshot.size,
    verifiedContactCount: contacts.filter((c) => c.emailVerified === true).length
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
