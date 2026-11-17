import { describe, expect, it, vi } from "vitest";
import { processInstantlyWebhook } from "../../services/webhook-processor.js";
import { sanitizeHtml, htmlToPlainText } from "../../services/html-sanitizer.js";
import { adminDb } from "../../config/firebase.js";

describe("Instantly Webhook Receiver & Reply Ingestion (REQ-059, REQ-062 & Security)", () => {
  it("should process reply_received event, sanitize HTML, update conversation and messages", async () => {
    let savedConvData: any = null;
    let savedMsgData: any = null;
    let savedOutreachData: any = null;
    let savedCompanyData: any = null;

    const mockDoc = vi.fn().mockImplementation((pathStr: string) => {
      if (pathStr.startsWith("webhookEvents/")) {
        return {
          get: vi.fn().mockResolvedValue({ exists: false }),
          set: vi.fn().mockResolvedValue({})
        };
      }
      if (pathStr.startsWith("conversations/conv_comp_999_cont_888")) {
        return {
          get: vi.fn().mockResolvedValue({
            exists: true,
            data: () => ({
              id: "conv_comp_999_cont_888",
              companyId: "comp_999",
              contactId: "cont_888",
              status: "sequence_active",
              messageCount: 1
            })
          }),
          set: vi.fn().mockImplementation((data: any) => {
            savedConvData = { ...(savedConvData || {}), ...data };
            return Promise.resolve();
          }),
          collection: vi.fn().mockReturnValue({
            doc: vi.fn().mockReturnValue({
              set: vi.fn().mockImplementation((data: any) => {
                savedMsgData = { ...(savedMsgData || {}), ...data };
                return Promise.resolve();
              })
            })
          })
        };
      }
      if (pathStr === "companies/comp_999") {
        return {
          get: vi.fn().mockResolvedValue({ exists: true, id: "comp_999", data: () => ({ name: "Alpha Corp" }) }),
          set: vi.fn().mockImplementation((data: any) => {
            savedCompanyData = { ...(savedCompanyData || {}), ...data };
            return Promise.resolve();
          })
        };
      }
      return {
        get: vi.fn().mockResolvedValue({ exists: false }),
        set: vi.fn().mockResolvedValue({})
      };
    });

    const mockOutreachRef = {
      set: vi.fn().mockImplementation((data: any) => {
        savedOutreachData = { ...(savedOutreachData || {}), ...data };
        return Promise.resolve();
      })
    };

    vi.spyOn(adminDb, "doc").mockImplementation(mockDoc as any);
    vi.spyOn(adminDb, "collection").mockImplementation((col: string) => {
      if (col === "contacts") {
        return {
          where: vi.fn().mockReturnValue({
            limit: vi.fn().mockReturnValue({
              get: vi.fn().mockResolvedValue({
                empty: false,
                docs: [{
                  id: "cont_888",
                  data: () => ({
                    id: "cont_888",
                    companyId: "comp_999",
                    // Attributed like every SDR contact. Phase 19: an
                    // unattributed reply is escalated to a person instead of
                    // being answered as a default business.
                    workspaceId: "ws_default",
                    businessId: "biz_devcomm",
                    email: "jean.dupont@alphacorp.fr",
                    normalizedEmail: "jean.dupont@alphacorp.fr"
                  })
                }]
              })
            }),
            get: vi.fn().mockResolvedValue({ empty: true, docs: [] })
          }),
          doc: (id?: string) => mockDoc(`${col}/${id || "id"}`),
          add: vi.fn().mockResolvedValue({ id: "added_id" })
        } as any;
      }
      if (col === "conversations") {
        return {
          doc: (id?: string) => mockDoc(`conversations/${id || "id"}`),
          where: vi.fn().mockReturnValue({
            get: vi.fn().mockResolvedValue({ empty: true, docs: [] })
          })
        } as any;
      }
      if (col === "outreach") {
        return {
          where: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({
              get: vi.fn().mockResolvedValue({
                empty: false,
                docs: [{
                  id: "outreach_111",
                  ref: mockOutreachRef,
                  data: () => ({ id: "outreach_111", status: "sent" })
                }]
              })
            })
          })
        } as any;
      }
      if (col === "companies") {
        return {
          doc: (id?: string) => mockDoc(`companies/${id || "id"}`),
          where: vi.fn().mockReturnValue({
            limit: vi.fn().mockReturnValue({
              get: vi.fn().mockResolvedValue({ empty: true, docs: [] })
            })
          })
        } as any;
      }
      return {
        doc: (id?: string) => mockDoc(`${col}/${id || "id"}`),
        where: vi.fn().mockReturnValue({
          get: vi.fn().mockResolvedValue({ empty: true, docs: [] })
        }),
        add: vi.fn().mockResolvedValue({ id: "log_id" })
      } as any;
    });

    const rawPayload = JSON.stringify({
      event_type: "reply_received",
      lead_email: "jean.dupont@alphacorp.fr",
      reply_subject: "Re: Proposition Audit",
      reply_text: "Bonjour, je suis disponible jeudi à 14h pour en parler.",
      reply_html: "<p>Bonjour, je suis disponible jeudi à 14h pour en parler.<script>alert('pwned')</script></p>",
      email_id: "msg_instantly_xyz_123",
      campaign_id: "camp_999"
    });

    const result = await processInstantlyWebhook(rawPayload, {});

    expect(result.success).toBe(true);
    expect(result.statusCode).toBe(200);
    expect(result.eventType).toBe("reply_received");

    // 1. Verify Conversation status updated to in_dialogue
    expect(savedConvData).toBeDefined();
    expect(savedConvData.status).toBe("in_dialogue");
    expect(savedConvData.unreadHumanAttention).toBe(true);
    expect(savedConvData.messageCount).toBe(2);
    expect(savedConvData.latestIntent).toBe("BOOKING_REQUEST");

    // 2. Verify Inbound Message saved with sanitized HTML
    expect(savedMsgData).toBeDefined();
    expect(savedMsgData.direction).toBe("inbound");
    expect(savedMsgData.senderEmail).toBe("jean.dupont@alphacorp.fr");
    expect(savedMsgData.subject).toBe("Re: Proposition Audit");
    expect(savedMsgData.bodyText).toBe("Bonjour, je suis disponible jeudi à 14h pour en parler.");
    expect(savedMsgData.bodyHtml).not.toContain("<script>");
    expect(savedMsgData.bodyHtml).toContain("<p>Bonjour, je suis disponible jeudi à 14h pour en parler.</p>");

    // 3. Verify Outreach and Company updated to replied
    expect(savedOutreachData.status).toBe("replied");
    expect(savedCompanyData.status).toBe("replied");

    vi.restoreAllMocks();
  });

  it("should process lead_bounced event and write to suppressionList", async () => {
    let savedSuppression: any = null;

    const mockDoc = vi.fn().mockImplementation((pathStr: string) => {
      if (pathStr.startsWith("webhookEvents/")) {
        return {
          get: vi.fn().mockResolvedValue({ exists: false }),
          set: vi.fn().mockResolvedValue({})
        };
      }
      if (pathStr.startsWith("suppressionList/")) {
        return {
          set: vi.fn().mockImplementation((data: any) => {
            savedSuppression = data;
            return Promise.resolve();
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
        get: vi.fn().mockResolvedValue({ empty: true, docs: [] })
      }),
      add: vi.fn().mockResolvedValue({ id: "log_id" })
    } as any));

    const rawPayload = JSON.stringify({
      event_type: "lead_bounced",
      lead_email: "bounced.contact@dead-domain.fr",
      reason: "550 Mailbox does not exist",
      email_id: "bounce_evt_001"
    });

    const result = await processInstantlyWebhook(rawPayload, {});

    expect(result.success).toBe(true);
    expect(result.statusCode).toBe(200);
    expect(savedSuppression).toBeDefined();
    expect(savedSuppression.targetValue).toBe("bounced.contact@dead-domain.fr");
    expect(savedSuppression.reason).toBe("bounce");

    vi.restoreAllMocks();
  });

  it("should properly sanitize malicious HTML and convert to plain text", () => {
    const dirty = `<div onclick="evil()">Hello <script src="bad.js">alert(1)</script> <a href="javascript:alert(2)">Click</a><iframe src="malware.com"></iframe></div>`;
    const clean = sanitizeHtml(dirty);
    expect(clean).not.toContain("script");
    expect(clean).not.toContain("onclick");
    expect(clean).not.toContain("javascript:");
    expect(clean).not.toContain("iframe");

    const plain = htmlToPlainText("<p>Line 1</p><br/><p>Line 2 &amp; special &lt;chars&gt;</p>");
    expect(plain).toContain("Line 1");
    expect(plain).toContain("Line 2 & special <chars>");
  });
});
