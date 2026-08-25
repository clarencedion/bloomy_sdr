import { FieldValue } from "firebase-admin/firestore";
import { adminDb } from "../config/firebase";
import type {
  WorkspaceDoc,
  BusinessDoc,
  OfferDoc,
  KnowledgeBaseDoc,
  SenderIdentityDoc,
} from "../types/domain";

// ── Workspace Operations ───────────────────────────────────────────────────

export async function getWorkspace(workspaceId: string): Promise<WorkspaceDoc | null> {
  if (!workspaceId) return null;
  const snapshot = await adminDb.collection("workspaces").doc(workspaceId).get();
  if (!snapshot.exists) return null;
  return { id: snapshot.id, ...(snapshot.data() as Omit<WorkspaceDoc, "id">) };
}

export async function listWorkspaces(): Promise<WorkspaceDoc[]> {
  const snapshot = await adminDb.collection("workspaces").get();
  return snapshot.docs.map((doc) => ({
    id: doc.id,
    ...(doc.data() as Omit<WorkspaceDoc, "id">),
  }));
}

export async function createWorkspace(
  workspaceId: string,
  name: string,
  ownerId?: string,
  defaultBusinessId?: string
): Promise<WorkspaceDoc> {
  const ref = adminDb.collection("workspaces").doc(workspaceId);
  const now = FieldValue.serverTimestamp();
  const data = {
    name,
    ...(ownerId ? { ownerId } : {}),
    ...(defaultBusinessId ? { defaultBusinessId } : {}),
    createdAt: now,
    updatedAt: now,
  };
  await ref.set(data, { merge: true });
  const snap = await ref.get();
  return { id: snap.id, ...(snap.data() as Omit<WorkspaceDoc, "id">) };
}

// ── Business Operations ────────────────────────────────────────────────────

export function getBusinessRef(workspaceId: string, businessId: string) {
  return adminDb
    .collection("workspaces")
    .doc(workspaceId)
    .collection("businesses")
    .doc(businessId);
}

export async function getBusiness(
  workspaceId: string,
  businessId: string
): Promise<BusinessDoc | null> {
  if (!workspaceId || !businessId) return null;
  const snap = await getBusinessRef(workspaceId, businessId).get();
  if (!snap.exists) return null;
  return { id: snap.id, ...(snap.data() as Omit<BusinessDoc, "id">) };
}

export async function listBusinesses(workspaceId: string): Promise<BusinessDoc[]> {
  if (!workspaceId) return [];
  const snapshot = await adminDb
    .collection("workspaces")
    .doc(workspaceId)
    .collection("businesses")
    .get();
  return snapshot.docs.map((doc) => ({
    id: doc.id,
    ...(doc.data() as Omit<BusinessDoc, "id">),
  }));
}

export async function createBusiness(
  workspaceId: string,
  input: Omit<BusinessDoc, "id" | "workspaceId" | "createdAt" | "updatedAt"> & { id?: string }
): Promise<BusinessDoc> {
  const businessId = input.id || adminDb.collection("workspaces").doc(workspaceId).collection("businesses").doc().id;
  const ref = getBusinessRef(workspaceId, businessId);
  const now = FieldValue.serverTimestamp();
  const data = {
    ...input,
    id: businessId,
    workspaceId,
    createdAt: now,
    updatedAt: now,
  };
  await ref.set(data, { merge: true });
  const snap = await ref.get();
  return { id: snap.id, ...(snap.data() as Omit<BusinessDoc, "id">) };
}

export async function updateBusiness(
  workspaceId: string,
  businessId: string,
  patch: Partial<Omit<BusinessDoc, "id" | "workspaceId" | "createdAt">>
): Promise<BusinessDoc | null> {
  const ref = getBusinessRef(workspaceId, businessId);
  const snap = await ref.get();
  if (!snap.exists) return null;
  await ref.set(
    {
      ...patch,
      updatedAt: FieldValue.serverTimestamp(),
    },
    { merge: true }
  );
  const updatedSnap = await ref.get();
  return { id: updatedSnap.id, ...(updatedSnap.data() as Omit<BusinessDoc, "id">) };
}

// ── Offer Operations ───────────────────────────────────────────────────────

export function getOffersCollection(workspaceId: string, businessId: string) {
  return getBusinessRef(workspaceId, businessId).collection("offers");
}

export async function listOffers(
  workspaceId: string,
  businessId: string
): Promise<OfferDoc[]> {
  if (!workspaceId || !businessId) return [];
  const snapshot = await getOffersCollection(workspaceId, businessId).get();
  return snapshot.docs.map((doc) => ({
    id: doc.id,
    ...(doc.data() as Omit<OfferDoc, "id">),
  }));
}

export async function getOffer(
  workspaceId: string,
  businessId: string,
  offerId: string
): Promise<OfferDoc | null> {
  if (!workspaceId || !businessId || !offerId) return null;
  const snap = await getOffersCollection(workspaceId, businessId).doc(offerId).get();
  if (!snap.exists) return null;
  return { id: snap.id, ...(snap.data() as Omit<OfferDoc, "id">) };
}

export async function createOffer(
  workspaceId: string,
  businessId: string,
  input: Omit<OfferDoc, "id" | "workspaceId" | "businessId" | "createdAt" | "updatedAt"> & { id?: string }
): Promise<OfferDoc> {
  const offerId = input.id || getOffersCollection(workspaceId, businessId).doc().id;
  const ref = getOffersCollection(workspaceId, businessId).doc(offerId);
  const now = FieldValue.serverTimestamp();
  const data = {
    ...input,
    id: offerId,
    workspaceId,
    businessId,
    createdAt: now,
    updatedAt: now,
  };
  await ref.set(data, { merge: true });
  const snap = await ref.get();
  return { id: snap.id, ...(snap.data() as Omit<OfferDoc, "id">) };
}

export async function updateOffer(
  workspaceId: string,
  businessId: string,
  offerId: string,
  patch: Partial<Omit<OfferDoc, "id" | "workspaceId" | "businessId" | "createdAt">>
): Promise<OfferDoc | null> {
  const ref = getOffersCollection(workspaceId, businessId).doc(offerId);
  const snap = await ref.get();
  if (!snap.exists) return null;
  await ref.set(
    {
      ...patch,
      updatedAt: FieldValue.serverTimestamp(),
    },
    { merge: true }
  );
  const updatedSnap = await ref.get();
  return { id: updatedSnap.id, ...(updatedSnap.data() as Omit<OfferDoc, "id">) };
}

export async function deleteOffer(
  workspaceId: string,
  businessId: string,
  offerId: string
): Promise<boolean> {
  const ref = getOffersCollection(workspaceId, businessId).doc(offerId);
  const snap = await ref.get();
  if (!snap.exists) return false;
  await ref.delete();
  return true;
}

// ── Knowledge Base Operations ──────────────────────────────────────────────

export function getKnowledgeBaseRef(workspaceId: string, businessId: string) {
  return getBusinessRef(workspaceId, businessId)
    .collection("knowledgeBase")
    .doc("default");
}

export async function getKnowledgeBase(
  workspaceId: string,
  businessId: string
): Promise<KnowledgeBaseDoc | null> {
  if (!workspaceId || !businessId) return null;
  const snap = await getKnowledgeBaseRef(workspaceId, businessId).get();
  if (!snap.exists) return null;
  return { id: snap.id, ...(snap.data() as Omit<KnowledgeBaseDoc, "id">) };
}

export async function saveKnowledgeBase(
  workspaceId: string,
  businessId: string,
  input: Partial<Omit<KnowledgeBaseDoc, "id" | "workspaceId" | "businessId" | "updatedAt">>
): Promise<KnowledgeBaseDoc> {
  const ref = getKnowledgeBaseRef(workspaceId, businessId);
  const now = FieldValue.serverTimestamp();
  const data = {
    ...input,
    id: "default",
    workspaceId,
    businessId,
    updatedAt: now,
  };
  await ref.set(data, { merge: true });
  const snap = await ref.get();
  return { id: snap.id, ...(snap.data() as Omit<KnowledgeBaseDoc, "id">) };
}

// ── Sender Identities Operations ───────────────────────────────────────────

export function getSenderIdentitiesCollection(workspaceId: string, businessId: string) {
  return getBusinessRef(workspaceId, businessId).collection("senderIdentities");
}

export async function listSenderIdentities(
  workspaceId: string,
  businessId: string
): Promise<SenderIdentityDoc[]> {
  if (!workspaceId || !businessId) return [];
  const snapshot = await getSenderIdentitiesCollection(workspaceId, businessId).get();
  return snapshot.docs.map((doc) => ({
    id: doc.id,
    ...(doc.data() as Omit<SenderIdentityDoc, "id">),
  }));
}

export async function saveSenderIdentity(
  workspaceId: string,
  businessId: string,
  input: Omit<SenderIdentityDoc, "id" | "workspaceId" | "businessId" | "createdAt" | "updatedAt"> & { id?: string }
): Promise<SenderIdentityDoc> {
  const senderId = input.id || getSenderIdentitiesCollection(workspaceId, businessId).doc().id;
  const ref = getSenderIdentitiesCollection(workspaceId, businessId).doc(senderId);
  const now = FieldValue.serverTimestamp();
  const data = {
    ...input,
    id: senderId,
    workspaceId,
    businessId,
    createdAt: now,
    updatedAt: now,
  };
  await ref.set(data, { merge: true });
  const snap = await ref.get();
  return { id: snap.id, ...(snap.data() as Omit<SenderIdentityDoc, "id">) };
}

// ── Calendar Config Operations ─────────────────────────────────────────────

export async function getCalendarConfig(
  workspaceId: string,
  businessId: string
): Promise<BusinessDoc["calendarConfig"] | null> {
  const business = await getBusiness(workspaceId, businessId);
  return business?.calendarConfig ?? null;
}

export async function saveCalendarConfig(
  workspaceId: string,
  businessId: string,
  calendarConfig: BusinessDoc["calendarConfig"]
): Promise<BusinessDoc | null> {
  return updateBusiness(workspaceId, businessId, { calendarConfig });
}
