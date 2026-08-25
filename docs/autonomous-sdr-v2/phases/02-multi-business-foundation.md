# Phase 02 — Multi-Business Foundation

## Objective
Implement generic multi-business architecture (`Workspace` → `Business` → `Offer` → `Campaign`), isolating knowledge bases, sender identities, and calendars. Backfill existing legacy records to a default workspace without data loss.

## Why this phase exists
To break the hardcoded "Devcomm" assumption and enable the platform to support Bloomy Digital Studio (website sales), B2B consultancies, and any other business using the exact same generic SDR engine.

## Requirements covered
* **REQ-001**: Multi-Business Workspaces
* **REQ-002**: Multiple Offers per Business
* **REQ-003**: Campaigns Inherit Offers
* **REQ-004**: Offer-Agnostic Core Engine
* **REQ-005**: Isolated Sender Configuration
* **REQ-006**: Isolated Calendar Credentials
* **REQ-007**: Isolated Knowledge Bases
* **REQ-008**: Legacy Data Migration
* **REQ-010**: Multi-Business Switcher UI

## Existing code to inspect
* `src/types/firestore.ts`
* `src/lib/firebase/firestore.ts`
* `functions/src/config/firebase.ts`
* `src/features/settings/settings-page.tsx`
* `src/components/layout/topbar.tsx`

## Existing code to preserve
* Existing Firestore helper functions; extend them with `workspaceId` and `businessId` parameters.

## Architecture
* Create domain schemas for `WorkspaceDoc`, `BusinessDoc`, `OfferDoc`, `KnowledgeBaseDoc`.
* Ensure generic backend services operate on generic context objects.
* Introduce a migration script to assign existing companies, contacts, campaigns, and outreach records to a default workspace/business.

## Data/schema changes
* Create collections:
  * `workspaces/{workspaceId}`
  * `workspaces/{workspaceId}/businesses/{businessId}`
  * `workspaces/{workspaceId}/businesses/{businessId}/offers/{offerId}`
* Add `workspaceId` and `businessId` fields to `companies`, `contacts`, `discoveryCampaigns`, `outreach`, `meetings`, and `logs`.

## Backend changes
* Implement `functions/src/services/business-service.ts` (CRUD for business, offer, and knowledge base).
* Implement `functions/src/migrations/backfill-v2.ts` to backfill existing single-tenant documents.

## Frontend changes
* Implement `src/components/layout/business-switcher.tsx` in topbar to allow switching between active businesses.
* Add Offer creation and Knowledge Base management tabs in Settings.

## External APIs
* None.

## Security considerations
* Verify that Firestore security rules enforce workspace isolation so users cannot access another workspace's records.

## Migration/backfill
* Execute `backfill-v2` to wrap existing data under default workspace `"ws_default"` and business `"biz_devcomm"`. Create new business `"biz_bloomy"` for Bloomy Digital Studio.

## Tests to write FIRST or alongside implementation
* `tests/domain/multi-business.test.ts`: Create two separate businesses (Bloomy and Consulting) and verify that querying offers/campaigns for Business A returns 0 results for Business B.
* `tests/domain/migration.test.ts`: Verify that un-migrated legacy docs are properly assigned `workspaceId` and `businessId`.
* `tests/domain/architecture-lint.test.ts`: AST test scanning `functions/src/services` to assert zero hardcoded occurrences of `"Bloomy"` or `"Devcomm"` in generic orchestration code.

## E2E scenarios
* Switch between "Bloomy Digital Studio" and "Devcomm Consulting" in UI; verify that campaign lists, contacts, and settings update to reflect the active business context.

## Definition of done
* [ ] Multi-business domain types and collections created.
* [ ] Legacy data backfilled cleanly without data loss.
* [ ] Business switcher UI operational.
* [ ] Zero hardcoded business branches in generic engine code.
* [ ] Tests pass; Reviewer verdict PASS.
* [ ] `ACCEPTANCE_MATRIX.md` updated for REQ-001 through REQ-008, REQ-010.

## Reviewer checklist
* [ ] Are campaigns strictly bound to an Offer?
* [ ] Is there any cross-tenant data leakage in Firestore queries?
* [ ] Did the migration preserve all existing companies and contacts?

## Explicitly out of scope
* Natural language prompt parsing (deferred to Phase 03).
