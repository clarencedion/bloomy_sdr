import type { ReplyClassification } from "../types/domain.js";
import { getAiProvider } from "../providers/ai/index.js";
import { getGlobalSettings, getAiSecrets } from "../utils/settings.js";
import { writeLog } from "../utils/logger.js";

export interface ClassifyReplyInput {
  subject?: string;
  bodyText: string;
  leadEmail: string;
  providerEventType?: string;
  workspaceId?: string;
  businessId?: string;
}

// Regex patterns for deterministic unsubscription detection (French & English)
const UNSUBSCRIBE_PATTERNS = [
  /\b(unsubscribe|desabonner|désabonner|désinscription|desinscription|opt-out|optout)\b/i,
  /\bstop\b/i,
  /retirer?\s+(?:de\s+)?(?:votre\s+liste|vos\s+listes|vos\s+bases|votre\s+fichier|vos\s+contacts)/i,
  /retirez[\s-]moi\b/i,
  /ne\s+plus\s+(?:me|nous)\s+(?:contacter|relancer|solliciter|ecrire|écrire|démarcher)/i,
  /supprimer?\s+(?:mes|nos)\s+(?:coordonn[ée]es|donn[ée]es|informations)/i,
  /merci\s+de\s+(?:me\s+)?(?:retirer|supprimer|d[ée]sabonner)/i,
  /pas\s+int[ée]ress[ée][\s\S]*?(?:retirer|ne\s+plus|supprimer|stop)/i,
  /cesser?\s+(?:tout|toute)\s+(?:contact|prospection|communication)/i
];

// Regex patterns for deterministic Out-of-Office (OOO) detection (French & English)
const OOO_SUBJECT_PATTERNS = [
  /automatic\s*reply/i,
  /auto-?reply/i,
  /out\s+of\s+office/i,
  /absence\s+du\s+bureau/i,
  /r[ée]ponse\s+automatique/i,
  /cong[ée]s?\b/i,
  /en\s+cong[ée]s?/i,
  /absent\s+du\s+bureau/i,
  /message\s+automatis[ée]/i
];

const OOO_BODY_PATTERNS = [
  /je\s+suis\s+(?:actuellement\s+)?absent(?:e)?\b/i,
  /i\s+am\s+(?:currently\s+)?(?:out\s+of\s+the\s+office|away\s+from\s+my\s+desk|on\s+leave|on\s+pto)\b/i,
  /je\s+serai\s+de\s+retour\s+le/i,
  /de\s+retour\s+au\s+bureau\s+le/i,
  /merci\s+de\s+noter\s+que\s+je\s+suis\s+en\s+cong[ée]/i,
  /en\s+cas\s+d['’]urgence,?\s+(?:veuillez|merci\s+de)\s+contacter/i
];

/**
 * Checks for deterministic unsubscription triggers (REQ-065).
 */
export function isDeterministicUnsubscribe(input: {
  providerEventType?: string;
  subject?: string;
  bodyText: string;
}): boolean {
  if (
    input.providerEventType &&
    ["lead_unsubscribed", "unsubscribed", "unsubscribe"].includes(input.providerEventType.toLowerCase())
  ) {
    return true;
  }

  const combinedText = `${input.subject || ""} ${input.bodyText || ""}`.trim();
  return UNSUBSCRIBE_PATTERNS.some((regex) => regex.test(combinedText));
}

/**
 * Checks for deterministic Out-of-Office triggers (REQ-063).
 */
export function isDeterministicOutOfOffice(input: {
  subject?: string;
  bodyText: string;
}): boolean {
  const subject = input.subject;
  if (subject && OOO_SUBJECT_PATTERNS.some((regex) => regex.test(subject))) {
    return true;
  }

  const bodyText = (input.bodyText || "").trim();
  // If the body is short or explicitly matches classic auto-responder intro phrases
  return OOO_BODY_PATTERNS.some((regex) => regex.test(bodyText));
}

/**
 * Primary Reply Classifier service (REQ-063, REQ-064, REQ-065).
 * Executes deterministic rules first, then runs LLM-based intent/objection classification.
 */
export async function classifyReply(input: ClassifyReplyInput): Promise<ReplyClassification> {
  const cleanBody = (input.bodyText || "").trim();
  const cleanSubject = (input.subject || "").trim();

  // --- FIRST PASS: Deterministic Fast-Paths ---

  // 1. Deterministic Unsubscribe (REQ-065)
  if (isDeterministicUnsubscribe({ providerEventType: input.providerEventType, subject: cleanSubject, bodyText: cleanBody })) {
    return {
      intent: "UNSUBSCRIBE",
      confidence: 1.0,
      detectedQuestions: [],
      suggestedAction: "unsubscribe_contact",
      reasoning: "Deterministic unsubscribe pattern matched (instant zero-latency rule).",
      requiresHumanAttention: false,
      classifiedAt: new Date().toISOString()
    };
  }

  // 2. Deterministic Out of Office
  if (isDeterministicOutOfOffice({ subject: cleanSubject, bodyText: cleanBody })) {
    return {
      intent: "OUT_OF_OFFICE",
      confidence: 1.0,
      detectedQuestions: [],
      suggestedAction: "ignore_auto_reply",
      reasoning: "Deterministic out-of-office autoresponder detected.",
      requiresHumanAttention: false,
      classifiedAt: new Date().toISOString()
    };
  }

  // 3. Fallback for empty message
  if (!cleanBody && !cleanSubject) {
    return {
      intent: "UNCLEAR",
      confidence: 0.5,
      detectedQuestions: [],
      suggestedAction: "pause_sequence_escalate",
      reasoning: "Empty inbound message content received.",
      requiresHumanAttention: true,
      classifiedAt: new Date().toISOString()
    };
  }

  // --- SECOND PASS: LLM Intent & Objection Classifier (REQ-063, REQ-064) ---
  try {
    const [settings, secrets] = await Promise.all([getGlobalSettings(), getAiSecrets()]);
    const aiProvider = getAiProvider(settings, secrets);

    if (typeof aiProvider.classifyReply === "function") {
      const result = await aiProvider.classifyReply({
        subject: cleanSubject,
        bodyText: cleanBody,
        senderEmail: input.leadEmail,
        settings
      });

      return {
        ...result.output,
        classifiedAt: new Date().toISOString()
      };
    }

    // If provider doesn't have custom classifyReply, standard fallback
    return {
      intent: "NEUTRAL",
      confidence: 0.7,
      detectedQuestions: [],
      suggestedAction: "none",
      reasoning: "AI Provider does not implement classifyReply.",
      requiresHumanAttention: false,
      classifiedAt: new Date().toISOString()
    };
  } catch (error) {
    const errMessage = error instanceof Error ? error.message : String(error);
    await writeLog({
      type: "reply.classification_error",
      level: "warning",
      message: `Failed to classify inbound reply from ${input.leadEmail}: ${errMessage}`,
      metadata: { leadEmail: input.leadEmail, error: errMessage }
    });

    return {
      intent: "UNCLEAR",
      confidence: 0.4,
      detectedQuestions: [],
      suggestedAction: "pause_sequence_escalate",
      reasoning: `Classification failed: ${errMessage}`,
      requiresHumanAttention: true,
      classifiedAt: new Date().toISOString()
    };
  }
}
