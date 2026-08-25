---
description: Testing standards, verification requirements, and acceptance evidence
globs: src/tests/**/*.ts, functions/src/tests/**/*.ts
---

# Testing & Verification Standards

1. **Test-First Verification:**
   - Every phase must implement automated tests verifying its specific requirements before declaring completion.
   - Do not claim a requirement is complete without running its associated test.

2. **Zero API Key Requirement for Unit Tests:**
   - Unit tests must run using mock providers and saved JSON fixtures.
   - Live integration tests requiring real API credentials must degrade gracefully and not fail the test suite if keys are absent.

3. **Adversarial Edge Cases:**
   - Always test negative cases: suppressed contacts, missing websites, 429 rate limits, malicious prompt injection, double-booked calendar slots.
