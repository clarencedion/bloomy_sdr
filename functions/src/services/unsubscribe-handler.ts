import { Timestamp } from "firebase-admin/firestore";
import { adminDb } from "../config/firebase.js";
import { writeLog } from "../utils/logger.js";

export interface UnsubscribeInput {
  leadEmail: string;
  workspaceId?: string;
  businessId?: string;
  conversationId?: string;
  reason?: string;
}

export interface UnsubscribeResult {
  success: boolean;
  normalizedEmail: string;
  suppressionDocId: string;
  contactsUpdated: number;
  conversationsUpdated: number;
  outreachUpdated: number;
}

/**
 * Deterministically executes contact unsubscription and suppression (REQ-065).
 * Immediately adds the email to suppressionList, marks contacts doNotContact = true,
 * marks conversations suppressed, and halts outreach without LLM delay.
 */
export async function executeDeterministicUnsubscribe(
  input: UnsubscribeInput
): Promise<UnsubscribeResult> {
  const normalizedEmail = input.leadEmail.toLowerCase().trim();
  if (!normalizedEmail) {
    throw new Error("Cannot unsubscribe an empty lead email.");
  }

  const now = Timestamp.now();
  const workspaceId = input.workspaceId || "ws_default";
  // An unsubscribe must never fail for want of attribution. Suppression is
  // checked across every business, so an unattributed entry still blocks all
  // further contact; it is simply not credited to a business that didn't send.
  // An attribution already on the entry is kept rather than nulled by the merge.
  const businessId = input.businessId;
  const suppDocId = `supp_email_${normalizedEmail.replace(/[^a-zA-Z0-9]/g, "_")}`;

  // 1. Write to suppressionList collection
  const suppRef = adminDb.collection("suppressionList").doc(suppDocId);
  await suppRef.set(
    {
      id: suppDocId,
      workspaceId,
      ...(businessId ? { businessId } : {}),
      targetType: "email",
      targetValue: normalizedEmail,
      reason: input.reason || "unsubscribe",
      sourceConversationId: input.conversationId,
      createdAt: now
    },
    { merge: true }
  );

  // 2. Update matching contacts
  let contactsUpdated = 0;
  const contactQuery1 = await adminDb
    .collection("contacts")
    .where("normalizedEmail", "==", normalizedEmail)
    .get();

  const contactDocs = [...contactQuery1.docs];
  if (contactDocs.length === 0) {
    const contactQuery2 = await adminDb
      .collection("contacts")
      .where("email", "==", input.leadEmail)
      .get();
    contactDocs.push(...contactQuery2.docs);
  }

  const contactIds: string[] = [];
  const companyIds: string[] = [];

  for (const doc of contactDocs) {
    contactIds.push(doc.id);
    const data = doc.data();
    if (data.companyId) {
      companyIds.push(data.companyId as string);
    }
    await doc.ref.set(
      {
        status: "do_not_contact",
        doNotContact: true,
        updatedAt: now
      },
      { merge: true }
    );
    contactsUpdated++;
  }

  // 3. Update Conversation(s)
  let conversationsUpdated = 0;
  if (input.conversationId) {
    await adminDb.collection("conversations").doc(input.conversationId).set(
      {
        status: "suppressed",
        latestIntent: "UNSUBSCRIBE",
        unreadHumanAttention: false,
        updatedAt: now
      },
      { merge: true }
    );
    conversationsUpdated++;
  }

  // Also update any other conversations tied to these contacts
  for (const contactId of contactIds) {
    const convSnaps = await adminDb
      .collection("conversations")
      .where("contactId", "==", contactId)
      .get();
    for (const convDoc of convSnaps.docs) {
      if (convDoc.id !== input.conversationId) {
        await convDoc.ref.set(
          {
            status: "suppressed",
            latestIntent: "UNSUBSCRIBE",
            unreadHumanAttention: false,
            updatedAt: now
          },
          { merge: true }
        );
        conversationsUpdated++;
      }
    }
  }

  // 4. Update Outreach sequences to suppressed
  let outreachUpdated = 0;
  for (const contactId of contactIds) {
    const outreachSnaps = await adminDb
      .collection("outreach")
      .where("contactId", "==", contactId)
      .where("status", "in", ["draft", "approved", "sent", "replied"])
      .get();

    for (const doc of outreachSnaps.docs) {
      await doc.ref.set(
        {
          status: "suppressed",
          rejectionReason: "Prospect unsubscribed",
          updatedAt: now
        },
        { merge: true }
      );
      outreachUpdated++;
    }
  }

  await writeLog({
    type: "suppression.unsubscribed",
    level: "info",
    message: `Deterministic unsubscribe executed for ${normalizedEmail}. Added to suppression list.`,
    metadata: {
      leadEmail: input.leadEmail,
      normalizedEmail,
      conversationId: input.conversationId,
      suppDocId,
      contactsUpdated,
      conversationsUpdated,
      outreachUpdated
    }
  });

  return {
    success: true,
    normalizedEmail,
    suppressionDocId: suppDocId,
    contactsUpdated,
    conversationsUpdated,
    outreachUpdated
  };
}
