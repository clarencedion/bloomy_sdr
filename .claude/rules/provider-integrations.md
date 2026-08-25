---
description: Third-party API research, adapter patterns, and integration standards
globs: functions/src/providers/**/*.ts
---

# Provider Integrations Rules

1. **Current Documentation First:**
   - Before implementing or editing an integration, verify CURRENT official documentation for endpoints, payloads, auth headers, and webhooks.
   - Do not rely on stale memory or deprecated API parameters.

2. **Pluggable Adapter Pattern:**
   - All signal providers must implement `SignalProvider`.
   - All email senders must implement `EmailProvider`.
   - All calendar tools must implement `CalendarProvider`.

3. **Deterministic Mock Companions:**
   - Every provider must have a companion Mock class (e.g. `MockAIProvider`, `MockPageSpeedProvider`) to allow 100% offline unit testing without API keys.

4. **Timeouts and Rate Limiting:**
   - All HTTP requests to external APIs must specify explicit timeouts (max 8–15s).
   - Implement exponential backoff retries on HTTP 429 Too Many Requests.
