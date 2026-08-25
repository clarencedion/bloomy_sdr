# Phase 01 — Security and Compliance

## Objective
Lock down critical security vulnerabilities: isolate API secrets server-side, rewrite Firestore security rules to block client read access to secrets, enforce the canonical `canContact(...)` suppression gatekeeper, and secure webhook endpoints.

## Why this phase exists
Audit Finding #1 revealed that API keys (OpenAI, Anthropic, Dropcontact, Instantly, Microsoft Client Secrets) are stored in client-readable Firestore documents. Furthermore, suppressed contacts were not checked prior to email dispatch. These must be permanently resolved before building autonomous capabilities.

## Requirements covered
* **REQ-009**: Workspace Security Scoping
* **REQ-057**: Mandatory `canContact` Gatekeeper
* **REQ-060**: HMAC Webhook Signature Verification
* **REQ-061**: Inbound Event Idempotency

## Existing code to inspect
* `firestore.rules` (Line 39)
* `functions/src/utils/settings.ts` & `src/lib/firebase/firestore.ts`
* `src/features/settings/settings-page.tsx`
* `src/app/api/booking-webhook/route.ts`
* `functions/src/services/send-outreach.ts`

## Existing code to preserve
* Settings UI layout and configuration controls (update to use masked status booleans instead of raw client reads).

## Architecture
* Move third-party API keys to server-side Google Cloud Secret Manager / environment variables.
* Restrict `firestore.rules` so secret documents cannot be read by clients (`allow read, write: if false;`).
* Create `functions/src/services/can-contact.ts` to evaluate suppression, unsubscribe, bounced, domain blacklists, and daily rate limits.
* Add HMAC signature verification utility for webhooks.

## Data/schema changes
* Ensure `suppressionList` collection contains `targetType` ("email" | "domain" | "siren"), `targetValue`, `reason`, `createdAt`.

## Backend changes
* Implement `canContact(contactId, businessId): Promise<{ allowed: boolean; reason?: string }>`.
* Integrate `canContact` into `functions/src/services/send-outreach.ts` before calling Instantly API.
* Implement `functions/src/services/webhook-verifier.ts` for HMAC verification.

## Frontend changes
* Update `settings-page.tsx` to read integration status via a secure callable function `getIntegrationSecretsStatus()` that returns boolean flags (`{ openAiConfigured: true }`), never secret strings.

## External APIs
* None.

## Security considerations
* Verify that executing `getDoc(doc(db, "settings", "integrationSecrets"))` from the browser console is rejected with a Firestore Permission Denied error.

## Migration/backfill
* None.

## Tests to write FIRST or alongside implementation
* `tests/security/firestore-rules.test.ts`: Test that authenticated and unauthenticated client reads to `settings/aiSecrets` and `settings/integrationSecrets` are blocked.
* `tests/security/can-contact.test.ts`: Test that suppressed emails, suppressed domains, and contacts with `doNotContact: true` return `allowed: false`.
* `tests/security/webhook-hmac.test.ts`: Test that valid HMAC payloads pass and forged/unauthenticated payloads are rejected with HTTP 401.

## E2E scenarios
* Attempting to send outreach to a contact in `suppressionList` fails with a logged suppression error without invoking Instantly API.

## Definition of done
* [ ] Firestore rules updated and deployed to emulator/project.
* [ ] Client reads to secret documents blocked.
* [ ] `canContact` gatekeeper implemented and enforced.
* [ ] Webhook HMAC verification implemented.
* [ ] Tests pass; Reviewer verdict PASS.
* [ ] `ACCEPTANCE_MATRIX.md` updated for REQ-009, REQ-057, REQ-060, REQ-061.

## Reviewer checklist
* [ ] Can any client SDK read plaintext API keys?
* [ ] Is every outbound dispatch path protected by `canContact`?
* [ ] Are webhook replays rejected idempotently?

## Explicitly out of scope
* Multi-business UI switcher (deferred to Phase 02).
