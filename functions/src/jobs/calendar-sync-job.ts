import { logger } from "firebase-functions";
import { Timestamp } from "firebase-admin/firestore";
import { adminDb } from "../config/firebase.js";
import { getGlobalSettings, getIntegrationSecrets } from "../utils/settings.js";
import { writeLog } from "../utils/logger.js";

export async function runCalendarSync(): Promise<void> {
  const [settings, secrets] = await Promise.all([getGlobalSettings(), getIntegrationSecrets()]);

  if (settings.automationPaused) {
    logger.info("[calendar-sync-job] Automation paused — skipping.");
    return;
  }

  if (!secrets.microsoftRefreshToken || !secrets.microsoftClientId || !secrets.microsoftClientSecret || !secrets.microsoftTenantId) {
    logger.info("[calendar-sync-job] Outlook not configured — skipping calendar sync.");
    await writeLog({
      type: "automation.calendar_sync",
      level: "info",
      message: "Outlook Calendar not configured. Connect your Outlook account in Settings > Calendar to enable meeting sync.",
      metadata: {}
    });
    return;
  }

  try {
    const accessToken = await refreshOutlookToken(secrets);

    const syncDocRef = adminDb.doc("settings/calendarSync");
    const syncDoc = await syncDocRef.get();
    const lastSync = syncDoc.exists && syncDoc.data()?.lastSyncAt instanceof Timestamp
      ? (syncDoc.data()!.lastSyncAt as Timestamp).toDate()
      : new Date(Date.now() - 2 * 60 * 60 * 1000);

    const now = new Date();
    const events = await listCalendarEvents(accessToken, lastSync, now, settings.outlookCalendarId);

    let created = 0;
    let updated = 0;
    let errors = 0;

    for (const event of events) {
      try {
        await syncMeetingFromOutlookEvent(event);
        if (event.isNew) created++;
        else updated++;
      } catch (error) {
        logger.warn(`[calendar-sync-job] Error syncing event ${event.id}: ${error instanceof Error ? error.message : error}`);
        errors++;
      }
    }

    await syncDocRef.set({ lastSyncAt: Timestamp.now() }, { merge: true });

    await writeLog({
      type: "automation.calendar_sync",
      level: "info",
      message: `Calendar sync completed. ${created} meetings created, ${updated} updated, ${errors} errors.`,
      metadata: { eventsFound: events.length, created, updated, errors }
    });

    logger.info(`[calendar-sync-job] Done. created=${created} updated=${updated} errors=${errors}`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error(`[calendar-sync-job] Fatal error: ${message}`);
    await writeLog({ type: "automation.calendar_sync", level: "error", message: `Calendar sync failed: ${message}`, metadata: {} });
  }
}

type OutlookEvent = {
  id: string;
  subject: string;
  start: { dateTime: string; timeZone: string };
  end: { dateTime: string; timeZone: string };
  attendees: Array<{ emailAddress: { address: string; name: string }; type: string }>;
  isNew?: boolean;
};

async function refreshOutlookToken(secrets: { microsoftTenantId?: string; microsoftClientId?: string; microsoftClientSecret?: string; microsoftRefreshToken?: string }): Promise<string> {
  const params = new URLSearchParams({
    grant_type: "refresh_token",
    client_id: secrets.microsoftClientId!,
    client_secret: secrets.microsoftClientSecret!,
    refresh_token: secrets.microsoftRefreshToken!,
    scope: "https://graph.microsoft.com/Calendars.Read offline_access"
  });

  const res = await fetch(`https://login.microsoftonline.com/${secrets.microsoftTenantId}/oauth2/v2.0/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: params.toString(),
    signal: AbortSignal.timeout(15000)
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Failed to refresh Outlook token: ${text}`);
  }

  const data = await res.json() as { access_token: string; refresh_token?: string };

  if (data.refresh_token) {
    await adminDb.doc("settings/integrationSecrets").set({ microsoftRefreshToken: data.refresh_token }, { merge: true });
  }

  return data.access_token;
}

async function listCalendarEvents(accessToken: string, start: Date, end: Date, calendarId?: string): Promise<OutlookEvent[]> {
  const startStr = start.toISOString();
  const endStr = end.toISOString();
  const base = calendarId && calendarId !== "primary"
    ? `https://graph.microsoft.com/v1.0/me/calendars/${calendarId}/calendarView`
    : "https://graph.microsoft.com/v1.0/me/calendarView";

  const url = `${base}?startDateTime=${encodeURIComponent(startStr)}&endDateTime=${encodeURIComponent(endStr)}&$select=id,subject,start,end,attendees&$top=50`;

  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
    signal: AbortSignal.timeout(15000)
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Graph API calendarView failed: ${text}`);
  }

  const data = await res.json() as { value: OutlookEvent[] };
  return data.value ?? [];
}

async function syncMeetingFromOutlookEvent(event: OutlookEvent): Promise<void> {
  const existing = await adminDb.collection("meetings").where("outlookEventId", "==", event.id).limit(1).get();

  const attendeeEmails = (event.attendees ?? [])
    .map((a) => a.emailAddress?.address?.toLowerCase())
    .filter(Boolean);

  let companyId: string | undefined;
  let contactId: string | undefined;

  for (const email of attendeeEmails) {
    const contactSnapshot = await adminDb.collection("contacts").where("email", "==", email).limit(1).get();
    if (!contactSnapshot.empty) {
      const contact = contactSnapshot.docs[0];
      contactId = contact.id;
      companyId = contact.data().companyId as string | undefined;
      break;
    }
  }

  const meetingData = {
    outlookEventId: event.id,
    title: event.subject ?? "Meeting",
    startTime: Timestamp.fromDate(new Date(event.start.dateTime)),
    endTime: Timestamp.fromDate(new Date(event.end.dateTime)),
    timezone: event.start.timeZone ?? "Europe/Paris",
    attendees: attendeeEmails,
    source: "outlook" as const,
    status: "scheduled" as const,
    companyId,
    contactId,
    updatedAt: Timestamp.now()
  };

  if (existing.empty) {
    await adminDb.collection("meetings").add({ ...meetingData, createdAt: Timestamp.now() });
    event.isNew = true;

    if (companyId) {
      await adminDb.collection("companies").doc(companyId).set(
        { status: "meeting_booked", lastActivityAt: Timestamp.now(), updatedAt: Timestamp.now() },
        { merge: true }
      );
    }

    if (contactId) {
      const outreachSnapshot = await adminDb
        .collection("outreach")
        .where("contactId", "==", contactId)
        .where("status", "in", ["sent", "replied", "exported"])
        .limit(1)
        .get();
      if (!outreachSnapshot.empty) {
        await outreachSnapshot.docs[0].ref.set({ status: "meeting_booked", updatedAt: Timestamp.now() }, { merge: true });
      }
    }
  } else {
    await existing.docs[0].ref.set(meetingData, { merge: true });
    event.isNew = false;
  }
}
