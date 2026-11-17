import { logger } from "firebase-functions";
import { adminDb } from "../config/firebase.js";
import { getGlobalSettings, getIntegrationSecrets, type IntegrationSecrets } from "../utils/settings.js";
import { getCalendarConfig } from "./business-service.js";
import { writeLog } from "../utils/logger.js";
import type { TimeSlot, BusyWindow, BusinessDoc } from "../types/domain.js";

// Global in-memory test mocks for deterministic unit & integration tests
let mockBusyWindows: BusyWindow[] | null = null;
let mockEventCreationHandler: ((event: Record<string, unknown>) => Promise<{ id: string; webLink?: string; joinUrl?: string }>) | null = null;

export function setMockBusyWindows(windows: BusyWindow[] | null): void {
  mockBusyWindows = windows;
}

export function setMockEventCreationHandler(
  handler: ((event: Record<string, unknown>) => Promise<{ id: string; webLink?: string; joinUrl?: string }>) | null
): void {
  mockEventCreationHandler = handler;
}

export function resetCalendarMocks(): void {
  mockBusyWindows = null;
  mockEventCreationHandler = null;
}

export interface GetFreeBusyInput {
  workspaceId?: string;
  businessId?: string;
  startDate: Date;
  endDate: Date;
  timezone?: string;
}

export interface GetAvailableSlotsInput {
  workspaceId?: string;
  businessId?: string;
  startDate?: Date;
  endDate?: Date;
  slotDurationMinutes?: number;
  limit?: number;
  preferredDay?: number; // 0=Sunday, 1=Monday, 2=Tuesday, 3=Wednesday, 4=Thursday, 5=Friday, 6=Saturday
  preferredTimeOfDay?: "morning" | "afternoon" | "any";
  timezone?: string;
  minLeadHours?: number;
}

export interface CreateCalendarEventInput {
  workspaceId?: string;
  businessId?: string;
  subject: string;
  bodyHtml?: string;
  startTime: Date;
  endTime: Date;
  timezone?: string;
  attendees: Array<{ email: string; name?: string }>;
  isOnlineMeeting?: boolean;
}

export interface CalendarEventResult {
  id: string;
  webLink?: string;
  joinUrl?: string;
  subject: string;
  startTime: Date;
  endTime: Date;
  timezone: string;
  attendees: string[];
}

/**
 * Refreshes Microsoft Graph OAuth2 access token
 */
export async function refreshOutlookToken(secrets: IntegrationSecrets): Promise<string> {
  if (!secrets.microsoftClientId || !secrets.microsoftClientSecret || !secrets.microsoftRefreshToken || !secrets.microsoftTenantId) {
    throw new Error("Microsoft Graph credentials incomplete. Missing Client ID, Secret, Tenant ID or Refresh Token.");
  }

  const params = new URLSearchParams({
    grant_type: "refresh_token",
    client_id: secrets.microsoftClientId,
    client_secret: secrets.microsoftClientSecret,
    refresh_token: secrets.microsoftRefreshToken,
    scope: "https://graph.microsoft.com/Calendars.ReadWrite offline_access"
  });

  const res = await fetch(`https://login.microsoftonline.com/${secrets.microsoftTenantId}/oauth2/v2.0/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: params.toString(),
    signal: AbortSignal.timeout(15000)
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Failed to refresh Outlook token (${res.status}): ${text}`);
  }

  const data = (await res.json()) as { access_token: string; refresh_token?: string };

  if (data.refresh_token) {
    await adminDb.doc("settings/integrationSecrets").set({ microsoftRefreshToken: data.refresh_token }, { merge: true });
  }

  return data.access_token;
}

/**
 * Queries real calendar free/busy windows from Microsoft Graph (REQ-071).
 */
export async function getFreeBusyWindows(input: GetFreeBusyInput): Promise<BusyWindow[]> {
  if (mockBusyWindows !== null) {
    return mockBusyWindows.filter(
      (w) => w.end > input.startDate && w.start < input.endDate
    );
  }

  const [settings, secrets] = await Promise.all([getGlobalSettings(), getIntegrationSecrets()]);

  // If Outlook is not configured, check if we have stored business or settings fallback
  if (!secrets.microsoftRefreshToken || !secrets.microsoftClientId) {
    logger.info("[calendar-service] Microsoft Graph not configured. Returning empty busy windows.");
    return [];
  }

  try {
    const accessToken = await refreshOutlookToken(secrets);
    const calendarId = settings.outlookCalendarId;
    const startStr = input.startDate.toISOString();
    const endStr = input.endDate.toISOString();

    const base = calendarId && calendarId !== "primary"
      ? `https://graph.microsoft.com/v1.0/me/calendars/${calendarId}/calendarView`
      : "https://graph.microsoft.com/v1.0/me/calendarView";

    const url = `${base}?startDateTime=${encodeURIComponent(startStr)}&endDateTime=${encodeURIComponent(endStr)}&$select=id,subject,start,end,showAs&$top=100`;

    const res = await fetch(url, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Prefer: `outlook.timezone="${input.timezone || "Europe/Paris"}"`
      },
      signal: AbortSignal.timeout(15000)
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Microsoft Graph calendarView query failed (${res.status}): ${text}`);
    }

    const data = (await res.json()) as {
      value: Array<{
        id: string;
        subject?: string;
        start: { dateTime: string; timeZone: string };
        end: { dateTime: string; timeZone: string };
        showAs?: string;
      }>;
    };

    const busyEvents = (data.value || []).filter(
      (e) => !e.showAs || e.showAs.toLowerCase() !== "free"
    );

    return busyEvents.map((e) => ({
      start: new Date(e.start.dateTime.endsWith("Z") ? e.start.dateTime : `${e.start.dateTime}Z`),
      end: new Date(e.end.dateTime.endsWith("Z") ? e.end.dateTime : `${e.end.dateTime}Z`),
      subject: e.subject
    }));
  } catch (error) {
    logger.warn(`[calendar-service] getFreeBusyWindows failed: ${error instanceof Error ? error.message : error}`);
    await writeLog({
      type: "calendar.freebusy_error",
      level: "warning",
      message: `Failed to query calendar free/busy: ${error instanceof Error ? error.message : String(error)}`,
      metadata: { error: String(error) }
    });
    return [];
  }
}

/**
 * Formats a Date object into polite, localized French string (e.g. "Jeudi 27 août à 14h30")
 */
export function formatSlotFrench(date: Date, timezone = "Europe/Paris"): string {
  try {
    const formatterDate = new Intl.DateTimeFormat("fr-FR", {
      weekday: "long",
      day: "numeric",
      month: "long",
      timeZone: timezone
    });
    const formatterTime = new Intl.DateTimeFormat("fr-FR", {
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
      timeZone: timezone
    });

    const datePart = formatterDate.format(date);
    const capitalizedDate = datePart.charAt(0).toUpperCase() + datePart.slice(1);
    const timePart = formatterTime.format(date).replace(":", "h");

    return `${capitalizedDate} à ${timePart}`;
  } catch {
    return date.toISOString();
  }
}

/**
 * Computes verified, conflict-free open time slots within configured business working hours (REQ-071, REQ-073).
 */
export async function getAvailableSlots(input: GetAvailableSlotsInput = {}): Promise<TimeSlot[]> {
  const workspaceId = input.workspaceId || "ws_default";
  // No fallback business: without one there is no business calendar config,
  // so the defaults below apply — never another business's hours.
  const businessId = input.businessId;
  const slotDurationMinutes = input.slotDurationMinutes || 30;
  const limit = input.limit || 5;
  const minLeadHours = input.minLeadHours ?? 2;

  // Retrieve Business calendar configuration
  let config: BusinessDoc["calendarConfig"] | null = null;
  try {
    config = businessId ? await getCalendarConfig(workspaceId, businessId) : null;
  } catch {
    // safe fallback
  }

  const timezone = input.timezone || config?.timezone || "Europe/Paris";
  const workingDays = config?.workingDays || [1, 2, 3, 4, 5]; // Mon-Fri
  const workingHours = config?.workingHours || { start: "09:00", end: "18:00" };

  const [startHour, startMin] = workingHours.start.split(":").map(Number);
  const [endHour, endMin] = workingHours.end.split(":").map(Number);

  const now = new Date();
  const earliestAllowed = new Date(now.getTime() + minLeadHours * 60 * 60 * 1000);

  const startDate = input.startDate && input.startDate > earliestAllowed
    ? input.startDate
    : earliestAllowed;

  // Search ahead up to 14 days by default
  const endDate = input.endDate || new Date(startDate.getTime() + 14 * 24 * 60 * 60 * 1000);

  // 1. Retrieve all busy windows for this entire period
  const busyWindows = await getFreeBusyWindows({
    workspaceId,
    businessId,
    startDate,
    endDate,
    timezone
  });

  const availableSlots: TimeSlot[] = [];

  // Iterate day-by-day
  const currentDay = new Date(startDate);
  currentDay.setMinutes(0, 0, 0);

  while (currentDay < endDate && availableSlots.length < limit) {
    const dayOfWeek = currentDay.getDay(); // 0 = Sun, 1 = Mon ... 6 = Sat

    // Check if day is a working day and matches preferred day (if specified)
    const isWorkingDay = workingDays.includes(dayOfWeek);
    const matchesPreferredDay = input.preferredDay === undefined || dayOfWeek === input.preferredDay;

    if (isWorkingDay && matchesPreferredDay) {
      // Build slots for this day
      const dayStart = new Date(currentDay);
      dayStart.setHours(startHour, startMin, 0, 0);

      const dayEnd = new Date(currentDay);
      dayEnd.setHours(endHour, endMin, 0, 0);

      let slotStart = new Date(dayStart);

      while (slotStart.getTime() + slotDurationMinutes * 60 * 1000 <= dayEnd.getTime() && availableSlots.length < limit) {
        const slotEnd = new Date(slotStart.getTime() + slotDurationMinutes * 60 * 1000);

        // Check if in the future
        if (slotStart >= earliestAllowed) {
          const slotHour = slotStart.getHours();

          // Time of day filter
          let matchesTimeOfDay = true;
          if (input.preferredTimeOfDay === "morning") {
            matchesTimeOfDay = slotHour < 12;
          } else if (input.preferredTimeOfDay === "afternoon") {
            matchesTimeOfDay = slotHour >= 13;
          }

          if (matchesTimeOfDay) {
            // Check for collision with any busy window
            const hasConflict = busyWindows.some((busy) => {
              return slotStart < busy.end && slotEnd > busy.start;
            });

            if (!hasConflict) {
              availableSlots.push({
                start: slotStart.toISOString(),
                end: slotEnd.toISOString(),
                durationMinutes: slotDurationMinutes,
                formattedFr: formatSlotFrench(slotStart, timezone)
              });
            }
          }
        }

        // Increment by slot duration (or 30 mins)
        slotStart = new Date(slotStart.getTime() + slotDurationMinutes * 60 * 1000);
      }
    }

    // Advance to next day
    currentDay.setDate(currentDay.getDate() + 1);
    currentDay.setHours(0, 0, 0, 0);
  }

  return availableSlots;
}

/**
 * Creates a meeting event in Microsoft Graph and sends Outlook calendar invite (REQ-074).
 */
export async function createCalendarEvent(input: CreateCalendarEventInput): Promise<CalendarEventResult> {
  const timezone = input.timezone || "Europe/Paris";

  if (mockEventCreationHandler) {
    const mockRes = await mockEventCreationHandler({
      subject: input.subject,
      startTime: input.startTime,
      endTime: input.endTime,
      attendees: input.attendees
    });
    return {
      id: mockRes.id,
      webLink: mockRes.webLink || "https://outlook.office.com/calendar/item/mock",
      joinUrl: mockRes.joinUrl || "https://teams.microsoft.com/l/meetup-join/mock",
      subject: input.subject,
      startTime: input.startTime,
      endTime: input.endTime,
      timezone,
      attendees: input.attendees.map((a) => a.email)
    };
  }

  const secrets = await getIntegrationSecrets();

  if (!secrets.microsoftRefreshToken || !secrets.microsoftClientId) {
    // In unconfigured or offline environments, generate synthetic event ID
    const syntheticId = `evt_offline_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    logger.info(`[calendar-service] Microsoft Graph not connected. Generated synthetic event: ${syntheticId}`);
    return {
      id: syntheticId,
      webLink: undefined,
      joinUrl: undefined,
      subject: input.subject,
      startTime: input.startTime,
      endTime: input.endTime,
      timezone,
      attendees: input.attendees.map((a) => a.email)
    };
  }

  const accessToken = await refreshOutlookToken(secrets);

  const eventPayload = {
    subject: input.subject,
    body: {
      contentType: "HTML",
      content: input.bodyHtml || `<p>Échange avec ${input.attendees.map((a) => a.name || a.email).join(", ")}</p>`
    },
    start: {
      dateTime: input.startTime.toISOString(),
      timeZone: timezone
    },
    end: {
      endTime: input.endTime.toISOString(),
      dateTime: input.endTime.toISOString(),
      timeZone: timezone
    },
    attendees: input.attendees.map((a) => ({
      emailAddress: {
        address: a.email,
        name: a.name || a.email
      },
      type: "required"
    })),
    isOnlineMeeting: input.isOnlineMeeting ?? true,
    onlineMeetingProvider: "teamsForBusiness"
  };

  const res = await fetch("https://graph.microsoft.com/v1.0/me/events", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(eventPayload),
    signal: AbortSignal.timeout(15000)
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Microsoft Graph createEvent failed (${res.status}): ${text}`);
  }

  const data = (await res.json()) as {
    id: string;
    webLink?: string;
    onlineMeeting?: { joinUrl?: string };
  };

  return {
    id: data.id,
    webLink: data.webLink,
    joinUrl: data.onlineMeeting?.joinUrl,
    subject: input.subject,
    startTime: input.startTime,
    endTime: input.endTime,
    timezone,
    attendees: input.attendees.map((a) => a.email)
  };
}

/**
 * Cancels a scheduled calendar event (REQ-074).
 */
export async function cancelCalendarEvent(eventId: string, comment = "Meeting cancelled"): Promise<void> {
  if (mockEventCreationHandler || eventId.startsWith("evt_offline_") || eventId.startsWith("mock_")) {
    return;
  }

  const secrets = await getIntegrationSecrets();
  if (!secrets.microsoftRefreshToken || !secrets.microsoftClientId) return;

  try {
    const accessToken = await refreshOutlookToken(secrets);
    await fetch(`https://graph.microsoft.com/v1.0/me/events/${eventId}/cancel`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ Comment: comment }),
      signal: AbortSignal.timeout(15000)
    });
  } catch (error) {
    logger.warn(`[calendar-service] Error cancelling event ${eventId}: ${error instanceof Error ? error.message : error}`);
  }
}
