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
    const businessName = input.business?.name || "Notre équipe";
    const offerName = input.offer?.name || String(research.bestOffer ?? research.bestDevcommOffer ?? "notre accompagnement");
    const valueProp = input.offer?.valuePropositions?.[0] || "l'optimisation de vos résultats et le développement opérationnel";
    const fitScore = typeof research.fitScore === "number" ? research.fitScore : 50;
    const confidence = typeof research.confidence === "number" ? research.confidence : 50;

    const facts = input.personalizationFacts ?? [];
    const pagespeedFact = facts.find((f) => f.key === "pagespeed_mobile_score");
    const reviewFact = facts.find((f) => f.key === "google_places_review_count");
    const cityFact = facts.find((f) => f.key === "city");
    const employeeFact = facts.find((f) => f.key === "employeeCount");

    let groundedFinding = "";
    if (pagespeedFact && reviewFact) {
      groundedFinding = `Vos ${reviewFact.value} avis clients sur Google soulignent une belle réputation, mais votre score mobile PageSpeed de ${pagespeedFact.value}/100 bride probablement une partie de vos conversions.`;
    } else if (pagespeedFact) {
      groundedFinding = `En observant votre présence web, j'ai noté un score de performance mobile de ${pagespeedFact.value}/100 qui impacte directement l'expérience de vos visiteurs sur smartphone.`;
    } else if (reviewFact) {
      groundedFinding = `Vos ${reviewFact.value} avis clients sur Google témoignent d'une solide traction commerciale locale.`;
    } else if (employeeFact) {
      groundedFinding = `Avec une équipe de ${employeeFact.value} collaborateurs${cityFact ? ` à ${cityFact.value}` : ""}, la coordination et la fluidité des processus sont des leviers essentiels de croissance.`;
    } else {
      groundedFinding = `Dans le cadre du développement de ${companyName}${cityFact ? ` à ${cityFact.value}` : ""}, l'optimisation des méthodes et des outils constitue un enjeu clé.`;
    }

    const persona =
      segment === "road_safety"
        ? "Responsable QHSE / Flotte"
        : segment === "training_hr"
          ? "Responsable Formation / RH"
          : "Dirigeant / Directeur Commercial";

    const greeting = contactName ? `Bonjour ${contactName},` : "Bonjour,";

    const body = `${greeting}

Je me permets de vous contacter car ${groundedFinding}

Chez ${businessName}, nous accompagnons les entreprises à travers ${offerName} afin de concrétiser ${valueProp}. Notre approche est pragmatique, sans démarche superflue.

L'objectif serait simplement de partager un premier diagnostic court pour identifier d'éventuels points d'optimisation prioritaires.

Seriez-vous ouvert à un court échange de 20 minutes cette semaine ?

Bien à vous,

Si ce sujet n’est pas pertinent pour vous, dites-le-moi simplement et je ne vous relancerai pas.`;

    const followUp1 = `Bonjour${contactName ? ` ${contactName}` : ""},

Je me permets une courte relance suite à mon message précédent.

L'idée n'est pas de vous engager dans un projet lourd, mais de vérifier en 20 minutes si les pistes identifiées pour ${companyName} font écho à vos priorités actuelles.

Avez-vous un créneau disponible cette semaine ?

Si vous préférez ne pas être relancé, n'hésitez pas à me l'indiquer.`;

    const followUp2 = `Bonjour${contactName ? ` ${contactName}` : ""},

Je ne souhaite pas insister inutilement. Si le sujet de ${offerName} n'est pas prioritaire pour ${companyName} en ce moment, aucun problème.

Je clôture nos échanges de mon côté. N'hésitez pas à me recontacter si le besoin se présente à l'avenir.

Bonne continuation,`;

    const linkedinConnectionNote = `Bonjour${contactName ? ` ${contactName}` : ""}, ravi de découvrir le développement de ${companyName}. Je serais ravi d'échanger avec vous autour de ${offerName}.`;
    const linkedinFollowUp = `Merci pour la mise en relation ! Si vous êtes disponible pour un court retour d'expérience de 20 minutes sur vos enjeux actuels, ce sera avec plaisir.`;

    const output: OutreachOutput = {
      subject: `Diagnostic pour ${companyName}`,
      body,
      followUp1,
      followUp2,
      linkedinConnectionNote,
      linkedinFollowUp,
      internalSalesNotes: `Generated with evidence grounding. Fit score: ${fitScore}, confidence: ${confidence}. Verified facts cited: ${facts.map((f) => f.key).join(", ") || "none"}.`,
      suggestedPersona: persona,
      cta: "Échange diagnostic de 20 minutes",
      personalizationNotes: facts.map((f) => f.label),
      riskWarnings: confidence < 60 ? ["Confiance faible : vérifier les données avant validation."] : [],
      landingPageDraft: {
        headline: `${companyName} x ${businessName}`,
        intro: `Proposition sur mesure pour ${companyName}`,
        whyDevcomm: valueProp,
        likelyChallenges: ["Temps de chargement et conversion mobile", "Fluidité des processus commerciaux"],
        recommendedSupport: [offerName],
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

  async classifyReply(input: import("./ai-provider.js").ReplyClassificationInput): Promise<import("./ai-provider.js").ReplyClassificationProviderResult> {
    const text = `${input.subject || ""} ${input.bodyText}`.toLowerCase();

    let intent: import("../../types/domain.js").ReplyIntent = "POSITIVE";
    let objectionType: import("../../types/domain.js").ObjectionType | undefined = undefined;
    let confidence = 0.9;
    let suggestedAction = "none";
    let reasoning = "Mock AI classification based on keyword signals.";
    let requiresHumanAttention = false;
    const detectedQuestions: string[] = [];

    // 1. Hostile / Angry / Legal
    if (
      text.includes("plainte") ||
      text.includes("cnil") ||
      text.includes("avocat") ||
      text.includes("tribunal") ||
      text.includes("harcèlement") ||
      text.includes("harcelement") ||
      text.includes("scandaleux") ||
      text.includes("honteux") ||
      text.includes("arnaque") ||
      (text.includes("spam") && (text.includes("inadmissible") || text.includes("illégal") || text.includes("arretez")))
    ) {
      intent = "ANGRY";
      confidence = 0.95;
      suggestedAction = "pause_sequence_escalate";
      reasoning = "Prospect expressed hostility, anger, or legal threats.";
      requiresHumanAttention = true;
    }
    // 2. Unsubscribe
    else if (
      text.includes("retirer") ||
      text.includes("supprimer") ||
      text.includes("desabonner") ||
      text.includes("désabonner") ||
      text.includes("ne plus me contacter") ||
      text.includes("ne plus m'ecrire") ||
      text.includes("ne plus m'écrire") ||
      text.includes("stop") ||
      text.includes("unsubscribe")
    ) {
      intent = "UNSUBSCRIBE";
      confidence = 1.0;
      suggestedAction = "unsubscribe_contact";
      reasoning = "Prospect requested removal from mailing list.";
      requiresHumanAttention = false;
    }
    // 3. Out of Office
    else if (
      text.includes("absent") ||
      text.includes("absence") ||
      text.includes("congé") ||
      text.includes("conge") ||
      text.includes("out of office") ||
      text.includes("auto-reply") ||
      text.includes("automatic reply")
    ) {
      intent = "OUT_OF_OFFICE";
      confidence = 1.0;
      suggestedAction = "ignore_auto_reply";
      reasoning = "Automated out of office responder detected.";
      requiresHumanAttention = false;
    }
    // 4. Wrong Person
    else if (
      text.includes("pas le bon interlocuteur") ||
      text.includes("pas le bon contact") ||
      text.includes("ne gère pas") ||
      text.includes("ne m'occupe pas") ||
      text.includes("voyez avec") ||
      text.includes("contactez plutot") ||
      text.includes("contactez plutôt") ||
      text.includes("s'adresser à")
    ) {
      intent = "WRONG_PERSON";
      confidence = 0.92;
      suggestedAction = "pause_sequence_escalate";
      reasoning = "Prospect indicated they are not the appropriate contact.";
      requiresHumanAttention = true;
    }
    // 5. Booking Request / Meeting
    else if (
      text.includes("jeudi") ||
      text.includes("vendredi") ||
      text.includes("lundi") ||
      text.includes("mardi") ||
      text.includes("mercredi") ||
      text.includes("demain") ||
      text.includes("appeler") ||
      text.includes("appelez-moi") ||
      text.includes("créneau") ||
      text.includes("creneau") ||
      text.includes("rendez-vous") ||
      text.includes("disponible") ||
      text.includes("lien cal") ||
      text.includes("lien de booking")
    ) {
      intent = "BOOKING_REQUEST";
      confidence = 0.95;
      suggestedAction = "send_booking_link";
      reasoning = "Prospect proposed or requested a meeting/call slot.";
      requiresHumanAttention = false;
    }
    // 6. Questions
    else if (
      text.includes("combien") ||
      text.includes("quel est le prix") ||
      text.includes("quels sont vos tarifs") ||
      text.includes("comment fonctionne") ||
      text.includes("comment procédez-vous") ||
      text.includes("avez-vous des références") ||
      text.includes("?")
    ) {
      intent = "QUESTION";
      confidence = 0.9;
      suggestedAction = "answer_question";
      if (text.includes("combien") || text.includes("prix") || text.includes("tarif")) {
        detectedQuestions.push("Tarification et coût de la prestation");
        objectionType = "PRICE";
      } else {
        detectedQuestions.push("Informations complémentaires sur le service");
      }
      reasoning = "Prospect asked specific questions regarding service or pricing.";
      requiresHumanAttention = false;
    }
    // 7. Objections
    else if (
      text.includes("agence") ||
      text.includes("prestataire") ||
      text.includes("déjà") ||
      text.includes("deja") ||
      text.includes("fournisseur") ||
      text.includes("interne")
    ) {
      intent = "OBJECTION";
      objectionType = "EXISTING_PROVIDER";
      confidence = 0.92;
      suggestedAction = "handle_objection";
      reasoning = "Prospect already works with an existing provider.";
      requiresHumanAttention = false;
    } else if (
      text.includes("trop cher") ||
      text.includes("hors budget") ||
      text.includes("coûteux") ||
      text.includes("couteux")
    ) {
      intent = "OBJECTION";
      objectionType = "PRICE";
      confidence = 0.9;
      suggestedAction = "handle_objection";
      reasoning = "Prospect raised pricing objection.";
      requiresHumanAttention = false;
    } else if (
      text.includes("pas de budget") ||
      text.includes("aucun budget") ||
      text.includes("gel des budgets")
    ) {
      intent = "OBJECTION";
      objectionType = "NO_BUDGET";
      confidence = 0.92;
      suggestedAction = "handle_objection";
      reasoning = "Prospect stated no budget is available.";
      requiresHumanAttention = false;
    } else if (
      text.includes("pas notre priorité") ||
      text.includes("pas une priorité") ||
      text.includes("pas prioritaire")
    ) {
      intent = "OBJECTION";
      objectionType = "NOT_PRIORITY";
      confidence = 0.9;
      suggestedAction = "handle_objection";
      reasoning = "Prospect indicated this topic is not a current priority.";
      requiresHumanAttention = false;
    } else if (
      text.includes("mauvais moment") ||
      text.includes("plus tard") ||
      text.includes("en fin d'année") ||
      text.includes("en septembre") ||
      text.includes("recontactez")
    ) {
      intent = "OBJECTION";
      objectionType = "BAD_TIMING";
      confidence = 0.88;
      suggestedAction = "handle_objection";
      reasoning = "Prospect indicated bad timing and requested later follow-up.";
      requiresHumanAttention = false;
    } else if (text.includes("pas le temps")) {
      intent = "OBJECTION";
      objectionType = "NO_TIME";
      confidence = 0.88;
      suggestedAction = "handle_objection";
      reasoning = "Prospect indicated lack of time.";
      requiresHumanAttention = false;
    } else if (
      text.includes("intéressé") ||
      text.includes("interesse") ||
      text.includes("volontiers") ||
      text.includes("pourquoi pas") ||
      text.includes("en savoir plus")
    ) {
      intent = "POSITIVE";
      confidence = 0.9;
      suggestedAction = "send_booking_link";
      reasoning = "Prospect expressed interest in learning more.";
      requiresHumanAttention = false;
    } else {
      intent = "NEUTRAL";
      confidence = 0.75;
      suggestedAction = "none";
      reasoning = "General reply without strong directional polarity.";
      requiresHumanAttention = false;
    }

    const output: import("../../services/reply-classifier-schema.js").ReplyClassificationOutput = {
      intent,
      objectionType,
      confidence,
      detectedQuestions,
      suggestedAction,
      reasoning,
      requiresHumanAttention
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

  async generateReply(input: import("./ai-provider.js").ReplyGenerationInput): Promise<import("./ai-provider.js").ReplyGenerationProviderResult> {
    const text = `${input.latestInboundMessage.subject || ""} ${input.latestInboundMessage.bodyText}`.toLowerCase();
    const businessName = input.business?.name || "Notre équipe";
    const citedKnowledgePoints: string[] = [];
    let pricingDisclosed = false;
    let pricingGuardrailPassed = true;
    let requiresHumanEscalation = false;
    let escalationReason: string | undefined = undefined;
    let bodyText = "";
    const subject = input.latestInboundMessage.subject?.startsWith("Re:")
      ? input.latestInboundMessage.subject
      : `Re: ${input.latestInboundMessage.subject || "Échange diagnostic"}`;

    // 1. Check for discount negotiation / aggressive pricing inquiry (REQ-067)
    if (
      text.includes("50%") ||
      text.includes("remise") ||
      text.includes("réduction") ||
      text.includes("reduction") ||
      text.includes("rabais") ||
      text.includes("négocier") ||
      text.includes("negocier") ||
      text.includes("geste commercial")
    ) {
      pricingGuardrailPassed = false;
      requiresHumanEscalation = true;
      escalationReason = "Discount negotiation requested outside pricing guardrails";
      bodyText = `Bonjour,\n\nMerci pour votre retour. Nos tarifs sont établis en fonction du périmètre exact et des besoins spécifiques identifiés lors du diagnostic initial, nous n'appliquons pas de remise forfaitaire sans étude préalable.\n\nJe transmets votre demande à notre direction commerciale qui étudiera votre dossier pour vous faire une proposition adaptée.\n\nBien cordialement,\nL'équipe ${businessName}`;
    }
    // 2. Delivery timeline question (e.g. "combien de temps", "délais", "3 semaines") (REQ-066)
    else if (
      text.includes("combien de temps") ||
      text.includes("délai") ||
      text.includes("delai") ||
      text.includes("durée") ||
      text.includes("duree") ||
      text.includes("temps prend")
    ) {
      const timelineFaq = input.knowledgeBase?.faqs?.find(
        (f) =>
          f.question.toLowerCase().includes("temps") ||
          f.question.toLowerCase().includes("délai") ||
          f.answer.toLowerCase().includes("semaine")
      );
      const answerSnippet = timelineFaq
        ? timelineFaq.answer
        : "Une refonte complète prend en moyenne 3 semaines entre le cadrage initial et la mise en ligne.";

      citedKnowledgePoints.push(timelineFaq ? `FAQ: ${timelineFaq.question}` : "Délai de livraison: 3 semaines");
      bodyText = `Bonjour,\n\nMerci pour votre question. ${answerSnippet}\n\nNotre processus est structuré pour minimiser l'impact sur votre activité quotidienne tout en garantissant un haut niveau d'exigence technique.\n\nSeriez-vous disponible pour un court échange de 15 minutes afin de faire le point sur vos attentes ?\n\nBien cordialement,\nL'équipe ${businessName}`;
    }
    // 3. Standard Pricing inquiry (REQ-067)
    else if (
      (text.includes("combien") && !text.includes("combien de temps")) ||
      text.includes("prix") ||
      text.includes("tarif") ||
      text.includes("coût") ||
      text.includes("cout")
    ) {
      const guardrails = input.offer?.pricingGuardrails;
      if (guardrails?.canDiscloseInColdReply && guardrails.startingPrice) {
        pricingDisclosed = true;
        citedKnowledgePoints.push(`Tarif de départ: ${guardrails.startingPrice} ${guardrails.currency}`);
        bodyText = `Bonjour,\n\nNos accompagnements démarrent à partir de ${guardrails.startingPrice} ${guardrails.currency}, le montant final dépendant du périmètre technique et fonctionnel exact.\n\nL'idée d'un premier échange de 20 minutes est justement d'évaluer vos besoins prioritaires pour vous proposer une formule sur mesure.\n\nAuriez-vous une disponibilité jeudi ou vendredi ?\n\nBien cordialement,\nL'équipe ${businessName}`;
      } else {
        requiresHumanEscalation = true;
        escalationReason = "Unlisted pricing requires custom diagnostic proposal";
        bodyText = `Bonjour,\n\nChaque projet faisant l'objet d'un dimensionnement sur mesure, nous établissons un devis précis suite à un court diagnostic de vos besoins.\n\nJe prépare les éléments avec notre équipe pour vous transmettre une estimation personnalisée.\n\nBien cordialement,\nL'équipe ${businessName}`;
      }
    }
    // 3. Existing Provider Objection Handling
    else if (
      input.classification?.objectionType === "EXISTING_PROVIDER" ||
      text.includes("agence") ||
      text.includes("déjà un") ||
      text.includes("déjà une") ||
      text.includes("deja un") ||
      text.includes("deja une") ||
      text.includes("prestataire en place")
    ) {
      citedKnowledgePoints.push("Complémentarité et audit sans engagement");
      bodyText = `Bonjour,\n\nC'est une excellente chose que vous ayez déjà un partenaire en place. Notre démarche n'est pas de remplacer votre prestataire actuel, mais de vous apporter un regard extérieur neutre sur les performances et opportunités d'optimisation.\n\nSeriez-vous ouvert à ce que nous vous partagions simplement notre rapport d'audit lors d'un point rapide de 15 minutes ?\n\nBien cordialement,\nL'équipe ${businessName}`;
    }
    // 4. Case study / Reference inquiry (e.g. "fleuriste", "exemples", "références") (REQ-066)
    else if (
      text.includes("fleuriste") ||
      text.includes("exemple") ||
      text.includes("référence") ||
      text.includes("reference") ||
      text.includes("portfolio") ||
      text.includes("déjà réalisé") ||
      text.includes("deja realise")
    ) {
      const caseStudy = input.knowledgeBase?.caseStudies?.find(
        (cs) =>
          cs.title.toLowerCase().includes("fleuriste") ||
          cs.clientIndustry.toLowerCase().includes("fleur") ||
          cs.description.toLowerCase().includes("fleur")
      ) || input.knowledgeBase?.caseStudies?.[0];

      if (caseStudy) {
        citedKnowledgePoints.push(`Étude de cas: ${caseStudy.title} (${caseStudy.metric})`);
        bodyText = `Bonjour,\n\nTout à fait ! Nous avons notamment accompagné ${caseStudy.title} (${caseStudy.clientIndustry}), ce qui a permis d'atteindre ${caseStudy.metric} (${caseStudy.description}).\n\nNous serions ravis de vous présenter ces réalisations concrètes lors d'un court échange de 15 minutes.\n\nQuel créneau vous conviendrait le mieux cette semaine ?\n\nBien cordialement,\nL'équipe ${businessName}`;
      } else {
        bodyText = `Bonjour,\n\nNous avons plusieurs réalisations concrètes dans votre secteur d'activité que nous pouvons vous présenter en direct.\n\nSeriez-vous disponible cette semaine pour un court partage d'écran de 15 minutes ?\n\nBien cordialement,\nL'équipe ${businessName}`;
      }
    }
    // 5. Generic Knowledge Base FAQ Grounding (REQ-066, Invariant 1)
    else if (
      input.knowledgeBase?.faqs?.some((f) => {
        const qTokens = f.question.toLowerCase().split(/[\s,?;:!.]+/).filter(w => w.length >= 4 && !["pour", "avec", "dans", "votre", "vous", "nous", "sont", "être", "etes"].includes(w));
        return qTokens.some(tok => text.includes(tok));
      })
    ) {
      const matchingFaq = input.knowledgeBase.faqs.find((f) => {
        const qTokens = f.question.toLowerCase().split(/[\s,?;:!.]+/).filter(w => w.length >= 4 && !["pour", "avec", "dans", "votre", "vous", "nous", "sont", "être", "etes"].includes(w));
        return qTokens.some(tok => text.includes(tok));
      })!;
      citedKnowledgePoints.push(`FAQ: ${matchingFaq.question}`);
      bodyText = `Bonjour,\n\nMerci pour votre question. ${matchingFaq.answer}\n\nSeriez-vous disponible pour un court échange de 15 minutes afin d'approfondir vos besoins et voir comment nous pouvons vous accompagner ?\n\nBien cordialement,\nL'équipe ${businessName}`;
    }
    // 6. General Question / Interest
    else {
      citedKnowledgePoints.push(input.offer?.name || "Diagnostic opérationnel");
      bodyText = `Bonjour,\n\nMerci pour votre retour. Chez ${businessName}, notre approche est pensée pour vous apporter un diagnostic clair et immédiatement actionnable.\n\nSeriez-vous disponible pour un court échange de 15 à 20 minutes cette semaine ?\n\nBien cordialement,\nL'équipe ${businessName}`;
    }

    const output: import("../../services/reply-generator-schema.js").ReplyDraftOutput = {
      subject,
      bodyText,
      citedKnowledgePoints,
      pricingDisclosed,
      pricingGuardrailPassed,
      requiresHumanEscalation,
      escalationReason,
      confidence: requiresHumanEscalation ? 0.75 : 0.92
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
