import type { OutreachInput } from "../providers/ai/ai-provider.js";
import type { GlobalSettings } from "../utils/settings.js";

export const OUTREACH_PROMPT_VERSION = "devcomm-outreach-v1";

export const DEFAULT_OUTREACH_SYSTEM_PROMPT = `You are a senior French B2B copywriter writing human, short, non-spammy outreach for our company.

Rules:
- French by default.
- No fake claims.
- No invented facts, clients, contacts, revenue, headcount, or fleet details.
- No "I saw that you..." unless the fact is explicitly sourced.
- If an observation is inferred, phrase it softly.
- Avoid over-personalization.
- Keep the first email short, ideally 80 to 140 words.
- Include one clear CTA for a 20-minute diagnostic call.
- Include a soft opt-out sentence.
- Do not mention AI.
- Do not overpromise results.
- Human approval is mandatory; write drafts only.

Return valid JSON only.`;

export const DEFAULT_OUTREACH_USER_PROMPT = `Company:
{{company}}

Contact:
{{contact}}

Research:
{{research}}

Campaign:
{{campaign}}

Company context (representing our company and what we sell):
{{companyContext}}

Return this JSON:
{
  "subject": "string",
  "body": "string",
  "followUp1": "string",
  "followUp2": "string",
  "linkedinConnectionNote": "string",
  "linkedinFollowUp": "string",
  "internalSalesNotes": "string",
  "suggestedPersona": "string",
  "cta": "string",
  "personalizationNotes": ["string"],
  "riskWarnings": ["string"],
  "landingPageDraft": {
    "headline": "string",
    "intro": "string",
    "whyDevcomm": "string (the value proposition and why they should choose our company)",
    "likelyChallenges": ["string"],
    "recommendedSupport": ["string"],
    "cta": "string"
  }
}`;

function substitute(template: string, values: Record<string, string>): string {
  let result = template;
  for (const [key, val] of Object.entries(values)) {
    result = result.replaceAll(`{{${key}}}`, val);
  }
  return result;
}

export function getOutreachSystemPrompt(settings: GlobalSettings): string {
  return settings.outreachSystemPrompt || DEFAULT_OUTREACH_SYSTEM_PROMPT;
}

export function buildOutreachUserPrompt(input: OutreachInput): string {
  const template = input.settings.outreachUserPrompt || DEFAULT_OUTREACH_USER_PROMPT;
  const values = {
    company: JSON.stringify(input.company, null, 2),
    contact: JSON.stringify(input.contact ?? null, null, 2),
    research: JSON.stringify(input.research, null, 2),
    campaign: JSON.stringify(input.campaign ?? null, null, 2),
    companyContext: input.devcommContext
  };
  return substitute(template, values);
}
