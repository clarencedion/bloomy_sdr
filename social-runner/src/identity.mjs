/**
 * Which account the browser window acts as, and whether it is the one the
 * business configured (business.socialAccounts).
 *
 * PURE: reads the aria snapshot of the page's navigation (see
 * web-dm-driver.mjs `activeIdentity`). Detection is deliberately strict: an
 * identity is returned only from the navigation's own "Profile" entry, never
 * from a post author or a suggested account, and two different candidates
 * mean "unknown". Whatever is detected, the session still asks the operator to
 * confirm the account (session-start.mjs) before the first message.
 */
import { normaliseText } from "./blockers.mjs";
import { parseAriaSnapshot } from "./inbox-matcher.mjs";

function walk(node, visit) {
  visit(node);
  for (const child of node.children) walk(child, visit);
}

function textsOf(node) {
  const texts = [];
  walk(node, (current) => {
    if (current.role === "text" && current.text) texts.push(current.text);
  });
  return texts;
}

// ── Instagram ────────────────────────────────────────────────────────────────

/** First-level paths that are Instagram sections, not usernames. */
const INSTAGRAM_RESERVED = new Set(["explore", "reels", "reel", "direct", "accounts", "p", "stories", "about", "legal", "web", "challenge"]);
const INSTAGRAM_PROFILE_PATH = /^(?:https?:\/\/(?:www\.)?instagram\.com)?\/([A-Za-z0-9._]{1,30})\/?$/;
const PROFILE_LABEL = /^(profil|profile)$/i;

/**
 * The username of the logged-in Instagram account: the navigation link whose
 * own label is "Profil" / "Profile" and which points at /<username>/.
 */
export function instagramIdentityFromSnapshot(snapshot) {
  const found = new Set();
  walk(parseAriaSnapshot(snapshot), (node) => {
    if (node.role !== "link" || !node.url) return;
    const match = INSTAGRAM_PROFILE_PATH.exec(node.url);
    if (!match || INSTAGRAM_RESERVED.has(match[1].toLowerCase())) return;
    const labelled =
      PROFILE_LABEL.test(String(node.name ?? "").trim()) ||
      textsOf(node).some((text) => PROFILE_LABEL.test(text.trim())) ||
      /(^|\s)(profil|profile)$/i.test(String(node.name ?? "").trim());
    if (labelled) found.add(match[1].toLowerCase());
  });
  if (found.size) return found.size === 1 ? [...found][0] : undefined;
  return instagramIdentityFromPicture(snapshot);
}

const PICTURE_LABEL = /^(?:Photo de profil de (.+)|(.+)'s profile picture)$/i;

/**
 * The 2026 navigation has no "Profil" text: the account is the link labelled
 * "Photo de profil de <username>" next to the Direct link. Only that shape
 * counts — a sibling of the link to /direct/inbox/, whose label names the
 * username its URL points at — so a post author's picture in the feed (never
 * next to the Direct link) is not taken for the account.
 */
function instagramIdentityFromPicture(snapshot) {
  const found = new Set();
  walk(parseAriaSnapshot(snapshot), (node) => {
    if (node.role !== "link" || !node.url || !node.parent) return;
    const label = PICTURE_LABEL.exec(String(node.name ?? "").trim());
    const path = INSTAGRAM_PROFILE_PATH.exec(node.url);
    if (!label || !path || INSTAGRAM_RESERVED.has(path[1].toLowerCase())) return;
    const named = (label[1] ?? label[2]).trim().toLowerCase();
    if (named !== path[1].toLowerCase()) return;
    const nextToDirect = node.parent.children.some((sibling) => sibling.role === "link" && /^\/direct\/inbox\/?$/.test(String(sibling.url ?? "")));
    if (nextToDirect) found.add(named);
  });
  return found.size === 1 ? [...found][0] : undefined;
}

// ── Facebook ─────────────────────────────────────────────────────────────────

/** First-level paths that are Facebook sections, not profiles or Pages. */
const FACEBOOK_RESERVED = new Set([
  "friends",
  "groups",
  "marketplace",
  "watch",
  "gaming",
  "events",
  "memories",
  "saved",
  "pages",
  "messages",
  "bookmarks",
  "feeds",
  "reel",
  "reels",
  "stories",
  "notifications",
  "settings",
  "help",
  "ads",
  "fundraisers",
  "business",
  "search",
  "login",
  "home.php"
]);

function facebookProfilePath(url) {
  let parsed;
  try {
    parsed = new URL(url, "https://www.facebook.com/");
  } catch {
    return false;
  }
  if (!/(^|\.)facebook\.com$/i.test(parsed.hostname)) return false;
  if (parsed.pathname === "/profile.php") return /^\d+$/.test(parsed.searchParams.get("id") ?? "");
  const segments = parsed.pathname.split("/").filter(Boolean);
  return segments.length === 1 && !FACEBOOK_RESERVED.has(segments[0].toLowerCase());
}

/**
 * The name of the profile or Page the Facebook window acts as: the first
 * navigation link to a profile that carries a picture and a name (the
 * shortcut at the top of the left column). Undefined when absent or when
 * the first two such links disagree.
 */
export function facebookIdentityFromSnapshot(snapshot) {
  const candidates = [];
  walk(parseAriaSnapshot(snapshot), (node) => {
    if (node.role !== "link" || !node.url || !facebookProfilePath(node.url)) return;
    let hasPicture = false;
    walk(node, (current) => {
      if (current.role === "img") hasPicture = true;
    });
    const name = (textsOf(node)[0] ?? String(node.name ?? "")).trim();
    if (hasPicture && name) candidates.push(name);
  });
  if (!candidates.length) return undefined;
  return candidates.every((name) => normaliseName(name) === normaliseName(candidates[0])) ? candidates[0] : undefined;
}

// ── Comparing with the business settings ─────────────────────────────────────

function normaliseName(value) {
  return normaliseText(value).replace(/^@/, "");
}

/** The configured account for this network, as a display string, or undefined. */
export function expectedAccount(socialAccounts, network) {
  const account = socialAccounts?.[network];
  const value = network === "instagram" ? account?.handle : account?.name;
  const trimmed = typeof value === "string" ? value.trim().replace(/^@/, "") : "";
  return trimmed || undefined;
}

/** PURE: does the detected identity name the configured account? */
export function identityMatches(detected, expected) {
  if (!detected || !expected) return false;
  return normaliseName(detected) === normaliseName(expected);
}

/** How the operator reads an identity: @username on Instagram, the name on Facebook. */
export function displayIdentity(network, identity) {
  return network === "instagram" ? `@${String(identity).replace(/^@/, "")}` : String(identity);
}
