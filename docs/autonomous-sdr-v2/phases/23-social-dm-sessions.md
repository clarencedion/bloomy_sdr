# Phase 23 — Social DM Sessions (Instagram + Facebook, browser agent, one-key send)

## Objective
Make social outreach as fast as the owner's current ChatGPT-in-Chrome routine, inside the SDR, with Qwen: an agent drives a real, visible browser logged into the business's own Instagram and Facebook accounts, opens each prospect's profile or Page, opens the conversation and types the prepared message. **The person presses one key to send**, and the agent moves to the next prospect. Every send is recorded in the funnel, replies included.

## Why this phase exists
* The owner already prospects by DM through a browser agent and wants it integrated, for Instagram and Facebook.
* The SDR already finds the profiles (`social-profile-provider.ts` → `instagram_url`, `facebook_url`) and writes the messages (`social-dm-generation.ts`), but the hand-off today is copy, switch tab, paste, send, come back, mark sent.
* Goal: ~10 seconds of human time per DM, so 100 DMs take about 15 minutes.

## Decisions taken with the owner (2026-11-10)
* **Browser automation of the owner's own logged-in accounts: yes.** The runner works in a headed browser with a dedicated, persistent profile in which the owner logs in once.
* **Send is confirmed per message by a person (one key).** The agent never sends unattended.
  * Meta's terms prohibit automated access, and accounts are restricted when it is detected. A per-message confirmation keeps the human in the loop at a cost of seconds.
  * It also matches Channel Contract rule 1: a checkpoint or CAPTCHA is a refusal, not an obstacle.
* **Never built:**
  * stealth or fingerprint plugins, proxies or IP rotation;
  * CAPTCHA or checkpoint solving;
  * multiple accounts to multiply volume;
  * automatic follow-ups by DM.

## Architecture
* **Local runner** (`social-runner/`, Node + Playwright, runs on the owner's Mac). A Cloud Function cannot drive a browser logged into a personal session.
  * Launched with `npm run social:session -- --business <id> --network instagram|facebook --max 50`.
  * Uses `launchPersistentContext` on a dedicated profile directory (never the owner's main Chrome profile), headed, at normal speed.
* **Work queue and SDR access (ADR-020):** the runner calls compiled services from `functions/lib` with the Firebase Admin SDK, pinned to `devcomm-os` (`social-runner/src/bootstrap.mjs` refuses any other project and the emulator host). Only `src/sdr.mjs` touches the backend. Queue = `outreach` drafts with `channel == "social_dm"`, `status == "draft"`, gate-checked (`listSocialDmQueue`).
* **`SocialChannelDriver` interface** (pluggable, like providers), each with a `MockSocialChannelDriver` that runs against fixture HTML pages:
  * `InstagramDriver`: open the profile URL → "Message" button (role/name selectors) → composer → type the message.
  * `FacebookDriver`: open the Page URL → "Envoyer un message" / "Message" → Messenger composer → type the message.
  * Selectors are kept in one config file per network, so a Meta UI change is a one-file fix.
* **Qwen's role:**
  * Qwen already writes the message (`generateSocialDm`, now checked by the pricing detector and the commercial gate).
  * Optional, behind a flag: when a selector fails, a Qwen vision model receives a screenshot and returns the element to click. It only *finds* the message button or composer; it never decides to send. If it is not confident, the driver skips the prospect.
* **Confirmation loop:**
  * the runner shows company, network and the message preview in the terminal and in an on-page banner;
  * **Enter** = send, **S** = skip, **E** = edit then send, **Q** = stop;
  * after Enter, the runner clicks Send, waits for the message bubble to appear, then calls `markSocialDmSent` with the network and a screenshot hash.
* **Stops immediately on:** login page, checkpoint/"confirm it's you", CAPTCHA, "action blocked" / "try again later", rate-limit banners, an unexpected URL. It records `socialSession.stoppedReason` and tells the owner. No retry loop.
* **Limits** (Settings, per business per network): daily cap (default 30), minimum spacing between sends (default 45 s; human pace — not randomised to look human), one message per company ever (any network), suppression checked by domain/SIREN/handle before each prospect.
* **Replies (in this phase, both networks):** `inbox` mode opens the Instagram / Messenger inbox, matches threads to conversations we started (handle or name), reads the thread (accessibility snapshot → Qwen extraction, untrusted-wrapped, corrected against our own sent texts), and ingests only new prospect messages idempotently (`ingestSocialInbound`): unsubscribe → handle suppression + company `doNotContact`; auto-reply → ignored; angry/legal → escalated without draft; otherwise a short grounded DM reply (offer pricing detector + commercial flag, booking link if the business has one, never specific times) is typed into the composer for one-key send (`recordSocialReplySent`). The email router, dispatcher and booking path are never used for social conversations.

## Data/schema changes
* `outreach` (social_dm): `socialProfiles: { instagram?: {url, handle}; facebook?: {url, handle} }`, `sentNetwork`, `sentVia`, `contactId`, `conversationId`, `skippedAt`/`skipReason`.
* `companies.socialDmSentAt` (one first DM per company, any channel); `contacts` without email for social accounts; `conversations.channel/socialHandle/socialProfileUrl/companyName/pendingSessionSend`; messages `channel/senderHandle/deliveredVia/dedupeKey`; suppression `targetType: "social_handle"`.
* `socialSessions/{id}`: business, network, startedAt/endedAt, sent/skipped counts, stoppedReason. Written only by server-side services (Admin SDK); clients read only.
* Business doc: `socialLimits.{instagram,facebook}.{dailyCap,minSpacingSeconds}`; counters in `dailyUsage` (`social_dm_instagram` / `social_dm_facebook` + last-send time).

## Security considerations
* No Meta credential ever touches Firestore or the SDR. The session lives only in the local profile directory (`~/Library/Application Support/devcomm-sdr/profiles/<business>`), outside the repo, documented as sensitive.
* The runner uses the owner's Google credentials (ADC) pinned to `devcomm-os`, like the operator scripts; it refuses to start on any other project or with an emulator host, and refuses to draft with the mock AI provider.
* Message text and profile pages are untrusted content. The vision fallback receives a screenshot plus a fixed instruction and can only return coordinates of known element types.

## Tests
* `MockSocialChannelDriver` against saved fixture pages for: Instagram profile, Facebook Page, private profile with no message button, checkpoint page, "action blocked" banner, login wall.
* Runner state machine: send only after confirmation; stop on each blocking page; daily cap and spacing respected; suppressed and already-contacted companies skipped; `markSocialDmSent` called exactly once per confirmed send.
* No test needs a Meta account or network access.

## Definition of done
* [ ] One session sends confirmed DMs on Instagram and on Facebook from a real logged-in profile (owner-run E2E on 3 test prospects).
* [ ] Zero sends without a key press (state-machine test).
* [ ] Every blocking page stops the session (fixture tests).
* [ ] Sends are recorded in the funnel with network and session.
* [ ] Typecheck ×2, lint, builds; reviewer PASS.
