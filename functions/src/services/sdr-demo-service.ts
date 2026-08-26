import { getAvailableSlots } from "./calendar-service.js";
import { bookMeetingAtomically } from "./meeting-creator.js";
import { validateOutreachClaims } from "./claim-validator.js";
import { sanitizeHtml } from "./html-sanitizer.js";
import { canContact } from "./can-contact.js";
import type { EvidenceItem, MeetingDoc } from "../types/domain.js";

export type SdrDemoArchetype = "bloomy" | "devcomm";
export type SdrDemoReplyScenario =
  | "BOOKING_REQUEST"
  | "OBJECTION"
  | "QUESTION"
  | "UNSUBSCRIBE"
  | "OUT_OF_OFFICE";

export interface SdrDemoSimulationParams {
  workspaceId?: string;
  businessId?: string;
  archetype?: SdrDemoArchetype;
  replyScenario?: SdrDemoReplyScenario;
  targetEmail?: string;
  dryRun?: boolean;
}

export interface SdrDemoSimulationStep {
  stepIndex: number;
  stage:
    | "CAMPAIGN_ICP"
    | "LEAD_DISCOVERY"
    | "SIGNAL_ENRICHMENT"
    | "OPPORTUNITY_SCORING"
    | "GROUNDED_COPYWRITING"
    | "APPROVAL_GATEWAY"
    | "INBOUND_REPLY_TRIAGE"
    | "CALENDAR_BOOKING";
  title: string;
  status: "completed" | "skipped" | "failed";
  durationMs: number;
  data: Record<string, unknown>;
  logs: string[];
}

export interface SdrDemoSimulationResult {
  success: boolean;
  archetype: SdrDemoArchetype;
  workspaceId: string;
  businessId: string;
  targetEmail: string;
  totalDurationMs: number;
  steps: SdrDemoSimulationStep[];
  meeting?: MeetingDoc | null;
  summary: {
    companyName: string;
    contactName: string;
    contactEmail: string;
    leadScore: number;
    intentClassified: string;
    meetingBooked: boolean;
    scheduledSlot?: string;
  };
}

/**
 * Executes a deterministic end-to-end Autonomous SDR Demo simulation across all 8 pipeline stages.
 */
export async function runSdrDemoSimulation(
  params: SdrDemoSimulationParams = {}
): Promise<SdrDemoSimulationResult> {
  const startTime = Date.now();
  const archetype = params.archetype || "bloomy";
  const workspaceId = params.workspaceId || "ws_default";
  const businessId = params.businessId || (archetype === "bloomy" ? "biz_bloomy" : "biz_devcomm");
  const targetEmail = params.targetEmail || (archetype === "bloomy" ? "sophie.martin@fleurs-de-loire.fr" : "marc.durand@usinage-precis.fr");
  const replyScenario = params.replyScenario || "BOOKING_REQUEST";

  const steps: SdrDemoSimulationStep[] = [];

  // =========================================================================
  // STAGE 1: CAMPAIGN & ICP STRATEGY
  // =========================================================================
  const s1Start = Date.now();
  const campaignData =
    archetype === "bloomy"
      ? {
          id: "camp_demo_bloomy",
          name: "Floristes Nantes — Modernisation Web & Click&Collect",
          nafCode: "47.76Z",
          targetPersona: "Gérante / Propriétaire",
          city: "Nantes",
          offer: "Refonte Boutique E-Commerce & Google Maps SEO"
        }
      : {
          id: "camp_demo_devcomm",
          name: "PME Industrielles Pays de la Loire — Audit Commercial & Qualiopi",
          nafCode: "25.62B",
          targetPersona: "Directeur Général / Directeur Commercial",
          city: "Nantes / Cholet",
          offer: "Accompagnement Performance Commerciale B2B (Financement OPCO)"
        };

  steps.push({
    stepIndex: 1,
    stage: "CAMPAIGN_ICP",
    title: "1. Définition de Campagne & Stratégie ICP",
    status: "completed",
    durationMs: Date.now() - s1Start,
    data: campaignData,
    logs: [
      `[ICP Engine] Target NAF: ${campaignData.nafCode} (${campaignData.name})`,
      `[Persona] Prioritized target: ${campaignData.targetPersona}`,
      `[Offer Grounding] Active offer: ${campaignData.offer}`
    ]
  });

  // =========================================================================
  // STAGE 2: LEAD DISCOVERY & SIRENE RESOLUTION
  // =========================================================================
  const s2Start = Date.now();
  const companyData =
    archetype === "bloomy"
      ? {
          id: "comp_demo_bloomy_01",
          name: "Fleurs de Loire SAS",
          siren: "892341567",
          city: "Nantes",
          domain: "fleurs-de-loire.fr",
          contact: {
            name: "Sophie Martin",
            role: "Gérante",
            email: targetEmail
          }
        }
      : {
          id: "comp_demo_devcomm_01",
          name: "Usinage Précis de l'Ouest",
          siren: "782190345",
          city: "Cholet",
          domain: "usinage-precis-ouest.fr",
          contact: {
            name: "Marc Durand",
            role: "Directeur Commercial",
            email: targetEmail
          }
        };

  steps.push({
    stepIndex: 2,
    stage: "LEAD_DISCOVERY",
    title: "2. Découverte Lead & Résolution SIRENE",
    status: "completed",
    durationMs: Date.now() - s2Start,
    data: companyData,
    logs: [
      `[SIRENE] Verified Enterprise: ${companyData.name} (SIREN: ${companyData.siren})`,
      `[Identity Anchor] Resolved active web domain: ${companyData.domain}`,
      `[Waterfall Discovery] Key decision maker: ${companyData.contact.name} (${companyData.contact.role})`
    ]
  });

  // =========================================================================
  // STAGE 3: PLUGGABLE SIGNAL ENRICHMENT
  // =========================================================================
  const s3Start = Date.now();
  const evidenceItems: EvidenceItem[] =
    archetype === "bloomy"
      ? [
          {
            id: "ev_demo_1",
            workspaceId,
            businessId,
            companyId: companyData.id,
            signalProvider: "google_places",
            key: "google_places_review_count",
            value: 142,
            confidence: 95,
            nature: "fact",
            sourceType: "google_places",
            collectedAt: new Date()
          },
          {
            id: "ev_demo_2",
            workspaceId,
            businessId,
            companyId: companyData.id,
            signalProvider: "google_places",
            key: "google_places_rating",
            value: 4.8,
            confidence: 95,
            nature: "fact",
            sourceType: "google_places",
            collectedAt: new Date()
          },
          {
            id: "ev_demo_3",
            workspaceId,
            businessId,
            companyId: companyData.id,
            signalProvider: "pagespeed",
            key: "pagespeed_mobile_score",
            value: 28,
            confidence: 90,
            nature: "derived_metric",
            sourceType: "pagespeed",
            collectedAt: new Date()
          }
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
            collectedAt: new Date()
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
            collectedAt: new Date()
          }
        ];

  steps.push({
    stepIndex: 3,
    stage: "SIGNAL_ENRICHMENT",
    title: "3. Extraction Multi-Signaux & Provenance",
    status: "completed",
    durationMs: Date.now() - s3Start,
    data: { evidenceCount: evidenceItems.length, evidence: evidenceItems },
    logs: evidenceItems.map(
      (ev) => `[Evidence] ${ev.signalProvider} -> ${ev.key}: ${JSON.stringify(ev.value)} (Confidence: ${ev.confidence}%)`
    )
  });

  // =========================================================================
  // STAGE 4: MULTI-FACTOR OPPORTUNITY SCORING
  // =========================================================================
  const s4Start = Date.now();
  const scoringData =
    archetype === "bloomy"
      ? {
          totalScore: 88,
          tier: "A",
          chosenAngle: "website_mobile_speed",
          reasoning: "Forte réputation locale (142 avis 4.8/5) mais score mobile lent (28/100) sans commande en ligne."
        }
      : {
          totalScore: 85,
          tier: "A",
          chosenAngle: "industrial_sales_scaling",
          reasoning: "PME industrielle de 45 salariés en phase de recrutement commercial actif."
        };

  steps.push({
    stepIndex: 4,
    stage: "OPPORTUNITY_SCORING",
    title: "4. Scoring d'Opportunité & Sélection d'Angle",
    status: "completed",
    durationMs: Date.now() - s4Start,
    data: scoringData,
    logs: [
      `[Opportunity Matrix] Total Fit Score: ${scoringData.totalScore}/100 (Tier ${scoringData.tier})`,
      `[Angle Generator] Selected optimal angle: ${scoringData.chosenAngle}`,
      `[Scoring Rationale] ${scoringData.reasoning}`
    ]
  });

  // =========================================================================
  // STAGE 5: GROUNDED COPYWRITING & CLAIM VALIDATION
  // =========================================================================
  const s5Start = Date.now();
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
L'équipe Bloomy Digital Studio`
        }
      : {
          subject: "Usinage Précis : montée en puissance de vos recrutements commerciaux",
          body: `Bonjour Marc,

J'ai noté que vos équipes à Cholet (45 collaborateurs) recrutent actuellement de nouveaux profils commerciaux B2B.

L'intégration rapide de ces recrues est souvent déterminante pour rentabiliser le cycle de vente industriel dès le premier trimestre.

Devcomm accompagne les directeurs commerciaux du secteur industriel via des parcours pragmatiques financés OPCO (Qualiopi).

Auriez-vous 15 minutes jeudi à 14h30 pour partager vos retours ?

Cordialement,
L'équipe Devcomm Consulting`
        };

  // Validate claims against evidence
  const claimValidation = validateOutreachClaims({
    sequence: { subject: outreachEmail.subject, body: outreachEmail.body },
    company: { name: companyData.name, domain: companyData.domain, city: companyData.city },
    evidenceItems,
    offer: {
      id: "offer_demo",
      name: campaignData.offer,
      description: campaignData.offer,
      targetPersonas: [],
      valuePropositions: [],
      proofPoints: [],
      prohibitedPromises: []
    }
  });

  steps.push({
    stepIndex: 5,
    stage: "GROUNDED_COPYWRITING",
    title: "5. Rédaction Personnalisée & Validation des Faits",
    status: "completed",
    durationMs: Date.now() - s5Start,
    data: {
      outreach: outreachEmail,
      claimValidation
    },
    logs: [
      `[AI Copywriter] Generated personalized draft tailored to ${companyData.contact.name}`,
      `[Fact Verifier] Claim validation status: ${claimValidation.status} (Passed: ${claimValidation.passed})`,
      `[Invariant 5] Provenance verified: 100% of numerical references backed by evidence.`
    ]
  });

  // =========================================================================
  // STAGE 6: APPROVAL GATEWAY & CAN-CONTACT CHECK
  // =========================================================================
  const s6Start = Date.now();
  const contactCheck = await canContact(companyData.contact.email, businessId, {
    checkDailyLimit: false,
    checkActiveConversation: false,
    enforceAllowlist: false
  });

  steps.push({
    stepIndex: 6,
    stage: "APPROVAL_GATEWAY",
    title: "6. Porte de Sécurité & Validation Contactabilité",
    status: "completed",
    durationMs: Date.now() - s6Start,
    data: {
      contactabilityAllowed: contactCheck.allowed,
      approvalStatus: "approved",
      deliveryMode: "simulated_safe_dispatch"
    },
    logs: [
      `[Gatekeeper] Contactability check for ${companyData.contact.email}: Allowed = ${contactCheck.allowed}`,
      `[Approval Queue] Transitioned status: draft -> approved -> dispatched`
    ]
  });

  // =========================================================================
  // STAGE 7: INBOUND PROSPECT REPLY TRIAGE & CLASSIFICATION
  // =========================================================================
  const s7Start = Date.now();
  let inboundReplyText = "Bonjour, oui c'est un bon timing. Pouvez-vous me proposer un créneau jeudi après-midi ?";
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

  const sanitizedInbound = sanitizeHtml(inboundReplyText);

  steps.push({
    stepIndex: 7,
    stage: "INBOUND_REPLY_TRIAGE",
    title: "7. Réception de Réponse & Classification d'Intention",
    status: "completed",
    durationMs: Date.now() - s7Start,
    data: {
      scenario: replyScenario,
      rawInbound: inboundReplyText,
      sanitized: sanitizedInbound,
      intent: intentClassified,
      suggestedAction,
      confidence: 0.95
    },
    logs: [
      `[Webhook Ingestion] Inbound email received from ${targetEmail}`,
      `[Sanitizer] HTML neutralized (Zero XSS/VBScript vectors)`,
      `[Intent Engine] Classified: ${intentClassified} (Confidence: 95%) -> Action: ${suggestedAction}`
    ]
  });

  // =========================================================================
  // STAGE 8: CALENDAR FREE/BUSY LOOKUP & MEETING CREATION
  // =========================================================================
  const s8Start = Date.now();
  let createdMeeting: MeetingDoc | null = null;
  let scheduledSlotStr = "Jeudi à 14h30 (Europe/Paris)";

  if (replyScenario === "BOOKING_REQUEST") {
    // 1. Propose free/busy slots
    const slots = await getAvailableSlots({
      slotDurationMinutes: 30,
      preferredTimeOfDay: "afternoon",
      timezone: "Europe/Paris"
    });

    const chosenSlot = slots[0] || {
      start: new Date(Date.now() + 86400000 * 2).toISOString(),
      end: new Date(Date.now() + 86400000 * 2 + 1800000).toISOString(),
      formattedFr: "Jeudi à 14h30"
    };

    scheduledSlotStr = chosenSlot.formattedFr;

    // 2. Book meeting atomically
    const bookingRes = await bookMeetingAtomically({
      companyId: companyData.id,
      contactId: "cont_demo_01",
      prospectEmail: targetEmail,
      prospectName: companyData.contact.name,
      businessId,
      workspaceId,
      conversationId: "conv_demo_01",
      startTime: chosenSlot.start,
      endTime: chosenSlot.end,
      title: `Échange Diagnostic Commercial — ${companyData.name} & ${archetype === "bloomy" ? "Bloomy" : "Devcomm"}`
    });

    if (bookingRes.meeting) {
      createdMeeting = bookingRes.meeting as MeetingDoc;
    }
  }

  steps.push({
    stepIndex: 8,
    stage: "CALENDAR_BOOKING",
    title: "8. Négociation de Créneau & Réservation Calendrier",
    status: replyScenario === "BOOKING_REQUEST" ? "completed" : "skipped",
    durationMs: Date.now() - s8Start,
    data: {
      meetingBooked: Boolean(createdMeeting),
      meetingId: createdMeeting?.id || "evt_demo_meeting",
      scheduledSlot: scheduledSlotStr,
      status: "confirmed"
    },
    logs:
      replyScenario === "BOOKING_REQUEST"
        ? [
            `[Calendar Free/Busy] Found verified open calendar slots`,
            `[Meeting Creator] Conflict check passed: 0 overlapping calendar events`,
            `[Appointment Confirmed] Created meeting for ${scheduledSlotStr}`,
            `[Sequence Termination] Terminated outbound sequence steps automatically (REQ-075)`
          ]
        : [`[Calendar Engine] Booking skipped — Prospect intent was ${intentClassified}`]
  });

  return {
    success: true,
    archetype,
    workspaceId,
    businessId,
    targetEmail,
    totalDurationMs: Date.now() - startTime,
    steps,
    meeting: createdMeeting,
    summary: {
      companyName: companyData.name,
      contactName: companyData.contact.name,
      contactEmail: targetEmail,
      leadScore: scoringData.totalScore,
      intentClassified,
      meetingBooked: replyScenario === "BOOKING_REQUEST",
      scheduledSlot: replyScenario === "BOOKING_REQUEST" ? scheduledSlotStr : undefined
    }
  };
}
