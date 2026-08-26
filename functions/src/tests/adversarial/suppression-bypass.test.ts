import { describe, it, expect, beforeEach } from "vitest";
import {
  canContact,
  canContactDetails,
  addToSuppressionList,
  isSuppressed
} from "../../services/can-contact.js";
import { adminDb } from "../../config/firebase.js";

describe("Adversarial Security Audit: Suppression & Contactability Invariant (Invariant 3)", () => {
  beforeEach(async () => {
    // Add known test entries to suppression list
    await addToSuppressionList({
      targetType: "email",
      targetValue: "suppressed-ceo@victim.fr",
      reason: "Requested deletion via GDPR inquiry"
    });

    await addToSuppressionList({
      targetType: "domain",
      targetValue: "banned-domain.com",
      reason: "Direct competitor domain"
    });

    await addToSuppressionList({
      targetType: "siren",
      targetValue: "999888777",
      reason: "Blacklisted SIREN"
    });
  });

  describe("Contact & Company Direct Flags", () => {
    it("should block 100% of contacts with doNotContact: true", async () => {
      const res = await canContactDetails({
        email: "prospect1@example-corp.fr",
        doNotContact: true
      });
      expect(res.allowed).toBe(false);
      expect(res.reason).toBe("contact_marked_do_not_contact");
    });

    it("should block 100% of unsubscribed or bounced contacts", async () => {
      const resUnsub = await canContactDetails({
        email: "unsub@example-corp.fr",
        unsubscribed: true
      });
      expect(resUnsub.allowed).toBe(false);
      expect(resUnsub.reason).toBe("contact_unsubscribed");

      const resBounce = await canContactDetails({
        email: "bounced@example-corp.fr",
        bounced: true
      });
      expect(resBounce.allowed).toBe(false);
      expect(resBounce.reason).toBe("contact_bounced");
    });

    it("should block contacts belonging to disqualified companies", async () => {
      await adminDb.collection("companies").doc("comp_disqualified_test").set({
        id: "comp_disqualified_test",
        name: "Disqualified SAS",
        status: "disqualified"
      });

      await adminDb.collection("contacts").doc("contact_disqualified_test").set({
        id: "contact_disqualified_test",
        email: "contact@disqualified-sas.fr",
        companyId: "comp_disqualified_test"
      });

      const res = await canContact("contact_disqualified_test");
      expect(res.allowed).toBe(false);
      expect(res.reason).toBe("company_disqualified");
    });
  });

  describe("Government, Disposable, and Competitor Blacklists", () => {
    it("should block all government and public administration domains", async () => {
      const govEmails = [
        "prefet@justice.fr",
        "agent@impots.gouv.fr",
        "contact@interieur.gouv.fr",
        "info@service-public.fr",
        "maire@nantes.gouv.fr"
      ];

      for (const email of govEmails) {
        const res = await canContactDetails({ email });
        expect(res.allowed).toBe(false);
        expect(res.reason).toContain("domain_blacklisted");
      }
    });

    it("should block all disposable/temporary email domains", async () => {
      const disposableEmails = [
        "burner@mailinator.com",
        "throwaway@tempmail.com",
        "fake@guerrillamail.com",
        "temp@10minutemail.com"
      ];

      for (const email of disposableEmails) {
        const res = await canContactDetails({ email });
        expect(res.allowed).toBe(false);
        expect(res.reason).toContain("domain_blacklisted");
      }
    });
  });

  describe("Suppression List Matching (Email, Domain, SIREN)", () => {
    it("should identify suppressed email, domain, and SIREN correctly", async () => {
      const emailCheck = await isSuppressed({ email: "SUPPRESSED-CEO@VICTIM.FR" });
      expect(emailCheck.suppressed).toBe(true);
      expect(emailCheck.reason).toContain("GDPR");

      const domainCheck = await isSuppressed({ domain: "subdomain.banned-domain.com" });
      expect(domainCheck.suppressed).toBe(true);

      const sirenCheck = await isSuppressed({ siren: "999888777" });
      expect(sirenCheck.suppressed).toBe(true);
    });

    it("should block outreach dispatch to suppressed email through canContactDetails", async () => {
      const res = await canContactDetails({ email: "suppressed-ceo@victim.fr" });
      expect(res.allowed).toBe(false);
      expect(res.reason).toContain("suppressed");
    });
  });

  describe("Active Conversation Locks", () => {
    it("should block cold outreach when prospect has an active dialogue in progress", async () => {
      const activeProspectEmail = "dialogue-prospect@active-corp.fr";

      await adminDb.collection("conversations").doc("conv_active_lock_test").set({
        id: "conv_active_lock_test",
        prospectEmail: activeProspectEmail,
        status: "waiting_reply",
        updatedAt: new Date()
      });

      const res = await canContactDetails(
        { email: activeProspectEmail },
        { checkActiveConversation: true }
      );

      expect(res.allowed).toBe(false);
      expect(res.reason).toContain("active_conversation_locked");
    });
  });

  describe("Concurrent High-Volume Bypass Attempt", () => {
    it("should block 100% of 50 concurrent dispatch attempts to suppressed contact", async () => {
      const attempts = Array.from({ length: 50 }, () =>
        canContactDetails({
          email: "suppressed-ceo@victim.fr",
          domain: "victim.fr"
        })
      );

      const results = await Promise.all(attempts);
      const allowedCount = results.filter((r) => r.allowed).length;
      expect(allowedCount).toBe(0);
    });
  });
});
