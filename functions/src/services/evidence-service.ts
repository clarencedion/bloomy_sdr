import { Timestamp } from "firebase-admin/firestore";
import { adminDb } from "../config/firebase.js";
import type { EvidenceItem, EvidenceNature, EvidenceSourceType } from "../types/domain.js";

const VALID_NATURES: Set<EvidenceNature> = new Set(["fact", "derived_metric", "ai_interpretation"]);

const VALID_SOURCE_TYPES: Set<EvidenceSourceType> = new Set([
  "official_registry",
  "website",
  "google_places",
  "pagespeed",
  "provider",
  "ai_interpretation",
  "manual"
]);

/**
 * Validates that an evidence item satisfies the provenance and FACT != INFERENCE requirements
 */
export function validateEvidenceItem(item: Omit<EvidenceItem, "id">): void {
  if (!item.key || typeof item.key !== "string" || !item.key.trim()) {
    throw new Error("Evidence item key must be a non-empty string.");
  }
  if (!item.signalProvider || typeof item.signalProvider !== "string") {
    throw new Error("Evidence item must specify a valid signalProvider.");
  }
  if (!VALID_NATURES.has(item.nature)) {
    throw new Error(
      `Invalid evidence nature: '${item.nature}'. Must be one of 'fact', 'derived_metric', or 'ai_interpretation'.`
    );
  }
  if (!VALID_SOURCE_TYPES.has(item.sourceType)) {
    throw new Error(
      `Invalid evidence sourceType: '${item.sourceType}'. Must be a valid EvidenceSourceType.`
    );
  }
  if (typeof item.confidence !== "number" || item.confidence < 0 || item.confidence > 100) {
    throw new Error(`Evidence confidence must be a number between 0 and 100. Received: ${item.confidence}`);
  }
}

/**
 * Persists an array of collected evidence items into subcollection companies/{companyId}/evidence/{evidenceId}
 */
export async function storeEvidenceItems(
  workspaceId: string,
  businessId: string,
  companyId: string,
  items: Array<Omit<EvidenceItem, "id" | "workspaceId" | "businessId" | "companyId">>,
  options?: { ttlDays?: number; overwriteKey?: boolean }
): Promise<EvidenceItem[]> {
  if (!companyId) throw new Error("companyId is required to store evidence.");
  if (!items || items.length === 0) return [];

  const defaultTtlDays = options?.ttlDays ?? 30;
  const now = new Date();
  const expiresAtDate = new Date(now.getTime() + defaultTtlDays * 24 * 60 * 60 * 1000);

  const evidenceCollection = adminDb.collection("companies").doc(companyId).collection("evidence");
  const storedItems: EvidenceItem[] = [];

  // Batch writes for atomic and performant persistence (chunks of 400)
  const chunkSize = 400;
  for (let i = 0; i < items.length; i += chunkSize) {
    const chunk = items.slice(i, i + chunkSize);
    const batch = adminDb.batch();
    const chunkResults: EvidenceItem[] = [];

    for (const item of chunk) {
      const fullItem: Omit<EvidenceItem, "id"> = {
        workspaceId: workspaceId || "ws_default",
        // Unattributed stays unattributed; never credited to a named business.
        businessId,
        companyId,
        signalProvider: item.signalProvider,
        key: item.key,
        value: item.value,
        sourceType: item.sourceType,
        sourceUrl: item.sourceUrl,
        confidence: item.confidence,
        nature: item.nature,
        collectedAt: item.collectedAt instanceof Date ? Timestamp.fromDate(item.collectedAt) : item.collectedAt || Timestamp.now(),
        expiresAt: item.expiresAt instanceof Date ? Timestamp.fromDate(item.expiresAt) : (item.expiresAt || Timestamp.fromDate(expiresAtDate)),
        costUsd: typeof item.costUsd === "number" ? item.costUsd : 0,
        metadata: item.metadata || {}
      };

      // Strict validation
      validateEvidenceItem(fullItem);

      // Deterministic or auto-generated ID: key_provider to easily replace on refresh if requested
      const docId = options?.overwriteKey
        ? `${item.signalProvider}_${item.key.replace(/[^a-zA-Z0-9_]/g, "_")}`
        : evidenceCollection.doc().id;

      const docRef = evidenceCollection.doc(docId);
      batch.set(docRef, fullItem, { merge: true });

      chunkResults.push({
        id: docId,
        ...fullItem
      });
    }

    await batch.commit();
    storedItems.push(...chunkResults);
  }

  return storedItems;
}

/**
 * Retrieves evidence items for a company with optional filtering
 */
export async function getEvidenceForCompany(
  companyId: string,
  options?: {
    signalProviders?: string[];
    unexpiredOnly?: boolean;
    nature?: EvidenceNature;
    limit?: number;
  }
): Promise<EvidenceItem[]> {
  if (!companyId) return [];

  let evidenceQuery = adminDb
    .collection("companies")
    .doc(companyId)
    .collection("evidence")
    .limit(options?.limit ?? 200);

  if (options?.nature) {
    evidenceQuery = evidenceQuery.where("nature", "==", options.nature);
  }

  const snapshot = await evidenceQuery.get();
  const now = Date.now();

  let items: EvidenceItem[] = snapshot.docs.map((doc) => {
    const data = doc.data();
    return {
      id: doc.id,
      workspaceId: data.workspaceId,
      businessId: data.businessId,
      companyId: data.companyId || companyId,
      signalProvider: data.signalProvider,
      key: data.key,
      value: data.value,
      sourceType: data.sourceType,
      sourceUrl: data.sourceUrl,
      confidence: data.confidence,
      nature: data.nature,
      collectedAt: data.collectedAt,
      expiresAt: data.expiresAt,
      costUsd: data.costUsd,
      metadata: data.metadata
    };
  });

  if (options?.signalProviders && options.signalProviders.length > 0) {
    const providerSet = new Set(options.signalProviders);
    items = items.filter((item) => providerSet.has(item.signalProvider));
  }

  if (options?.unexpiredOnly !== false) {
    items = items.filter((item) => {
      if (!item.expiresAt) return true;
      const expireTime =
        item.expiresAt instanceof Timestamp
          ? item.expiresAt.toMillis()
          : item.expiresAt instanceof Date
            ? item.expiresAt.getTime()
            : 0;
      return expireTime > now;
    });
  }

  return items;
}

/**
 * Retrieves unexpired evidence for a company
 */
export async function getValidEvidence(companyId: string): Promise<EvidenceItem[]> {
  return getEvidenceForCompany(companyId, { unexpiredOnly: true });
}

/**
 * Extracts verified, human-readable personalization facts from EvidenceItem[] and company records.
 * Strictly enforces confidence >= 70 and fact/derived_metric nature (FACT != INFERENCE invariant).
 */
export function extractPersonalizationFacts(
  evidenceItems: EvidenceItem[],
  company?: Record<string, unknown>
): import("../types/domain.js").PersonalizationFact[] {
  const facts: import("../types/domain.js").PersonalizationFact[] = [];
  const addedKeys = new Set<string>();

  const reviewCount = evidenceItems.find(
    (item) => (item.key === "google_review_count" || item.key === "google_places_review_count") && item.confidence >= 70
  )?.value;

  // 1. Process verified evidence items (confidence >= 70)
  for (const item of evidenceItems) {
    if (item.confidence < 70) continue;
    if (item.nature === "ai_interpretation") continue;
    if (item.value === undefined || item.value === null || item.value === "") continue;

    let label = "";
    switch (item.key) {
      case "pagespeed_mobile_score":
        label = `Score de performance mobile : ${item.value}/100`;
        break;
      case "pagespeed_lcp":
        label = `Temps de chargement LCP mobile : ${Number(item.value).toFixed(1)}s`;
        break;
      case "pagespeed_cls":
        label = `Stabilité visuelle CLS mobile : ${item.value}`;
        break;
      // The second spelling is the key the Places provider writes (the claim validator reads both too).
      case "google_places_review_count":
      case "google_review_count":
        label = `${item.value} avis clients sur Google`;
        break;
      case "google_places_rating":
      case "google_rating":
        // Decimal comma: the model quotes a figure as it is given. With the
        // number of reviews behind it: 5/5 on one review is not 5/5 on 300.
        label = `Note moyenne Google Places : ${String(item.value).replace(".", ",")}/5${
          typeof reviewCount === "number" ? ` (sur ${reviewCount} avis)` : ""
        }`;
        break;
      case "mobile_pagespeed_score":
        // Only a poor score (Google's own band: under 50) is worth a sentence.
        label = Number(item.value) < 50 ? `Score de performance mobile du site (test Google PageSpeed) : ${item.value}/100 (faible)` : "";
        break;
      case "lcp_seconds":
        // One decimal, as a person would quote it; the figure check accepts that rounding.
        // Google's own bands for this measure (web.dev, Largest Contentful
        // Paint: good up to 2.5 s, poor beyond 4 s), in words: a threshold
        // in digits would be quoted as a fact about the prospect.
        // Only a slow site is worth a sentence; an ordinary loading time
        // quoted to a prospect reads as a reproach about nothing.
        label =
          Number(item.value) > 4
            ? `D'après le test Google PageSpeed, sur téléphone le contenu principal du site s'affiche en ${Number(item.value)
                .toFixed(1)
                .replace(".", ",")} secondes (lent selon les seuils de Google)`
            : "";
        break;
      case "fcp_seconds":
        // The same test's first paint: a second figure for the same thing, in jargon.
        label = "";
        break;
      case "has_website":
        // Only the gap is worth a sentence; "has a site" also stood next to
        // "only on a platform" for a business whose address is its Instagram.
        label = item.value === false ? "Aucun site web trouvé pour cette entreprise" : "";
        break;
      case "third_party_presence_only":
        // Only worth saying when true; "false" is the ordinary case.
        label = item.value === true ? "Présente en ligne uniquement sur une plateforme tierce : pas de site à son nom" : "";
        break;
      case "is_redirected_to_social":
        label = item.value === true ? "L'adresse de son site renvoie vers un réseau social : pas de site à son nom" : "";
        break;
      case "is_copyright_outdated":
        label = item.value === true ? "Le site ne semble plus mis à jour (son pied de page affiche une année ancienne)" : "";
        break;
      case "outdated_copyright_year":
        label = `Année de copyright affichée sur le site : ${item.value}`;
        break;
      case "place_category":
        label = `Activité : ${item.value}`;
        break;
      case "cms_detected":
      case "tech_stack":
        label = `Technologie web détectée : ${item.value}`;
        break;
      case "has_ssl":
        label = item.value === false ? "Certificat de sécurité HTTPS absent" : "Certificat HTTPS actif";
        break;
      case "mobile_friendly":
        label = item.value === false ? "Site web non adapté aux mobiles" : "Site web adapté aux mobiles";
        break;
      case "has_ecommerce":
        label = item.value === false ? "Absence de boutique e-commerce en ligne" : "Boutique e-commerce active";
        break;
      case "has_booking_widget":
        label = item.value === false ? "Absence de module de réservation / prise de rdv en ligne" : "Module de réservation en ligne actif";
        break;
      case "copyright_year":
        label = `Mention de copyright datant de ${item.value}`;
        break;
      case "outdated_copyright":
        label = "Site web non mis à jour depuis plusieurs années";
        break;
      default:
        label = `${item.key.replace(/_/g, " ")} : ${String(item.value)}`;
    }

    if (label && !addedKeys.has(item.key)) {
      addedKeys.add(item.key);
      facts.push({
        key: item.key,
        label,
        value: item.value as string | number | boolean,
        sourceType: item.sourceType,
        confidence: item.confidence,
        nature: item.nature,
        provenance: item.sourceUrl || item.signalProvider
      });
    }
  }

  // 2. Add verified company official registry fields (confidence 100)
  if (company) {
    if (company.city && typeof company.city === "string" && !addedKeys.has("city")) {
      addedKeys.add("city");
      facts.push({
        key: "city",
        label: `Implantation locale à ${company.city}`,
        value: company.city,
        sourceType: "official_registry",
        confidence: 100,
        nature: "fact",
        provenance: "Registre officiel SIRENE"
      });
    }
    if (typeof company.employeeCount === "number" && company.employeeCount > 0 && !addedKeys.has("employeeCount")) {
      addedKeys.add("employeeCount");
      facts.push({
        key: "employeeCount",
        label: `Effectif déclaré de ${company.employeeCount} salariés`,
        value: company.employeeCount,
        sourceType: "official_registry",
        confidence: 100,
        nature: "fact",
        provenance: "Registre officiel SIRENE"
      });
    }
    if (typeof company.establishmentCount === "number" && company.establishmentCount > 1 && !addedKeys.has("establishmentCount")) {
      addedKeys.add("establishmentCount");
      facts.push({
        key: "establishmentCount",
        label: `Réseau de ${company.establishmentCount} établissements`,
        value: company.establishmentCount,
        sourceType: "official_registry",
        confidence: 100,
        nature: "fact",
        provenance: "Registre officiel SIRENE"
      });
    }
    if (company.industry && typeof company.industry === "string" && !addedKeys.has("industry")) {
      addedKeys.add("industry");
      facts.push({
        key: "industry",
        label: `Secteur d'activité : ${company.industry}`,
        value: company.industry,
        sourceType: "official_registry",
        confidence: 90,
        nature: "fact",
        provenance: "Registre officiel SIRENE"
      });
    }
  }

  return facts;
}
