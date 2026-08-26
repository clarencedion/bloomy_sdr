"use client";

import {
  addDoc,
  collection,
  deleteDoc,
  deleteField,
  doc,
  getDoc,
  getDocs,
  limit,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where
} from "firebase/firestore";
import { db } from "@/lib/firebase/client";
import { normalizeCompanyInput, normalizeContactInput, type CompanyInput, type ContactInput } from "@/lib/data/company";
import { mergeWithoutDowngrade } from "@/lib/data/quality";
import type {
  BusinessDoc,
  Company,
  Contact,
  ConversationDoc,
  EvidenceItem,
  GlobalSettings,
  KnowledgeBaseDoc,
  LeadResearch,
  Log,
  MessageDoc,
  OfferDoc,
  Outreach,
  SenderIdentityDoc,
  WorkspaceDoc
} from "@/types/firestore";



export const collections = {
  companies: "companies",
  contacts: "contacts",
  logs: "logs",
  settings: "settings",
  discoveryCampaigns: "discoveryCampaigns",
  discoveryRuns: "discoveryRuns",
  discoveryRejected: "discoveryRejected",
  leadResearch: "leadResearch",
  outreach: "outreach",
  campaigns: "campaigns",
  conversations: "conversations",
  webhookEvents: "webhookEvents",
  suppressionList: "suppressionList",
  analyticsDaily: "analyticsDaily",
  performanceInsights: "performanceInsights",
  jobQueue: "jobQueue",
  apiSpendDaily: "apiSpendDaily"
} as const;


type CompanyDuplicateOptions = {
  allowDomain?: boolean;
  allowNameCity?: boolean;
};

export async function findCompanyDuplicate(
  input: { domain?: string; siren?: string; siret?: string; normalizedName?: string; city?: string },
  options: CompanyDuplicateOptions = {}
) {
  const { allowDomain = true, allowNameCity = true } = options;
  if (allowDomain && input.domain) {
    const snapshot = await getDocs(query(collection(db, collections.companies), where("domain", "==", input.domain), limit(1)));
    if (!snapshot.empty) return snapshot.docs[0];
  }
  if (input.siren) {
    const snapshot = await getDocs(query(collection(db, collections.companies), where("siren", "==", input.siren), limit(1)));
    if (!snapshot.empty) return snapshot.docs[0];
  }
  if (input.siret) {
    const snapshot = await getDocs(query(collection(db, collections.companies), where("siret", "==", input.siret), limit(1)));
    if (!snapshot.empty) return snapshot.docs[0];
  }
  if (allowNameCity && input.normalizedName && input.city) {
    const snapshot = await getDocs(
      query(
        collection(db, collections.companies),
        where("normalizedName", "==", input.normalizedName),
        where("city", "==", input.city),
        limit(1)
      )
    );
    if (!snapshot.empty) return snapshot.docs[0];
  }
  return null;
}

export async function createOrMergeCompany(input: CompanyInput, duplicateOptions?: CompanyDuplicateOptions) {
  const normalized = normalizeCompanyInput(input);
  if (!normalized.data) return { status: "skipped" as const, reason: normalized.skippedReason };

  const duplicate = await findCompanyDuplicate(normalized.data, duplicateOptions);
  if (duplicate) {
    const existing = duplicate.data();
    const merged = mergeWithoutDowngrade(existing, { ...normalized.data, createdAt: existing.createdAt, updatedAt: serverTimestamp() });
    await updateDoc(duplicate.ref, merged);
    return { status: "merged" as const, id: duplicate.id };
  }

  const docRef = await addDoc(collection(db, collections.companies), normalized.data);
  return { status: "created" as const, id: docRef.id };
}

export async function createContactIfNotDuplicate(companyId: string, input: ContactInput) {
  const normalized = normalizeContactInput(input, companyId);
  if (!normalized.data) return { status: "skipped" as const, reason: normalized.skippedReason };

  if (normalized.data.normalizedEmail) {
    const existing = await getDocs(
      query(collection(db, collections.contacts), where("normalizedEmail", "==", normalized.data.normalizedEmail), limit(1))
    );
    if (!existing.empty) return { status: "duplicate" as const, id: existing.docs[0].id };
  }

  const docRef = await addDoc(collection(db, collections.contacts), normalized.data);
  return { status: "created" as const, id: docRef.id };
}

export async function listCompanies() {
  const snapshot = await getDocs(query(collection(db, collections.companies), orderBy("updatedAt", "desc"), limit(100)));
  return snapshot.docs.map((item) => ({ id: item.id, ...item.data() })) as Company[];
}

export async function getCompany(companyId: string) {
  const snapshot = await getDoc(doc(db, collections.companies, companyId));
  if (!snapshot.exists()) return null;
  return { id: snapshot.id, ...snapshot.data() } as Company;
}

export async function listContactsForCompany(companyId: string) {
  const snapshot = await getDocs(query(collection(db, collections.contacts), where("companyId", "==", companyId), limit(50)));
  return snapshot.docs.map((item) => ({ id: item.id, ...item.data() })) as Contact[];
}

export async function listContacts() {
  const snapshot = await getDocs(query(collection(db, collections.contacts), limit(500)));
  return snapshot.docs.map((item) => ({ id: item.id, ...item.data() })) as Contact[];
}

export async function listResearchForCompany(companyId: string) {
  const snapshot = await getDocs(query(collection(db, collections.leadResearch), where("companyId", "==", companyId), limit(20)));
  return (snapshot.docs.map((item) => ({ id: item.id, ...item.data() })) as LeadResearch[]).sort((a, b) => {
    const left = a.createdAt && "toMillis" in a.createdAt ? a.createdAt.toMillis() : 0;
    const right = b.createdAt && "toMillis" in b.createdAt ? b.createdAt.toMillis() : 0;
    return right - left;
  });
}

export async function listResearchQueue() {
  const snapshot = await getDocs(query(collection(db, collections.leadResearch), orderBy("createdAt", "desc"), limit(100)));
  const latestByCompany = new Map<string, LeadResearch>();
  for (const item of snapshot.docs.map((entry) => ({ id: entry.id, ...entry.data() })) as LeadResearch[]) {
    if (!latestByCompany.has(item.companyId)) latestByCompany.set(item.companyId, item);
  }
  return [...latestByCompany.values()];
}

export async function listOutreachForCompany(companyId: string) {
  const snapshot = await getDocs(query(collection(db, collections.outreach), where("companyId", "==", companyId), limit(20)));
  return (snapshot.docs.map((item) => ({ id: item.id, ...item.data() })) as Outreach[]).sort((a, b) => {
    const left = a.updatedAt && "toMillis" in a.updatedAt ? a.updatedAt.toMillis() : 0;
    const right = b.updatedAt && "toMillis" in b.updatedAt ? b.updatedAt.toMillis() : 0;
    return right - left;
  });
}

export async function listOutreachDrafts() {
  const snapshot = await getDocs(query(collection(db, collections.outreach), limit(100)));
  return (snapshot.docs.map((item) => ({ id: item.id, ...item.data() })) as Outreach[]).sort((a, b) => {
    const left = a.updatedAt && "toMillis" in a.updatedAt ? a.updatedAt.toMillis() : 0;
    const right = b.updatedAt && "toMillis" in b.updatedAt ? b.updatedAt.toMillis() : 0;
    return right - left;
  });
}

export async function queueCompanyForResearchClient(companyId: string) {
  const existing = await getDocs(query(collection(db, collections.leadResearch), where("companyId", "==", companyId), limit(20)));
  const reusable = existing.docs
    .sort((a, b) => {
      const left = a.data().createdAt && "toMillis" in a.data().createdAt ? a.data().createdAt.toMillis() : 0;
      const right = b.data().createdAt && "toMillis" in b.data().createdAt ? b.data().createdAt.toMillis() : 0;
      return right - left;
    })
    .find((item) => ["pending", "running", "failed"].includes(String(item.data().status)));
  if (reusable) {
    if (reusable.data().status === "failed") {
      await updateDoc(doc(db, collections.leadResearch, reusable.id), {
        status: "pending",
        error: deleteField(),
        completedAt: deleteField(),
        updatedAt: serverTimestamp()
      });
      await updateDoc(doc(db, collections.companies, companyId), { status: "research_pending", needsResearch: true, updatedAt: serverTimestamp() });
    }
    return reusable.id;
  }
  const docRef = await addDoc(collection(db, collections.leadResearch), {
    companyId,
    status: "pending",
    createdAt: serverTimestamp(),
    rawInput: { queuedBy: "frontend" }
  });
  await updateDoc(doc(db, collections.companies, companyId), { status: "research_pending", needsResearch: true, updatedAt: serverTimestamp() });
  await createLog({ type: "research.queued", level: "info", message: "Company queued for AI research.", metadata: { companyId, researchId: docRef.id } });
  return docRef.id;
}

export async function clearCompanyWebsite(companyId: string) {
  await updateDoc(doc(db, collections.companies, companyId), {
    website: deleteField(),
    domain: deleteField(),
    websiteEnrichmentStatus: deleteField(),
    updatedAt: serverTimestamp()
  });
}

export async function updateCompanyWebsite(companyId: string, websiteUrl: string) {
  const trimmed = websiteUrl.trim();
  const withProtocol = trimmed.startsWith("http") ? trimmed : `https://${trimmed}`;
  let domain: string | undefined;
  try {
    domain = new URL(withProtocol).hostname.replace(/^www\./, "");
  } catch {
    domain = undefined;
  }
  await updateDoc(doc(db, collections.companies, companyId), {
    website: withProtocol,
    ...(domain ? { domain } : {}),
    websiteEnrichmentStatus: "pending",
    updatedAt: serverTimestamp()
  });
}

export async function saveGlobalSettings(settings: GlobalSettings) {
  const {
    openAiApiKeyConfigured: _openAiApiKeyConfigured,
    anthropicApiKeyConfigured: _anthropicApiKeyConfigured,
    ...publicSettings
  } = settings;
  void _openAiApiKeyConfigured;
  void _anthropicApiKeyConfigured;
  await setDoc(doc(db, collections.settings, "global"), { ...publicSettings, updatedAt: serverTimestamp() }, { merge: true });
}

export async function saveIntegrationSecrets(input: {
  dropcontactApiKey?: string;
  instantlyApiKey?: string;
  pappersApiKey?: string;
  serperApiKey?: string;
  microsoftTenantId?: string;
  microsoftClientId?: string;
  microsoftClientSecret?: string;
  microsoftRefreshToken?: string;
  instantlyWebhookSecret?: string;
  bookingWebhookSecret?: string;
}) {
  const { callSaveIntegrationSecrets } = await import("@/lib/firebase/functions");
  return callSaveIntegrationSecrets(input);
}

export async function getIntegrationSecretsStatus(): Promise<{
  openAiConfigured: boolean;
  anthropicConfigured: boolean;
  dropcontactConfigured: boolean;
  instantlyConfigured: boolean;
  pappersConfigured: boolean;
  serperConfigured: boolean;
  outlookConfigured: boolean;
}> {
  const { callGetIntegrationSecretsStatus } = await import("@/lib/firebase/functions");
  return callGetIntegrationSecretsStatus();
}

export async function saveAiProviderSecrets(input: { openAiApiKey?: string; anthropicApiKey?: string }) {
  const { callSaveAiSecrets } = await import("@/lib/firebase/functions");
  return callSaveAiSecrets(input);
}

export async function clearAiProviderSecret(provider: "openai" | "anthropic") {
  const { callClearAiSecret } = await import("@/lib/firebase/functions");
  return callClearAiSecret(provider);
}

export async function getGlobalSettings(): Promise<GlobalSettings | null> {
  try {
    const snapshot = await getDoc(doc(db, collections.settings, "global"));
    if (!snapshot.exists()) return null;
    return snapshot.data() as GlobalSettings;
  } catch (err) {
    console.warn("Failed to read global settings from Firestore, using local defaults:", err);
    return {
      automationPaused: true,
      aiProvider: "openai",
      openAiModel: "gpt-4o-mini",
      anthropicModel: "claude-3-5-haiku-20241022",
      testModeEnabled: true,
      testEmailAllowlist: [],
      demoModeActive: false,
      dailyAiResearchLimit: 25,
      dailyEmailGenerationLimit: 50,
      dailyOutreachSendLimit: 20,
      requireApprovalBeforeExport: true,
      defaultLanguage: "fr",
      companyContext: "Devcomm is a French B2B training and consulting company helping clients improve commercial performance.",
      dailyDiscoveryLimit: 100,
      autoQueueDiscoveredCompanies: true,
      minDiscoveryScoreForAutoResearch: 80,
      minQualityScoreForAutoResearch: 70,
      enabledDiscoveryProviders: ["recherche_entreprises", "sirene", "google_places"],
      defaultDiscoveryCities: ["Nantes"],
      defaultDiscoverySegments: ["road_safety"],
    };
  }
}

export async function listLogs() {
  const snapshot = await getDocs(query(collection(db, collections.logs), orderBy("createdAt", "desc"), limit(100)));
  return snapshot.docs.map((item) => ({ id: item.id, ...item.data() })) as Log[];
}

export async function listLogsForCompany(companyId: string) {
  const snapshot = await getDocs(
    query(collection(db, collections.logs), where("metadata.companyId", "==", companyId), orderBy("createdAt", "desc"), limit(100))
  );
  return snapshot.docs.map((item) => ({ id: item.id, ...item.data() })) as Log[];
}

export async function createLog(input: Omit<Log, "id" | "createdAt">) {
  // Every log must carry a workspace so the SDR activity feed stays scoped.
  await addDoc(collection(db, collections.logs), {
    ...input,
    workspaceId: input.workspaceId || "ws_default",
    createdAt: serverTimestamp()
  });
}

export async function listGeneratedDocumentsForCompany(companyId: string) {
  const snapshot = await getDocs(query(collection(db, "generatedDocuments"), where("companyId", "==", companyId), orderBy("createdAt", "desc"), limit(20)));
  return snapshot.docs.map((docSnap) => ({ id: docSnap.id, ...(docSnap.data() as Record<string, unknown>) })) as Array<{ id: string; type: string; title: string; publicUrl?: string; status: string; createdAt: unknown; outreachId?: string }>;
}

export async function listMeetingsForCompany(companyId: string) {
  const snapshot = await getDocs(query(collection(db, "meetings"), where("companyId", "==", companyId), orderBy("startTime", "desc"), limit(20)));
  return snapshot.docs.map((docSnap) => ({ id: docSnap.id, ...(docSnap.data() as Record<string, unknown>) })) as Array<{ id: string; title: string; startTime: unknown; endTime: unknown; status: string; attendees?: string[]; source: string; contactId?: string }>;
}

export async function listAllMeetings() {
  const snapshot = await getDocs(query(collection(db, "meetings"), orderBy("startTime", "desc"), limit(100)));
  return snapshot.docs.map((docSnap) => ({ id: docSnap.id, ...(docSnap.data() as Record<string, unknown>) })) as Array<{ id: string; companyId?: string; contactId?: string; title: string; startTime: unknown; endTime: unknown; status: string; attendees?: string[]; source: string }>;
}

export async function getCompanyCountsByStatus(): Promise<Record<string, number>> {
  try {
    const snapshot = await getDocs(query(collection(db, collections.companies), limit(2000)));
    const counts: Record<string, number> = {};
    snapshot.docs.forEach((docSnap) => {
      const status = String(docSnap.data().status ?? "unknown");
      counts[status] = (counts[status] ?? 0) + 1;
    });
    return counts;
  } catch {
    return {};
  }
}

export async function getOutreachCountsByStatus(): Promise<Record<string, number>> {
  try {
    const snapshot = await getDocs(query(collection(db, collections.outreach), limit(2000)));
    const counts: Record<string, number> = {};
    snapshot.docs.forEach((docSnap) => {
      const status = String(docSnap.data().status ?? "unknown");
      counts[status] = (counts[status] ?? 0) + 1;
    });
    return counts;
  } catch {
    return {};
  }
}

export async function getMeetingCount(): Promise<number> {
  try {
    const snapshot = await getDocs(query(collection(db, "meetings"), limit(500)));
    return snapshot.size;
  } catch {
    return 0;
  }
}

export async function getWeeklyDiscoveredCount(): Promise<number> {
  try {
    const weekAgo = new Date();
    weekAgo.setDate(weekAgo.getDate() - 7);
    const snapshot = await getDocs(query(collection(db, collections.companies), where("importedAt", ">=", weekAgo), limit(500)));
    return snapshot.size;
  } catch {
    return 0;
  }
}

export async function deleteCompany(companyId: string) {
  const [contacts, research] = await Promise.all([
    getDocs(query(collection(db, collections.contacts), where("companyId", "==", companyId))),
    getDocs(query(collection(db, "leadResearch"), where("companyId", "==", companyId)))
  ]);
  await Promise.all([
    ...contacts.docs.map((item) => deleteDoc(item.ref)),
    ...research.docs.map((item) => deleteDoc(item.ref)),
    deleteDoc(doc(db, collections.companies, companyId))
  ]);
  await createLog({
    type: "company.delete",
    level: "warning",
    message: "Company deleted from app.",
    metadata: { companyId, relatedContactsDeleted: contacts.size, relatedResearchDeleted: research.size }
  });
}

// ── Multi-Business Client Operations ───────────────────────────────────────

export async function listWorkspacesClient(): Promise<WorkspaceDoc[]> {
  const snapshot = await getDocs(collection(db, "workspaces"));
  return snapshot.docs.map((docSnap) => ({ id: docSnap.id, ...(docSnap.data() as Omit<WorkspaceDoc, "id">) }));
}

export async function getWorkspaceClient(workspaceId = "ws_default"): Promise<WorkspaceDoc | null> {
  const snap = await getDoc(doc(db, "workspaces", workspaceId));
  if (!snap.exists()) return null;
  return { id: snap.id, ...(snap.data() as Omit<WorkspaceDoc, "id">) };
}

export async function listBusinessesClient(workspaceId = "ws_default"): Promise<BusinessDoc[]> {
  try {
    const snapshot = await getDocs(collection(db, `workspaces/${workspaceId}/businesses`));
    return snapshot.docs.map((docSnap) => ({ id: docSnap.id, ...(docSnap.data() as Omit<BusinessDoc, "id">) }));
  } catch (err) {
    console.warn("Failed to list businesses from Firestore, falling back to local business defaults:", err);
    return [];
  }
}

export async function getBusinessClient(workspaceId = "ws_default", businessId: string): Promise<BusinessDoc | null> {
  if (!businessId) return null;
  try {
    const snap = await getDoc(doc(db, `workspaces/${workspaceId}/businesses`, businessId));
    if (!snap.exists()) return null;
    return { id: snap.id, ...(snap.data() as Omit<BusinessDoc, "id">) };
  } catch {
    return null;
  }
}

export async function saveBusinessClient(
  workspaceId = "ws_default",
  business: Partial<BusinessDoc> & { id: string; name: string }
): Promise<BusinessDoc> {
  const ref = doc(db, `workspaces/${workspaceId}/businesses`, business.id);
  const snap = await getDoc(ref).catch(() => null);
  const now = serverTimestamp();
  const data = {
    ...business,
    workspaceId,
    updatedAt: now,
    ...(snap?.exists() ? {} : { createdAt: now }),
  };
  // Must not swallow: a silently dropped write used to report success and hand
  // back fabricated data, so a business could look created and never persist.
  await setDoc(ref, data, { merge: true });
  return data as unknown as BusinessDoc;
}

/**
 * Removes a business and everything scoped under it.
 *
 * Firestore does not cascade, so the offers, knowledge base and sender
 * identities are deleted first; otherwise they would linger as orphans that a
 * future business reusing the id would silently inherit.
 */
export async function deleteBusinessClient(workspaceId = "ws_default", businessId: string): Promise<void> {
  if (!businessId) throw new Error("A business id is required.");

  const base = `workspaces/${workspaceId}/businesses/${businessId}`;

  for (const sub of ["offers", "knowledgeBase", "senderIdentities", "campaigns"]) {
    const snapshot = await getDocs(collection(db, `${base}/${sub}`)).catch(() => null);
    if (!snapshot) continue;
    await Promise.all(snapshot.docs.map((docSnap) => deleteDoc(docSnap.ref)));
  }

  await deleteDoc(doc(db, `workspaces/${workspaceId}/businesses`, businessId));
}

export async function listOffersClient(workspaceId = "ws_default", businessId: string): Promise<OfferDoc[]> {
  if (!businessId) return [];
  try {
    const snapshot = await getDocs(collection(db, `workspaces/${workspaceId}/businesses/${businessId}/offers`));
    return snapshot.docs.map((docSnap) => ({ id: docSnap.id, ...(docSnap.data() as Omit<OfferDoc, "id">) }));
  } catch {
    return [];
  }
}

export async function getOfferClient(
  workspaceId = "ws_default",
  businessId: string,
  offerId: string
): Promise<OfferDoc | null> {
  if (!businessId || !offerId) return null;
  try {
    const snap = await getDoc(doc(db, `workspaces/${workspaceId}/businesses/${businessId}/offers`, offerId));
    if (!snap.exists()) return null;
    return { id: snap.id, ...(snap.data() as Omit<OfferDoc, "id">) };
  } catch {
    return null;
  }
}

export async function saveOfferClient(
  workspaceId = "ws_default",
  businessId: string,
  offer: Partial<OfferDoc> & { id?: string; name: string }
): Promise<OfferDoc> {
  const offerId = offer.id || doc(collection(db, `workspaces/${workspaceId}/businesses/${businessId}/offers`)).id;
  const ref = doc(db, `workspaces/${workspaceId}/businesses/${businessId}/offers`, offerId);
  const now = serverTimestamp();
  const data = {
    ...offer,
    id: offerId,
    workspaceId,
    businessId,
    updatedAt: now,
  };
  await setDoc(ref, data, { merge: true });
  return data as unknown as OfferDoc;
}

export async function deleteOfferClient(
  workspaceId = "ws_default",
  businessId: string,
  offerId: string
): Promise<boolean> {
  if (!businessId || !offerId) return false;
  try {
    await deleteDoc(doc(db, `workspaces/${workspaceId}/businesses/${businessId}/offers`, offerId));
    return true;
  } catch {
    return false;
  }
}

export async function getKnowledgeBaseClient(
  workspaceId = "ws_default",
  businessId: string
): Promise<KnowledgeBaseDoc | null> {
  if (!businessId) return null;
  try {
    const snap = await getDoc(doc(db, `workspaces/${workspaceId}/businesses/${businessId}/knowledgeBase`, "default"));
    if (!snap.exists()) return null;
    return { id: snap.id, ...(snap.data() as Omit<KnowledgeBaseDoc, "id">) };
  } catch {
    return null;
  }
}

export async function saveKnowledgeBaseClient(
  workspaceId = "ws_default",
  businessId: string,
  kb: Partial<KnowledgeBaseDoc>
): Promise<KnowledgeBaseDoc> {
  const ref = doc(db, `workspaces/${workspaceId}/businesses/${businessId}/knowledgeBase`, "default");
  const data = {
    ...kb,
    id: "default",
    workspaceId,
    businessId,
    updatedAt: serverTimestamp(),
  };
  await setDoc(ref, data, { merge: true });
  const updated = await getDoc(ref);
  return { id: updated.id, ...(updated.data() as Omit<KnowledgeBaseDoc, "id">) };
}

export async function listSenderIdentitiesClient(
  workspaceId = "ws_default",
  businessId: string
): Promise<SenderIdentityDoc[]> {
  if (!businessId) return [];
  const snapshot = await getDocs(collection(db, `workspaces/${workspaceId}/businesses/${businessId}/senderIdentities`));
  return snapshot.docs.map((docSnap) => ({ id: docSnap.id, ...(docSnap.data() as Omit<SenderIdentityDoc, "id">) }));
}

export async function saveSenderIdentityClient(
  workspaceId = "ws_default",
  businessId: string,
  sender: Partial<SenderIdentityDoc> & { id?: string; email: string; name: string }
): Promise<SenderIdentityDoc> {
  const senderId = sender.id || doc(collection(db, `workspaces/${workspaceId}/businesses/${businessId}/senderIdentities`)).id;
  const ref = doc(db, `workspaces/${workspaceId}/businesses/${businessId}/senderIdentities`, senderId);
  const snap = await getDoc(ref);
  const now = serverTimestamp();
  const data = {
    ...sender,
    id: senderId,
    workspaceId,
    businessId,
    updatedAt: now,
    ...(snap.exists() ? {} : { createdAt: now }),
  };
  await setDoc(ref, data, { merge: true });
  const updated = await getDoc(ref);
  return { id: updated.id, ...(updated.data() as Omit<SenderIdentityDoc, "id">) };
}

export async function getContact(contactId: string): Promise<Contact | null> {
  const snapshot = await getDoc(doc(db, collections.contacts, contactId));
  if (!snapshot.exists()) return null;
  return { id: snapshot.id, ...snapshot.data() } as Contact;
}

export async function listEvidenceForCompany(companyId: string): Promise<EvidenceItem[]> {
  if (!companyId) return [];
  const snapshot = await getDocs(collection(db, `${collections.companies}/${companyId}/evidence`));
  return snapshot.docs.map((docSnap) => ({
    id: docSnap.id,
    ...(docSnap.data() as Omit<EvidenceItem, "id">)
  }));
}

export const listCompanyEvidence = listEvidenceForCompany;

export async function listConversations(workspaceId = "ws_default", businessId?: string): Promise<ConversationDoc[]> {
  let q = query(collection(db, collections.conversations), where("workspaceId", "==", workspaceId));
  if (businessId) {
    q = query(collection(db, collections.conversations), where("workspaceId", "==", workspaceId), where("businessId", "==", businessId));
  }
  const snapshot = await getDocs(q);
  return snapshot.docs.map((item) => ({ id: item.id, ...item.data() })) as ConversationDoc[];
}

export async function getConversation(conversationId: string): Promise<ConversationDoc | null> {
  const snapshot = await getDoc(doc(db, collections.conversations, conversationId));
  if (!snapshot.exists()) return null;
  return { id: snapshot.id, ...snapshot.data() } as ConversationDoc;
}

export async function listMessagesForConversation(conversationId: string): Promise<MessageDoc[]> {
  const snapshot = await getDocs(
    query(collection(db, `${collections.conversations}/${conversationId}/messages`), orderBy("sentAt", "asc"))
  );
  return snapshot.docs.map((item) => ({ id: item.id, ...item.data() })) as MessageDoc[];
}

export async function getConversationForCompany(companyId: string): Promise<ConversationDoc | null> {
  const snapshot = await getDocs(
    query(collection(db, collections.conversations), where("companyId", "==", companyId), limit(1))
  );
  if (snapshot.empty) return null;
  const item = snapshot.docs[0];
  return { id: item.id, ...item.data() } as ConversationDoc;
}

export async function listInboxConversations(
  workspaceId = "ws_default",
  businessId?: string,
  tab = "all",
  search?: string
): Promise<ConversationDoc[]> {
  let q = query(collection(db, collections.conversations), where("workspaceId", "==", workspaceId));
  if (businessId) {
    q = query(collection(db, collections.conversations), where("workspaceId", "==", workspaceId), where("businessId", "==", businessId));
  }
  const snapshot = await getDocs(q);
  let list = snapshot.docs.map((docSnap) => ({ id: docSnap.id, ...docSnap.data() })) as ConversationDoc[];

  if (tab !== "all") {
    if (tab === "needs_attention") {
      list = list.filter((c) => c.unreadHumanAttention || c.humanAttentionRequired || c.status === "human_escalated");
    } else {
      list = list.filter((c) => c.status === tab);
    }
  }

  if (search?.trim()) {
    const term = search.toLowerCase().trim();
    list = list.filter((c) => {
      return (
        c.companyId.toLowerCase().includes(term) ||
        c.contactId.toLowerCase().includes(term) ||
        (c.latestIntent || "").toLowerCase().includes(term) ||
        (c.escalationReason || "").toLowerCase().includes(term)
      );
    });
  }

  return list.sort((a, b) => {
    const tA = a.lastMessageAt ? (typeof (a.lastMessageAt as any).toMillis === "function" ? (a.lastMessageAt as any).toMillis() : new Date(a.lastMessageAt as any).getTime()) : 0;
    const tB = b.lastMessageAt ? (typeof (b.lastMessageAt as any).toMillis === "function" ? (b.lastMessageAt as any).toMillis() : new Date(b.lastMessageAt as any).getTime()) : 0;
    return tB - tA;
  });
}

/**
 * Badge count for conversations awaiting a human.
 *
 * Bounded on purpose: this is polled from the navigation, so it must never
 * degenerate into a full-collection scan. The badge only needs to distinguish
 * "none", "a few" and "a lot", so reading a capped window is sufficient.
 */
export const ATTENTION_COUNT_CAP = 50;

export async function getUnreadHumanAttentionCount(workspaceId = "ws_default", businessId?: string): Promise<number> {
  const constraints = [
    where("workspaceId", "==", workspaceId),
    ...(businessId ? [where("businessId", "==", businessId)] : []),
    where("unreadHumanAttention", "==", true),
    limit(ATTENTION_COUNT_CAP)
  ];

  try {
    const snapshot = await getDocs(query(collection(db, collections.conversations), ...constraints));
    return snapshot.docs.filter((docSnap) => (docSnap.data() as ConversationDoc).status !== "suppressed").length;
  } catch {
    // Missing composite index: fall back to a capped unordered read rather than
    // scanning the whole collection.
    const snapshot = await getDocs(
      query(
        collection(db, collections.conversations),
        where("workspaceId", "==", workspaceId),
        limit(200)
      )
    );
    return snapshot.docs.filter((docSnap) => {
      const data = docSnap.data() as ConversationDoc;
      if (data.status === "suppressed") return false;
      if (businessId && data.businessId && data.businessId !== businessId) return false;
      return data.unreadHumanAttention || data.humanAttentionRequired || data.status === "human_escalated";
    }).length;
  }
}

export async function getRecentAgentLogs(workspaceId = "ws_default", businessId?: string, limitCount = 15): Promise<Log[]> {
  let q = query(
    collection(db, collections.logs),
    where("workspaceId", "==", workspaceId),
    orderBy("createdAt", "desc"),
    limit(limitCount)
  );
  if (businessId) {
    q = query(
      collection(db, collections.logs),
      where("workspaceId", "==", workspaceId),
      where("businessId", "==", businessId),
      orderBy("createdAt", "desc"),
      limit(limitCount)
    );
  }
  try {
    const snapshot = await getDocs(q);
    return snapshot.docs.map((docSnap) => ({ id: docSnap.id, ...docSnap.data() })) as Log[];
  } catch {
    // Fallback if index not yet available
    const snap = await getDocs(query(collection(db, collections.logs), limit(limitCount)));
    return snap.docs.map((docSnap) => ({ id: docSnap.id, ...docSnap.data() })) as Log[];
  }
}

export async function getLatestAnalyticsDaily(
  workspaceId = "ws_default",
  businessId?: string
): Promise<import("@/types/domain").AnalyticsDailyDoc | null> {
  const today = new Date().toISOString().slice(0, 10);
  const targetId = `${workspaceId}_${businessId || "all"}_${today}`;
  try {
    const snap = await getDoc(doc(db, collections.analyticsDaily, targetId));
    if (snap.exists()) {
      return snap.data() as import("@/types/domain").AnalyticsDailyDoc;
    }
  } catch {
    // ignore
  }
  return null;
}

export async function getPerformanceInsightsClient(
  workspaceId = "ws_default",
  businessId = "all",
  offerId = "all"
): Promise<import("@/types/domain").PerformanceInsightsDoc | null> {
  const docId = `${workspaceId}_${businessId}_${offerId}`;
  try {
    const snap = await getDoc(doc(db, collections.performanceInsights, docId));
    if (snap.exists()) {
      return snap.data() as import("@/types/domain").PerformanceInsightsDoc;
    }
  } catch {
    // ignore
  }
  return null;
}

export async function listAnalyticsDailySnapshots(
  workspaceId = "ws_default",
  businessId?: string,
  limitCount = 14
): Promise<import("@/types/domain").AnalyticsDailyDoc[]> {
  try {
    let q = query(
      collection(db, collections.analyticsDaily),
      where("workspaceId", "==", workspaceId),
      orderBy("date", "desc"),
      limit(limitCount)
    );
    if (businessId) {
      q = query(
        collection(db, collections.analyticsDaily),
        where("workspaceId", "==", workspaceId),
        where("businessId", "==", businessId),
        orderBy("date", "desc"),
        limit(limitCount)
      );
    }
    const snap = await getDocs(q);
    return snap.docs.map((d) => d.data() as import("@/types/domain").AnalyticsDailyDoc).reverse();
  } catch {
    return [];
  }
}

export async function getQueueHealthClient(
  workspaceId = "ws_default",
  businessId?: string
): Promise<import("@/types/domain").QueueHealthSummary> {
  const { callGetQueueHealth } = await import("./functions");
  return callGetQueueHealth({ workspaceId, businessId });
}

export async function getCostSummaryClient(
  workspaceId = "ws_default",
  businessId?: string
): Promise<{
  todaySpendUsd: number;
  monthSpendUsd: number;
  spendByProvider: Record<string, number>;
  spendByOperation: Record<string, number>;
  dailyBudgetCapUsd: number;
  monthlyBudgetCapUsd: number;
  budgetExceeded: boolean;
  isDailyCapReached: boolean;
  isMonthlyCapReached: boolean;
}> {
  const { callGetCostSummary } = await import("./functions");
  return callGetCostSummary({ workspaceId, businessId });
}

export async function triggerTaskQueueProcessor(
  limit = 10,
  workspaceId = "ws_default",
  businessId?: string
): Promise<{ processed: number; succeeded: number; failed: number; retried: number }> {
  const { callProcessTaskQueue } = await import("./functions");
  return callProcessTaskQueue({ limit, workspaceId, businessId });
}

export async function retryFailedTaskJobs(
  jobIds?: string[],
  workspaceId = "ws_default",
  businessId?: string
): Promise<{ retriedCount: number }> {
  const { callRetryTaskJob } = await import("./functions");
  return callRetryTaskJob({ jobIds, workspaceId, businessId });
}

export async function listRecentJobQueue(
  workspaceId = "ws_default",
  businessId?: string,
  limitCount = 20
): Promise<import("@/types/domain").JobQueueDoc[]> {
  try {
    let q = query(
      collection(db, collections.jobQueue),
      where("workspaceId", "==", workspaceId),
      orderBy("createdAt", "desc"),
      limit(limitCount)
    );
    if (businessId) {
      q = query(
        collection(db, collections.jobQueue),
        where("workspaceId", "==", workspaceId),
        where("businessId", "==", businessId),
        orderBy("createdAt", "desc"),
        limit(limitCount)
      );
    }
    const snap = await getDocs(q);
    return snap.docs.map((d) => ({ id: d.id, ...d.data() })) as import("@/types/domain").JobQueueDoc[];
  } catch {
    // Fallback if index not ready
    const snap = await getDocs(query(collection(db, collections.jobQueue), limit(limitCount)));
    return snap.docs.map((d) => ({ id: d.id, ...d.data() })) as import("@/types/domain").JobQueueDoc[];
  }
}

export async function saveBudgetSettingsClient(settings: {
  dailySpendBudgetUsd?: number;
  monthlySpendBudgetUsd?: number;
}): Promise<{ ok: boolean }> {
  const { callSaveBudgetSettings } = await import("./functions");
  return callSaveBudgetSettings(settings);
}


