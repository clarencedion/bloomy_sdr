import { describe, it, expect } from "vitest";
import { classifyReply } from "../../services/reply-classifier.js";

describe("Reply Intent & Objection Classifier (REQ-063, REQ-064)", () => {
  it("should classify meeting & slot requests as BOOKING_REQUEST (confidence >= 0.90)", async () => {
    const res = await classifyReply({
      leadEmail: "prospect@acme.fr",
      subject: "Re: Diagnostic",
      bodyText: "Bonjour, oui pourquoi pas, pouvez-vous m'appeler jeudi à 14h pour en discuter ?"
    });

    expect(res.intent).toBe("BOOKING_REQUEST");
    expect(res.confidence).toBeGreaterThanOrEqual(0.9);
    expect(res.suggestedAction).toBe("send_booking_link");
  });

  it("should classify pricing & service inquiries as QUESTION with detected questions", async () => {
    const res = await classifyReply({
      leadEmail: "prospect@acme.fr",
      subject: "Re: Diagnostic",
      bodyText: "Bonjour, combien coûte votre prestation de refonte et comment procédez-vous ?"
    });

    expect(res.intent).toBe("QUESTION");
    expect(res.confidence).toBeGreaterThanOrEqual(0.85);
    expect(res.suggestedAction).toBe("answer_question");
    expect(res.detectedQuestions && res.detectedQuestions.length).toBeGreaterThan(0);
  });

  it("should classify existing vendor objection as OBJECTION / EXISTING_PROVIDER", async () => {
    const res = await classifyReply({
      leadEmail: "prospect@acme.fr",
      subject: "Re: Diagnostic",
      bodyText: "Merci pour votre message, mais nous travaillons déjà avec une agence web à Nantes."
    });

    expect(res.intent).toBe("OBJECTION");
    expect(res.objectionType).toBe("EXISTING_PROVIDER");
    expect(res.suggestedAction).toBe("handle_objection");
  });

  it("should classify price pushback as OBJECTION / PRICE", async () => {
    const res = await classifyReply({
      leadEmail: "prospect@acme.fr",
      subject: "Re: Diagnostic",
      bodyText: "Vos tarifs sont beaucoup trop chers pour notre structure."
    });

    expect(res.intent).toBe("OBJECTION");
    expect(res.objectionType).toBe("PRICE");
    expect(res.suggestedAction).toBe("handle_objection");
  });

  it("should classify lack of budget as OBJECTION / NO_BUDGET", async () => {
    const res = await classifyReply({
      leadEmail: "prospect@acme.fr",
      subject: "Re: Diagnostic",
      bodyText: "Nous n'avons aucun budget alloué pour ce type de projet cette année."
    });

    expect(res.intent).toBe("OBJECTION");
    expect(res.objectionType).toBe("NO_BUDGET");
  });

  it("should classify low priority as OBJECTION / NOT_PRIORITY", async () => {
    const res = await classifyReply({
      leadEmail: "prospect@acme.fr",
      subject: "Re: Diagnostic",
      bodyText: "Merci mais ce sujet n'est pas notre priorité en ce moment."
    });

    expect(res.intent).toBe("OBJECTION");
    expect(res.objectionType).toBe("NOT_PRIORITY");
  });

  it("should classify bad timing as OBJECTION / BAD_TIMING", async () => {
    const res = await classifyReply({
      leadEmail: "prospect@acme.fr",
      subject: "Re: Diagnostic",
      bodyText: "C'est un mauvais moment en pleine réorganisation. Recontactez-moi en fin d'année."
    });

    expect(res.intent).toBe("OBJECTION");
    expect(res.objectionType).toBe("BAD_TIMING");
  });

  it("should classify delegation/referral as WRONG_PERSON with human attention required", async () => {
    const res = await classifyReply({
      leadEmail: "prospect@acme.fr",
      subject: "Re: Diagnostic",
      bodyText: "Bonjour, je ne suis pas le bon interlocuteur pour ce sujet, voyez avec M. Dupont notre directeur technique."
    });

    expect(res.intent).toBe("WRONG_PERSON");
    expect(res.requiresHumanAttention).toBe(true);
  });

  it("should classify hostile or threatening replies as ANGRY and flag for SDR alert", async () => {
    const res = await classifyReply({
      leadEmail: "angry-lead@example.com",
      subject: "Re: Diagnostic",
      bodyText: "Arrêtez vos spams inadmissibles ! Si vous me recontactez je dépose une plainte à la CNIL."
    });

    expect(res.intent).toBe("ANGRY");
    expect(res.requiresHumanAttention).toBe(true);
  });

  it("should classify general interest as POSITIVE", async () => {
    const res = await classifyReply({
      leadEmail: "interested@example.com",
      subject: "Re: Diagnostic",
      bodyText: "Bonjour, votre proposition est intéressante, nous serions volontiers preneurs d'en savoir plus."
    });

    expect(res.intent).toBe("POSITIVE");
    expect(res.confidence).toBeGreaterThanOrEqual(0.85);
  });
});
