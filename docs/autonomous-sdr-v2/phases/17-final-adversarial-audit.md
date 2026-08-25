# Phase 17 — Final Adversarial Security & Invariant Audit

## Objective
Execute a comprehensive adversarial test suite to attempt to break the platform: test prompt injection attacks, secret leakage attempts, cross-tenant isolation, suppression bypass checks, duplicate sends, webhook replays, and hallucinated calendar slot attempts.

## Why this phase exists
To ensure the system is completely robust, secure, and production-ready before real-world deployment, with zero unverified assumptions.

## Requirements covered
* Final adversarial sign-off for REQ-001 through REQ-080.

## Existing code to inspect
* Entire repository (`src/`, `functions/src/`, `firestore.rules`).

## Existing code to preserve
* All completed phase implementations.

## Architecture
* **Adversarial Test Suite:**
  1. **Prompt Injection Attack Suite:** Injects malicious prompt payloads in prospect website HTML and incoming emails; asserts that LLM output is not hijacked and no tools are executed.
  2. **Secret Leakage Audit:** Attempts client SDK queries against secret documents; asserts Firestore permission denied.
  3. **Cross-Tenant Attack:** Attempts reading/writing Business A data using Business B user credentials; asserts permission denied.
  4. **Suppression Bypass Attack:** Attempts concurrent rapid sends to suppressed/unsubscribed contacts; asserts 100% blocked rate.
  5. **Webhook Replay Attack:** Sends 100 duplicate webhook payloads; asserts exactly 1 message created.
  6. **Calendar Hallucination Attack:** Requests slots during known busy hours; asserts that no busy slots are proposed.
  7. **Claim Validation Audit:** Injects synthetic ungrounded copy drafts; asserts that 100% of unverified claims are caught by `validateOutreachClaims`.

## Data/schema changes
* None.

## Backend changes
* Implement any required defensive patches identified during adversarial tests.

## Frontend changes
* None.

## External APIs
* None.

## Security considerations
* Complete security sign-off across all OWASP Top 10 for LLM applications.

## Migration/backfill
* None.

## Tests to write FIRST or alongside implementation
* `tests/adversarial/prompt-injection.test.ts`
* `tests/adversarial/secret-leakage.test.ts`
* `tests/adversarial/cross-tenant-isolation.test.ts`
* `tests/adversarial/suppression-bypass.test.ts`
* `tests/adversarial/webhook-replay.test.ts`
* `tests/adversarial/calendar-hallucination.test.ts`
* `tests/adversarial/claim-hallucination.test.ts`

## E2E scenarios
* Full adversarial test suite execution passes with 0 security findings.

## Definition of done
* [ ] All adversarial test suites pass.
* [ ] Zero critical or high security findings.
* [ ] Zero cross-tenant data leaks.
* [ ] Zero unsupported outreach claims allowed through.
* [ ] Independent SDR Reviewer issues final verdict `PASS`.
* [ ] `ACCEPTANCE_MATRIX.md` marked 100% `PASS`.
* [ ] Project ready for production release.

## Reviewer checklist
* [ ] Did all 80 requirements achieve verified PASS status?
* [ ] Were all adversarial attack tests executed and passed?
* [ ] Is the codebase cleanly documented and maintainable?

## Explicitly out of scope
* Speculative feature additions.
