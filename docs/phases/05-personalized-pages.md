# Phase 4 — Personalized Sales Pages

## Goal

Generate and publish personalized prospect pages.

## URL Format

```txt
/proposition/:slug
```

Example:

```txt
/proposition/acme-sas
```

## Internal Preview

Create internal preview:
```txt
/app/generated-pages/:id
```

## Public Page Requirements

Must include:
- Devcomm branding
- company name
- personalized headline
- why Devcomm contacted them
- likely challenges
- recommended support
- diagnostic call CTA
- booking CTA
- legal/privacy footer

Do not expose:
- internal AI notes
- fit score
- private research
- contact data

## Tracking

Track events:
- page_created
- page_viewed
- cta_clicked
- booking_clicked

Store in Firestore.

## Acceptance Criteria

- User can generate a page draft
- User can preview page
- User can publish page
- Public URL works
- Page views are tracked
