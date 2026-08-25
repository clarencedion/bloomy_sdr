import { adminDb, adminStorage } from "../config/firebase.js";
import { writeLog } from "../utils/logger.js";
import { Timestamp } from "firebase-admin/firestore";

type OutreachRecord = {
  id: string;
  companyId: string;
  contactId?: string;
  campaignId?: string;
  generatedSubject?: string;
  generatedBody?: string;
  followUp1?: string;
  followUp2?: string;
  personalizedPageUrl?: string;
  status: string;
};

type ContactRecord = { email?: string; firstName?: string; lastName?: string; fullName?: string };
type CompanyRecord = { name?: string; domain?: string };

const CSV_FIELDS = ["email", "firstName", "lastName", "companyName", "subject", "body", "followUp1", "followUp2", "personalizedPageUrl", "campaignName", "tags"] as const;

function escapeCsvField(value: string | undefined): string {
  const str = value ?? "";
  if (str.includes(",") || str.includes('"') || str.includes("\n")) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

function buildRow(fields: Record<string, string | undefined>): string {
  return CSV_FIELDS.map((field) => escapeCsvField(fields[field])).join(",");
}

export async function exportOutreachToCsv(outreachIds: string[]): Promise<{ downloadUrl: string; count: number }> {
  if (!outreachIds.length) throw new Error("No outreach IDs provided.");

  const rows: string[] = [CSV_FIELDS.join(",")];
  let exported = 0;

  for (const outreachId of outreachIds) {
    const outreachSnap = await adminDb.collection("outreach").doc(outreachId).get();
    if (!outreachSnap.exists) continue;
    const outreach = { id: outreachSnap.id, ...outreachSnap.data() } as OutreachRecord;

    if (outreach.status !== "approved") continue;

    const [contactSnap, companySnap] = await Promise.all([
      outreach.contactId ? adminDb.collection("contacts").doc(outreach.contactId).get() : undefined,
      adminDb.collection("companies").doc(outreach.companyId).get()
    ]);

    const contact = contactSnap?.exists ? (contactSnap.data() as ContactRecord) : undefined;
    const company = companySnap.exists ? (companySnap.data() as CompanyRecord) : undefined;

    const row = buildRow({
      email: contact?.email,
      firstName: contact?.firstName ?? contact?.fullName?.split(" ")[0],
      lastName: contact?.lastName ?? contact?.fullName?.split(" ").slice(1).join(" "),
      companyName: company?.name,
      subject: outreach.generatedSubject,
      body: outreach.generatedBody,
      followUp1: outreach.followUp1,
      followUp2: outreach.followUp2,
      personalizedPageUrl: outreach.personalizedPageUrl,
      campaignName: "Devcomm Outreach",
      tags: [company?.domain, outreach.campaignId].filter(Boolean).join(";")
    });

    rows.push(row);
    exported++;
  }

  const csv = rows.join("\n");
  const buffer = Buffer.from(csv, "utf-8");
  const timestamp = new Date().toISOString().split("T")[0];
  const filePath = `exports/outreach-${timestamp}-${Date.now()}.csv`;

  const bucket = adminStorage.bucket();
  const file = bucket.file(filePath);
  await file.save(buffer, { metadata: { contentType: "text/csv; charset=utf-8" } });

  const [signedUrl] = await file.getSignedUrl({
    action: "read",
    expires: Date.now() + 24 * 60 * 60 * 1000
  });

  await writeLog({
    type: "export.csv",
    level: "info",
    message: `CSV export generated. ${exported} outreach records exported.`,
    metadata: { requested: outreachIds.length, exported, filePath }
  });

  await adminDb.collection("logs").add({
    type: "export.csv",
    level: "info",
    message: `Outreach CSV exported: ${exported} records.`,
    metadata: { exported, filePath, downloadUrl: signedUrl },
    createdAt: Timestamp.now()
  });

  return { downloadUrl: signedUrl, count: exported };
}
