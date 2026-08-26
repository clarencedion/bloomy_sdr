import { describe, expect, it, vi } from "vitest";
import { processInstantlyWebhook } from "../../services/webhook-processor.js";
import { adminDb } from "../../config/firebase.js";

describe("Webhook Idempotency & Deduplication (REQ-061 & Invariant 7)", () => {
  it("should process unique event on first delivery and return duplicate on second delivery", async () => {
    const recordedEvents = new Map<string, any>();

    const mockDoc = vi.fn().mockImplementation((pathStr: string) => {
      if (pathStr.startsWith("webhookEvents/")) {
        const id = pathStr.replace("webhookEvents/", "");
        return {
          get: vi.fn().mockImplementation(() => {
            const exists = recordedEvents.has(id);
            return Promise.resolve({
              exists,
              data: () => recordedEvents.get(id)
            });
          }),
          set: vi.fn().mockImplementation((data: any) => {
            recordedEvents.set(id, { ...recordedEvents.get(id), ...data });
            return Promise.resolve();
          })
        };
      }
      if (pathStr.startsWith("conversations/")) {
        return {
          get: vi.fn().mockResolvedValue({ exists: false }),
          set: vi.fn().mockResolvedValue({}),
          collection: vi.fn().mockReturnValue({
            doc: vi.fn().mockReturnValue({ set: vi.fn().mockResolvedValue({}) })
          })
        };
      }
      return {
        get: vi.fn().mockResolvedValue({ exists: false }),
        set: vi.fn().mockResolvedValue({})
      };
    });

    vi.spyOn(adminDb, "doc").mockImplementation(mockDoc as any);
    vi.spyOn(adminDb, "collection").mockImplementation((col: string) => ({
      doc: (id?: string) => mockDoc(`${col}/${id || "id"}`),
      where: vi.fn().mockReturnValue({
        limit: vi.fn().mockReturnValue({
          get: vi.fn().mockResolvedValue({ empty: true, docs: [] })
        }),
        get: vi.fn().mockResolvedValue({ empty: true, docs: [] })
      }),
      add: vi.fn().mockResolvedValue({ id: "log_id" })
    } as any));

    const rawPayload = JSON.stringify({
      event_type: "reply_received",
      lead_email: "prospect@acme.com",
      reply_subject: "Intéressé",
      reply_text: "Parlons-en la semaine prochaine.",
      email_id: "unique_msg_id_99999"
    });

    // First delivery -> processed: true, duplicate: undefined
    const res1 = await processInstantlyWebhook(rawPayload, {});
    expect(res1.success).toBe(true);
    expect(res1.duplicate).toBeFalsy();
    expect(res1.eventId).toBe("unique_msg_id_99999");

    // Second delivery with identical event ID -> duplicate: true, no duplicate side-effects
    const res2 = await processInstantlyWebhook(rawPayload, {});
    expect(res2.success).toBe(true);
    expect(res2.duplicate).toBe(true);
    expect(res2.eventId).toBe("unique_msg_id_99999");

    vi.restoreAllMocks();
  });
});
