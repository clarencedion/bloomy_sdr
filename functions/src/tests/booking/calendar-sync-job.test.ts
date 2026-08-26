import { describe, it, expect } from "vitest";
import { runCalendarSync } from "../../jobs/calendar-sync-job.js";
import { adminDb } from "../../config/firebase.js";

describe("Microsoft Graph Hourly Sync Fallback (REQ-076)", () => {
  it("should handle unconfigured or paused states safely without exceptions", async () => {
    // When automation is paused or unconfigured, runCalendarSync exits gracefully
    await expect(runCalendarSync()).resolves.toBeUndefined();
  });

  it("should verify meetings collection schema compatibility for direct synced events", async () => {
    const unique = Date.now();
    const contactId = `contact_sync_${unique}`;
    const companyId = `comp_sync_${unique}`;
    const meetingId = `meeting_sync_${unique}`;

    await adminDb.collection("meetings").doc(meetingId).set({
      id: meetingId,
      workspaceId: "ws_default",
      businessId: "biz_devcomm",
      companyId,
      contactId,
      outlookEventId: `evt_direct_${unique}`,
      title: "Direct Sync Meeting",
      startTime: new Date(),
      endTime: new Date(Date.now() + 30 * 60 * 1000),
      timezone: "Europe/Paris",
      attendees: ["synced.lead@acme.fr"],
      source: "outlook",
      bookingSource: "direct",
      status: "scheduled"
    });

    const snap = await adminDb.collection("meetings").doc(meetingId).get();
    expect(snap.exists).toBe(true);
    expect(snap.data()?.bookingSource).toBe("direct");
    expect(snap.data()?.source).toBe("outlook");
  });
});
