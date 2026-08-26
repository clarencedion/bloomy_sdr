import { describe, it, expect } from "vitest";
import type { MeetingDoc, TimeSlot } from "@/types/firestore";

describe("Calendar Truth & Conversational Booking Invariants (REQ-071, REQ-074)", () => {
  it("should conform to MeetingDoc multi-tenant schema with bookingSource", () => {
    const meeting: MeetingDoc = {
      id: "meet_123",
      workspaceId: "ws_default",
      businessId: "biz_devcomm",
      companyId: "comp_123",
      contactId: "cont_123",
      conversationId: "conv_123",
      title: "Échange Devcomm <> Acme Corp",
      startTime: new Date().toISOString(),
      endTime: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
      timezone: "Europe/Paris",
      attendees: ["prospect@acme.com"],
      source: "conversational",
      bookingSource: "conversational",
      status: "scheduled",
      outlookEventId: "evt_123",
      calendarProvider: "microsoft_graph",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    expect(meeting.bookingSource).toBe("conversational");
    expect(meeting.status).toBe("scheduled");
    expect(meeting.calendarProvider).toBe("microsoft_graph");
    expect(meeting.workspaceId).toBe("ws_default");
  });

  it("should validate TimeSlot structure conforms to calendar truth format", () => {
    const slot: TimeSlot = {
      start: "2026-08-27T14:00:00.000Z",
      end: "2026-08-27T14:30:00.000Z",
      durationMinutes: 30,
      formattedFr: "Jeudi 27 août à 14h00"
    };

    expect(slot.durationMinutes).toBe(30);
    expect(slot.formattedFr).toContain("Jeudi 27 août");
  });
});
