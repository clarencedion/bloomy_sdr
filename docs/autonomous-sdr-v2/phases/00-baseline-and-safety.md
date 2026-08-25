# Phase 00 — Baseline and Safety

## Objective
Establish a clean, documented baseline for the entire repository (git state, build pipeline, typecheck verification, linter configuration, and test harnesses) before any feature modifications.

## Why this phase exists
To ensure we know with mathematical certainty what worked, what failed, and what passed before SDR V2 development began.

## Requirements covered
* Baseline infrastructure preparation for REQ-001 through REQ-080.

## Existing code to inspect
* `package.json` & `functions/package.json`
* `tsconfig.json` & `functions/tsconfig.json`
* `eslint.config.mjs`
* `firestore.rules` & `firebase.json`

## Existing code to preserve
* All working Next.js App Router routes, Tailwind components, and Cloud Functions v2 handlers.

## Architecture
* Establish dedicated git branch `feat/autonomous-sdr-v2`.
* Introduce Node test runner or Vitest / Jest harness for unit tests.
* Document and fix linter environment globals (e.g. `AbortSignal`, `Buffer`, `alert`, `document` in `eslint.config.mjs`).

## Data/schema changes
* None.

## Backend changes
* Add unit test scripts in `package.json` and `functions/package.json`.

## Frontend changes
* None.

## External APIs
* None.

## Security considerations
* Verify that no `.env.local` or secret files are tracked in git.

## Migration/backfill
* None.

## Tests to write FIRST or alongside implementation
* Smoke test verifying Next.js build and Cloud Functions build.
* Linter pass with zero errors.

## E2E scenarios
* Run `npm run typecheck` → Exit 0.
* Run `npm run --prefix functions typecheck` → Exit 0.
* Run `npm run build` → Exit 0.
* Run `npm run --prefix functions build` → Exit 0.

## Definition of done
* [ ] Git repository initialized with clean `.gitignore`.
* [ ] Branch `feat/autonomous-sdr-v2` active.
* [ ] Frontend and backend typechecks pass with 0 errors.
* [ ] Frontend and backend builds pass with 0 errors.
* [ ] ESLint config updated to recognize standard globals and passes with 0 errors.
* [ ] Test runner configured in `package.json`.
* [ ] `PROGRESS.md` updated with baseline results.

## Reviewer checklist
* [ ] Are any user files accidentally deleted or uncommitted?
* [ ] Does `npm run build` succeed cleanly?
* [ ] Is the test harness ready for Phase 01?

## Explicitly out of scope
* Implementing any new multi-business, security, or signal features (deferred to Phase 01+).
