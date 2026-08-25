import PDFDocument from "pdfkit";
import { Timestamp } from "firebase-admin/firestore";
import { adminDb, adminStorage } from "../config/firebase.js";
import { writeLog } from "../utils/logger.js";
import { getGlobalSettings } from "../utils/settings.js";

type LandingPageDraft = {
  headline?: string;
  intro?: string;
  whyDevcomm?: string;
  likelyChallenges?: string[];
  recommendedSupport?: string[];
  cta?: string;
};

type OutreachRecord = {
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
};

const BRAND_COLOR = "#1a1a2e";
const ACCENT_COLOR = "#2563eb";
const TEXT_COLOR = "#374151";
const MUTED_COLOR = "#6b7280";
const PAGE_MARGIN = 50;

export async function generateProposalPdf(outreachId: string): Promise<{
  documentId: string;
  downloadUrl: string;
}> {
  const outreachSnapshot = await adminDb.collection("outreach").doc(outreachId).get();
  if (!outreachSnapshot.exists) throw new Error(`Outreach not found: ${outreachId}`);
  const outreach = outreachSnapshot.data() as OutreachRecord;

  if (!outreach.companyId) throw new Error("Outreach has no companyId.");

  const companySnapshot = await adminDb.collection("companies").doc(outreach.companyId).get();
  const company = companySnapshot.exists ? (companySnapshot.data() as CompanyRecord) : {};

  const companyName = company.name ?? "Votre entreprise";
  const draft = outreach.landingPageDraft ?? {};

  const settings = await getGlobalSettings();
  const bookingLink = settings.bookingLink;

  await writeLog({ type: "pdf.generation.start", level: "info", message: "PDF proposal generation started.", metadata: { outreachId, companyId: outreach.companyId } });

  const pdfBuffer = await renderProposalPdf({ companyName, company, draft, outreach, bookingLink });

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
      companyId: outreach.companyId,
      contactId: outreach.contactId,
      outreachId,
      type: "pdf",
      title: `Proposition Devcomm — ${companyName}`,
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
    await existingDoc.docs[0].ref.set({ publicUrl: downloadUrl, storagePath: filePath, status: "published", updatedAt: now }, { merge: true });
  }

  await writeLog({
    type: "pdf.generation.completed",
    level: "info",
    message: "PDF proposal generated and uploaded.",
    metadata: { outreachId, documentId, downloadUrl, companyId: outreach.companyId }
  });

  return { documentId, downloadUrl };
}

async function renderProposalPdf(input: {
  companyName: string;
  company: CompanyRecord;
  draft: LandingPageDraft;
  outreach: OutreachRecord;
  bookingLink?: string;
}): Promise<Buffer> {
  const { companyName, company, draft, bookingLink } = input;

  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: "A4", margin: PAGE_MARGIN, info: { Title: `Proposition Devcomm — ${companyName}`, Author: "Devcomm" } });
    const chunks: Buffer[] = [];

    doc.on("data", (chunk: Buffer) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    const width = doc.page.width - PAGE_MARGIN * 2;

    // Header bar
    doc.rect(0, 0, doc.page.width, 80).fill(BRAND_COLOR);
    doc.fillColor("#ffffff").fontSize(22).font("Helvetica-Bold").text("Devcomm", PAGE_MARGIN, 25);
    doc.fillColor("#94a3b8").fontSize(10).font("Helvetica").text("Formation & Développement Commercial B2B", PAGE_MARGIN, 52);

    doc.moveDown(3);

    // Headline
    const headline = draft.headline ?? `Proposition personnalisée pour ${companyName}`;
    doc.fillColor(BRAND_COLOR).fontSize(20).font("Helvetica-Bold").text(headline, { width, align: "left" });
    doc.moveDown(0.5);

    // Company & meta line
    const meta = [companyName, company.city, company.industry].filter(Boolean).join(" · ");
    doc.fillColor(MUTED_COLOR).fontSize(10).font("Helvetica").text(meta);
    doc.moveDown(1.2);

    // Divider
    doc.moveTo(PAGE_MARGIN, doc.y).lineTo(PAGE_MARGIN + width, doc.y).strokeColor(ACCENT_COLOR).lineWidth(2).stroke();
    doc.moveDown(1);

    // Intro
    if (draft.intro) {
      doc.fillColor(TEXT_COLOR).fontSize(11).font("Helvetica").text(draft.intro, { width, align: "justify", lineGap: 3 });
      doc.moveDown(1.2);
    }

    // Why Devcomm
    if (draft.whyDevcomm) {
      sectionTitle(doc, "Pourquoi Devcomm ?", width);
      doc.fillColor(TEXT_COLOR).fontSize(11).font("Helvetica").text(draft.whyDevcomm, { width, align: "justify", lineGap: 3 });
      doc.moveDown(1.2);
    }

    // Likely challenges
    if (draft.likelyChallenges?.length) {
      sectionTitle(doc, "Enjeux identifiés", width);
      for (const item of draft.likelyChallenges) {
        bulletItem(doc, item, width);
      }
      doc.moveDown(1);
    }

    // Recommended support
    if (draft.recommendedSupport?.length) {
      sectionTitle(doc, "Notre accompagnement recommandé", width);
      for (const item of draft.recommendedSupport) {
        bulletItem(doc, item, width);
      }
      doc.moveDown(1);
    }

    // CTA box
    const ctaText = draft.cta ?? "Réservez un appel diagnostic de 20 minutes pour explorer comment nous pouvons vous accompagner.";
    const ctaY = doc.y;
    const boxHeight = bookingLink ? 85 : 70;
    doc.rect(PAGE_MARGIN, ctaY, width, boxHeight).fill("#eff6ff");
    doc.fillColor(ACCENT_COLOR).fontSize(12).font("Helvetica-Bold").text("Prochaine étape", PAGE_MARGIN + 16, ctaY + 12, { width: width - 32 });
    doc.fillColor(TEXT_COLOR).fontSize(10).font("Helvetica").text(ctaText, PAGE_MARGIN + 16, ctaY + 28, { width: width - 32, lineGap: 2 });
    
    if (bookingLink) {
      doc.fillColor(ACCENT_COLOR).fontSize(10).font("Helvetica-Bold").text("👉 Réserver un créneau en ligne", PAGE_MARGIN + 16, ctaY + 54, {
        width: width - 32,
        link: bookingLink,
        underline: true
      });
    }

    // Footer
    const footerY = doc.page.height - 60;
    doc.moveTo(PAGE_MARGIN, footerY).lineTo(PAGE_MARGIN + width, footerY).strokeColor("#e5e7eb").lineWidth(1).stroke();
    doc.fillColor(MUTED_COLOR).fontSize(8).font("Helvetica").text("Devcomm — Document confidentiel généré automatiquement. Ce document est destiné uniquement à son destinataire.", PAGE_MARGIN, footerY + 10, { width, align: "center" });

    doc.end();
  });
}

function sectionTitle(doc: InstanceType<typeof PDFDocument>, title: string, width: number) {
  doc.fillColor(BRAND_COLOR).fontSize(13).font("Helvetica-Bold").text(title, { width });
  doc.moveDown(0.4);
}

function bulletItem(doc: InstanceType<typeof PDFDocument>, text: string, width: number) {
  const x = doc.x;
  const y = doc.y;
  doc.fillColor(ACCENT_COLOR).fontSize(11).font("Helvetica").text("•", x, y);
  doc.fillColor(TEXT_COLOR).text(text, x + 15, y, { width: width - 15, lineGap: 2 });
  doc.moveDown(0.3);
  if (doc.x !== x) doc.x = x;
}
