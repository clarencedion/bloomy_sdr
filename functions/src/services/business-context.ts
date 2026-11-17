import { describePricingTerms } from "./pricing-guardrail.js";
import { getBusiness, getKnowledgeBase, listOffers } from "./business-service.js";
import { offerNeutralKnowledgeBase } from "./offer-experiment.js";

/**
 * Describes "our company" for AI prompts, built from the business a company
 * belongs to.
 *
 * `settings/global.companyContext` is a SINGLE workspace-wide string. Using it
 * meant every business generated research and outreach as if it were the
 * workspace's original consulting firm: a hairdressing-website campaign was
 * told "our company sells sales training", so it dutifully rejected every salon
 * for having no sales force. The per-business profile is the only correct
 * source; the global string survives only as a fallback for records with no
 * business attached.
 *
 * Phase 19: there is no fallback any more. The global string's default names
 * one specific consultancy, so a missing businessId or a momentary read error
 * researched and pitched prospects in that firm's name (and could reject them
 * as a poor fit for it). No business → refused, like outreach. Unreadable
 * business → a transient error the queue retries.
 */
export async function buildBusinessContext(input: {
  workspaceId?: string;
  businessId?: string;
  offerId?: string;
}): Promise<string> {
  const workspaceId = input.workspaceId || "ws_default";
  if (!input.businessId) {
    throw new Error("Company is not attributed to any business; there is no offer to describe.");
  }

  let business, offers, knowledgeBase;
  try {
    [business, offers, knowledgeBase] = await Promise.all([
      getBusiness(workspaceId, input.businessId),
      listOffers(workspaceId, input.businessId),
      getKnowledgeBase(workspaceId, input.businessId)
    ]);
  } catch (error) {
    throw new Error(
      `Business context temporarily unavailable for ${input.businessId}: ${error instanceof Error ? error.message : String(error)}`
    );
  }
  if (!business) {
    throw new Error(`Business ${input.businessId} does not exist; it is not attributed to any business that can be described.`);
  }

  const matching = input.offerId ? offers.filter((offer) => offer.id === input.offerId) : offers;
  const chosen = matching.length ? matching : offers;
  const described = chosen.slice(0, 3);
  // While the business tests several offers, its knowledge base is shared by
  // all of them: a pricing rule stating one variant's figures must not reach
  // another variant's prompt (offer-experiment.ts). No experiment: unchanged.
  const kb = offerNeutralKnowledgeBase(
    knowledgeBase,
    business,
    described.map((offer) => offer.pricingGuardrails)
  );

  const lines: string[] = [`Our company: ${business.name}.`];
  if (business.branding?.tagline) lines.push(`Positioning: ${business.branding.tagline}.`);

  for (const offer of described) {
    lines.push(`\nOffer: ${offer.name}`);
    if (offer.description) lines.push(offer.description);
    if (offer.valuePropositions?.length) {
      lines.push(`Value propositions: ${offer.valuePropositions.join("; ")}`);
    }
    if (offer.targetPersonas?.length) {
      lines.push(`We sell to: ${offer.targetPersonas.map((persona) => persona.title).join(", ")}`);
    }
    if (offer.prohibitedPromises?.length) {
      lines.push(`Never promise: ${offer.prohibitedPromises.join("; ")}`);
    }
    // The commercial terms the business approved, stated once and checked
    // after generation by the same rules (pricing-guardrail.ts).
    if (offer.pricingGuardrails) {
      lines.push(`Commercial terms:\n${describePricingTerms(offer.pricingGuardrails)}`);
    }
  }

  if (kb?.services?.length) {
    lines.push(`\nServices: ${kb.services.map((service) => service.name).join(", ")}`);
  }
  if (kb?.caseStudies?.length) {
    lines.push(
      `Proof points: ${kb.caseStudies
        // A reference without a measured metric is still a reference; never
        // print "(undefined)" where a number would be expected.
        .map((study) => (study.metric ? `${study.title} (${study.metric})` : study.title))
        .join("; ")}`
    );
  }
  if (kb?.pricingRules?.length) {
    lines.push(`Pricing rules: ${kb.pricingRules.join(" ")}`);
  }

  return lines.filter(Boolean).join("\n").trim();
}
