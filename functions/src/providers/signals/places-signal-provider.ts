import type { SignalContext, SignalProvider, SignalResult } from "./signal-provider.js";
import type { EvidenceItem } from "../../types/domain.js";
import { getIntegrationSecrets } from "../../utils/settings.js";

type SerperPlacesResult = {
  title: string;
  address?: string;
  website?: string;
  phoneNumber?: string;
  category?: string;
  rating?: number;
  ratingCount?: number;
  cid?: string;
  status?: string;
};

export class PlacesSignalProvider implements SignalProvider {
  readonly id = "google_places";
  readonly name = "Google Places & Reviews";
  readonly description = "Extracts commercial visibility, customer review score, total reviews, business category, and operational status from Google Maps (via Serper).";
  readonly capabilities = [
    "google_rating",
    "google_review_count",
    "place_category",
    "operational_status",
    "google_phone_number",
    "google_cid",
    "google_website_url"
  ];
  readonly costPerExecutionUsd = 0.001;

  supports(context: SignalContext): boolean {
    return Boolean(
      context.company.name &&
      (context.company.city || context.company.address || context.company.postalCode)
    );
  }

  async collect(context: SignalContext): Promise<SignalResult> {
    const startTime = Date.now();
    const evidence: Array<Omit<EvidenceItem, "id" | "workspaceId" | "businessId" | "companyId">> = [];

    try {
      let place: SerperPlacesResult | null = null;

      // 1. Check if rawProviderData on company already contains a valid Places record
      if (
        context.company.rawProviderData &&
        typeof context.company.rawProviderData === "object" &&
        ("title" in (context.company.rawProviderData as object) || "cid" in (context.company.rawProviderData as object))
      ) {
        place = context.company.rawProviderData as SerperPlacesResult;
      }

      // 2. If not, query Serper Places API
      if (!place) {
        const secrets = await getIntegrationSecrets();
        const apiKey = secrets.serperApiKey;
        if (!apiKey) {
          return {
            providerId: this.id,
            evidence: [],
            costEstimateUsd: 0,
            durationMs: Date.now() - startTime,
            error: "Serper API key is not configured in settings/integrationSecrets."
          };
        }

        const query = [context.company.name, context.company.city || context.company.postalCode || context.company.address]
          .filter(Boolean)
          .join(" ");

        const response = await fetch("https://google.serper.dev/places", {
          method: "POST",
          headers: {
            "X-API-KEY": apiKey,
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            q: query,
            gl: "fr",
            hl: "fr",
            page: 1
          })
        });

        if (!response.ok) {
          return {
            providerId: this.id,
            evidence: [],
            costEstimateUsd: this.costPerExecutionUsd,
            durationMs: Date.now() - startTime,
            error: `Serper Places API returned status ${response.status}`
          };
        }

        const data = (await response.json()) as { places?: SerperPlacesResult[] };
        place = data.places?.[0] ?? null;
      }

      if (!place) {
        return {
          providerId: this.id,
          evidence: [],
          costEstimateUsd: this.costPerExecutionUsd,
          durationMs: Date.now() - startTime,
          error: "No matching Google Places record found."
        };
      }

      const now = new Date();
      const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000); // 30 days TTL
      const sourceUrl = place.cid
        ? `https://maps.google.com/?cid=${place.cid}`
        : undefined;

      if (place.rating !== undefined && place.rating !== null) {
        evidence.push({
          signalProvider: this.id,
          key: "google_rating",
          value: Number(place.rating),
          sourceType: "google_places",
          sourceUrl,
          confidence: 90,
          nature: "fact",
          collectedAt: now,
          expiresAt,
          costUsd: this.costPerExecutionUsd
        });
      }

      if (place.ratingCount !== undefined && place.ratingCount !== null) {
        evidence.push({
          signalProvider: this.id,
          key: "google_review_count",
          value: Number(place.ratingCount),
          sourceType: "google_places",
          sourceUrl,
          confidence: 90,
          nature: "fact",
          collectedAt: now,
          expiresAt,
          costUsd: this.costPerExecutionUsd
        });
      }

      if (place.category) {
        evidence.push({
          signalProvider: this.id,
          key: "place_category",
          value: String(place.category),
          sourceType: "google_places",
          sourceUrl,
          confidence: 85,
          nature: "fact",
          collectedAt: now,
          expiresAt,
          costUsd: this.costPerExecutionUsd
        });
      }

      if (place.phoneNumber) {
        evidence.push({
          signalProvider: this.id,
          key: "google_phone_number",
          value: String(place.phoneNumber),
          sourceType: "google_places",
          sourceUrl,
          confidence: 90,
          nature: "fact",
          collectedAt: now,
          expiresAt,
          costUsd: this.costPerExecutionUsd
        });
      }

      if (place.cid) {
        evidence.push({
          signalProvider: this.id,
          key: "google_cid",
          value: String(place.cid),
          sourceType: "google_places",
          sourceUrl,
          confidence: 90,
          nature: "fact",
          collectedAt: now,
          expiresAt,
          costUsd: this.costPerExecutionUsd
        });
      }

      if (place.website) {
        evidence.push({
          signalProvider: this.id,
          key: "google_website_url",
          value: String(place.website),
          sourceType: "google_places",
          sourceUrl,
          confidence: 85,
          nature: "fact",
          collectedAt: now,
          expiresAt,
          costUsd: this.costPerExecutionUsd
        });
      }

      const operationalStatus = place.status ?? "OPERATIONAL";
      evidence.push({
        signalProvider: this.id,
        key: "operational_status",
        value: operationalStatus,
        sourceType: "google_places",
        sourceUrl,
        confidence: 85,
        nature: "fact",
        collectedAt: now,
        expiresAt,
        costUsd: this.costPerExecutionUsd
      });

      return {
        providerId: this.id,
        evidence,
        costEstimateUsd: this.costPerExecutionUsd,
        durationMs: Date.now() - startTime
      };
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      return {
        providerId: this.id,
        evidence: [],
        costEstimateUsd: this.costPerExecutionUsd,
        durationMs: Date.now() - startTime,
        error: errorMsg
      };
    }
  }
}
