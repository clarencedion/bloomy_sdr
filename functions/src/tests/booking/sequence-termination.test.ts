import { describe, it, expect } from "vitest";
import { terminateProspectSequence } from "../../services/meeting-creator.js";
import { adminDb } from "../../config/firebase.js";
import { Timestamp } from "firebase-admin/firestore";

describe("Automatic Sequence Termination (REQ-075)", () => {
  it("should immediately halt all ongoing outbound sequence steps when a meeting is booked", async () => {
    const unique = Date.now();
    const contactId = `contact_seq_${unique}`;
    const outreach1 = `outreach_step1_${unique}`;
    const outreach2 = `outreach_step2_${unique}`;
    const convId = `conv_seq_${unique}`;

    // Seed active outreach sequence records
    await adminDb.collection("outreach").doc(outreach1).set({
      id: outreach1,
      contactId,
      status: "sent",
      step: 1,
      createdAt: Timestamp.now()
    });

    await adminDb.collection("outreach").doc(outreach2).set({
      id: outreach2,
      contactId,
      status: "approved",
      step: 2,
      createdAt: Timestamp.now()
    });

    // Seed active conversation
    await adminDb.collection("conversations").doc(convId).set({
      id: convId,
      contactId,
      status: "in_dialogue"
    });

    const result = await terminateProspectSequence({
      contactId,
      leadEmail: "prospect.meeting@target.fr",
      conversationId: convId,
      reason: "Meeting successfully scheduled"
    });

    expect(result.success).toBe(true);
    expect(result.outreachTerminated).toBe(2);
    expect(result.conversationsUpdated).toBeGreaterThanOrEqual(1);

    // Assert Outreach 1 is stopped
    const snap1 = await adminDb.collection("outreach").doc(outreach1).get();
    expect(snap1.data()?.status).toBe("meeting_booked");
    expect(snap1.data()?.stoppedAt).toBeDefined();

    // Assert Outreach 2 is stopped
    const snap2 = await adminDb.collection("outreach").doc(outreach2).get();
    expect(snap2.data()?.status).toBe("meeting_booked");
    expect(snap2.data()?.stoppedAt).toBeDefined();

    // Assert Conversation is updated
    const convSnap = await adminDb.collection("conversations").doc(convId).get();
    expect(convSnap.data()?.status).toBe("meeting_booked");
  });
});
