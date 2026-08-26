/**
 * Creates and starts a campaign from a natural-language description.
 *
 * This is the whole "Start prospecting" action: the campaign is written as
 * `active` with auto-queueing enabled and its first run is triggered
 * immediately, so the user never has to press Create, then Run, then Research,
 * then Generate, then Send. Everything after this point is handled by the
 * existing scheduled jobs under the business autonomy policy.
 */

import { addDoc, collection, serverTimestamp } from "firebase/firestore";
import { db } from "@/lib/firebase/client";
import { collections, createLog } from "@/lib/firebase/firestore";
import { callRunDiscoveryCampaign } from "@/lib/firebase/functions";
import type { DiscoveryCampaign, DiscoverySegment, DiscoveryProviderName, SignalProviderId } from "@/types/firestore";
import type { IcpTranslationResult } from "@/types/domain";

export interface LaunchCampaignInput {
  plan: IcpTranslationResult;
  prompt: string;
  workspaceId: string;
  businessId: string;
  offerId?: string;
  /** Overrides captured in Advanced settings, when the user opened them. */
  overrides?: Partial<Pick<DiscoveryCampaign, "name" | "maxCompaniesPerRun" | "requireWebsite" | "minEmployeeCount">>;
}

export interface LaunchCampaignResult {
  campaignId: string;
  /** False when the campaign was saved but its first run could not be started. */
  started: boolean;
  startError?: string;
}

const DEFAULT_PROVIDERS: DiscoveryProviderName[] = ["recherche_entreprises", "sirene", "google_places"];
const DEFAULT_SIGNALS: SignalProviderId[] = ["company_registry"];

export function buildCampaignDocument(input: LaunchCampaignInput): Omit<DiscoveryCampaign, "id"> {
  const { plan, prompt, workspaceId, businessId, offerId, overrides } = input;

  return {
    workspaceId,
    businessId,
    offerId: offerId || undefined,
    name: (overrides?.name || plan.campaignName || "New campaign").trim(),
    naturalLanguagePrompt: prompt.trim(),
    status: "active",
    segment: (plan.segment || "custom") as DiscoverySegment,
    cities: plan.cities ?? [],
    departments: plan.departments ?? [],
    regions: plan.regions ?? [],
    keywords: plan.keywords ?? [],
    excludeKeywords: plan.excludeKeywords ?? [],
    nafCodes: plan.nafCodes ?? [],
    maxCompaniesPerRun: overrides?.maxCompaniesPerRun ?? 15,
    minEmployeeCount: overrides?.minEmployeeCount ?? plan.minEmployeeCount ?? undefined,
    requireWebsite: overrides?.requireWebsite ?? Boolean(plan.requireWebsite),
    providerPriority: plan.providerPriority?.length ? plan.providerPriority : DEFAULT_PROVIDERS,
    researchStrategy: {
      enabledSignalProviders: plan.researchStrategy?.enabledSignalProviders?.length
        ? plan.researchStrategy.enabledSignalProviders
        : DEFAULT_SIGNALS,
      relevanceExplanation: plan.reasoningSummary || "",
      scoringWeights: plan.researchStrategy?.scoringWeights ?? {
        companyFitWeight: 0.3,
        needStrengthWeight: 0.4,
        commercialScaleWeight: 0.2,
        evidenceConfidenceWeight: 0.1
      }
    },
    // The SDR qualifies and researches on its own; the user never presses "Run".
    autoQueueHighScoreCompanies: true,
    minDiscoveryScoreForSave: 100,
    minDiscoveryScoreForAutoResearch: 100,
    minQualityScoreForAutoResearch: 100,
    rechercheEntreprisesPageCursor: 1,
    rechercheEntreprisesExhausted: false,
    googlePlacesPageCursor: 1,
    googlePlacesExhausted: false,
    createdAt: serverTimestamp() as never,
    updatedAt: serverTimestamp() as never
  };
}

export async function launchCampaign(input: LaunchCampaignInput): Promise<LaunchCampaignResult> {
  const campaignData = buildCampaignDocument(input);
  const docRef = await addDoc(collection(db, collections.discoveryCampaigns), campaignData);

  await createLog({
    type: "discovery.campaign.created_from_nl",
    level: "info",
    message: `Campaign created: ${campaignData.name}`,
    workspaceId: input.workspaceId,
    businessId: input.businessId,
    metadata: {
      campaignId: docRef.id,
      prompt: input.prompt.trim(),
      offerId: input.offerId
    }
  });

  // Start the first run now so the user sees progress instead of an idle
  // campaign waiting for tomorrow's scheduled job.
  try {
    await callRunDiscoveryCampaign(docRef.id);
    return { campaignId: docRef.id, started: true };
  } catch (error) {
    return {
      campaignId: docRef.id,
      started: false,
      startError: error instanceof Error ? error.message : "Could not start the first search."
    };
  }
}
