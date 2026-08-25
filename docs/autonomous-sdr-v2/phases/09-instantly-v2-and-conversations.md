# Phase 09 — Instantly V2, Webhooks & Conversation Model

## Objective
Upgrade the Instantly.ai integration to the **V2 Webhook Architecture**, enforce the mandatory `canContact(...)` gatekeeper, ingest real-time inbound reply webhooks with HMAC signature verification, and maintain a persistent multi-message `conversations` and `messages` data model.

## Why this phase exists
Audit Finding #2 revealed that the legacy system polled Instantly hourly for a binary `replied: true` boolean without ingesting the reply email body. Building a conversational autonomous SDR requires real-time webhook ingestion of full email text and complete conversation thread persistence.

## Requirements covered
* **REQ-057**: Mandatory `canContact` Gatekeeper
* **REQ-058**: Instantly.ai V2 Sequence Dispatch
* **REQ-059**: Inbound Reply Webhook Receiver
* **REQ-060**: HMAC Webhook Signature Verification
* **REQ-061**: Inbound Event Idempotency
* **REQ-062**: Persistent Conversation Model

## Existing code to inspect
* `functions/src/providers/email/instantly-provider.ts`
* `functions/src/services/send-outreach.ts`
* `functions/src/jobs/hourly-outreach-sync.ts`
* `src/features/outreach/outreach-page.tsx`

## Existing code to preserve
* Instantly campaign creation and lead addition logic (`/campaign/create`, `/lead/add`).

## Architecture
* **Outbound Dispatch:** Before calling `/lead/add`, `sendApprovedOutreach` invokes `canContact(contactId, businessId)`. If blocked, the lead is skipped and logged. Custom variables (`custom_subject`, `custom_body`, `custom_followUp1`, `custom_followUp2`, `custom_pdfUrl`) are passed to Instantly.
* **Inbound Webhook Receiver:** Implement `POST /api/webhooks/instantly` receiving events (`reply_received`, `bounced`, `unsubscribed`).
* **Security & Idempotency:** The webhook handler verifies `X-Instantly-Signature` against the configured secret and checks `event_id` against `webhookEvents` collection to reject replays.
* **Conversation Store:** Creates or updates `conversations/{conversationId}` and appends `messages/{messageId}` with `direction: "inbound"`, sender, recipient, subject, bodyText, and timestamps.

## Data/schema changes
* Create collections:
  * `conversations/{conversationId}`
  * `conversations/{conversationId}/messages/{messageId}`
  * `webhookEvents/{eventId}`

## Backend changes
* Implement `src/app/api/webhooks/instantly/route.ts`.
* Implement `functions/src/services/webhook-processor.ts`.
* Implement `functions/src/services/conversation-service.ts`.
* Update `functions/src/services/send-outreach.ts` to initialize conversation documents.
* Retain `functions/src/jobs/hourly-outreach-sync.ts` as a fallback reconciliation worker.

## Frontend changes
* Display conversation status and message count on Outreach and Company Detail views.

## External APIs
* Instantly.ai REST API v1/v2 & Inbound Webhooks.

## Security considerations
* Verify HMAC webhook signatures.
* Sanitize inbound email body HTML to prevent XSS.

## Migration/backfill
* Backfill existing `outreach` documents with status `"sent"` into `conversations`.

## Tests to write FIRST or alongside implementation
* `tests/email/can-contact-gate.test.ts`: Test that attempting to send to a suppressed email throws an error and does not invoke Instantly API.
* `tests/email/instantly-webhook.test.ts`: Test that receiving a valid `reply_received` webhook creates a conversation and appends an inbound message with the prospect's email text.
* `tests/email/webhook-hmac.test.ts`: Test that webhooks with missing or invalid signatures return HTTP 401.
* `tests/email/webhook-idempotency.test.ts`: Test that sending the same webhook event ID twice creates exactly one message document.

## E2E scenarios
* Dispatch an approved outreach draft to Instantly; simulate an incoming reply webhook; verify that Firestore contains an updated `conversation` with the full message body text.

## Definition of done
* [ ] Instantly sequence dispatch protected by `canContact`.
* [ ] Inbound reply webhook operational with HMAC verification and idempotency.
* [ ] Multi-message conversation model implemented and persisted.
* [ ] Tests pass; Reviewer verdict PASS.
* [ ] `ACCEPTANCE_MATRIX.md` updated for REQ-057 through REQ-062.

## Reviewer checklist
* [ ] Is every outbound send verified against suppression?
* [ ] Are forged webhook requests rejected?
* [ ] Is the full body text of the prospect's reply stored in Firestore?

## Explicitly out of scope
* LLM reply intent classification (deferred to Phase 10).
