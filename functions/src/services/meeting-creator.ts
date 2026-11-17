import { Timestamp } from "firebase-admin/firestore";
import { adminDb } from "../config/firebase.js";
import { writeLog } from "../utils/logger.js";
import { getIntegrationSecrets } from "../utils/settings.js";
import { InstantlyProvider } from "../providers/email/instantly-provider.js";
import { getFreeBusyWindows, createCalendarEvent } from "./calendar-service.js";
import type { BookMeetingInput, BookMeetingResult, MeetingDoc } from "../types/domain.js";

export interface TerminateSequenceInput {
  contactId: string;
  leadEmail?: string;
  workspaceId?: string;
  businessId?: string;
  conversationId?: string;
  reason?: string;
}

export interface TerminateSequenceResult {
  success: boolean;
  outreachTerminated: number;
  conversationsUpdated: number;
  instantlySequenceStopped: boolean;
}

/**
 * Automatically terminates ongoing cold outreach sequences across Devcomm OS and Instantly (REQ-075).
 */
export async function terminateProspectSequence(
  input: TerminateSequenceInput
): Promise<TerminateSequenceResult> {
  const now = Timestamp.now();
  let outreachTerminated = 0;
  let conversationsUpdated = 0;
  let instantlySequenceStopped = false;

  // 1. Update all active outreach documents for this contact
  const outreachSnap = await adminDb
    .collection("outreach")
    .where("contactId", "==", input.contactId)
    .where("status", "in", ["draft", "approved", "sent", "replied", "exported", "queued_for_approval"])
    .get();

  for (const doc of outreachSnap.docs) {
    await doc.ref.set(
      {
        status: "meeting_booked",
        stoppedAt: now,
        rejectionReason: input.reason || "Meeting successfully booked",
        updatedAt: now
      },
      { merge: true }
    );
    outreachTerminated++;
  }

  // 2. Halt sequence in Instantly.ai if configured
  if (input.leadEmail) {
    try {
      const secrets = await getIntegrationSecrets();
      if (secrets.instantlyApiKey) {
        const provider = new InstantlyProvider(secrets.instantlyApiKey);
        instantlySequenceStopped = await provider.pauseLead(input.leadEmail);
      }
    } catch {
      // safe fallback
    }
  }

  // 3. Update Conversation status to meeting_booked
  if (input.conversationId) {
    await adminDb.collection("conversations").doc(input.conversationId).set(
      {
        status: "meeting_booked",
        unreadHumanAttention: false,
        updatedAt: now
      },
      { merge: true }
    );
    conversationsUpdated++;
  }

  // Also check if any other conversations exist for this contact
  const convsSnap = await adminDb
    .collection("conversations")
    .where("contactId", "==", input.contactId)
    .get();

  for (const doc of convsSnap.docs) {
    if (doc.id !== input.conversationId) {
      await doc.ref.set(
        {
          status: "meeting_booked",
          unreadHumanAttention: false,
          updatedAt: now
        },
        { merge: true }
      );
      conversationsUpdated++;
    }
  }

  await writeLog({
    type: "meeting.sequence_terminated",
    level: "info",
    message: `Outreach sequence terminated for contact ${input.contactId} (${input.leadEmail || "email unknown"}): ${outreachTerminated} outreach steps halted.`,
    metadata: {
      contactId: input.contactId,
      leadEmail: input.leadEmail,
      conversationId: input.conversationId,
      outreachTerminated,
      conversationsUpdated,
      instantlySequenceStopped
    }
  });

  return {
    success: true,
    outreachTerminated,
    conversationsUpdated,
    instantlySequenceStopped
  };
}

/**
 * Executes atomic conversational meeting booking with double-booking prevention and invite dispatch (REQ-074, REQ-075).
 */
export async function bookMeetingAtomically(
  input: BookMeetingInput
): Promise<BookMeetingResult> {
  const workspaceId = input.workspaceId || "ws_default";
  const timezone = input.timezone || "Europe/Paris";

  // No fallback business (ADR-016 #6). A meeting booked for nobody lands on no
  // one's Meetings screen and no one's calendar config: refuse, a person books.
  const businessId = input.businessId;
  if (!businessId) {
    return {
      success: false,
      error: "Cannot book a meeting for a conversation that is not attributed to any business."
    };
  }

  const startDate = new Date(input.startTime);
  const durationMinutes = input.durationMinutes || 30;
  const endDate = input.endTime
    ? new Date(input.endTime)
    : new Date(startDate.getTime() + durationMinutes * 60 * 1000);

  if (isNaN(startDate.getTime()) || isNaN(endDate.getTime())) {
    return {
      success: false,
      error: "Invalid start or end time specified for meeting."
    };
  }

  // 1. Double-booking check: verify real-time calendar availability (REQ-074, Invariant 6)
  const busyWindows = await getFreeBusyWindows({
    workspaceId,
    businessId,
    startDate: new Date(startDate.getTime() - 60 * 1000),
    endDate: new Date(endDate.getTime() + 60 * 1000),
    timezone
  });

  const hasConflict = busyWindows.some(
    (busy) => startDate < busy.end && endDate > busy.start
  );

  if (hasConflict) {
    await writeLog({
      type: "meeting.booking_conflict",
      level: "warning",
      message: `Conflict detected while attempting to book slot for ${input.prospectEmail} at ${startDate.toISOString()}`,
      metadata: {
        startTime: startDate.toISOString(),
        endTime: endDate.toISOString(),
        prospectEmail: input.prospectEmail
      }
    });

    return {
      success: false,
      conflict: true,
      error: "The requested time slot is no longer available."
    };
  }

  // 2. Dispatch calendar event creation via Microsoft Graph
  const title = input.title || `Échange Devcomm <> ${input.prospectName || input.prospectEmail}`;
  let eventResult: { id: string; webLink?: string; joinUrl?: string };

  try {
    eventResult = await createCalendarEvent({
      workspaceId,
      businessId,
      subject: title,
      startTime: startDate,
      endTime: endDate,
      timezone,
      attendees: [
        {
          email: input.prospectEmail,
          name: input.prospectName
        }
      ],
      isOnlineMeeting: true
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await writeLog({
      type: "meeting.calendar_event_error",
      level: "error",
      message: `Failed to create calendar event for ${input.prospectEmail}: ${message}`,
      metadata: { error: message }
    });

    return {
      success: false,
      error: `Failed to create calendar event: ${message}`
    };
  }

  const now = Timestamp.now();
  const meetingDocRef = adminDb.collection("meetings").doc();
  const meetingId = meetingDocRef.id;

  const meetingDoc: MeetingDoc = {
    id: meetingId,
    workspaceId,
    businessId,
    companyId: input.companyId,
    contactId: input.contactId,
    conversationId: input.conversationId,
    title,
    startTime: Timestamp.fromDate(startDate),
    endTime: Timestamp.fromDate(endDate),
    timezone,
    attendees: [input.prospectEmail],
    meetingUrl: eventResult.joinUrl || eventResult.webLink,
    location: eventResult.joinUrl ? "Teams Meeting" : "Visioconférence",
    source: "conversational",
    bookingSource: input.source || "conversational",
    status: "scheduled",
    outlookEventId: eventResult.id,
    calendarProvider: "microsoft_graph",
    notes: input.notes,
    createdAt: now,
    updatedAt: now
  };

  // 3. Atomically persist meeting record
  await meetingDocRef.set(meetingDoc);

  // 4. Update Company status
  if (input.companyId) {
    await adminDb.collection("companies").doc(input.companyId).set(
      {
        status: "meeting_booked",
        lastActivityAt: now,
        updatedAt: now
      },
      { merge: true }
    );
  }

  // 5. Update Contact status
  if (input.contactId) {
    await adminDb.collection("contacts").doc(input.contactId).set(
      {
        status: "meeting_booked",
        updatedAt: now
      },
      { merge: true }
    );
  }

  // 6. Terminate ongoing cold sequence for prospect
  let sequenceTerminated = false;
  if (input.contactId) {
    const termRes = await terminateProspectSequence({
      contactId: input.contactId,
      leadEmail: input.prospectEmail,
      workspaceId,
      businessId,
      conversationId: input.conversationId,
      reason: `Meeting booked: ${title}`
    });
    sequenceTerminated = termRes.success;
  }

  await writeLog({
    type: "meeting.booked",
    level: "info",
    message: `Meeting atomically booked for ${input.prospectEmail} at ${startDate.toISOString()} (Meeting ID: ${meetingId})`,
    metadata: {
      meetingId,
      outlookEventId: eventResult.id,
      prospectEmail: input.prospectEmail,
      startTime: startDate.toISOString(),
      endTime: endDate.toISOString(),
      companyId: input.companyId,
      contactId: input.contactId,
      conversationId: input.conversationId
    }
  });

  return {
    success: true,
    meetingId,
    outlookEventId: eventResult.id,
    meetingUrl: meetingDoc.meetingUrl,
    sequenceTerminated,
    meeting: meetingDoc
  };
}
