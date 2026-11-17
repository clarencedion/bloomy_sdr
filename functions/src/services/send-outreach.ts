import { Timestamp } from "firebase-admin/firestore";
import { adminDb } from "../config/firebase.js";
import { InstantlyProvider } from "../providers/email/instantly-provider.js";
import { getGlobalSettings, getIntegrationSecrets } from "../utils/settings.js";
import { writeLog } from "../utils/logger.js";
import { canContact } from "./can-contact.js";
import { verifyContactBeforeSend } from "./email-verification.js";
import { createOrUpdateConversationFromOutreach } from "./conversation-service.js";
import { resolveSenderEmail } from "./sender-resolver.js";

type OutreachRecord = {
  id: string;
  companyId: string;
  contactId?: string;
  businessId?: string;
  workspaceId?: string;
  campaignId?: string;
  opportunityId?: string;
  status: string;
  generatedSubject?: string;
  generatedBody?: string;
  followUp1?: string;
  followUp2?: string;
  linkedinNote?: string;
  linkedinFollowUp?: string;
  pdfStorageUrl?: string;
  approvedBy?: string;
};

type ContactRecord = { email?: string; firstName?: string; lastName?: string; fullName?: string };
type CompanyRecord = { name?: string; domain?: string };

const INSTANTLY_CAMPAIGN_NAME = "Devcomm Outreach Automation";

export async function sendApprovedOutreach(
  outreachId: string
): Promise<{ outreachId: string; status: string; leadId?: string; conversationId?: string }> {
  const settings = await getGlobalSettings();
  const secrets = await getIntegrationSecrets();

  if (!secrets.instantlyApiKey) throw new Error("Instantly.ai API key not configured. Add it in Settings > Integrations.");

  const outreachSnap = await adminDb.collection("outreach").doc(outreachId).get();
  if (!outreachSnap.exists) throw new Error(`Outreach not found: ${outreachId}`);
  const outreach = { id: outreachSnap.id, ...outreachSnap.data() } as OutreachRecord;

  if (outreach.status !== "approved") throw new Error(`Outreach must be approved before sending. Current status: ${outreach.status}`);
  if (settings.requireApprovalBeforeExport && outreach.status !== "approved") throw new Error("Approval required before sending.");
  if (!outreach.contactId) throw new Error("Contact ID is required on outreach record.");

  // Canonical Gatekeeper (REQ-057 & Invariant 3)
  const contactability = await canContact(outreach.contactId, outreach.businessId, {
    checkDailyLimit: true,
    checkActiveConversation: true
  });
  // Deliverability gate: an address that cannot receive mail produces a hard
  // bounce, and bounces above ~5% degrade the sending domain for every later
  // message. Checked here, immediately before dispatch, so nothing slips past.
  if (contactability.allowed) {
    const verification = await verifyContactBeforeSend({
      contactId: outreach.contactId,
      workspaceId: outreach.workspaceId,
      businessId: outreach.businessId
    }).catch(() => null);

    if (verification?.blocked) {
      const now = Timestamp.now();
      await outreachSnap.ref.set(
        {
          status: "suppressed",
          suppressionReason: `Undeliverable address: ${verification.reason ?? "no mail server"}`,
          updatedAt: now
        },
        { merge: true }
      );
      await writeLog({
        type: "outreach.suppressed",
        level: "warning",
        message: `Send blocked — the address cannot receive mail. ${verification.reason ?? ""}`.trim(),
        workspaceId: outreach.workspaceId,
        businessId: outreach.businessId,
        metadata: { outreachId, contactId: outreach.contactId, verdict: verification.verdict }
      });
      return { outreachId, status: "suppressed" };
    }
  }

  if (!contactability.allowed) {
    const now = Timestamp.now();
    await outreachSnap.ref.set(
      {
        status: "suppressed",
        suppressionReason: contactability.reason,
        updatedAt: now
      },
      { merge: true }
    );
    await writeLog({
      type: "outreach.suppressed",
      level: "warning",
      message: `Outreach blocked by contactability gatekeeper: ${contactability.reason}`,
      metadata: {
        outreachId,
        contactId: outreach.contactId,
        companyId: outreach.companyId,
        reason: contactability.reason,
        details: contactability.details
      }
    });
    throw new Error(`Outreach blocked by contactability gatekeeper: ${contactability.reason}`);
  }

  const contactSnap = await adminDb.collection("contacts").doc(outreach.contactId).get();
  const contact = contactSnap.exists ? (contactSnap.data() as ContactRecord) : undefined;

  if (!contact?.email) throw new Error("Contact email is required to send outreach. Find contacts via Dropcontact first.");

  const companySnap = await adminDb.collection("companies").doc(outreach.companyId).get();
  const company = companySnap.exists ? (companySnap.data() as CompanyRecord) : undefined;

  const provider = new InstantlyProvider(secrets.instantlyApiKey);
  const campaignId = await provider.findOrCreateCampaign(INSTANTLY_CAMPAIGN_NAME);

  const lead = {
    email: contact.email,
    firstName: contact.firstName ?? contact.fullName?.split(" ")[0],
    lastName: contact.lastName ?? contact.fullName?.split(" ").slice(1).join(" "),
    companyName: company?.name,
    customVariables: {
      subject: outreach.generatedSubject ?? "",
      body: outreach.generatedBody ?? "",
      followUp1: outreach.followUp1 ?? "",
      followUp2: outreach.followUp2 ?? "",
      linkedinNote: outreach.linkedinNote ?? "",
      companyDomain: company?.domain ?? "",
      pdfUrl: outreach.pdfStorageUrl ?? ""
    }
  };

  const result = await provider.addLead(campaignId, lead);

  // Initialize Conversation & Outbound Message (REQ-062)
  const { conversationId } = await createOrUpdateConversationFromOutreach({
    outreachId,
    companyId: outreach.companyId,
    contactId: outreach.contactId,
    workspaceId: outreach.workspaceId,
    businessId: outreach.businessId,
    campaignId: outreach.campaignId,
    opportunityId: outreach.opportunityId,
    subject: outreach.generatedSubject ?? "",
    bodyText: outreach.generatedBody ?? "",
    // The business's own sender, never another business's address.
    senderEmail: await resolveSenderEmail({ workspaceId: outreach.workspaceId, businessId: outreach.businessId }),
    recipientEmail: contact.email,
    instantlyLeadId: result.leadId,
    assignedRepUserId: outreach.approvedBy
  });

  const now = Timestamp.now();
  await outreachSnap.ref.set(
    {
      status: "sent",
      conversationId,
      instantlyLeadId: result.leadId,
      sentAt: now,
      updatedAt: now,
      lastInteractionAt: now
    },
    { merge: true }
  );

  await adminDb.collection("companies").doc(outreach.companyId).set(
    { status: "contacted", lastActivityAt: now, updatedAt: now },
    { merge: true }
  );

  await writeLog({
    type: "outreach.sent",
    level: "info",
    message: `Outreach sent to Instantly.ai. Campaign: ${INSTANTLY_CAMPAIGN_NAME}`,
    metadata: {
      outreachId,
      campaignId,
      email: contact.email,
      companyId: outreach.companyId,
      leadId: result.leadId,
      conversationId
    }
  });

  return { outreachId, status: "sent", leadId: result.leadId, conversationId };
}

