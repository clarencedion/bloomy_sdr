import type { ReplyClassification } from "../types/domain.js";
import { getAiProvider } from "../providers/ai/index.js";
import { getGlobalSettings, getAiSecrets } from "../utils/settings.js";
import { writeLog } from "../utils/logger.js";
import { recordAiSpend } from "./cost-guardrail-service.js";
import { runStructuredAiCall } from "./ai-structured-call.js";
import { ObjectionTypeSchema, ReplyClassificationSchema } from "./reply-classifier-schema.js";
import {
  buildReplyClassifierUserPrompt,
  getReplyClassifierSystemPrompt,
  type ReplyChannel
} from "./reply-classifier-prompts.js";

export interface ClassifyReplyInput {
  subject?: string;
  bodyText: string;
  /** The sender's address. Email always has one; a direct message has none. */
  leadEmail?: string;
  providerEventType?: string;
  workspaceId?: string;
  businessId?: string;
  /** "dm": Instagram / Facebook direct message. Absent = email, unchanged. */
  channel?: ReplyChannel;
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
 * Automatic replies that business messaging accounts send on their own
 * (Instagram / Messenger "instant replies", away messages). An email
 * auto-responder announces itself in its subject; a DM has none, so these
 * match the body. Each pattern is a phrase only a canned reply uses: a real
 * reply wrongly ignored is a lost lead, while an auto-reply wrongly kept only
 * shows the operator a draft they skip.
 */
const DM_AUTO_REPLY_PATTERNS = [
  /r[ée]ponse\s+(?:automatique|instantan[ée]e)/i,
  /message\s+automati(?:que|s[ée])/i,
  /\b(?:auto-?reply|automatic\s+reply|instant\s+reply|away\s+message)\b/i,
  /nous\s+vous\s+(?:r[ée]pondrons|recontacterons)\s+(?:dans\s+les\s+(?:plus\s+)?brefs\s+d[ée]lais|d[èe]s\s+que\s+possible|au\s+plus\s+vite|(?:tr[èe]s\s+)?rapidement|(?:tr[èe]s\s+)?bient[ôo]t)/i,
  /merci\s+(?:pour\s+votre\s+message|de\s+(?:nous\s+avoir\s+contact[ée]s?|votre\s+message))\s*[,.!]*\s*nous\s+(?:vous\s+)?(?:r[ée]pondrons|reviendrons|revenons|recontacterons)/i,
  /thanks?\s+(?:you\s+)?for\s+(?:messaging|contacting|reaching\s+out\s+to)\s+us[\s\S]{0,160}?(?:get\s+back\s+to\s+you|respond|reply)/i,
  /\b(?:we\s+are|we['’]re|i\s+am|i['’]m)\s+(?:currently\s+)?away\b/i,
  /\b(?:actuellement|momentan[ée]ment)\s+absente?s?\b/i,
  /\bnous\s+sommes\s+(?:actuellement\s+)?absents?\b/i
];

/**
 * How people tell a business to stop in a direct message, in the words the
 * email list above misses: the elided "m'" ("ne m'écrivez plus"), imperatives
 * ("arrêtez de m'envoyer…"), "pas de démarchage", "laissez-moi tranquille".
 * DM only, so email classification is unchanged.
 *
 * A match suppresses the handle and the company for good, with no model
 * asked, so each pattern is a request standing on its own: it starts a
 * clause ("Bonjour, pas de démarchage" — never "on n'a pas de prospection en
 * place") and ends one, allowing only politeness or "again" in between ("ne
 * me contactez pas avant septembre" is a date, not a stop). A miss costs one
 * model call; a failed call escalates with no draft.
 */
const APOSTROPHE = "['’]\\s*";
/** The start of the message or of a clause, or a polite lead-in. */
const CLAUSE_START =
  "(?:^|[.!?;:,\\n…]\\s*|\\b(?:merci|svp|stp|bon|bref|alors|donc|ok|okay|non|bonjour|bonsoir|hello|please|pls|kindly|so|no|and|et|mais|but)\\s*[,!.]?\\s+)";
/** A clause start, or a request that takes an infinitive ("merci de…", "pouvez-vous…"). */
const REQUEST_LEAD = `(?:${CLAUSE_START}|\\b(?:merci|pri[èe]re|veuillez|je\\s+vous\\s+(?:prie|demande|remercie)|pouvez[\\s-]vous|pourriez[\\s-]vous|vous\\s+pouvez|j${APOSTROPHE}aimerais|je\\s+voudrais|je\\s+pr[ée]f[èe]re|nous\\s+pr[ée]f[ée]rons|je\\s+souhaite|nous\\s+souhaitons)\\s+(?:de\\s+|d${APOSTROPHE})?)`;
/** The end of the clause, after nothing but politeness or "again". */
const CLAUSE_END =
  "(?:\\s*,?\\s*(?:svp|stp|s['’]il\\s+(?:vous|te)\\s+pla[îi]t|merci(?:\\s+(?:bien|beaucoup|d['’]avance))?|plus\\s+jamais|jamais|du\\s+tout|d[ée]sormais|dor[ée]navant|[àa]\\s+l['’]avenir|une\\s+bonne\\s+fois\\s+pour\\s+toutes|again|anymore|any\\s+more|ever|please|thanks?|thank\\s+you))*\\s*(?=$|[.!?,;:\\n…]|\\p{Extended_Pictographic})";
/** "…de messages", "…vos offres", "…rien": what is no longer to be sent. */
const MESSAGES_OBJECT =
  "(?:\\s+(?:de|d['’]|des|vos|ces|tes|les|ce\\s+genre\\s+de)\\s*(?:messages?|mp|dm|relances?|sollicitations?|offres?|propositions?|pubs?|publicit[ée]s?|spams?|trucs?|choses?)|\\s+rien)?";
const TO_ME = `(?:m${APOSTROPHE}|me\\s+|nous\\s+)`;
const STOP_VERBS_IMPERATIVE =
  "(?:[ée]crivez|contactez|recontactez|relancez|sollicitez|d[ée]marchez|envoyez|spammez|harcelez|[ée]cris|contacte|recontacte|relance|envoie|spamme|harc[eè]le)";
/** With "pas" rather than "plus", only the verbs of contact itself: "ne me relancez pas" is not a stop. */
const STOP_VERBS_IMPERATIVE_PAS = "(?:contactez|recontactez|sollicitez|d[ée]marchez|contacte|recontacte)";
const STOP_VERBS_INFINITIVE = "(?:[ée]crire|contacter|recontacter|relancer|solliciter|d[ée]marcher|envoyer|spammer|harceler)";
const STOP_VERBS_INFINITIVE_PAS = "(?:contacter|recontacter|solliciter|d[ée]marcher)";
const DM_PATTERN_FLAGS = "iu";
const DM_UNSUBSCRIBE_PATTERNS = [
  // "Ne m'écrivez plus", "ne me contactez plus svp", "Pas intéressé, ne me recontactez pas", "ne m'envoyez plus rien"
  new RegExp(
    `${CLAUSE_START}ne\\s+${TO_ME}?(?:${STOP_VERBS_IMPERATIVE}\\s+(?:plus|jamais)|${STOP_VERBS_IMPERATIVE_PAS}\\s+pas)${MESSAGES_OBJECT}${CLAUSE_END}`,
    DM_PATTERN_FLAGS
  ),
  // "N'envoyez plus de messages", "N'écrivez plus"
  new RegExp(`${CLAUSE_START}n${APOSTROPHE}(?:[ée]crivez|envoyez|[ée]cris|envoie)\\s+(?:plus|jamais)${MESSAGES_OBJECT}${CLAUSE_END}`, DM_PATTERN_FLAGS),
  // "Merci de ne plus m'écrire", "merci de ne pas me recontacter", "ne plus m'envoyer de messages"
  new RegExp(
    `${REQUEST_LEAD}ne\\s+(?:(?:plus|jamais)\\s+${TO_ME}${STOP_VERBS_INFINITIVE}|pas\\s+${TO_ME}${STOP_VERBS_INFINITIVE_PAS})${MESSAGES_OBJECT}${CLAUSE_END}`,
    DM_PATTERN_FLAGS
  ),
  // "Arrêtez de m'envoyer des messages", "arrête de me spammer", "merci d'arrêter de m'écrire"
  new RegExp(
    `(?:${CLAUSE_START}|\\bmerci\\s+d${APOSTROPHE}|\\bveuillez\\s+|\\bpouvez[\\s-]vous\\s+|\\bpourriez[\\s-]vous\\s+)arr[êe]te(?:z|r)?\\s+(?:de\\s+|d${APOSTROPHE})${TO_ME}${STOP_VERBS_INFINITIVE}${MESSAGES_OBJECT}${CLAUSE_END}`,
    DM_PATTERN_FLAGS
  ),
  // "Arrêtez vos messages", "arrête ce spam" — the imperative only: "on voudrait arrêter ces relances" is about theirs.
  new RegExp(
    `${CLAUSE_START}arr[êe]te(?:z)?\\s+(?:le|ce|ces|vos|tes|votre|ton)\\s+(?:spam|messages?|relances?|harc[eè]lement|d[ée]marchage|pubs?|sollicitations?)${CLAUSE_END}`,
    DM_PATTERN_FLAGS
  ),
  // A message that is only "Arrêtez (svp / merci / ça)".
  /^\s*arr[êe]te[zr]?(?:\s*[,!.]?\s*(?:svp|stp|s['’]il\s+vous\s+pla[îi]t|merci|maintenant|tout\s+de\s+suite|[çc]a))*\s*[.!]*\s*$/iu,
  // "Pas de démarchage svp", "Bonjour, pas de prospection merci."
  new RegExp(
    `${CLAUSE_START}pas\\s+de\\s+(?:d[ée]marchage|prospection|sollicitations?|pubs?|publicit[ée]s?|spam)(?:\\s+commercia(?:l|le|ux|les))?${CLAUSE_END}`,
    DM_PATTERN_FLAGS
  ),
  // "Je ne veux plus recevoir vos messages", "je ne souhaite pas être contactée", "je ne veux pas de démarchage"
  new RegExp(
    `\\b(?:je|nous|on)\\s+ne\\s+(?:veux|voulons|veut|souhaite|souhaitons|d[ée]sire|d[ée]sirons)\\s+(?:plus|pas)\\s+(?:[êe]tre\\s+(?:re)?(?:contact[ée]e?s?|sollicit[ée]e?s?|d[ée]march[ée]e?s?|relanc[ée]e?s?)|recevoir(?:\\s+(?:de|d['’]|vos|ces|des|les)\\s*)?(?:messages?|sollicitations?|offres?|propositions?|relances?|pubs?|publicit[ée]s?)|(?:de|d['’])\\s*(?:messages?|sollicitations?|relances?|d[ée]marchage|prospection|pubs?))${CLAUSE_END}`,
    DM_PATTERN_FLAGS
  ),
  // "Laissez-moi tranquille", "foutez-nous la paix"
  /\blaissez[\s-](?:moi|nous)\s+tranquilles?\b/iu,
  /\bfoutez[\s-](?:moi|nous)\s+la\s+paix\b/iu,
  // "Désinscrivez-moi", "comment me désinscrire" — never "nos clients veulent se désinscrire facilement".
  /\b(?:me|nous)\s+d[ée]sinscrire\b|\bd[ée]sinscri(?:vez|s)[\s-](?:moi|nous)\b/iu,
  // "Supprimez mes coordonnées"
  /\bsupprimez\s+(?:mes|nos)\s+(?:coordonn[ée]es|donn[ée]es|informations|contacts?|num[ée]ros?)\b/iu,
  // English
  new RegExp(
    `${CLAUSE_START}(?:please\\s+)?(?:do\\s+not|don['’]t|never)\\s+(?:contact|message|text|dm|email|e-mail|write\\s+to)\\s+(?:me|us)${CLAUSE_END}`,
    DM_PATTERN_FLAGS
  ),
  new RegExp(`\\bleave\\s+(?:me|us)\\s+alone${CLAUSE_END}`, DM_PATTERN_FLAGS),
  /\bremove\s+(?:me|us)\s+from\s+(?:your|the|this)\s+(?:list|mailing\s+list|database|contacts?|contact\s+list)\b/iu
];

/**
 * What turns "stop" into something else: a move to another channel ("ne
 * m'écrivez plus ici, appelez-moi au 06…", "don't message me here, email me
 * at…") or a "I'll come back to you" ("ne me relancez pas, je reviens vers
 * vous"). Such a message is left to the model: it is not a request never to
 * hear from the business again.
 */
const NOT_A_STOP_PATTERNS = [
  /\b(?:ici|here)\b/iu,
  /\b(?:sur|on)\s+(?:ce\s+compte|this\s+account|instagram|insta|facebook|fb|messenger|whatsapp)\b/iu,
  /\b(?:par|via|au|en|by|over)\s+(?:e-?mail|mail|courriel|t[ée]l[ée]phone|t[ée]l|phone|sms|texto|text|whatsapp|courrier|message\s+priv[ée]|mp|dm)\b/iu,
  /\b(?:r?appel|t[ée]l[ée]phon)/iu,
  /\b(?:e-?mail|mail)(?:ez)?[\s-](?:moi|nous)\b/iu,
  /\b(?:email|e-mail|mail|call|text|phone|ring|reach|write\s+to)\s+(?:me|us)\b/iu,
  /\bcontact\s+(?:me|us)\s+(?:at|on|via|by|through)\b/iu,
  /\b[ée]cri(?:vez|s)[\s-](?:moi|nous)\b/iu,
  /\bcontacte(?:z)?[\s-](?:moi|nous)\b/iu,
  /\benvoye[zr][\s-](?:moi|nous)\b/iu,
  /\bpassez\s+par\b|\bplut[ôo]t\b|\binstead\b|\brather\b/iu,
  // An e-mail address or a phone number.
  /[^\s@]+@[^\s@]+\.[a-z]{2,}/iu,
  /(?:\+\d{2,3}[\s.-]?|\b0)[1-9](?:[\s.-]?\d{2}){4}\b/u,
  // "je vous recontacte", "c'est moi qui vous contacterai", "je reviens vers vous", "si besoin"
  /\b(?:je|on|nous)\s+(?:vous\s+)?(?:re)?contacte(?:rai|rons|ra)?\b|\bvous\s+(?:re)?contacter(?:ai|ons|a)\b|\b(?:je\s+reviens|je\s+reviendrai|nous\s+reviendrons|on\s+revient|on\s+reviendra)\s+vers\s+vous\b|\bje\s+vous\s+(?:[ée]cri(?:s|rai)|redis|dirai|tiens\s+au\s+courant)\b|\bsi\s+besoin\b/iu,
  /\b(?:i|we)(?:['’]ll|\s+will)\s+(?:get\s+back|reach\s+out|contact\s+you|call\s+you|be\s+in\s+touch|let\s+you\s+know)\b|\bif\s+(?:needed|i\s+need|we\s+need)\b/iu
];

/**
 * Checks for an opt-out in a direct message: the email patterns and the DM
 * ones above, unless the message moves the conversation elsewhere or defers
 * it (see NOT_A_STOP_PATTERNS) — that is the model's to read.
 */
export function isDeterministicDmUnsubscribe(bodyText: string): boolean {
  const text = (bodyText || "").trim();
  if (!text) return false;
  if (NOT_A_STOP_PATTERNS.some((regex) => regex.test(text))) return false;
  return isDeterministicUnsubscribe({ bodyText: text }) || DM_UNSUBSCRIBE_PATTERNS.some((regex) => regex.test(text));
}

/**
 * Checks for a business account's automatic instant reply in a direct message.
 */
export function isDeterministicDmAutoReply(bodyText: string): boolean {
  const text = (bodyText || "").trim();
  return DM_AUTO_REPLY_PATTERNS.some((regex) => regex.test(text));
}

/**
 * The stored schema, tolerating the `null` objection type the prompt itself
 * offers ("objectionType": ... | null) instead of failing the whole call on it.
 */
const DmReplyClassificationSchema = ReplyClassificationSchema.extend({
  objectionType: ObjectionTypeSchema.nullish().transform((value) => value ?? undefined)
});

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

  // 1. Deterministic Unsubscribe (REQ-065). A DM has its own wordings, and
  // a "stop" that moves the conversation elsewhere is left to the model.
  if (
    input.channel === "dm"
      ? isDeterministicDmUnsubscribe(cleanBody)
      : isDeterministicUnsubscribe({ providerEventType: input.providerEventType, subject: cleanSubject, bodyText: cleanBody })
  ) {
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

  // 2b. A business account's automatic instant reply to our DM
  if (input.channel === "dm" && isDeterministicDmAutoReply(cleanBody)) {
    return {
      intent: "OUT_OF_OFFICE",
      confidence: 1.0,
      detectedQuestions: [],
      suggestedAction: "ignore_auto_reply",
      reasoning: "Deterministic direct-message auto-reply (instant reply) detected.",
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
  if (input.channel === "dm") return classifyDirectMessageWithAi(input, cleanBody);

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

      await recordAiSpend({
        workspaceId: input.workspaceId,
        businessId: input.businessId,
        provider: result.provider,
        model: result.model,
        operation: "reply_classification",
        usage: {
          inputTokens: result.estimatedInputTokens,
          outputTokens: result.estimatedOutputTokens
        }
      }).catch(() => undefined);

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

/**
 * The LLM pass for a direct message. It runs through the structured call
 * rather than `provider.classifyReply`, whose prompts are the email ones and
 * whose parser turns any failure into a canned verdict. Here a failure — no
 * real model configured, a timeout, output off-schema — lands in the same
 * UNCLEAR-and-escalate verdict as the email path's errors, never in a guess.
 */
async function classifyDirectMessageWithAi(input: ClassifyReplyInput, cleanBody: string): Promise<ReplyClassification> {
  try {
    const { output } = await runStructuredAiCall({
      operation: "social_reply_classification",
      system: getReplyClassifierSystemPrompt("dm"),
      user: buildReplyClassifierUserPrompt({ bodyText: cleanBody, channel: "dm" }),
      schema: DmReplyClassificationSchema,
      maxTokens: 1000,
      temperature: 0.1,
      workspaceId: input.workspaceId,
      businessId: input.businessId
    });
    return { ...output, classifiedAt: new Date().toISOString() };
  } catch (error) {
    const errMessage = error instanceof Error ? error.message : String(error);
    // Never the message text: logs are readable by every signed-in user.
    await writeLog({
      type: "reply.classification_error",
      level: "warning",
      message: `Failed to classify an inbound direct message: ${errMessage}`,
      workspaceId: input.workspaceId,
      businessId: input.businessId,
      metadata: { channel: "dm", error: errMessage }
    }).catch(() => undefined);

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
