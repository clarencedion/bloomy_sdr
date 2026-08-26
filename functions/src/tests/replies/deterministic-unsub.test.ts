import { describe, it, expect, beforeEach } from "vitest";
import { isDeterministicUnsubscribe, classifyReply } from "../../services/reply-classifier.js";
import { executeDeterministicUnsubscribe } from "../../services/unsubscribe-handler.js";
import { adminDb } from "../../config/firebase.js";

describe("Deterministic Unsubscribe Engine (REQ-065)", () => {
  beforeEach(async () => {
    // Clear test data
    const suppDocs = await adminDb.collection("suppressionList").get();
    for (const doc of suppDocs.docs) {
      await doc.ref.delete();
    }
  });

  it("should match various French and English unsubscribe phrases deterministically", () => {
    const unsubPhrases = [
      "Merci de me retirer de votre liste de diffusion.",
      "Retirez-moi immédiatement de vos contacts svp.",
      "Stop, ne plus me contacter.",
      "Veuillez supprimer mes coordonnées de votre base.",
      "Je ne souhaite plus recevoir vos emails. Désabonner.",
      "Pas intéressé, merci de ne plus m'écrire.",
      "Unsubscribe please.",
      "Please opt-out my email address."
    ];

    for (const phrase of unsubPhrases) {
      const isUnsub = isDeterministicUnsubscribe({ bodyText: phrase });
      expect(isUnsub, `Expected "${phrase}" to be recognized as unsubscribe`).toBe(true);
    }
  });

  it("should classify unsubscribe reply with 100% confidence without LLM delay", async () => {
    const res = await classifyReply({
      leadEmail: "prospect-unsub@example.fr",
      subject: "Re: Diagnostic pour votre entreprise",
      bodyText: "Merci de me retirer de votre liste de prospection."
    });

    expect(res.intent).toBe("UNSUBSCRIBE");
    expect(res.confidence).toBe(1.0);
    expect(res.suggestedAction).toBe("unsubscribe_contact");
    expect(res.requiresHumanAttention).toBe(false);
  });

  it("should execute deterministic unsubscription and update Firestore suppressionList and contacts", async () => {
    const testEmail = "ceo-unsub-test@corp-nantes.fr";

    // Seed contact
    const contactRef = adminDb.collection("contacts").doc("contact_unsub_test_01");
    await contactRef.set({
      id: "contact_unsub_test_01",
      email: testEmail,
      normalizedEmail: testEmail,
      companyId: "comp_unsub_01",
      status: "contacted",
      doNotContact: false
    });

    // Seed conversation
    const convRef = adminDb.collection("conversations").doc("conv_unsub_01");
    await convRef.set({
      id: "conv_unsub_01",
      contactId: "contact_unsub_test_01",
      companyId: "comp_unsub_01",
      status: "in_dialogue",
      unreadHumanAttention: true
    });

    // Seed outreach
    const outreachRef = adminDb.collection("outreach").doc("outreach_unsub_01");
    await outreachRef.set({
      id: "outreach_unsub_01",
      contactId: "contact_unsub_test_01",
      companyId: "comp_unsub_01",
      status: "sent"
    });

    // Execute unsubscribe
    const result = await executeDeterministicUnsubscribe({
      leadEmail: testEmail,
      conversationId: "conv_unsub_01",
      workspaceId: "ws_default",
      businessId: "biz_devcomm"
    });

    expect(result.success).toBe(true);
    expect(result.contactsUpdated).toBeGreaterThanOrEqual(1);

    // Verify suppressionList record
    const suppDoc = await adminDb.collection("suppressionList").doc(result.suppressionDocId).get();
    expect(suppDoc.exists).toBe(true);
    expect(suppDoc.data()?.targetValue).toBe(testEmail);
    expect(suppDoc.data()?.reason).toBe("unsubscribe");

    // Verify contact updated
    const updatedContact = await contactRef.get();
    expect(updatedContact.data()?.doNotContact).toBe(true);
    expect(updatedContact.data()?.status).toBe("do_not_contact");

    // Verify conversation updated
    const updatedConv = await convRef.get();
    expect(updatedConv.data()?.status).toBe("suppressed");
    expect(updatedConv.data()?.latestIntent).toBe("UNSUBSCRIBE");
    expect(updatedConv.data()?.unreadHumanAttention).toBe(false);

    // Verify outreach updated
    const updatedOutreach = await outreachRef.get();
    expect(updatedOutreach.data()?.status).toBe("suppressed");
  });
});
