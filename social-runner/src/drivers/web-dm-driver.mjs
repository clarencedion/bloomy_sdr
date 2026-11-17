/**
 * The browser driver behind both networks. Instagram and Facebook differ only
 * in URLs, labels and selectors, which live in one config object per network
 * (instagram-driver.mjs, facebook-driver.mjs): when Meta changes its interface,
 * the fix is in that one file.
 *
 * Every navigation is followed by a blocker check. Every path that cannot find
 * what it expects returns a reason instead of guessing: no fallback ever
 * clicks an unlabelled element (a profile's "..." menu also holds "Block" and
 * "Report").
 */
import { detectBlocker } from "../blockers.mjs";
import { normaliseForCompare } from "../composer.mjs";
import {
  classifyThread,
  confirmBubble,
  dismissInterstitials,
  firstVisible,
  gotoChecked,
  mainText,
  observeThread,
  pageBlocker,
  pinSingleComposer,
  settleAndCheck,
  snapshotOf,
  textVisible,
  threadUrlOf
} from "./common.mjs";

const BUTTON_TIMEOUT_MS = 8000;
const COMPOSER_TIMEOUT_MS = 15000;

/**
 * @param {{
 *   network: "instagram" | "facebook",
 *   homeUrl: string,
 *   inboxUrl: string,
 *   messageButton: RegExp,
 *   composer: (page: any) => any,
 *   closeChatButton?: RegExp,
 *   recipientLinks?: (page: any) => any,
 *   emptyThread?: { recipientLabel: string, handleLine: (handle: string) => RegExp,
 *     interfaces: Array<{ header: string[], labels: string[], verified: string, typingLabels: string[] }>, roles: string[], maxImages: number },
 *   notFoundText: RegExp,
 *   privateText?: RegExp,
 *   loggedInMarker: (page: any) => any,
 *   identityFromSnapshot: (snapshot: string) => string | undefined,
 *   threadListSelectors: string[],
 *   conversationPaneSelectors: string[]
 * }} config
 */
export function createWebDmDriver(config) {
  const visibleComposers = (page) => config.composer(page).filter({ visible: true });

  /**
   * Exactly one composer must be on screen. Two would mean an older chat
   * window is still open, and typing into the wrong one would message the
   * wrong prospect, so that is a stop, not a guess. The one found is pinned
   * to its element (pinComposer), so a window opening later cannot take its
   * place.
   */
  async function singleComposer(page) {
    const found = await pinSingleComposer(() => config.composer(page), COMPOSER_TIMEOUT_MS);
    if (!found.ok && found.reason === "no_composer") {
      const restriction = detectBlocker({ url: page.url(), text: await mainText(page) });
      return { ok: false, reason: restriction ?? "no_composer" };
    }
    return found;
  }

  /** Closes every chat window on screen (networks that open chats as windows). */
  async function closeChat(page) {
    if (!config.closeChatButton) return;
    const buttons = page.getByRole("button", { name: config.closeChatButton }).filter({ visible: true });
    const count = await buttons.count().catch(() => 0);
    for (let index = 0; index < count; index += 1) {
      await buttons.first().click().catch(() => undefined);
    }
  }

  /** After a send that re-rendered the thread: the one composer on screen now, else null. */
  async function currentComposer(page) {
    const visible = visibleComposers(page);
    return (await visible.count().catch(() => 0)) === 1 ? visible.first() : null;
  }

  return {
    network: config.network,
    homeUrl: config.homeUrl,

    async isLoggedIn(page) {
      return (await config.loggedInMarker(page).count().catch(() => 0)) > 0;
    },

    /** The network's home page, checked for blockers, where the session reads who is logged in. */
    async openHome(page) {
      const blocked = await gotoChecked(page, config.homeUrl);
      if (blocked) return { ok: false, reason: blocked };
      await dismissInterstitials(page);
      return { ok: true };
    },

    /**
     * The account the window acts as (Instagram username, Facebook profile or
     * Page name), read from the navigation; undefined when it cannot be read
     * with confidence.
     */
    async activeIdentity(page) {
      const navigation = page.locator('nav, [role="navigation"], [role="banner"]').filter({ visible: true });
      const count = Math.min(await navigation.count().catch(() => 0), 6);
      const parts = [];
      for (let index = 0; index < count; index += 1) {
        parts.push(await navigation.nth(index).ariaSnapshot({ timeout: 5000 }).catch(() => ""));
      }
      const fromNavigation = config.identityFromSnapshot(parts.join("\n"));
      if (fromNavigation) return fromNavigation;
      // Instagram's 2026 sidebar is no navigation landmark: read the whole page.
      // The identity rules are strict enough for that (identity.mjs).
      const whole = await page.locator("body").ariaSnapshot({ timeout: 8000 }).catch(() => "");
      return config.identityFromSnapshot(whole);
    },

    async openConversation(page, profile) {
      const blocked = await gotoChecked(page, profile.url);
      if (blocked) return { ok: false, reason: blocked };
      await dismissInterstitials(page);

      if ((await visibleComposers(page).count()) > 0) {
        return { ok: false, reason: { kind: "unexpected", detail: "chat_window_already_open" } };
      }

      const name = config.messageButton;
      const button = await firstVisible(
        page.getByRole("button", { name }).or(page.getByRole("link", { name })),
        BUTTON_TIMEOUT_MS
      );
      if (!button) {
        if (await textVisible(page, config.notFoundText)) return { ok: false, reason: "not_found" };
        if (config.privateText && (await textVisible(page, config.privateText))) return { ok: false, reason: "private" };
        return { ok: false, reason: "no_message_button" };
      }

      await button.click();
      const after = await settleAndCheck(page);
      if (after) return { ok: false, reason: after };
      await dismissInterstitials(page);
      const opened = await singleComposer(page);
      if (!opened.ok || !config.recipientLinks) return opened;
      // The chat window must be the prospect's: a docked conversation with
      // someone else would take the message otherwise.
      const hrefs = await config
        .recipientLinks(page)
        .filter({ visible: true })
        .evaluateAll((links) => links.map((link) => link.getAttribute("href") ?? ""))
        .catch(() => []);
      const target = `/${String(profile.handle ?? "").toLowerCase()}/`;
      if (!hrefs.some((href) => href.toLowerCase().replace(/^https?:\/\/(www\.)?instagram\.com/, "").split("?")[0] === target)) {
        await closeChat(page);
        return { ok: false, reason: "wrong_recipient" };
      }
      return opened;
    },

    /** Closes the chat window a conversation opened, so the next prospect starts clean. */
    closeConversation: (page) => closeChat(page),

    confirmSent: (page, text, composer) => confirmBubble(page, text, composer, { relocate: () => currentComposer(page) }),

    /**
     * The one composer on screen now, or null: the page may have rebuilt the
     * conversation's composer, leaving the pinned one detached while the
     * text is still there, unsent.
     */
    currentComposer: (page) => currentComposer(page),

    /**
     * Is this conversation new? Only networks whose empty chat window has been
     * described (`emptyThread`) can answer; the others have no such method,
     * and an automatic session refuses to run on them.
     * `typed`: the composer holds the message, so the interface shows its
     * "Send" button.
     * @returns {Promise<{ state: "empty" | "has_content" | "unknown", why?: string }>}
     */
    ...(config.emptyThread
      ? {
          async threadState(page, composer, profile, { typed = false } = {}) {
            const observation = await observeThread(page, composer, config.emptyThread, () => currentComposer(page));
            return classifyThread(observation, { ...config.emptyThread, handle: String(profile?.handle ?? ""), typed });
          }
        }
      : {}),
    checkBlocker: (page) => pageBlocker(page),
    threadUrl: (page) => threadUrlOf(page.url()),

    async openInbox(page) {
      const blocked = await gotoChecked(page, config.inboxUrl);
      if (blocked) return { ok: false, reason: blocked };
      await dismissInterstitials(page);
      return { ok: true };
    },

    listThreads: (page) => snapshotOf(page, config.threadListSelectors),

    /** `ref` comes from matchThreads: a thread URL when known, else a role+name or text to click. */
    async openThread(page, ref) {
      if (ref.url) {
        const blocked = await gotoChecked(page, new URL(ref.url, config.homeUrl).href);
        if (blocked) return { ok: false, reason: blocked };
      } else {
        const named = Boolean(ref.role && normaliseForCompare(ref.name));
        // An empty text would match any empty element on the page: never click that.
        if (!named && !normaliseForCompare(ref.text)) return { ok: false, reason: "thread_not_found" };
        const target = named ? page.getByRole(ref.role, { name: ref.name, exact: true }) : page.getByText(ref.text, { exact: true });
        const row = await firstVisible(target, BUTTON_TIMEOUT_MS);
        if (!row) return { ok: false, reason: "thread_not_found" };
        await row.click();
        const blocked = await settleAndCheck(page);
        if (blocked) return { ok: false, reason: blocked };
      }
      await dismissInterstitials(page);
      return singleComposer(page);
    },

    threadSnapshot: (page) => snapshotOf(page, config.conversationPaneSelectors)
  };
}
