/**
 * Finds, in an inbox's accessibility snapshot, the threads that belong to
 * prospects we DM'd.
 *
 * PURE. The input is the YAML text Playwright's `ariaSnapshot()` returns; the
 * output says which row to open for which conversation. Nothing here clicks,
 * so the matching rules are tested on saved snapshots.
 *
 * Getting this wrong means reading one prospect's messages into another
 * prospect's conversation, so the rules lean towards "no match":
 *  - a handle counts only as a whole token (or a profile link), never as a
 *    substring of a longer handle;
 *  - a name counts when it equals a label, or starts it at a word boundary
 *    (thread rows concatenate name, preview and time into one label);
 *  - a row two conversations claim equally, or a conversation that matches two
 *    rows equally, is left unmatched;
 *  - a row with nothing safe to click (no thread link, no name, no text) is
 *    opened by the conversation's own thread URL when the SDR knows it, and
 *    left unmatched otherwise;
 *  - once a thread is open, `threadLooksLike` must confirm it before anything
 *    is read from it.
 *
 * Snapshot text is untrusted prospect content. It is only compared here,
 * never interpreted.
 */

const CLICKABLE_ROLES = new Set(["link", "button", "row", "listitem", "option", "gridcell", "menuitem", "treeitem", "tab"]);

/** Thread URLs on Instagram Direct and Messenger. */
const THREAD_URL = /\/(direct\/t|messages\/(?:e2ee\/)?t|t)\/[^/?#\s]+/i;

/** Hosts a conversation's recorded thread URL may point at. */
const THREAD_HOST = /(^|\.)(instagram|facebook|messenger)\.com$/i;

/** "Vous : …" / "You: …" in a row preview means the last message is ours. */
const LAST_FROM_US = /(^|\s)(vous|you)\s?:\s/i;

const SCORE = { profileLink: 4, handle: 3, exactName: 2, namePrefix: 1 };

// ── Snapshot parsing ─────────────────────────────────────────────────────────

function unquoteYamlValue(value) {
  const trimmed = value.trim();
  if (trimmed.startsWith('"') && trimmed.endsWith('"') && trimmed.length >= 2) {
    // Playwright escapes control characters as \xNN, which JSON does not know.
    const jsonish = trimmed.replace(/\\x([0-9a-fA-F]{2})/g, "\\u00$1");
    try {
      return JSON.parse(jsonish);
    } catch {
      return trimmed.slice(1, -1);
    }
  }
  if (trimmed.startsWith("'") && trimmed.endsWith("'") && trimmed.length >= 2) {
    return trimmed.slice(1, -1).replace(/''/g, "'");
  }
  return trimmed;
}

/** Splits "key: value" / "key:" / "key", honouring a single-quoted YAML key. */
function splitKeyValue(rest) {
  if (rest.startsWith("'")) {
    let index = 1;
    let key = "";
    while (index < rest.length) {
      if (rest[index] === "'" && rest[index + 1] === "'") {
        key += "'";
        index += 2;
      } else if (rest[index] === "'") {
        index += 1;
        break;
      } else {
        key += rest[index];
        index += 1;
      }
    }
    const after = rest.slice(index);
    if (after.startsWith(":")) return { key, value: after.slice(1).trim() || undefined };
    return { key, value: undefined };
  }
  // Unquoted keys never contain ": " (Playwright would have quoted them).
  const match = /:(\s|$)/.exec(rest);
  if (!match) return { key: rest, value: undefined };
  return { key: rest.slice(0, match.index), value: rest.slice(match.index + 1).trim() || undefined };
}

/** `role "name" [attr]` → { role, name }. A /regex/ name is kept as written. */
function parseKey(key) {
  const match = /^([a-zA-Z]+)(?:\s+("(?:[^"\\]|\\.)*"|\/.*\/))?/.exec(key.trim());
  if (!match) return { role: key.trim(), name: "" };
  let name = "";
  if (match[2]?.startsWith('"')) {
    try {
      name = JSON.parse(match[2]);
    } catch {
      name = match[2].slice(1, -1);
    }
  } else if (match[2]) {
    name = match[2];
  }
  return { role: match[1].toLowerCase(), name };
}

/**
 * Parses an aria snapshot into a tree of nodes:
 * { role, name, text, url, children, parent }. Text lines become nodes with
 * role "text".
 */
export function parseAriaSnapshot(snapshot) {
  const root = { role: "root", name: "", text: "", url: undefined, children: [], parent: null, depth: -1 };
  const stack = [root];
  for (const line of String(snapshot ?? "").split(/\r?\n/)) {
    const match = /^(\s*)- (.*)$/.exec(line);
    if (!match) continue;
    const depth = Math.floor(match[1].length / 2);
    const rest = match[2];
    while (stack.length > 1 && stack[stack.length - 1].depth >= depth) stack.pop();
    const parent = stack[stack.length - 1];

    const prop = /^\/([\w-]+):\s?(.*)$/.exec(rest);
    if (prop) {
      if (prop[1] === "url") parent.url = unquoteYamlValue(prop[2]);
      continue;
    }
    if (rest.startsWith("text:")) {
      parent.children.push({ role: "text", name: "", text: unquoteYamlValue(rest.slice(5)), url: undefined, children: [], parent, depth });
      continue;
    }
    const { key, value } = splitKeyValue(rest);
    const { role, name } = parseKey(key);
    const node = { role, name, text: value ? unquoteYamlValue(value) : "", url: undefined, children: [], parent, depth };
    parent.children.push(node);
    stack.push(node);
  }
  return root;
}

function walk(node, visit) {
  visit(node);
  for (const child of node.children) walk(child, visit);
}

/** Every visible string of a subtree, in document order. */
function subtreeStrings(node) {
  const out = [];
  walk(node, (current) => {
    if (current.name) out.push(current.name);
    if (current.text) out.push(current.text);
  });
  return out;
}

// ── Normalisation ────────────────────────────────────────────────────────────

/** Names: lowercase, no accents, punctuation as spaces. "Fleurs de Lise !" → "fleurs de lise". */
export function normaliseName(value) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** Message text for prefix checks: lowercase, straight quotes, collapsed whitespace. */
function normaliseMessage(value) {
  return String(value ?? "")
    .normalize("NFC")
    .replace(/[\u2018\u2019\u02bc]/g, "'")
    .replace(/[\u201c\u201d]/g, '"')
    .replace(/[\u200b-\u200d\u2060\ufeff]/g, "")
    .replace(/\s+/g, " ")
    .toLowerCase()
    .trim();
}

/**
 * Handles worth searching for. Facebook "id:123" handles and bare numeric
 * page ids never appear in visible text, and very short handles would match
 * by accident.
 */
function searchableHandle(handle) {
  const value = String(handle ?? "").trim().replace(/^@/, "").toLowerCase();
  if (value.length < 3 || value.startsWith("id:") || /^\d+$/.test(value)) return null;
  return value;
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Whole-token handle match. Handle characters are letters, digits, "_" and
 * "."; a trailing "." is sentence punctuation, since handles cannot end with one.
 */
function containsHandle(text, handle) {
  const pattern = new RegExp(`(^|[^a-z0-9._])${escapeRegExp(handle)}(?=$|[^a-z0-9._]|\\.(?![a-z0-9_]))`);
  return pattern.test(String(text ?? "").toLowerCase());
}

/** Does `url` point at the profile of `handle` (absolute or site-relative)? */
function isProfileLink(url, handle) {
  if (!url) return false;
  const pattern = new RegExp(`^(?:https?://(?:[a-z]+\\.)?(?:instagram|facebook)\\.com)?/${escapeRegExp(handle)}/?(?:[?#].*)?$`, "i");
  return pattern.test(url.trim());
}

/**
 * Handles made only of letters ("fleurs") are also ordinary words, so they
 * count as a token only where Instagram prints usernames: a profile picture's
 * alt text, or a label that is exactly the handle. Handles with ".", "_" or a
 * digit do not occur in prose and count anywhere as a whole token.
 */
function handleScore(node, handle) {
  if (isProfileLink(node.url, handle)) return SCORE.profileLink;
  const labels = [node.name, node.text].map((value) => String(value ?? "").trim().toLowerCase().replace(/^@/, ""));
  if (labels.includes(handle)) return SCORE.handle;
  if (node.role === "img" && containsHandle(node.name, handle)) return SCORE.handle;
  if (/[._0-9]/.test(handle) && (containsHandle(node.name, handle) || containsHandle(node.text, handle))) return SCORE.handle;
  return 0;
}

// ── Matching ─────────────────────────────────────────────────────────────────

const isThreadLink = (node) => node.role === "link" && Boolean(node.url) && THREAD_URL.test(node.url);
const isOtherLink = (node) => node.role === "link" && Boolean(node.url) && !THREAD_URL.test(node.url);

/**
 * The row to open for a matching node: the nearest thread link, else the
 * nearest clickable ancestor. A link to anywhere else (the prospect's profile
 * in a thread header, for instance) is not a row: clicking it would leave the
 * inbox. Returns null when there is nothing safe to click.
 */
function rowFor(node) {
  let insideOtherLink = false;
  for (let current = node; current && current.role !== "root"; current = current.parent) {
    if (isThreadLink(current)) return current;
    if (isOtherLink(current)) {
      insideOtherLink = true;
      continue;
    }
    if (CLICKABLE_ROLES.has(current.role)) return current;
  }
  // Some inboxes render rows as plain divs, which leave only text lines in the
  // snapshot; the text itself is then what gets clicked.
  return node.role === "text" && !insideOtherLink ? node : null;
}

/** A row's thread URL: its own, or a thread link inside it. */
function rowThreadUrl(row) {
  let found;
  walk(row, (current) => {
    if (!found && isThreadLink(current)) found = current.url;
  });
  return found;
}

/**
 * The thread URL the SDR recorded for this conversation (the page URL when
 * the thread was last open), when it is a Meta DM thread link. Anything else
 * (a profile URL, another site) is not used.
 */
function knownThreadUrl(conversation) {
  const value = String(conversation?.threadUrl ?? "").trim();
  if (!value) return undefined;
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    return undefined;
  }
  if (parsed.protocol !== "https:" || !THREAD_HOST.test(parsed.hostname) || !THREAD_URL.test(parsed.pathname)) return undefined;
  return value;
}

/** Visible text to click when the row has no accessible name: a text line, not an image's alt. */
function clickText(row, node) {
  if (node.role === "text" || node.text) return node.text;
  let found = "";
  walk(row, (current) => {
    if (!found && (current.role === "text" || current.text)) found = current.text;
  });
  return found || row.name || node.name;
}

function scoreNode(node, handle, name) {
  let best = handle ? handleScore(node, handle) : 0;
  if (name) {
    for (const candidate of [node.name, node.text]) {
      const normalised = normaliseName(candidate);
      if (!normalised) continue;
      if (normalised === name) best = Math.max(best, SCORE.exactName);
      else if (normalised.startsWith(`${name} `)) best = Math.max(best, SCORE.namePrefix);
    }
  }
  return best;
}

/**
 * The thread entry a row belongs to: the top of the unbroken chain of
 * clickable ancestors above it. A Messenger row wraps a thread link and both
 * can match, so nested clickables count as one entry, not as two look-alike
 * rows. The chain stops at the first non-clickable container (a list, a
 * grid), so separate rows stay separate.
 */
function entryOf(row) {
  let entry = row;
  while (entry.parent && CLICKABLE_ROLES.has(entry.parent.role) && !isOtherLink(entry.parent)) entry = entry.parent;
  return entry;
}

/** Of two rows in one entry, the one to click: a thread link, else the deeper named one. */
function betterTarget(current, candidate) {
  if (isThreadLink(current)) return current;
  if (isThreadLink(candidate)) return candidate;
  if (candidate.name && (!current.name || candidate.depth > current.depth)) return candidate;
  return current;
}

/** Score per thread entry: the best evidence found anywhere inside it. */
function entryScores(nodes, handle, name) {
  const byEntry = new Map();
  for (const node of nodes) {
    const score = scoreNode(node, handle, name);
    if (!score) continue;
    const row = rowFor(node);
    if (!row) continue;
    const entry = entryOf(row);
    const previous = byEntry.get(entry);
    if (!previous) {
      byEntry.set(entry, { score, node, target: row });
      continue;
    }
    if (score > previous.score) {
      previous.score = score;
      previous.node = node;
    }
    previous.target = betterTarget(previous.target, row);
  }
  return byEntry;
}

function lastMessageIsOurs(row, ourPrefixes) {
  const strings = subtreeStrings(row);
  if (strings.some((value) => LAST_FROM_US.test(value))) return true;
  const plain = normaliseMessage(strings.join(" "));
  return ourPrefixes.some((prefix) => plain.includes(prefix));
}

/** The first characters of our own messages, as they would appear in a row preview. */
function previewPrefixes(ourTexts) {
  return (ourTexts ?? [])
    .map((text) => normaliseMessage(text).slice(0, 24))
    .filter((prefix) => prefix.length >= 12);
}

/**
 * @param {string} snapshotText  aria snapshot of the inbox list
 * @param {Array<{ conversationId: string, companyName?: string, handle?: string, threadUrl?: string, ourTexts?: string[] }>} conversations
 * @returns {Map<string, { role?: string, name?: string, text: string, url?: string, matchedBy: "profile_link" | "handle" | "name", lastFromUs: boolean }>}
 *   For each matched conversation, how to open its row: `url` when the row
 *   links to the thread or the conversation's thread URL is known, else
 *   `role` + `name` for getByRole, else `text`.
 */
export function matchThreads(snapshotText, conversations) {
  const root = parseAriaSnapshot(snapshotText);
  const nodes = [];
  walk(root, (node) => {
    if (node !== root) nodes.push(node);
  });

  // The single best entry for each conversation.
  const candidates = [];
  for (const conversation of conversations ?? []) {
    const handle = searchableHandle(conversation.handle);
    const companyName = normaliseName(conversation.companyName);
    const name = companyName.length >= 3 ? companyName : null;
    if (!handle && !name) continue;

    let entries = [...entryScores(nodes, handle, name).entries()];
    // Entries that link to a thread are inbox rows for sure; prefer them over
    // look-alikes elsewhere on the page (an open thread's header, a search result).
    const threadEntries = entries.filter(([entry]) => rowThreadUrl(entry));
    if (threadEntries.length) entries = threadEntries;
    if (!entries.length) continue;
    const top = Math.max(...entries.map(([, found]) => found.score));
    const topEntries = entries.filter(([, found]) => found.score === top);
    // The same prospect twice in the visible list cannot be told apart safely.
    if (topEntries.length !== 1) continue;
    const [entry, found] = topEntries[0];
    candidates.push({ conversation, entry, found, score: top, nameLength: name?.length ?? 0 });
  }

  // One conversation per entry: the strongest claim wins; an exact tie is dropped.
  const claimsByEntry = new Map();
  for (const candidate of candidates) {
    const claims = claimsByEntry.get(candidate.entry) ?? [];
    claims.push(candidate);
    claimsByEntry.set(candidate.entry, claims);
  }

  const result = new Map();
  for (const [entry, claims] of claimsByEntry) {
    claims.sort((a, b) => b.score - a.score || b.nameLength - a.nameLength);
    const [first, second] = claims;
    if (second && second.score === first.score && second.nameLength === first.nameLength) continue;
    const { target, node } = first.found;
    const named = CLICKABLE_ROLES.has(target.role) && Boolean(String(target.name ?? "").trim());
    const text = clickText(target, node);
    // The row's own thread link, else the thread URL the SDR recorded for this
    // conversation: a row with nothing to click is still opened by its URL, so
    // a new reply in it is not missed.
    const url = rowThreadUrl(entry) ?? knownThreadUrl(first.conversation);
    // Nothing safe to open the row with (no thread link or known URL, no name,
    // no text): an empty text would match any empty element on the page.
    if (!url && !named && !String(text ?? "").trim()) continue;
    result.set(first.conversation.conversationId, {
      role: named ? target.role : undefined,
      name: named ? target.name : undefined,
      text,
      url,
      matchedBy: first.score === SCORE.profileLink ? "profile_link" : first.score === SCORE.handle ? "handle" : "name",
      lastFromUs: lastMessageIsOurs(entry, previewPrefixes(first.conversation.ourTexts))
    });
  }
  return result;
}

/**
 * PURE: once a thread is open, is it really this prospect's?
 *
 * True when the conversation pane shows one of the messages we sent them, or
 * their handle (same evidence rules as the matcher). A matching display name
 * alone is not enough: two businesses can share a name, but not a handle or
 * our personalised DM.
 */
export function threadLooksLike(snapshotText, conversation) {
  const root = parseAriaSnapshot(snapshotText);
  const haystack = normaliseMessage(subtreeStrings(root).join(" "));
  const ours = (conversation?.ourTexts ?? [])
    .map((text) => normaliseMessage(text).slice(0, 30))
    .filter((prefix) => prefix.length >= 12);
  if (ours.some((prefix) => haystack.includes(prefix))) return true;
  const handle = searchableHandle(conversation?.handle);
  if (!handle) return false;
  let seen = false;
  walk(root, (node) => {
    if (!seen && handleScore(node, handle) > 0) seen = true;
  });
  return seen;
}
