import { Timestamp, type DocumentData } from "firebase-admin/firestore";
import { adminDb } from "../config/firebase.js";

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
  if (typeof contact.email === "string" && contact.email.includes("@")) return true;
  return false;
}

export async function computeLeadReadiness(company: CompanyRecord) {
  const reasons: string[] = [];
  const contactSnapshot = await adminDb.collection("contacts").where("companyId", "==", company.id).limit(50).get();
  const hasUsableContact = contactSnapshot.docs.some((doc) => isUsableContact(doc.data()));
  const hasResearchStatus = ["researched", "qualified", "outreach_ready", "approved", "rejected"].includes(String(company.status));

  if (!hasResearchStatus) reasons.push("AI research is not completed yet.");
  if (company.status === "rejected") reasons.push("Company has been rejected by AI research.");
  if (!hasUsableContact) reasons.push("No usable professional contact email found.");
  if (!company.website && !company.domain) reasons.push("No website/domain available for enrichment.");
  if (company.websiteEnrichmentStatus === "failed") reasons.push("Website enrichment failed.");
  if (company.websiteEnrichmentStatus === "missing_website") reasons.push("Website enrichment could not run without a website/domain.");

  return {
    leadReadyForOutreach: reasons.length === 0,
    leadReadinessReasons: reasons,
    contactCount: contactSnapshot.size
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
