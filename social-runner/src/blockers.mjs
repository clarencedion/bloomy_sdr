/**
 * Recognises the pages on which a social session must stop at once.
 *
 * Pure: it reads a URL and some page text, nothing else, so the whole table is
 * unit-tested offline. The drivers call it after every navigation and the
 * session machine calls it again right before every send.
 *
 * A match is never something to work around. Login walls, checkpoints,
 * CAPTCHAs and "try again later" banners are Meta telling the account to slow
 * down or prove it is human; the runner stops, reports, and leaves the human to
 * deal with it in the browser. There is deliberately no retry path.
 *
 * The drivers pass interface text only (title, headings, dialogs, alerts), not
 * the whole page: a prospect's bio or message saying "réessayez plus tard"
 * must not end every session that opens their profile.
 */

/** @typedef {"login" | "checkpoint" | "captcha" | "rate_limited" | "action_blocked" | "unexpected"} BlockerKind */
/** @typedef {{ kind: BlockerKind, detail: string }} Blocker */

/** Hosts a session is expected to be on. Anything else is an unexpected redirect. */
const META_HOSTS = ["instagram.com", "facebook.com", "messenger.com", "fb.com", "m.me"];

/**
 * URL patterns, checked first because they are unambiguous. Only the path is
 * tested: a login URL can carry "checkpoint" in its `next` parameter.
 */
const URL_RULES = [
  { kind: "captcha", detail: "captcha_url", test: (u) => /captcha|arkose/i.test(u.pathname) },
  { kind: "checkpoint", detail: "challenge", test: (u) => /\/challenge(\/|$)/i.test(u.pathname) },
  { kind: "checkpoint", detail: "checkpoint", test: (u) => /\/checkpoint(\/|$)/i.test(u.pathname) },
  { kind: "checkpoint", detail: "account_suspended", test: (u) => /\/accounts\/suspended(\/|$)/i.test(u.pathname) },
  { kind: "login", detail: "instagram_login", test: (u) => isHost(u, "instagram.com") && /^\/accounts\/login(\/|$)/i.test(u.pathname) },
  { kind: "login", detail: "facebook_login", test: (u) => (isHost(u, "facebook.com") || isHost(u, "messenger.com")) && /^\/login(\.php|\/|$)/i.test(u.pathname) },
  // After the login rules: Instagram's own 2FA step lives under /accounts/login/.
  { kind: "checkpoint", detail: "two_step_verification", test: (u) => /\/(two_step_verification|two_factor|auth_platform)(\/|$)/i.test(u.pathname) }
];

/**
 * Text patterns, written in the normalised form produced by `normaliseText`
 * (lowercase, no accents, straight apostrophes). French and English, because
 * Meta follows the account's interface language.
 */
const TEXT_RULES = [
  { kind: "captcha", patterns: ["captcha", "i'm not a robot", "je ne suis pas un robot"] },
  {
    kind: "checkpoint",
    patterns: [
      "confirm it's you",
      "confirmez qu'il s'agit bien de vous",
      "help us confirm",
      "aidez-nous a confirmer",
      "suspicious login attempt",
      "tentative de connexion suspecte",
      "we suspended your account",
      "nous avons suspendu votre compte"
    ]
  },
  {
    kind: "rate_limited",
    patterns: ["try again later", "reessayez plus tard", "we restrict certain activity", "nous limitons"]
  },
  {
    kind: "action_blocked",
    patterns: [
      "action blocked",
      "action bloquee",
      "temporarily blocked",
      "temporairement bloque",
      "vous ne pouvez pas envoyer de messages",
      "you can't message this account",
      "you can't send messages"
    ]
  },
  {
    kind: "login",
    patterns: ["log in to continue", "connectez-vous pour continuer", "log in to facebook", "connectez-vous a facebook", "se connecter a facebook"]
  },
  // End-to-end encrypted Messenger chats can ask for a PIN before showing the
  // history. Entering it is the human's job, not the runner's.
  { kind: "unexpected", patterns: ["restore chat history", "restaurer l'historique des discussions", "saisissez votre code pin"] }
];

/** Lowercase, accents removed, curly apostrophes straightened, whitespace collapsed. */
export function normaliseText(text) {
  return String(text ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[\u2018\u2019\u02bc]/g, "'")
    .replace(/\s+/g, " ")
    .toLowerCase()
    .trim();
}

function isHost(url, domain) {
  const host = url.hostname.toLowerCase();
  return host === domain || host.endsWith(`.${domain}`);
}

function parseUrl(url) {
  try {
    return new URL(url);
  } catch {
    return null;
  }
}

/**
 * @param {{ url?: string, text?: string }} input
 * @returns {Blocker | null}
 */
export function detectBlocker({ url, text } = {}) {
  const rawUrl = String(url ?? "").trim();
  if (rawUrl && rawUrl !== "about:blank") {
    // Chrome's own error page: the network dropped or the site refused us.
    if (rawUrl.startsWith("chrome-error://")) return { kind: "unexpected", detail: "browser_error_page" };
    const parsed = parseUrl(rawUrl);
    if (!parsed) return { kind: "unexpected", detail: "unparseable_url" };
    if (parsed.protocol === "http:" || parsed.protocol === "https:") {
      if (!META_HOSTS.some((domain) => isHost(parsed, domain))) {
        return { kind: "unexpected", detail: `off_platform:${parsed.hostname}` };
      }
      for (const rule of URL_RULES) {
        if (rule.test(parsed)) return { kind: rule.kind, detail: rule.detail };
      }
    }
  }

  const haystack = normaliseText(text);
  if (!haystack) return null;
  for (const rule of TEXT_RULES) {
    const hit = rule.patterns.find((pattern) => haystack.includes(pattern));
    if (hit) return { kind: rule.kind, detail: hit };
  }
  return null;
}

/**
 * The part of a URL that is safe to store: origin and path. Checkpoint and
 * login URLs carry tokens and the post-login redirect in their query string.
 */
export function redactUrl(url) {
  const parsed = parseUrl(String(url ?? ""));
  if (!parsed) return undefined;
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return `${parsed.protocol}//`;
  return `${parsed.origin}${parsed.pathname}`;
}

/** French one-liners for the terminal, keyed by blocker kind. */
export const BLOCKER_LABELS_FR = {
  login: "Page de connexion : la session n'est plus connectée.",
  checkpoint: "Vérification de sécurité Meta (checkpoint / « confirmez qu'il s'agit bien de vous »).",
  captcha: "CAPTCHA affiché.",
  rate_limited: "Meta limite l'activité (« réessayez plus tard »).",
  action_blocked: "Action bloquée par Meta.",
  unexpected: "Page inattendue."
};
