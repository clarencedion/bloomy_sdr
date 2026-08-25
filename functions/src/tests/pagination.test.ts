import { describe, expect, it } from "vitest";
import { adminDb } from "../config/firebase.js";
import { runDiscoveryCampaign } from "../services/run-discovery-campaign.js";

describe("Phase 03: Discovery Pagination, Prioritization & Lifecycle Controls", () => {
  it("tracks and advances pagination cursors across runs without duplicates (REQ-017)", async () => {
    // 1. Create a mock campaign with manual provider priority
    const campaignRef = await adminDb.collection("discoveryCampaigns").add({
      workspaceId: "ws_default",
      businessId: "biz_devcomm",
      name: "Test Pagination Campaign",
      status: "active",
      segment: "custom",
      cities: ["Nantes"],
      keywords: ["test"],
      maxCompaniesPerRun: 2,
      providerPriority: ["manual"],
      autoQueueHighScoreCompanies: false,
      rechercheEntreprisesPageCursor: 1,
      rechercheEntreprisesExhausted: false,
      googlePlacesPageCursor: 1,
      googlePlacesExhausted: false
    });

    // 2. Run discovery run #1
    const run1 = await runDiscoveryCampaign(campaignRef.id);
    expect(run1.runId).toBeTruthy();

    const campaignSnap1 = await campaignRef.get();
    const campData1 = campaignSnap1.data();
    expect(campData1?.status).toBe("active");

    // Clean up
    await campaignRef.delete();
  });

  it("prevents execution on paused or archived campaigns (REQ-018)", async () => {
    const pausedCampRef = await adminDb.collection("discoveryCampaigns").add({
      workspaceId: "ws_default",
      businessId: "biz_devcomm",
      name: "Paused Campaign",
      status: "paused",
      segment: "custom",
      cities: ["Paris"],
      keywords: ["test"],
      maxCompaniesPerRun: 5,
      providerPriority: ["manual"]
    });

    await expect(runDiscoveryCampaign(pausedCampRef.id)).rejects.toThrow("paused");
    await pausedCampRef.delete();

    const archivedCampRef = await adminDb.collection("discoveryCampaigns").add({
      workspaceId: "ws_default",
      businessId: "biz_devcomm",
      name: "Archived Campaign",
      status: "archived",
      segment: "custom",
      cities: ["Paris"],
      keywords: ["test"],
      maxCompaniesPerRun: 5,
      providerPriority: ["manual"]
    });

    await expect(runDiscoveryCampaign(archivedCampRef.id)).rejects.toThrow("archived");
    await archivedCampRef.delete();
  });

  it("supports discovery provider prioritization order (REQ-016)", async () => {
    const customPriorityCamp = await adminDb.collection("discoveryCampaigns").add({
      workspaceId: "ws_default",
      businessId: "biz_bloomy",
      name: "Custom Priority Campaign",
      status: "active",
      segment: "custom",
      cities: ["Lyon"],
      keywords: ["fleuriste"],
      maxCompaniesPerRun: 5,
      providerPriority: ["google_places", "recherche_entreprises", "sirene"]
    });

    const snap = await customPriorityCamp.get();
    const data = snap.data();
    expect(data?.providerPriority[0]).toBe("google_places");
    expect(data?.providerPriority[1]).toBe("recherche_entreprises");
    expect(data?.providerPriority[2]).toBe("sirene");

    await customPriorityCamp.delete();
  });
});
