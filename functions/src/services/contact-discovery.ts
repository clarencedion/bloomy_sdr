import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { adminDb } from "../config/firebase.js";
import { DropcontactProvider } from "../providers/enrichment/dropcontact-provider.js";
import { getIntegrationSecrets } from "../utils/settings.js";
import { writeLog } from "../utils/logger.js";
import { updateCompanyLeadReadiness } from "./lead-readiness.js";

type CompanyRecord = {
  id: string;
  name?: string;
  domain?: string;
  website?: string;
  siren?: string;
  siret?: string;
};

function normEmail(email: string) {
  return email.trim().toLowerCase();
}

const IRRELEVANT_ROLE_KEYWORDS = [
  "commissaire aux comptes",
  "commissaire au compte",
  "expert-comptable",
  "expert comptable",
  "comptable",
  "auditeur",
  "audit",
  "stagiaire",
  "alternant",
  "apprenti",
  "avocat",
  "juriste",
  "dpo"
];

function isJobTitleIrrelevant(title?: string): boolean {
  if (!title) return false;
  const lower = title.toLowerCase();
  return IRRELEVANT_ROLE_KEYWORDS.some((kw) => lower.includes(kw));
}


export async function findContactsForCompany(companyId: string): Promise<{
  found: number;
  created: number;
  skipped: number;
  error?: string;
}> {
  const secrets = await getIntegrationSecrets();

  if (!secrets.dropcontactApiKey) {
    await writeLog({
      type: "contact_discovery.skipped",
      level: "info",
      message: "Dropcontact API key not configured. Add it in Settings > Integrations.",
      metadata: { companyId }
    });
    return { found: 0, created: 0, skipped: 0, error: "Dropcontact API key not configured." };
  }

  const companySnapshot = await adminDb.collection("companies").doc(companyId).get();
  if (!companySnapshot.exists) throw new Error(`Company not found: ${companyId}`);
  const company = { id: companySnapshot.id, ...companySnapshot.data() } as CompanyRecord;

  if (!company.name) throw new Error("Company must have a name for contact discovery.");

  const provider = new DropcontactProvider(secrets.dropcontactApiKey);

  await writeLog({ type: "contact_discovery.start", level: "info", message: "Contact discovery started via Dropcontact.", metadata: { companyId, company: company.name } });

  let enrichedContacts;
  try {
    enrichedContacts = await provider.findContactsForCompany({
      companyName: company.name,
      domain: company.domain,
      siren: company.siren,
      siret: company.siret
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await writeLog({ type: "contact_discovery.failed", level: "error", message, metadata: { companyId } });
    return { found: 0, created: 0, skipped: 0, error: message };
  }

  const existingSnapshot = await adminDb.collection("contacts").where("companyId", "==", companyId).get();
  const existingEmails = new Set(existingSnapshot.docs.map((doc) => normEmail(String(doc.data().email ?? ""))).filter(Boolean));

  let created = 0;
  let skipped = 0;

  for (const contact of enrichedContacts) {
    if (!contact.email && !contact.fullName) {
      skipped++;
      continue;
    }

    if (isJobTitleIrrelevant(contact.jobTitle)) {
      skipped++;
      continue;
    }

    const normalizedEmail = contact.email ? normEmail(contact.email) : undefined;

    if (normalizedEmail && existingEmails.has(normalizedEmail)) {
      skipped++;
      continue;
    }

    const now = Timestamp.now();
    const docData = {
      companyId,
      firstName: contact.firstName,
      lastName: contact.lastName,
      fullName: contact.fullName ?? ([contact.firstName, contact.lastName].filter(Boolean).join(" ") || undefined),
      email: normalizedEmail,
      emailVerified: contact.emailQualification === "verified",
      emailQualification: contact.emailQualification,
      phone: contact.phone,
      role: contact.jobTitle,
      source: "dropcontact" as const,
      sourceType: "enrichment" as const,
      status: "new" as const,
      doNotContact: false,
      createdAt: now,
      updatedAt: now
    };

    await adminDb.collection("contacts").add(stripUndefined(docData));

    if (normalizedEmail) existingEmails.add(normalizedEmail);
    created++;
  }

  await adminDb.collection("companies").doc(companyId).set(
    { lastActivityAt: Timestamp.now(), updatedAt: Timestamp.now(), needsContactDiscovery: FieldValue.delete() },
    { merge: true }
  );

  await updateCompanyLeadReadiness(companyId);

  await writeLog({
    type: "contact_discovery.completed",
    level: "info",
    message: `Contact discovery completed. ${created} created, ${skipped} skipped.`,
    metadata: { companyId, found: enrichedContacts.length, created, skipped }
  });

  return { found: enrichedContacts.length, created, skipped };
}

function stripUndefined<T extends Record<string, unknown>>(obj: T): T {
  return Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined)) as T;
}
