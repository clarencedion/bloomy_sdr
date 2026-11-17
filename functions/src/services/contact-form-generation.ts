import { Timestamp } from "firebase-admin/firestore";
import { adminDb } from "../config/firebase.js";
import { writeLog } from "../utils/logger.js";
import { detectContactForm } from "./contact-form-detector.js";
import { generateSocialDm } from "./social-dm-generation.js";

/**
 * Prepares a contact-form message for a prospect with no reachable email.
 *
 * The copy reuses the direct-message writer: both are short, informal, land in
 * a personal inbox and carry no subject line or signature block - a full cold
 * email would read as a mail-merge dropped into a contact box.
 *
 * Nothing is submitted here. The draft is queued for approval, and only when a
 * person approves it does the submission run - so a message is never posted to
 * someone's website without a human deciding to.
 */
export async function prepareContactFormOutreach(input: {
  companyId: string;
  campaignId?: string;
}): Promise<{ outreachId: string; pageUrl?: string; submittable: boolean } | null> {
  const companySnap = await adminDb.collection("companies").doc(input.companyId).get();
  if (!companySnap.exists) return null;

  const company = companySnap.data() ?? {};
  const form = await detectContactForm(company.website as string | undefined);
  if (form.channel === "none") return null;

  // Reuse the DM writer, then re-key the draft onto this channel.
  const drafted = await generateSocialDm({
    companyId: input.companyId,
    campaignId: input.campaignId,
    force: true
  }).catch(() => null);

  if (!drafted) return null;

  const now = Timestamp.now();
  await adminDb.collection("outreach").doc(drafted.outreachId).set(
    {
      channel: "contact_form",
      contactFormUrl: form.pageUrl,
      contactFormSubmittable: form.channel === "submittable",
      contactFormReason: form.reason ?? null,
      // The DM writer stores the profile it found; on this channel the form
      // page is the destination, so clear it to avoid two conflicting links.
      socialProfileUrl: null,
      updatedAt: now
    },
    { merge: true }
  );

  await writeLog({
    type: "outreach.contact_form.drafted",
    level: "info",
    message: `Message prepared for the contact form of ${company.name}.`,
    workspaceId: company.workspaceId as string | undefined,
    businessId: company.businessId as string | undefined,
    metadata: {
      companyId: input.companyId,
      outreachId: drafted.outreachId,
      pageUrl: form.pageUrl,
      submittable: form.channel === "submittable"
    }
  });

  return {
    outreachId: drafted.outreachId,
    pageUrl: form.pageUrl,
    submittable: form.channel === "submittable"
  };
}
