import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { bookMeetingAtomically } from "../../services/meeting-creator.js";
import { setMockBusyWindows, setMockEventCreationHandler, resetCalendarMocks } from "../../services/calendar-service.js";
import { adminDb } from "../../config/firebase.js";

describe("Atomic Meeting Creation & Double-Booking Guard (REQ-074)", () => {
  beforeEach(() => {
    resetCalendarMocks();
  });

  afterEach(() => {
    resetCalendarMocks();
  });

  it("should prevent double-booking when the slot is already busy", async () => {
    const slotStart = new Date("2026-08-27T14:30:00Z");
    const slotEnd = new Date("2026-08-27T15:00:00Z");

    setMockBusyWindows([
      {
        start: new Date("2026-08-27T14:00:00Z"),
        end: new Date("2026-08-27T15:00:00Z"),
        subject: "Existing Internal Meeting"
      }
    ]);

    const result = await bookMeetingAtomically({
      startTime: slotStart,
      endTime: slotEnd,
      prospectEmail: "client@test.com",
      prospectName: "Jean Dupont"
    });

    expect(result.success).toBe(false);
    expect(result.conflict).toBe(true);
    expect(result.error).toContain("no longer available");
  });

  it("should atomically create meeting, persist document, and update company & contact states", async () => {
    const unique = Date.now();
    const companyId = `comp_meeting_${unique}`;
    const contactId = `contact_meeting_${unique}`;
    const convId = `conv_meeting_${unique}`;

    // Seed test records
    await adminDb.collection("companies").doc(companyId).set({
      id: companyId,
      name: "Acme Logistique",
      status: "replied"
    });

    await adminDb.collection("contacts").doc(contactId).set({
      id: contactId,
      companyId,
      email: "jean.dupont@acmelog.fr",
      status: "replied"
    });

    await adminDb.collection("conversations").doc(convId).set({
      id: convId,
      companyId,
      contactId,
      status: "in_dialogue"
    });

    setMockEventCreationHandler(async (_event) => ({
      id: `evt_graph_${unique}`,
      webLink: "https://outlook.office.com/calendar/item/test",
      joinUrl: "https://teams.microsoft.com/l/meetup-join/test"
    }));

    const slotStart = new Date("2026-08-27T15:00:00Z");
    const slotEnd = new Date("2026-08-27T15:30:00Z");

    const result = await bookMeetingAtomically({
      companyId,
      contactId,
      conversationId: convId,
      startTime: slotStart,
      endTime: slotEnd,
      prospectEmail: "jean.dupont@acmelog.fr",
      prospectName: "Jean Dupont",
      title: "Échange Devcomm <> Acme Logistique",
      source: "conversational"
    });

    expect(result.success).toBe(true);
    expect(result.meetingId).toBeDefined();
    expect(result.outlookEventId).toBe(`evt_graph_${unique}`);
    expect(result.sequenceTerminated).toBe(true);

    // Verify Firestore Meeting Document
    const meetingSnap = await adminDb.collection("meetings").doc(result.meetingId!).get();
    expect(meetingSnap.exists).toBe(true);
    const mData = meetingSnap.data();
    expect(mData?.status).toBe("scheduled");
    expect(mData?.bookingSource).toBe("conversational");
    expect(mData?.outlookEventId).toBe(`evt_graph_${unique}`);
    expect(mData?.attendees).toContain("jean.dupont@acmelog.fr");

    // Verify Company Status Updated
    const compSnap = await adminDb.collection("companies").doc(companyId).get();
    expect(compSnap.data()?.status).toBe("meeting_booked");

    // Verify Contact Status Updated
    const contSnap = await adminDb.collection("contacts").doc(contactId).get();
    expect(contSnap.data()?.status).toBe("meeting_booked");

    // Verify Conversation Status Updated
    const convSnap = await adminDb.collection("conversations").doc(convId).get();
    expect(convSnap.data()?.status).toBe("meeting_booked");
  });
});
