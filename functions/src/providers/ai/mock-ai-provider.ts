import type { AIProvider, OutreachInput, OutreachProviderResult, ResearchInput, ResearchProviderResult } from "./ai-provider.js";
import type { ResearchOutput } from "../../services/research-schema.js";
import type { OutreachOutput } from "../../services/outreach-schema.js";

export class MockAIProvider implements AIProvider {
  name = "mock" as const;
  model = "mock-devcomm-research-v1";

  isConfigured() {
    return true;
  }

  async generateStructuredResearch(input: ResearchInput): Promise<ResearchProviderResult> {
    const company = input.company;
    const text = [company.name, company.industry, company.nafLabel, company.description, input.websiteText].join(" ").toLowerCase();
    const road = ["transport", "flotte", "livraison", "maintenance", "technicien", "qHSE".toLowerCase(), "prévention"].some((word) => text.includes(word));
    const sales = ["commercial", "sales", "b2b", "agence", "distribution"].some((word) => text.includes(word));
    const training = ["formation", "rh", "recrutement", "talent"].some((word) => text.includes(word));
    const fitScore = road ? 82 : sales ? 76 : training ? 72 : 42;
    const confidence = company.website || input.websiteText ? 72 : 54;
    const segment = road ? "road_safety" : sales ? "commercial_performance" : training ? "training_hr" : "low_fit";
    const sourceUrls = [company.sourceUrl, company.website].filter((value): value is string => typeof value === "string" && value.startsWith("http"));

    const output: ResearchOutput = {
      companySummary: `${String(company.name ?? "This company")} appears to be a ${String(company.industry ?? "B2B organization")}. This is a mock research result for local testing, not a confirmed external analysis.`,
      segment,
      fitScore,
      confidence,
      detectedNeeds: road ? ["Inference: road-risk or fleet training may be relevant if field teams are confirmed."] : sales ? ["Inference: sales performance support may be relevant if a sales team is confirmed."] : [],
      painPoints: confidence >= 60 ? ["Inference: operational consistency and team practices may need validation in discovery."] : ["Data is limited; enrich the company before drawing conclusions."],
      buyingTriggers: ["Inference only: campaign/source keywords suggest a possible Devcomm angle."],
      bestDevcommOffer: road ? "Skills2Drive / prévention du risque routier" : sales ? "Commercial performance and sales training" : training ? "Professional training and team behavior support" : "Enrich before selecting an offer",
      targetPersonas: road ? ["Responsable QHSE", "Responsable Flotte", "Directeur d’exploitation"] : sales ? ["Dirigeant", "Directeur Commercial", "Responsable Formation"] : ["Dirigeant", "Responsable Formation"],
      personalizedAngle: "Use available source data carefully and frame the first touch as a diagnostic, not as a claim about confirmed internal needs.",
      reasoningSummary: "Mock provider used because no configured AI key was available. Scores are deterministic based on company fields and should be treated as test data.",
      risks: confidence < 60 ? ["Low confidence because website/source context is missing."] : ["Needs human review before outreach."],
      recommendedNextAction: fitScore >= 70 && confidence >= 60 ? "approve_outreach" : fitScore < 40 ? "reject" : "enrich_more",
      sourceUrls
    };

    return {
      provider: this.name,
      model: this.model,
      output,
      rawOutput: output,
      estimatedInputTokens: Math.ceil(JSON.stringify(input).length / 4),
      estimatedOutputTokens: Math.ceil(JSON.stringify(output).length / 4),
      estimatedCost: 0
    };
  }

  async generateStructuredOutreach(input: OutreachInput): Promise<OutreachProviderResult> {
    const companyName = String(input.company.name ?? "votre entreprise");
    const contactName = input.contact?.firstName ? String(input.contact.firstName) : undefined;
    const research = input.research;
    const segment = String(research.segment ?? "commercial_performance");
    const bestOffer = String(research.bestOffer ?? research.bestDevcommOffer ?? "un accompagnement opérationnel des équipes");
    const fitScore = typeof research.fitScore === "number" ? research.fitScore : 50;
    const confidence = typeof research.confidence === "number" ? research.confidence : 50;
    const persona =
      segment === "road_safety"
        ? "Responsable QHSE / Flotte"
        : segment === "training_hr"
          ? "Responsable Formation / RH"
          : "Dirigeant / Directeur Commercial";
    const observation =
      segment === "road_safety"
        ? "semble avoir des enjeux opérationnels où la prévention et les pratiques terrain peuvent compter"
        : segment === "training_hr"
          ? "semble évoluer dans un contexte où le développement des compétences peut avoir un impact concret"
          : "semble adresser des sujets commerciaux ou opérationnels où les rituels d'équipe peuvent faire la différence";
    const greeting = contactName ? `Bonjour ${contactName},` : "Bonjour,";

    const output: OutreachOutput = {
      subject: `Échange autour de ${companyName}`,
      body: `${greeting}\n\nJe me permets de vous contacter car ${companyName} ${observation}.\n\nDevcomm accompagne les entreprises sur ${bestOffer}, avec une approche très opérationnelle centrée sur les équipes et les situations concrètes.\n\nL’idée serait simplement de voir si un diagnostic court pourrait être utile pour identifier quelques leviers prioritaires.\n\nSeriez-vous ouvert à un échange de 20 minutes dans les prochains jours ?\n\nBien à vous,\n\nSi ce sujet n’est pas pertinent, dites-le-moi simplement et je ne vous relancerai pas.`,
      followUp1: `Bonjour,\n\nJe me permets une courte relance au sujet de mon message précédent. L’idée n’est pas de vous proposer une démarche lourde, mais simplement d’échanger 20 minutes pour voir si un diagnostic Devcomm pourrait être utile à ${companyName}.\n\nEst-ce que cela vaudrait le coup d’en parler brièvement ?`,
      followUp2: `Bonjour,\n\nJe ne veux pas insister inutilement. Si les sujets liés à ${bestOffer} ne sont pas prioritaires pour ${companyName}, dites-le-moi simplement et je clôturerai de mon côté.\n\nBonne journée,`,
      linkedinConnectionNote: `Bonjour, je souhaitais vous ajouter à mon réseau autour des sujets ${bestOffer}.`,
      linkedinFollowUp: `Merci pour l’ajout. Si le sujet est pertinent, je serais ravi d’échanger 20 minutes pour voir si un diagnostic court pourrait être utile à ${companyName}.`,
      internalSalesNotes: `Mock outreach generated from latest research. Fit score ${fitScore}, confidence ${confidence}. Review carefully before approval.`,
      suggestedPersona: persona,
      cta: "Proposer un échange diagnostic de 20 minutes.",
      personalizationNotes: ["Observation phrased cautiously as an inference.", `Segment used: ${segment}.`],
      riskWarnings: confidence < 60 ? ["Confidence is low; review or enrich before approving."] : ["Human review required before any export or sending."],
      landingPageDraft: {
        headline: `${companyName} x Devcomm`,
        intro: "Brouillon interne uniquement pour une future page personnalisée.",
        whyDevcomm: bestOffer,
        likelyChallenges: ["À valider en échange diagnostic."],
        recommendedSupport: [bestOffer],
        cta: "Planifier un échange diagnostic de 20 minutes."
      }
    };

    return {
      provider: this.name,
      model: this.model,
      output,
      rawOutput: output,
      estimatedInputTokens: Math.ceil(JSON.stringify(input).length / 4),
      estimatedOutputTokens: Math.ceil(JSON.stringify(output).length / 4),
      estimatedCost: 0
    };
  }
}
