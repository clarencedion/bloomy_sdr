import type { OfferDoc } from "../types/domain.js";

/**
 * Which kind of company a campaign is going after.
 *
 * This single choice decides how hard - and how expensively - the SDR should
 * work to find a contact, because the two segments fail in opposite ways:
 *
 *  - `small_business`: a two-person salon has no LinkedIn profile and no record
 *    in any B2B enrichment database. What it does have is a published
 *    `contact@` address, an owner's personal mailbox, and a phone number from
 *    its Google listing. Paid person-lookup returns nothing here, so we do not
 *    spend on it and we accept those published details as a real contact.
 *
 *  - `large_company`: has a website, named executives and a database record.
 *    A generic `contact@` inbox will not reach the Directeur Commercial, so a
 *    named professional address is required and paid enrichment is worth it -
 *    the deal size covers it many times over.
 */
export type TargetSegment = "small_business" | "large_company";

/** Companies at or above this headcount are treated as the large-company path. */
export const LARGE_COMPANY_EMPLOYEE_THRESHOLD = 20;

export interface SegmentPolicy {
  segment: TargetSegment;
  /** Accept `contact@`, `info@` and personal-domain mailboxes as reachable. */
  acceptGenericEmail: boolean;
  /** Treat a phone number alone as enough to work the lead. */
  acceptPhoneOnly: boolean;
  /** Whether paid person-lookup (Dropcontact and friends) should run at all. */
  usePaidContactEnrichment: boolean;
  /**
   * Treat a public social profile as a reachable channel. For trades with no
   * website and no database record, an Instagram profile is frequently the only
   * way to reach the owner - the SDR drafts the message and a human sends it.
   */
  acceptSocialDm: boolean;
}

const POLICIES: Record<TargetSegment, SegmentPolicy> = {
  small_business: {
    segment: "small_business",
    acceptGenericEmail: true,
    acceptPhoneOnly: true,
    // Measured: 7/7 French salons returned `only_organization_data`. Paying per
    // lookup for a guaranteed miss is pure cost.
    usePaidContactEnrichment: false,
    acceptSocialDm: true
  },
  large_company: {
    segment: "large_company",
    acceptGenericEmail: false,
    acceptPhoneOnly: false,
    usePaidContactEnrichment: true,
    // A large company is reached through its named decision maker, not a DM.
    acceptSocialDm: false
  }
};

export function getSegmentPolicy(segment: TargetSegment | undefined): SegmentPolicy {
  return POLICIES[segment ?? "small_business"];
}

/**
 * Resolves the segment for a company.
 *
 * The campaign's explicit choice wins - it is what the operator selected. When
 * absent, headcount from the company registry decides, which is free data we
 * already collect. The offer's configured ideal size is the last hint.
 */
export function resolveTargetSegment(input: {
  campaignSegment?: TargetSegment | string | null;
  employeeCount?: number | null;
  offer?: Pick<OfferDoc, "scoringRules"> | null;
}): TargetSegment {
  if (input.campaignSegment === "small_business" || input.campaignSegment === "large_company") {
    return input.campaignSegment;
  }

  if (typeof input.employeeCount === "number" && input.employeeCount > 0) {
    return input.employeeCount >= LARGE_COMPANY_EMPLOYEE_THRESHOLD ? "large_company" : "small_business";
  }

  const idealMin = input.offer?.scoringRules?.idealEmployeeMin;
  if (typeof idealMin === "number" && idealMin >= LARGE_COMPANY_EMPLOYEE_THRESHOLD) {
    return "large_company";
  }

  // Unknown headcount: assume small. Being wrong this way costs nothing;
  // being wrong the other way spends money on a lookup that will miss.
  return "small_business";
}

/** Generic mailboxes that are nonetheless the owner's real inbox at a very small business. */
const GENERIC_LOCAL_PARTS = [
  "contact",
  "info",
  "bonjour",
  "hello",
  "accueil",
  "direction",
  "commercial",
  "devis",
  "rdv",
  "reservation",
  "sales",
  "salon"
];

export function isGenericMailbox(email: string | undefined | null): boolean {
  if (!email || !email.includes("@")) return false;
  const localPart = email.split("@")[0].toLowerCase().replace(/[._-]/g, "");
  return GENERIC_LOCAL_PARTS.some((generic) => localPart === generic || localPart.startsWith(generic));
}

/**
 * Whether paid person-lookup should be skipped for this company.
 *
 * Deliberately requires POSITIVE knowledge that the prospect is small - either
 * the operator chose the small-business segment, or the registry gave us a
 * headcount below the threshold. An unknown headcount runs the waterfall as
 * before: silently disabling enrichment for everything we simply do not know
 * about would be a much worse failure than a few wasted lookups.
 */
export function shouldSkipPaidEnrichment(input: {
  campaignSegment?: string | null;
  employeeCount?: number | null;
}): boolean {
  if (input.campaignSegment === "large_company") return false;
  if (input.campaignSegment === "small_business") return true;

  if (typeof input.employeeCount === "number" && input.employeeCount > 0) {
    return input.employeeCount < LARGE_COMPANY_EMPLOYEE_THRESHOLD;
  }

  return false;
}

/** Ways the SDR may reach a prospect, chosen per campaign. */
export type OutreachChannel = "email" | "social_dm" | "contact_form";

export const DEFAULT_CHANNELS: OutreachChannel[] = ["email"];

/**
 * Channels enabled for a campaign, always including email.
 *
 * Direct messages and contact forms carry reputational weight the operator has
 * to accept deliberately, so they are opt-in rather than inferred - but email is
 * never removable, because a campaign that can reach nobody is not a campaign.
 */
export function resolveChannels(raw: unknown): OutreachChannel[] {
  const valid: OutreachChannel[] = ["email", "social_dm", "contact_form"];
  const requested = Array.isArray(raw) ? raw.filter((c): c is OutreachChannel => valid.includes(c as OutreachChannel)) : [];
  return requested.includes("email") ? requested : ["email", ...requested];
}

export function channelEnabled(raw: unknown, channel: OutreachChannel): boolean {
  return resolveChannels(raw).includes(channel);
}

/**
 * Whether a campaign writes a DM even to a prospect that has an email: the
 * operator chose "prefer direct messages" (`preferredChannel: "social_dm"`)
 * and DMs are enabled. Off unless chosen, like every non-email channel.
 */
export function prefersDirectMessages(campaign: { preferredChannel?: unknown; channels?: unknown } | null | undefined): boolean {
  return campaign?.preferredChannel === "social_dm" && channelEnabled(campaign.channels, "social_dm");
}
