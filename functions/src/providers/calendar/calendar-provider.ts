export type CalendarEvent = {
  id: string;
  title: string;
  startTime: string;
  endTime: string;
  attendees?: string[];
};

export interface CalendarProvider {
  listEvents(start: Date, end: Date): Promise<CalendarEvent[]>;
  createEvent(input: Omit<CalendarEvent, "id">): Promise<CalendarEvent>;
  updateEvent(eventId: string, input: Partial<CalendarEvent>): Promise<CalendarEvent>;
  deleteEvent(eventId: string): Promise<void>;
  handleWebhook(payload: unknown): Promise<void>;
}
