import { NextResponse } from "next/server";

export type SdrDemoArchetype = "bloomy" | "devcomm";
export type SdrDemoReplyScenario =
  | "BOOKING_REQUEST"
  | "OBJECTION"
  | "QUESTION"
  | "UNSUBSCRIBE"
  | "OUT_OF_OFFICE";

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    const archetype: SdrDemoArchetype = body.archetype || "bloomy";
    const replyScenario: SdrDemoReplyScenario = body.replyScenario || "BOOKING_REQUEST";
    const workspaceId = body.workspaceId || "ws_default";
    const businessId = body.businessId || (archetype === "bloomy" ? "biz_bloomy" : "biz_devcomm");
    const targetEmail =
      body.targetEmail ||
      (archetype === "bloomy"
        ? "sophie.martin@fleurs-de-loire.fr"
        : "marc.durand@usinage-precis.fr");

    const startTime = Date.now();
    const steps = [];

    // Stage 1: Campaign & ICP
    const campaignData =
      archetype === "bloomy"
        ? {
            id: "camp_demo_bloomy",
            name: "Floristes Nantes — Modernisation Web & Click&Collect",
            nafCode: "47.76Z",
            targetPersona: "Gérante / Propriétaire",
            city: "Nantes",
            offer: "Refonte Boutique E-Commerce & Google Maps SEO",
          }
        : {
            id: "camp_demo_devcomm",
            name: "PME Industrielles Pays de la Loire — Audit Commercial & Qualiopi",
            nafCode: "25.62B",
            targetPersona: "Directeur Général / Directeur Commercial",
            city: "Nantes / Cholet",
            offer: "Accompagnement Performance Commerciale B2B (Financement OPCO)",
          };

    steps.push({
      stepIndex: 1,
      stage: "CAMPAIGN_ICP",
      title: "1. Stratégie de Campagne & Définition ICP",
      status: "completed",
      durationMs: 45,
      data: campaignData,
      logs: [
        `[Campaign Engine] Archetype: ${archetype.toUpperCase()} -> Profile: ${businessId}`,
        `[ICP Grounding] Targeted NAF: ${campaignData.nafCode} in ${campaignData.city}`,
        `[Offer Mapping] Grounded with Offer: ${campaignData.offer}`,
      ],
    });

    // Stage 2: Lead Discovery
    const companyData =
      archetype === "bloomy"
        ? {
            id: "comp_demo_fleurs_loire",
            name: "Fleurs de Loire SAS",
            siren: "891234567",
            city: "Nantes",
            domain: "fleurs-de-loire.fr",
            website: "https://www.fleurs-de-loire.fr",
            nafLabel: "Commerce de détail de fleurs",
            contact: {
              name: "Sophie Martin",
              role: "Gérante",
              email: targetEmail,
            },
          }
        : {
            id: "comp_demo_usinage_ouest",
            name: "Usinage Précis de l'Ouest",
            siren: "412345678",
            city: "Cholet",
            domain: "usinage-precis.fr",
            website: "https://www.usinage-precis.fr",
            nafLabel: "Mécanique industrielle et usinage",
            contact: {
              name: "Marc Durand",
              role: "Directeur Général",
              email: targetEmail,
            },
          };

    steps.push({
      stepIndex: 2,
      stage: "LEAD_DISCOVERY",
      title: "2. Découverte d'Entreprise SIRENE & Décideur",
      status: "completed",
      durationMs: 60,
      data: companyData,
      logs: [
        `[SIRENE Engine] Discovered company: ${companyData.name} (SIREN: ${companyData.siren})`,
        `[Domain Resolver] Resolved verified domain: ${companyData.domain}`,
        `[Waterfall Contact] Identified Decision Maker: ${companyData.contact.name} (${companyData.contact.role})`,
      ],
    });

    // Stage 3: Signal Extraction & Provenance
    const evidenceItems =
      archetype === "bloomy"
        ? [
            {
              id: "ev_demo_1",
              workspaceId,
              businessId,
              companyId: companyData.id,
              signalProvider: "google_places",
              key: "google_review_count",
              value: 142,
              confidence: 95,
              nature: "fact",
              sourceType: "google_places",
              collectedAt: new Date().toISOString(),
            },
            {
              id: "ev_demo_2",
              workspaceId,
              businessId,
              companyId: companyData.id,
              signalProvider: "google_places",
              key: "google_rating",
              value: 4.8,
              confidence: 95,
              nature: "fact",
              sourceType: "google_places",
              collectedAt: new Date().toISOString(),
            },
            {
              id: "ev_demo_3",
              workspaceId,
              businessId,
              companyId: companyData.id,
              signalProvider: "pagespeed_insights",
              key: "mobile_performance_score",
              value: 28,
              confidence: 90,
              nature: "fact",
              sourceType: "pagespeed",
              collectedAt: new Date().toISOString(),
            },
          ]
        : [
            {
              id: "ev_demo_4",
              workspaceId,
              businessId,
              companyId: companyData.id,
              signalProvider: "insee_sirene",
              key: "employee_count_range",
              value: "45 salariés",
              confidence: 90,
              nature: "fact",
              sourceType: "provider",
              collectedAt: new Date().toISOString(),
            },
            {
              id: "ev_demo_5",
              workspaceId,
              businessId,
              companyId: companyData.id,
              signalProvider: "job_postings",
              key: "active_hiring_roles",
              value: ["Commercial B2B Industrie", "Technico-Commercial"],
              confidence: 85,
              nature: "derived_metric",
              sourceType: "manual",
              collectedAt: new Date().toISOString(),
            },
          ];

    steps.push({
      stepIndex: 3,
      stage: "SIGNAL_ENRICHMENT",
      title: "3. Extraction Multi-Signaux & Provenance",
      status: "completed",
      durationMs: 70,
      data: { evidenceCount: evidenceItems.length, evidence: evidenceItems },
      logs: evidenceItems.map(
        (ev) =>
          `[Evidence] ${ev.signalProvider} -> ${ev.key}: ${JSON.stringify(ev.value)} (Confidence: ${ev.confidence}%)`
      ),
    });

    // Stage 4: Opportunity Scoring
    const scoringData =
      archetype === "bloomy"
        ? {
            totalScore: 88,
            tier: "A",
            chosenAngle: "website_mobile_speed",
            reasoning:
              "Forte réputation locale (142 avis 4.8/5) mais score mobile lent (28/100) sans commande en ligne.",
          }
        : {
            totalScore: 85,
            tier: "A",
            chosenAngle: "industrial_sales_scaling",
            reasoning:
              "PME industrielle de 45 salariés en phase de recrutement commercial actif.",
          };

    steps.push({
      stepIndex: 4,
      stage: "OPPORTUNITY_SCORING",
      title: "4. Scoring d'Opportunité & Sélection d'Angle",
      status: "completed",
      durationMs: 50,
      data: scoringData,
      logs: [
        `[Opportunity Matrix] Total Fit Score: ${scoringData.totalScore}/100 (Tier ${scoringData.tier})`,
        `[Angle Generator] Selected optimal angle: ${scoringData.chosenAngle}`,
        `[Scoring Rationale] ${scoringData.reasoning}`,
      ],
    });

    // Stage 5: Grounded Copywriting
    const outreachEmail =
      archetype === "bloomy"
        ? {
            subject: "Fleurs de Loire : vos 142 avis Google & optimisation mobile",
            body: `Bonjour Sophie,

Vos 142 avis clients et votre note de 4.8/5 témoignent de la superbe réputation de Fleurs de Loire à Nantes.

En analysant votre site fleurs-de-loire.fr, j'ai remarqué un score de chargement mobile de 28/100, ce qui freine souvent les commandes sur smartphone lors des pics saisonniers.

Chez Bloomy, nous concevons des boutiques web ultra-rapides sous Shopify en 10 jours ouvrés.

Seriez-vous ouverte à un échange de 15 minutes jeudi ou vendredi pour faire le point ?

Bien à vous,
L'équipe Bloomy Digital Studio`,
          }
        : {
            subject: "Usinage Précis : montée en puissance de vos recrutements commerciaux",
            body: `Bonjour Marc,

J'ai noté que vos équipes à Cholet (45 collaborateurs) recrutent actuellement de nouveaux profils commerciaux B2B.

L'intégration rapide de ces recrues est souvent déterminante pour rentabiliser le cycle de vente industriel dès le premier trimestre.

Devcomm accompagne les directeurs commerciaux du secteur industriel via des parcours pragmatiques financés OPCO (Qualiopi).

Auriez-vous 15 minutes jeudi à 14h30 pour partager vos retours ?

Cordialement,
L'équipe Devcomm Consulting`,
          };

    steps.push({
      stepIndex: 5,
      stage: "GROUNDED_COPYWRITING",
      title: "5. Rédaction Personnalisée & Validation des Faits",
      status: "completed",
      durationMs: 80,
      data: {
        outreach: outreachEmail,
        claimValidation: { status: "valid", passed: true, unsupportedClaims: [] },
      },
      logs: [
        `[AI Copywriter] Generated personalized draft tailored to ${companyData.contact.name}`,
        `[Fact Verifier] Claim validation status: valid (Passed: true)`,
        `[Invariant 5] Provenance verified: 100% of numerical references backed by evidence.`,
      ],
    });

    // Stage 6: Safety Gatekeeper
    steps.push({
      stepIndex: 6,
      stage: "APPROVAL_GATEWAY",
      title: "6. Porte de Sécurité & Validation Contactabilité",
      status: "completed",
      durationMs: 30,
      data: {
        contactabilityAllowed: true,
        approvalStatus: "approved",
        deliveryMode: "simulated_safe_dispatch",
      },
      logs: [
        `[Gatekeeper] Contactability check for ${companyData.contact.email}: Allowed = true`,
        `[Approval Queue] Transitioned status: draft -> approved -> dispatched`,
      ],
    });

    // Stage 7: Inbound Reply Triage
    let inboundReplyText =
      "Bonjour, oui c'est un bon timing. Pouvez-vous me proposer un créneau jeudi après-midi ?";
    let intentClassified = "BOOKING_REQUEST";
    let suggestedAction = "send_booking_link";

    if (replyScenario === "OBJECTION") {
      inboundReplyText = "Merci pour votre message mais nous avons déjà une agence web partenaire.";
      intentClassified = "OBJECTION";
      suggestedAction = "handle_objection";
    } else if (replyScenario === "QUESTION") {
      inboundReplyText = "Bonjour, combien coûte votre prestation et comment fonctionne le financement ?";
      intentClassified = "QUESTION";
      suggestedAction = "answer_question";
    } else if (replyScenario === "UNSUBSCRIBE") {
      inboundReplyText = "Merci de me retirer définitivement de votre liste de diffusion.";
      intentClassified = "UNSUBSCRIBE";
      suggestedAction = "unsubscribe_contact";
    } else if (replyScenario === "OUT_OF_OFFICE") {
      inboundReplyText = "Je suis absent du bureau jusqu'à lundi prochain. Pour toute urgence...";
      intentClassified = "OUT_OF_OFFICE";
      suggestedAction = "ignore_auto_reply";
    }

    steps.push({
      stepIndex: 7,
      stage: "INBOUND_REPLY_TRIAGE",
      title: "7. Réception de Réponse & Classification d'Intention",
      status: "completed",
      durationMs: 65,
      data: {
        scenario: replyScenario,
        rawInbound: inboundReplyText,
        sanitized: inboundReplyText,
        intent: intentClassified,
        suggestedAction,
        confidence: 0.95,
      },
      logs: [
        `[Webhook Ingestion] Inbound email received from ${targetEmail}`,
        `[Sanitizer] HTML neutralized (Zero XSS/VBScript vectors)`,
        `[Intent Engine] Classified: ${intentClassified} (Confidence: 95%) -> Action: ${suggestedAction}`,
      ],
    });

    // Stage 8: Calendar Booking
    let meetingBooked = false;
    let scheduledSlotStr: string | undefined = undefined;
    let createdMeeting = null;

    if (replyScenario === "BOOKING_REQUEST") {
      meetingBooked = true;
      scheduledSlotStr = "Jeudi à 14h30 (Europe/Paris)";
      createdMeeting = {
        id: `meet_demo_${Date.now()}`,
        workspaceId,
        businessId,
        companyId: companyData.id,
        contactId: "cont_demo_01",
        title: `Échange Diagnostic Commercial — ${companyData.name} & ${archetype === "bloomy" ? "Bloomy" : "Devcomm"}`,
        prospectEmail: targetEmail,
        prospectName: companyData.contact.name,
        startTime: new Date(Date.now() + 86400000 * 2).toISOString(),
        endTime: new Date(Date.now() + 86400000 * 2 + 1800000).toISOString(),
        status: "confirmed",
        meetingLink: "https://teams.microsoft.com/l/meetup-join/demo-meeting",
        source: "conversational",
      };

      steps.push({
        stepIndex: 8,
        stage: "CALENDAR_BOOKING",
        title: "8. Négociation de Créneau & Réservation Calendrier",
        status: "completed",
        durationMs: 75,
        data: {
          meetingBooked: true,
          scheduledSlot: scheduledSlotStr,
          meeting: createdMeeting,
        },
        logs: [
          `[Calendar Service] Queried real-time free/busy windows (0 conflicts)`,
          `[Slot Proposer] Generated candidate slot in French: ${scheduledSlotStr}`,
          `[Meeting Creator] Meeting confirmed atomically: ${createdMeeting.id}`,
          `[Sequence Terminator] Outbound sequence terminated across OS & Instantly (REQ-075)`,
        ],
      });
    } else {
      steps.push({
        stepIndex: 8,
        stage: "CALENDAR_BOOKING",
        title: "8. Négociation de Créneau & Réservation Calendrier",
        status: "completed",
        durationMs: 15,
        data: {
          meetingBooked: false,
          reason: `Reply scenario was ${replyScenario}; meeting scheduling bypassed as expected.`,
        },
        logs: [
          `[Calendar Service] Skipped meeting booking for ${replyScenario} response scenario.`,
        ],
      });
    }

    const totalDurationMs = Date.now() - startTime;

    return NextResponse.json({
      success: true,
      archetype,
      workspaceId,
      businessId,
      targetEmail,
      totalDurationMs,
      steps,
      meeting: createdMeeting,
      summary: {
        companyName: companyData.name,
        contactName: companyData.contact.name,
        contactEmail: targetEmail,
        leadScore: scoringData.totalScore,
        intentClassified,
        meetingBooked,
        scheduledSlot: scheduledSlotStr,
      },
    });
  } catch (error) {
    console.error("SDR Demo Simulation Route error:", error);
    return NextResponse.json(
      { success: false, error: (error as Error).message },
      { status: 500 }
    );
  }
}
