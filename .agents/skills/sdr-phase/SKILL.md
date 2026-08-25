---
name: sdr-phase
description: Executes a single, bounded implementation phase of Autonomous SDR V2 following strict verification protocols.
---

# SDR Phase Execution Protocol

Use this skill to execute a single phase of Autonomous SDR V2 (e.g. `/sdr-phase 00`, `/sdr-phase 01`, `/sdr-phase 02`).

## Execution Steps

1. **Read Core Context:**
   - Read `docs/autonomous-sdr-v2/INVARIANTS.md`.
   - Read `docs/autonomous-sdr-v2/HANDOFF.md` and `docs/autonomous-sdr-v2/PROGRESS.md`.
   - Read the requested phase file: `docs/autonomous-sdr-v2/phases/{phase_number}-*.md`.

2. **Inspect Existing Code:**
   - Use `view_file` to read the exact files listed in the phase specification.
   - Verify existing code against assumptions; default to `KEEP` or `EXTEND`.

3. **Verify Third-Party Provider Docs:**
   - If the phase touches external APIs (Instantly, Google PageSpeed, Dropcontact, Microsoft Graph), verify CURRENT official documentation before writing code.

4. **Formulate Bounded Implementation Plan:**
   - Define exact files to modify and tests to write for THIS phase only.
   - Do NOT implement features belonging to subsequent phases.

5. **Implement & Test:**
   - Implement the phase features.
   - Write targeted unit and integration tests.
   - Run verification commands:
     ```bash
     export PATH=$PATH:/opt/homebrew/bin
     npm run typecheck
     npm run --prefix functions typecheck
     npm run build
     npm run --prefix functions build
     ```

6. **Adversarial Review:**
   - Review implementation against phase requirements, edge cases, security, and multi-business invariants.
   - Resolve all blockers or regressions.

7. **Update Documentation:**
   - Update `docs/autonomous-sdr-v2/ACCEPTANCE_MATRIX.md` with verified test evidence for completed requirement IDs.
   - Update `docs/autonomous-sdr-v2/PROGRESS.md` with current phase status.
   - Update `docs/autonomous-sdr-v2/DECISIONS.md` if any new ADRs were made.
   - Update `docs/autonomous-sdr-v2/HANDOFF.md` with exact instructions for the next fresh session.

8. **Stop:**
   - Do NOT proceed to the next phase automatically. Report completion and await user review.
