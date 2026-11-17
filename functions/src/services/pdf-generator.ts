import PDFDocument from "pdfkit";
import { Timestamp } from "firebase-admin/firestore";
import { adminDb, adminStorage } from "../config/firebase.js";
import { writeLog } from "../utils/logger.js";
import { getBusiness, getOffer } from "./business-service.js";
import { getValidEvidence } from "./evidence-service.js";
import type { BusinessDoc, EvidenceItem, OfferDoc } from "../types/domain.js";

type LandingPageDraft = {
  headline?: string;
  intro?: string;
  whyUs?: string;
  /** Legacy field name from earlier drafts. */
  whyDevcomm?: string;
  likelyChallenges?: string[];
  recommendedSupport?: string[];
  cta?: string;
};

type OutreachRecord = {
  workspaceId?: string;
  businessId?: string;
  offerId?: string;
  companyId: string;
  contactId?: string;
  landingPageDraft?: LandingPageDraft;
  generatedSubject?: string;
  generatedBody?: string;
};

type CompanyRecord = {
  name?: string;
  website?: string;
  domain?: string;
  city?: string;
  industry?: string;
  employeeCount?: number;
  establishmentCount?: number;
  workspaceId?: string;
  businessId?: string;
  bestOffer?: string;
};

const DEFAULT_BRAND_COLOR = "#1e293b";
const DEFAULT_ACCENT_COLOR = "#2563eb";
const TEXT_COLOR = "#334155";
const MUTED_COLOR = "#64748b";
const PAGE_MARGIN = 50;

export async function generateProposalPdf(outreachId: string): Promise<{
  documentId: string;
  downloadUrl: string;
  storagePath: string;
}> {
  const outreachSnapshot = await adminDb.collection("outreach").doc(outreachId).get();
  if (!outreachSnapshot.exists) throw new Error(`Outreach not found: ${outreachId}`);
  const outreach = { id: outreachSnapshot.id, ...outreachSnapshot.data() } as OutreachRecord & { id: string };

  if (!outreach.companyId) throw new Error("Outreach has no companyId.");

  const companySnapshot = await adminDb.collection("companies").doc(outreach.companyId).get();
  const company = companySnapshot.exists ? (companySnapshot.data() as CompanyRecord) : {};

  const workspaceId = outreach.workspaceId || company.workspaceId || "ws_default";
  const businessId = outreach.businessId || company.businessId;
  if (!businessId) throw new Error(`Outreach ${outreachId} is not attributed to any business; a proposal is branded per business.`);
  const offerId = outreach.offerId;

  const [business, offer, evidenceItems] = await Promise.all([
    getBusiness(workspaceId, businessId),
    offerId ? getOffer(workspaceId, businessId, offerId) : null,
    getValidEvidence(outreach.companyId)
  ]);

  const companyName = company.name ?? "Votre entreprise";
  const draft = outreach.landingPageDraft ?? {};
  // The business's own booking link or none. The workspace setting held one
  // firm's Calendly, which then appeared in every other business's proposals.
  const bookingLink = business?.calendarConfig?.bookingLink || undefined;

  await writeLog({
    type: "pdf.generation.start",
    level: "info",
    message: "Dynamic PDF proposal generation started.",
    metadata: { outreachId, companyId: outreach.companyId, businessId, offerId }
  });

  const pdfBuffer = await renderProposalPdf({
    companyName,
    company,
    draft,
    outreach,
    business,
    offer,
    evidenceItems,
    bookingLink
  });

  const filePath = `pdfs/${outreach.companyId}/${outreachId}.pdf`;
  const bucket = adminStorage.bucket();
  const file = bucket.file(filePath);

  await file.save(pdfBuffer, {
    metadata: { contentType: "application/pdf", cacheControl: "no-cache, no-store, must-revalidate, max-age=0" }
  });

  let downloadUrl = `https://storage.googleapis.com/${bucket.name}/${filePath}`;
  try {
    await file.makePublic();
  } catch {
    const [signedUrl] = await file.getSignedUrl({
      action: "read",
      expires: "03-09-2491"
    });
    downloadUrl = signedUrl;
  }

  const now = Timestamp.now();
  const businessName = business?.name || "";
  const slug = `proposition-${outreach.companyId}-${outreachId}`.toLowerCase().replace(/[^a-z0-9-]/g, "-");

  const existingDoc = await adminDb
    .collection("generatedDocuments")
    .where("outreachId", "==", outreachId)
    .where("type", "==", "pdf")
    .limit(1)
    .get();

  let documentId: string;
  if (existingDoc.empty) {
    const ref = await adminDb.collection("generatedDocuments").add({
      workspaceId,
      businessId,
      companyId: outreach.companyId,
      contactId: outreach.contactId,
      outreachId,
      type: "pdf",
      title: `Proposition ${businessName} — ${companyName}`,
      slug,
      publicUrl: downloadUrl,
      storagePath: filePath,
      status: "published",
      createdAt: now,
      updatedAt: now
    });
    documentId = ref.id;
  } else {
    documentId = existingDoc.docs[0].id;
    await existingDoc.docs[0].ref.set(
      {
        workspaceId,
        businessId,
        publicUrl: downloadUrl,
        storagePath: filePath,
        status: "published",
        updatedAt: now
      },
      { merge: true }
    );
  }

  // Update outreach document with pdfStorageUrl
  await outreachSnapshot.ref.set(
    {
      pdfStorageUrl: downloadUrl,
      pdfDocumentId: documentId,
      updatedAt: now
    },
    { merge: true }
  );

  await writeLog({
    type: "pdf.generation.completed",
    level: "info",
    message: "PDF proposal generated and uploaded.",
    metadata: { outreachId, documentId, downloadUrl, companyId: outreach.companyId }
  });

  return { documentId, downloadUrl, storagePath: filePath };
}

export async function renderProposalPdf(input: {
  companyName: string;
  company: CompanyRecord;
  draft: LandingPageDraft;
  outreach: OutreachRecord;
  business?: BusinessDoc | null;
  offer?: OfferDoc | null;
  evidenceItems?: EvidenceItem[];
  bookingLink?: string;
}): Promise<Buffer> {
  const { companyName, company, draft, business, offer, evidenceItems = [], bookingLink } = input;

  const brandColor = business?.branding?.primaryColor || DEFAULT_BRAND_COLOR;
  const businessName = business?.name || "";
  const tagline = business?.branding?.tagline || "Conseil & Développement Commercial";

  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: "A4",
      margin: PAGE_MARGIN,
      info: { Title: `Proposition ${businessName} — ${companyName}`, Author: businessName }
    });
    const chunks: Buffer[] = [];

    doc.on("data", (chunk: Buffer) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    const width = doc.page.width - PAGE_MARGIN * 2;

    // ── Header Bar ─────────────────────────────────────────────
    doc.rect(0, 0, doc.page.width, 80).fill(brandColor);
    doc.fillColor("#ffffff").fontSize(22).font("Helvetica-Bold").text(businessName, PAGE_MARGIN, 25);
    doc.fillColor("#94a3b8").fontSize(10).font("Helvetica").text(tagline, PAGE_MARGIN, 52);

    doc.moveDown(3);

    // ── Document Title & Metadata ──────────────────────────────
    const headline = draft.headline ?? `Audit diagnostic & proposition personnalisée pour ${companyName}`;
    doc.fillColor(brandColor).fontSize(18).font("Helvetica-Bold").text(headline, { width, align: "left" });
    doc.moveDown(0.4);

    const metaParts = [companyName, company.city, company.industry].filter(Boolean);
    if (company.employeeCount) metaParts.push(`${company.employeeCount} salariés`);
    doc.fillColor(MUTED_COLOR).fontSize(10).font("Helvetica").text(metaParts.join(" · "));
    doc.moveDown(0.8);

    // Accent line
    doc.moveTo(PAGE_MARGIN, doc.y).lineTo(PAGE_MARGIN + width, doc.y).strokeColor(DEFAULT_ACCENT_COLOR).lineWidth(2).stroke();
    doc.moveDown(1);

    // ── Diagnostic Findings / Evidence Box ─────────────────────
    const findings: string[] = [];
    const evidenceMap = new Map<string, unknown>();
    for (const item of evidenceItems) {
      if (item.confidence >= 70) evidenceMap.set(item.key, item.value);
    }

    const pagespeedScore = evidenceMap.get("pagespeed_mobile_score");
    const pagespeedLcp = evidenceMap.get("pagespeed_lcp");
    const reviews = evidenceMap.get("google_places_review_count");
    const rating = evidenceMap.get("google_places_rating");
    const techStack = evidenceMap.get("cms_detected") || evidenceMap.get("tech_stack");
    const mobileFriendly = evidenceMap.get("mobile_friendly");

    if (typeof pagespeedScore === "number") {
      const lcpText = typeof pagespeedLcp === "number" ? ` (LCP : ${pagespeedLcp.toFixed(1)}s)` : "";
      findings.push(`Performance mobile : ${pagespeedScore}/100${lcpText}`);
    }
    if (typeof reviews === "number") {
      const ratingText = rating ? ` (note ${rating}/5)` : "";
      findings.push(`Notoriété Google : ${reviews} avis clients vérifiés${ratingText}`);
    }
    if (techStack) {
      findings.push(`Socle technique : ${String(techStack)}`);
    }
    if (mobileFriendly === false) {
      findings.push("Affichage sur smartphone : non optimisé responsive");
    }

    if (findings.length > 0) {
      sectionTitle(doc, "Synthèse du diagnostic technique & commercial", width, brandColor);
      const boxY = doc.y;
      const boxHeight = 24 + findings.length * 18;
      doc.rect(PAGE_MARGIN, boxY, width, boxHeight).fill("#f8fafc");
      doc.rect(PAGE_MARGIN, boxY, width, boxHeight).strokeColor("#e2e8f0").lineWidth(1).stroke();

      let textY = boxY + 12;
      for (const finding of findings) {
        doc.fillColor(DEFAULT_ACCENT_COLOR).fontSize(10).font("Helvetica-Bold").text("✓", PAGE_MARGIN + 14, textY);
        doc.fillColor(TEXT_COLOR).fontSize(10).font("Helvetica").text(finding, PAGE_MARGIN + 30, textY, { width: width - 40 });
        textY += 18;
      }
      doc.y = boxY + boxHeight + 14;
    }

    // ── Introduction / Contexte ────────────────────────────────
    if (draft.intro) {
      sectionTitle(doc, "Contexte & Objectifs", width, brandColor);
      doc.fillColor(TEXT_COLOR).fontSize(10.5).font("Helvetica").text(draft.intro, { width, align: "justify", lineGap: 3 });
      doc.moveDown(1);
    }

    // ── Enjeux Identifiés ──────────────────────────────────────
    const challenges = draft.likelyChallenges?.length ? draft.likelyChallenges : offer?.valuePropositions?.slice(0, 3);
    if (challenges?.length) {
      sectionTitle(doc, "Axes d'optimisation prioritaires", width, brandColor);
      for (const challenge of challenges) {
        bulletItem(doc, challenge, width);
      }
      doc.moveDown(0.8);
    }

    // ── Notre Accompagnement Recommandé ────────────────────────
    const supportItems = draft.recommendedSupport?.length
      ? draft.recommendedSupport
      : offer?.proofPoints?.length
        ? offer.proofPoints
        : [offer?.name || "Accompagnement sur mesure et plan d'action opérationnel"];

    sectionTitle(doc, `Accompagnement recommandé — ${offer?.name || businessName}`, width, brandColor);
    for (const support of supportItems) {
      bulletItem(doc, support, width);
    }
    doc.moveDown(1);

    // ── CTA Box ────────────────────────────────────────────────
    const ctaText = draft.cta ?? "Échangeons 20 minutes pour analyser vos priorités et définir les leviers d'action.";
    const ctaY = doc.y;
    const boxHeight = bookingLink ? 80 : 65;
    doc.rect(PAGE_MARGIN, ctaY, width, boxHeight).fill("#eff6ff");
    doc.rect(PAGE_MARGIN, ctaY, width, boxHeight).strokeColor("#bfdbfe").lineWidth(1).stroke();

    doc.fillColor(DEFAULT_ACCENT_COLOR).fontSize(11).font("Helvetica-Bold").text("Prochaine étape", PAGE_MARGIN + 16, ctaY + 12, { width: width - 32 });
    doc.fillColor(TEXT_COLOR).fontSize(9.5).font("Helvetica").text(ctaText, PAGE_MARGIN + 16, ctaY + 28, { width: width - 32, lineGap: 2 });

    if (bookingLink) {
      doc.fillColor(DEFAULT_ACCENT_COLOR).fontSize(9.5).font("Helvetica-Bold").text("👉 Choisir un créneau dans notre agenda en ligne", PAGE_MARGIN + 16, ctaY + 52, {
        width: width - 32,
        link: bookingLink,
        underline: true
      });
    }

    // ── Footer ─────────────────────────────────────────────────
    const footerY = doc.page.height - 45;
    doc.moveTo(PAGE_MARGIN, footerY).lineTo(PAGE_MARGIN + width, footerY).strokeColor("#e2e8f0").lineWidth(1).stroke();
    doc.fillColor(MUTED_COLOR).fontSize(8).font("Helvetica").text(
      `${businessName} — Document confidentiel généré pour ${companyName}. Tous droits réservés.`,
      PAGE_MARGIN,
      footerY + 8,
      { width, align: "center" }
    );

    doc.end();
  });
}

function sectionTitle(doc: InstanceType<typeof PDFDocument>, title: string, width: number, color = DEFAULT_BRAND_COLOR) {
  doc.fillColor(color).fontSize(12).font("Helvetica-Bold").text(title, { width });
  doc.moveDown(0.3);
}

function bulletItem(doc: InstanceType<typeof PDFDocument>, text: string, width: number) {
  const x = doc.x;
  const y = doc.y;
  doc.fillColor(DEFAULT_ACCENT_COLOR).fontSize(10).font("Helvetica-Bold").text("•", x, y);
  doc.fillColor(TEXT_COLOR).fontSize(10).font("Helvetica").text(text, x + 15, y, { width: width - 15, lineGap: 2 });
  doc.moveDown(0.3);
  if (doc.x !== x) doc.x = x;
}
