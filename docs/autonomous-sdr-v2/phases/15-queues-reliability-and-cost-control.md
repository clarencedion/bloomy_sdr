# Phase 15 — Cloud Task Queues, Reliability & Cost Control

## Objective
Decouple heavy synchronous batch loops into asynchronous, retry-safe **Cloud Task Queues**, enforce bounded execution windows, implement exponential backoff retries, and provide centralized API cost tracking and budget caps.

## Why this phase exists
Audit Finding #7 revealed that background cron jobs processed companies in sequential `for..of` loops. As campaigns scale, a single timeout or rate limit could stall an entire batch. Queue-based execution ensures true production reliability and bounded costs.

## Requirements covered
* **REQ-080**: Cloud Task Queue Decoupling
* **REQ-024**: Signal Cost Tracking & Budget Guardrails

## Existing code to inspect
* `functions/src/jobs/daily-research-runner.ts`
* `functions/src/services/run-discovery-campaign.ts`
* `functions/src/index.ts`

## Existing code to preserve
* Scheduled triggers; adapt them to enqueue discrete tasks rather than executing synchronous monolithic loops.

## Architecture
* Implement `TaskQueueWorker` leveraging Google Cloud Tasks (or Firestore-backed job queue for local emulator compatibility).
* Discrete Task Types:
  * `TASK_DISCOVER_PAGE`
  * `TASK_COLLECT_SIGNALS`
  * `TASK_SCORE_OPPORTUNITY`
  * `TASK_ENRICH_CONTACTS`
  * `TASK_GENERATE_OUTREACH`
  * `TASK_DISPATCH_EMAIL`
* Every task execution is bounded (max 60s), idempotent, and automatically retried up to 3 times with exponential backoff on transient errors (HTTP 429, 503).
* Centralized `CostGuardrailService` tracks daily spend across OpenAI, Anthropic, Serper, and Dropcontact, automatically pausing heavy discovery if daily budget caps are reached.

## Data/schema changes
* Create `jobQueue/{jobId}` collection for queue management and dead-letter tracking.
* Extend `settings/global` with `dailySpendBudgetUsd`, `monthlySpendBudgetUsd`.

## Backend changes
* Implement `functions/src/jobs/task-queue-worker.ts`.
* Implement `functions/src/services/cost-guardrail-service.ts`.
* Refactor scheduled runners (`scheduledLeadDiscoveryRunner`, `dailyResearchQueueRunner`) to dispatch bounded task chunks.

## Frontend changes
* Display real-time queue health (pending jobs, running jobs, failed jobs, daily API cost) in Settings and Logs views.

## External APIs
* Google Cloud Tasks API.

## Security considerations
* Cloud Task webhook worker endpoints must verify Cloud Tasks authorization headers or OIDC tokens.

## Migration/backfill
* Seamless migration: Existing campaigns continue running with queue-backed execution.

## Tests to write FIRST or alongside implementation
* `tests/reliability/task-queue.test.ts`: Test enqueuing tasks, processing discrete company jobs, and capturing task status.
* `tests/reliability/retry-backoff.test.ts`: Test that a transient 429 error triggers exponential retry without failing the overall campaign.
* `tests/reliability/cost-guardrail.test.ts`: Test that exceeding the configured daily spend cap halts task dispatch and logs a warning.

## E2E scenarios
* Enqueue a batch of 50 companies; verify tasks execute in parallel bounded chunks, update progress, log costs, and complete cleanly.

## Definition of done
* [ ] Asynchronous task queue architecture operational.
* [ ] Idempotency and exponential retries validated.
* [ ] Cost tracking and budget caps enforced.
* [ ] Tests pass; Reviewer verdict PASS.
* [ ] `ACCEPTANCE_MATRIX.md` updated for REQ-080.

## Reviewer checklist
* [ ] Are monolithic synchronous loops completely decoupled?
* [ ] Are transient API rate limits handled with exponential backoff?
* [ ] Are daily API cost limits respected?

## Explicitly out of scope
* Final multi-business fixture validation (deferred to Phase 16).
