# Phase-by-Phase Control Prompt

Use this after the master prompt.

```txt
Important:
Do not implement more than the current phase.
Do not create placeholder chaos for future phases unless the phase explicitly asks for skeleton interfaces.
Do not rewrite the architecture.
Read the relevant phase file and implement exactly that phase.
At the end, stop and give me:
1. Summary
2. Files changed
3. How to test
4. Known limitations
5. Next recommended phase
```

## Start Phase 1

```txt
Read:
- docs/README.md
- docs/prompts/00-master-prompt.md
- docs/architecture/01-product-requirements.md
- docs/architecture/02-technical-architecture.md
- docs/architecture/03-firestore-schema.md
- docs/ui/01-design-system.md
- docs/phases/01-foundation.md

Implement Phase 1 only.
Stop when Phase 1 is complete.
```

## Start Phase 2

```txt
Read:
- docs/phases/02-ai-research.md
- docs/functions/01-ai-prompts.md
- current codebase

Implement Phase 2 only.
Do not implement outreach generation yet.
Stop when Phase 2 is complete.
```

## Start Phase 3

```txt
Read:
- docs/phases/03-outreach-generation.md
- docs/functions/01-ai-prompts.md
- current codebase

Implement Phase 3 only.
Stop when Phase 3 is complete.
```


## Start Phase 2 — Lead Discovery

```txt
Read:
- docs/phases/02-lead-discovery.md
- docs/integrations/03-lead-discovery-sources.md
- docs/architecture/03-firestore-schema.md
- current codebase

Implement Phase 2 only: autonomous lead discovery.
Do not implement AI research yet except queueing companies for future research.
Stop when Phase 2 is complete.
```

## Start Phase 3 — AI Research

```txt
Read:
- docs/phases/03-ai-research.md
- docs/functions/01-ai-prompts.md
- current codebase

Implement Phase 3 only.
Stop when Phase 3 is complete.
```
