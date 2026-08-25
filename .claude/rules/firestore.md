---
description: Firestore security rules, query scoping, and data integrity standards
globs: firestore.rules, src/lib/firebase/firestore.ts, functions/src/**/*.ts
---

# Firestore Rules & Data Access Standards

1. **Multi-Tenant Scoping:**
   - Every document write must include `workspaceId` and `businessId` where applicable.
   - All collection queries must filter by `workspaceId` to prevent cross-tenant data leakage.

2. **Security Rules Integrity:**
   - `settings/aiSecrets` and `settings/integrationSecrets` must have `allow read, write: if false;` to block client SDK reads.
   - Clients must never be granted direct write access to `suppressionList` without authentication.

3. **Non-Downgrading Merges:**
   - When updating companies or contacts from scraped data, always use non-downgrading merges (`mergeWithoutDowngrade`) to preserve verified data.

4. **Composite Indexes:**
   - Always verify and declare composite indexes in `firestore.indexes.json` when adding multi-field ordering or filtering.
