/**
 * Page helpers shared by the Instagram and Facebook drivers.
 *
 * Everything that waits has an explicit timeout (the page default is 15 s,
 * set in browser.mjs); everything that navigates is followed by a blocker
 * check. The pure helpers at the bottom are unit-tested.
 */
import { detectBlocker, normaliseText } from "../blockers.mjs";
import { composerDetached, composerMatches, normaliseForCompare } from "../composer.mjs";

const CONFIRM_TIMEOUT_MS = 12000;
/** Meta draws the outgoing bubble before its server answers: it must stay clean this long. */
const DELIVERY_SETTLE_MS = 3000;
const SETTLE_TIMEOUT_MS = 10000;
const POLL_MS = 400;
const PIN_TIMEOUT_MS = 5000;

/** What `confirmSent` reports about a message that was just sent. */
export const SEND_STATUS = Object.freeze({
  /** The bubble is in the conversation, with no pending or failure marker, for DELIVERY_SETTLE_MS. */
  DELIVERED: "delivered",
  /** Meta marked the bubble as not sent ("Échec de l'envoi", "Not delivered", retry icon...). */
  FAILED: "failed",
  /** Neither: no bubble seen, still pending, or the page could not be read. */
  UNCONFIRMED: "unconfirmed"
});

/** Two chat windows open at once: typing could reach the wrong prospect. */
export const SEVERAL_CHAT_WINDOWS = Object.freeze({ kind: "unexpected", detail: "several_chat_windows_open" });

/** Interface chrome only. See blockers.mjs for why page content is left out. */
const INTERFACE_SELECTOR = '[role="dialog"], [role="alertdialog"], [role="alert"], h1, h2';
const MAX_INTERFACE_TEXT = 4000;

/** "Turn on notifications" / "Save your login info" style dialogs. Never "Allow", never "Save". */
const NOT_NOW = /^(Not now|Plus tard|Pas maintenant)$/i;

/** Title, headings, dialogs and alerts currently visible on the page. */
async function interfaceText(page) {
  const parts = [];
  try {
    parts.push(await page.title());
  } catch {
    // A page mid-navigation has no title yet; the URL check still runs.
  }
  try {
    const texts = await page.locator(INTERFACE_SELECTOR).filter({ visible: true }).allInnerTexts();
    parts.push(...texts);
  } catch {
    // Same: an unreadable page is judged on its URL.
  }
  return parts.join("\n").slice(0, MAX_INTERFACE_TEXT);
}

/** The blocker on the current page, if any. */
export async function pageBlocker(page) {
  return detectBlocker({ url: page.url(), text: await interfaceText(page) });
}

/**
 * Text of the main region, used only where interface text is not enough: to
 * explain why a composer never appeared ("you can't message this account" is
 * printed where the composer would be, not in a dialog).
 */
export async function mainText(page) {
  try {
    const main = page.locator('main, [role="main"]').first();
    return (await main.innerText({ timeout: 3000 })).slice(0, MAX_INTERFACE_TEXT);
  } catch {
    return "";
  }
}

/**
 * Waits for Meta's single-page app to render after a navigation. A fixed
 * second on top lets client-side redirects (to a login or checkpoint page)
 * land before the blocker check reads the URL.
 */
async function settle(page) {
  await page
    .locator('main, [role="main"], [role="dialog"]')
    .first()
    .waitFor({ state: "visible", timeout: SETTLE_TIMEOUT_MS })
    .catch(() => undefined);
  await page.waitForTimeout(1000);
}

/**
 * Navigates and reports the blocker found there, or null when the page is usable.
 * A navigation that fails outright is a stop too: the runner never retries.
 */
export async function gotoChecked(page, url) {
  try {
    await page.goto(url, { waitUntil: "domcontentloaded" });
  } catch {
    return (await pageBlocker(page)) ?? { kind: "unexpected", detail: "navigation_failed" };
  }
  await settle(page);
  return pageBlocker(page);
}

/** After a click that may navigate: let it land, then check. */
export async function settleAndCheck(page) {
  await page.waitForLoadState("domcontentloaded").catch(() => undefined);
  await settle(page);
  return pageBlocker(page);
}

/** Closes "not now" dialogs (notifications, saved login). Two at most, then gives up quietly. */
export async function dismissInterstitials(page) {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const button = page.getByRole("dialog").getByRole("button", { name: NOT_NOW }).filter({ visible: true }).first();
    if (!(await button.isVisible().catch(() => false))) return;
    await button.click().catch(() => undefined);
    await page.waitForTimeout(300);
  }
}

/** The first visible element of `locator` within `timeout`, or null. */
export async function firstVisible(locator, timeout) {
  const candidate = locator.filter({ visible: true }).first();
  try {
    await candidate.waitFor({ state: "visible", timeout });
    return candidate;
  } catch {
    return null;
  }
}

/** Is some text matching `pattern` visible right now? */
export async function textVisible(page, pattern) {
  return page.getByText(pattern).filter({ visible: true }).first().isVisible().catch(() => false);
}

/**
 * The aria snapshot of the first visible candidate selector. `body` is the
 * last resort, so a renamed container degrades to a noisier snapshot (which
 * the matcher and the thread check still guard) instead of no snapshot at all.
 */
export async function snapshotOf(page, selectors) {
  for (const selector of selectors) {
    const target = page.locator(selector).filter({ visible: true }).first();
    if (await target.isVisible().catch(() => false)) {
      return target.ariaSnapshot({ timeout: 10000 });
    }
  }
  return page.locator("body").ariaSnapshot({ timeout: 10000 });
}

/**
 * Pins a composer to the element `locator` resolves to NOW.
 *
 * A Playwright locator is resolved again on every action, so `.first()` means
 * "the first match at the moment of the call". A Messenger chat window that
 * pops up mid-item (someone writing to the Page) could then silently become
 * "the composer": the text would be typed into, or sent to, another person.
 * The pinned composer acts on one element only and can tell when that element
 * has left the page. Null when nothing could be pinned.
 */
export async function pinComposer(locator) {
  let handle;
  try {
    handle = await locator.elementHandle({ timeout: PIN_TIMEOUT_MS });
  } catch {
    return null;
  }
  if (!handle) return null;
  return {
    pinned: true,
    attached: () => handle.evaluate((element) => element.isConnected),
    click: (options) => handle.click(options),
    innerText: () => handle.innerText(),
    // ElementHandle.press focuses this very element before the key goes down.
    press: (key, options) => handle.press(key, options),
    blur: () => handle.evaluate((element) => element.blur()),
    evaluate: (fn, arg) => handle.evaluate(fn, arg),
    dispose: () => handle.dispose().catch(() => undefined)
  };
}

/**
 * Exactly one composer must be on screen, and it is pinned (see pinComposer).
 * The count is checked again after pinning: a window that opened in between
 * could otherwise be the one pinned.
 *
 * @param {() => any} composers  the network's composer locator (unfiltered)
 */
export async function pinSingleComposer(composers, timeoutMs) {
  const first = await firstVisible(composers(), timeoutMs);
  if (!first) return { ok: false, reason: "no_composer" };
  const visibleCount = () => composers().filter({ visible: true }).count().catch(() => 0);
  if ((await visibleCount()) > 1) return { ok: false, reason: SEVERAL_CHAT_WINDOWS };
  const pinned = await pinComposer(first);
  if (!pinned) return { ok: false, reason: "no_composer" };
  if ((await visibleCount()) > 1) {
    await pinned.dispose();
    return { ok: false, reason: SEVERAL_CHAT_WINDOWS };
  }
  return { ok: true, composer: pinned };
}

/**
 * Runs IN THE PAGE (Playwright serialises it): no closure, no import, no
 * global but what the element gives. Reads, never changes anything.
 *
 * Looks for our message as a bubble of THIS conversation: inside the widest
 * ancestor of the composer that holds no other composer (so another chat
 * window's history never counts), outside the composer itself. Returns the
 * composer's text, whether a visible bubble holds the snippet, and the text
 * and labels around the newest such bubble (its row), where Meta prints
 * "Échec de l'envoi", "Not delivered", "Envoi…" or a retry icon.
 */
function inspectSendInPage(element, { snippet, noComposer }) {
  const doc = element.ownerDocument;
  const view = doc.defaultView;
  const composer = noComposer ? null : element;
  const norm = (value) =>
    String(value ?? "")
      .replace(/[\u200b-\u200d\u2060\ufeff]/g, "")
      .replace(/\s+/g, " ")
      .trim()
      .toLowerCase();
  const editors = Array.from(doc.querySelectorAll('[contenteditable="true"], textarea, [role="textbox"]'));
  const isEditor = (node) => editors.includes(node);

  let scope = doc.body;
  if (composer) {
    scope = composer;
    for (let node = composer.parentElement; node; node = node.parentElement) {
      const holdsAnother = editors.some((editor) => editor !== composer && !composer.contains(editor) && !editor.contains(composer) && node.contains(editor));
      if (holdsAnother) break;
      scope = node;
      if (node === doc.body) break;
    }
  }

  const visible = (node) => {
    const rect = node.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return false;
    const style = view.getComputedStyle(node);
    return style.visibility !== "hidden" && style.display !== "none";
  };
  const needle = norm(snippet);
  const matches = [];
  // Depth first, pruning every subtree whose text does not hold the snippet.
  const visit = (node) => {
    if (composer && node === composer) return false;
    if (isEditor(node)) return false;
    if (!norm(node.textContent).includes(needle)) return false;
    let deeper = false;
    for (const child of Array.from(node.children)) {
      if (visit(child)) deeper = true;
    }
    if (deeper) return true;
    if (composer && node.contains(composer)) return false;
    if (!visible(node)) return false;
    matches.push(node);
    return true;
  };
  if (needle) visit(scope);
  const bubble = matches.length ? matches[matches.length - 1] : null;

  const around = [];
  if (bubble) {
    const own = norm(bubble.textContent).length;
    let row = bubble;
    for (let depth = 0; depth < 8; depth += 1) {
      const parent = row.parentElement;
      if (!parent || parent === scope || (composer && parent.contains(composer))) break;
      if (norm(parent.textContent).length > own + 200) break;
      row = parent;
    }
    const collect = (node) => {
      if (node === bubble) return;
      if (node.nodeType === 3) {
        around.push(node.nodeValue);
        return;
      }
      if (node.nodeType !== 1) return;
      for (const name of ["aria-label", "title", "alt"]) {
        const value = node.getAttribute(name);
        if (value) around.push(value);
      }
      for (const child of Array.from(node.childNodes)) collect(child);
    };
    collect(row);
  }

  return {
    composerText: composer ? composer.innerText ?? "" : "",
    bubbleFound: Boolean(bubble),
    markerText: around.join("\n").slice(0, 2000)
  };
}

async function observeSend(page, composer, snippet, relocate) {
  const args = { snippet };
  try {
    if (composer && typeof composer.evaluate === "function" && !(await composerDetached(composer))) {
      return await composer.evaluate(inspectSendInPage, args);
    }
    // The thread re-rendered after the send (Instagram does on a first
    // message): look from the conversation's composer as it is now.
    const current = relocate ? await relocate() : null;
    if (current) return await current.evaluate(inspectSendInPage, args);
    return await page.locator("body").evaluate(inspectSendInPage, { ...args, noComposer: true });
  } catch {
    return null;
  }
}

/**
 * Did the message go out? Polls the conversation for up to 12 s:
 *  - FAILED as soon as the bubble carries a send-failure marker;
 *  - DELIVERED once the composer is empty and the bubble has been visible,
 *    with no pending or failure marker, for 3 s in a row (Meta draws the
 *    bubble before its server accepts the message);
 *  - UNCONFIRMED otherwise.
 *
 * @param {{ timeoutMs?: number, settleMs?: number, pollMs?: number, now?: () => number,
 *   sleep?: (ms: number) => Promise<unknown>, relocate?: () => Promise<any> }} [options]
 *   `relocate` finds the conversation's composer again when the pinned one left the page.
 * @returns {Promise<"delivered" | "failed" | "unconfirmed">}
 */
export async function confirmBubble(page, text, composer, options = {}) {
  const {
    timeoutMs = CONFIRM_TIMEOUT_MS,
    settleMs = DELIVERY_SETTLE_MS,
    pollMs = POLL_MS,
    now = Date.now,
    sleep = (ms) => page.waitForTimeout(ms),
    relocate
  } = options;
  const snippet = confirmationSnippet(text);
  if (!snippet) return SEND_STATUS.UNCONFIRMED;
  const deadline = now() + timeoutMs;
  let shownSince = null;
  for (;;) {
    const verdict = deliveryVerdict(await observeSend(page, composer, snippet, relocate), text);
    if (verdict === "failed") return SEND_STATUS.FAILED;
    if (verdict === "shown") {
      shownSince ??= now();
      if (now() - shownSince >= settleMs) return SEND_STATUS.DELIVERED;
    } else {
      shownSince = null;
    }
    // A bubble that appeared just before the deadline still gets its settle time.
    if (now() >= deadline + (shownSince === null ? 0 : settleMs)) return SEND_STATUS.UNCONFIRMED;
    await sleep(pollMs);
  }
}

// ── Is this conversation new? ────────────────────────────────────────────────

/**
 * Runs IN THE PAGE (Playwright serialises it): no closure, no import. Reads,
 * never changes anything.
 *
 * Describes the chat window the composer belongs to — the nearest ancestor
 * that also holds the header link to the recipient's profile: every text line
 * outside the composer, the roles it contains, its images and media, and the
 * label of the conversation area (the recipient's display name).
 */
function inspectThreadInPage(composer, { recipientLabel }) {
  const labelPattern = new RegExp(recipientLabel, "i");
  const isRecipientLink = (node) => node.tagName === "A" && labelPattern.test(node.getAttribute("aria-label") ?? "");
  let chat = null;
  for (let node = composer.parentElement; node && node !== composer.ownerDocument.body; node = node.parentElement) {
    if (Array.from(node.querySelectorAll("a[aria-label]")).some(isRecipientLink)) {
      chat = node;
      break;
    }
  }
  if (!chat) return { windowFound: false };

  let displayName = "";
  for (let node = composer.parentElement; node && node !== chat.parentElement; node = node.parentElement) {
    const label = node.getAttribute("aria-label");
    if (label) {
      displayName = label;
      break;
    }
  }

  const lines = [];
  const walk = (node) => {
    if (node === composer) return;
    if (node.nodeType === 3) {
      const text = String(node.nodeValue ?? "").replace(/\s+/g, " ").trim();
      if (text) lines.push(text);
      return;
    }
    if (node.nodeType !== 1) return;
    for (const child of Array.from(node.childNodes)) walk(child);
  };
  walk(chat);

  const outsideComposer = (node) => !composer.contains(node);
  const roles = [...new Set(Array.from(chat.querySelectorAll("[role]")).filter(outsideComposer).map((node) => node.getAttribute("role")))];
  const tags = (name) => Array.from(chat.querySelectorAll(name)).filter(outsideComposer).length;
  return {
    windowFound: true,
    displayName,
    lines: lines.slice(0, 400),
    roles,
    images: tags("img"),
    media: tags("video") + tags("audio") + tags("canvas")
  };
}

/**
 * What the open chat window holds, as `classifyThread` reads it. Null when it
 * cannot be read (no composer on screen, evaluation failed).
 * @param {{ recipientLabel: string }} options
 * @param {() => Promise<any>} [relocate] finds the conversation's composer again when the pinned one left the page
 */
export async function observeThread(page, composer, options, relocate) {
  try {
    if (composer && typeof composer.evaluate === "function" && !(await composerDetached(composer))) {
      return await composer.evaluate(inspectThreadInPage, { recipientLabel: options.recipientLabel });
    }
    const current = relocate ? await relocate() : null;
    return current ? await current.evaluate(inspectThreadInPage, { recipientLabel: options.recipientLabel }) : null;
  } catch {
    return null;
  }
}

/**
 * PURE. Is the conversation new — nothing ever written in it?
 *
 * "empty" is only said on positive evidence:
 *  - the window's header is in a language the rules describe (all its header
 *    labels, once each), and the window is read with THAT language's labels;
 *  - it shows the recipient's intro card (the "<handle> · Instagram" line, once);
 *  - EVERY line of text in it is the recipient's display name (at most
 *    twice), the "verified" badge (twice or not at all), or one of the
 *    interface's own labels (once);
 *  - it holds only the roles an empty window holds, no media, and no more
 *    images than the avatars.
 * Anything else — one unknown line, a message row, a photo — is
 * "has_content", and a window that cannot be read is "unknown". Both mean
 * "do not send a first message here without a person looking".
 *
 * `typed`: a text sits in the composer, so the interface shows its "Send"
 * button (the check made right before a send).
 *
 * @param {object | null} observation  from observeThread
 * @param {{ handle: string, handleLine: (handle: string) => RegExp, typed?: boolean,
 *   interfaces: Array<{ header: string[], labels: string[], verified: string, typingLabels: string[] }>,
 *   roles: string[], maxImages: number }} rules
 * `why` is a category, safe to record in the SDR; `unexpected` holds the
 * lines themselves (up to five) — they may be somebody's messages, so they
 * are only ever shown on this Mac.
 *
 * @returns {{ state: "empty" | "has_content" | "unknown", why?: string, unexpected?: string[] }}
 */
export function classifyThread(observation, rules) {
  if (!observation || observation.windowFound !== true) return { state: "unknown", why: "chat_window_not_found" };
  const lines = (observation.lines ?? []).map((raw) => ({ raw, line: normaliseText(raw) })).filter(({ line }) => line);
  const times = (label) => lines.filter(({ line }) => line === normaliseText(label)).length;

  const language = rules.interfaces.find((candidate) => candidate.header.every((label) => times(label) === 1));
  if (!language) return { state: "unknown", why: "interface_not_recognised" };

  const display = normaliseText(observation.displayName);
  const verified = normaliseText(language.verified);
  const once = new Set([...language.header, ...language.labels, ...(rules.typed ? language.typingLabels : [])].map((label) => normaliseText(label)));
  const handleLine = rules.handleLine(normaliseText(rules.handle));

  const seen = new Map();
  const unexpected = [];
  let unknownText = false;
  let handleLines = 0;
  for (const { raw, line } of lines) {
    if (handleLine.test(line)) {
      handleLines += 1;
      continue;
    }
    const count = (seen.get(line) ?? 0) + 1;
    seen.set(line, count);
    const limit = display && line === display ? 2 : line === verified ? 2 : once.has(line) ? 1 : undefined;
    if (limit === undefined) unknownText = true;
    if (limit === undefined || count > limit) unexpected.push(String(raw).slice(0, 80));
  }
  // The badge sits in the header and on the card: alone, it is somebody's message.
  if (verified !== display && (seen.get(verified) ?? 0) === 1) unexpected.push(language.verified);
  if (unexpected.length) return { state: "has_content", why: unknownText ? "text" : "repeated", unexpected: unexpected.slice(0, 5) };
  if (handleLines === 0) return { state: "unknown", why: "intro_card_not_found" };
  if (handleLines > 1) return { state: "has_content", why: "handle_line_repeated" };
  const strangeRole = (observation.roles ?? []).find((role) => !rules.roles.includes(role));
  if (strangeRole) return { state: "has_content", why: `role:${strangeRole}` };
  if (observation.media > 0) return { state: "has_content", why: "media" };
  if (observation.images > rules.maxImages) return { state: "has_content", why: `images:${observation.images}` };
  return { state: "empty" };
}

// ── Pure helpers ─────────────────────────────────────────────────────────────

/**
 * Send-failure and pending markers, in normaliseText form (lowercase, no
 * accents, straight apostrophes), French and English. They are looked for
 * only around our own bubble, never in its text.
 */
const SEND_FAILED_PATTERNS = [
  "echec de l'envoi",
  "echec d'envoi",
  "envoi impossible",
  "impossible d'envoyer",
  "message non envoye",
  "n'a pas ete envoye",
  "non distribue",
  "not delivered",
  "couldn't send",
  "could not send",
  "failed to send",
  "wasn't sent",
  "was not sent",
  "reessayer",
  "try again",
  "tap to retry",
  "retry"
];
const SEND_PENDING = /(^|[^a-z])(envoi en cours|envoi(…|\.\.\.)|sending)([^a-z]|$)/;

/** PURE: the failure / pending marker found in the text around a sent bubble. */
export function sendMarkers(text) {
  const haystack = normaliseText(text);
  if (!haystack) return { failed: null, pending: null };
  const failed = SEND_FAILED_PATTERNS.find((pattern) => haystack.includes(pattern)) ?? null;
  const pending = SEND_PENDING.exec(haystack)?.[2] ?? null;
  return { failed, pending };
}

/**
 * PURE: one observation of the conversation after a send, judged.
 *  - "failed": the bubble is there with a failure marker;
 *  - "in_composer" / "composer_changed": the composer is not empty;
 *  - "absent": composer empty, no bubble;
 *  - "pending": bubble there, still marked as sending;
 *  - "shown": bubble there, composer empty, no marker;
 *  - "unreadable": the page could not be read.
 */
export function deliveryVerdict(observation, text) {
  if (!observation) return "unreadable";
  const markers = sendMarkers(observation.markerText);
  if (observation.bubbleFound && markers.failed) return "failed";
  if (normaliseForCompare(observation.composerText) !== "") {
    return composerMatches(observation.composerText, text) ? "in_composer" : "composer_changed";
  }
  if (!observation.bubbleFound) return "absent";
  if (markers.pending) return "pending";
  return "shown";
}

/**
 * The piece of a message to look for in the sent bubble: the first 40
 * characters of its first substantial line. Lines, because bubbles render
 * line breaks as separate elements and text matching does not cross them;
 * a substantial line, because "Bonjour," alone would match older messages.
 */
export function confirmationSnippet(text) {
  const lines = String(text ?? "")
    .split(/\r\n|\r|\n/)
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter(Boolean);
  if (!lines.length) return "";
  const line = lines.find((candidate) => candidate.length >= 20) ?? [...lines].sort((a, b) => b.length - a.length)[0];
  // Array.from keeps emoji (surrogate pairs) whole.
  return Array.from(line).slice(0, 40).join("");
}

const THREAD_PATHS = [
  { host: "instagram.com", path: /^\/direct\/t\/[^/]+\/?$/ },
  { host: "facebook.com", path: /^\/messages\/(e2ee\/)?t\/[^/]+\/?$/ },
  { host: "messenger.com", path: /^\/(e2ee\/)?t\/[^/]+\/?$/ }
];

/** The page URL when it is a DM thread (query stripped), else undefined. */
export function threadUrlOf(url) {
  let parsed;
  try {
    parsed = new URL(String(url ?? ""));
  } catch {
    return undefined;
  }
  const host = parsed.hostname.toLowerCase();
  const known = THREAD_PATHS.some(
    (entry) => (host === entry.host || host.endsWith(`.${entry.host}`)) && entry.path.test(parsed.pathname)
  );
  return known ? `${parsed.origin}${parsed.pathname}` : undefined;
}
