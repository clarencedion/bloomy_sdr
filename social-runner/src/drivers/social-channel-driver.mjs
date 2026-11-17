/**
 * SocialChannelDriver: what the session machines need from a network.
 *
 * Drivers find things and read things. They never decide to send: the only
 * send is `sendFromComposer` in composer.mjs, called by session-machine.mjs
 * after the operator's Enter for that message. A driver that cannot find what
 * it expects returns a reason; a driver that lands on a blocker returns it so
 * the session stops.
 *
 * @typedef {import("../blockers.mjs").Blocker} Blocker
 * @typedef {{ url: string, handle: string }} SocialProfileRef
 * @typedef {{ ok: true, composer: any } | { ok: false, reason: string | Blocker }} OpenResult
 *
 * @typedef {Object} SocialChannelDriver
 * @property {"instagram" | "facebook"} network
 * @property {string} homeUrl                         where `login` sends the operator
 * @property {(page: any) => Promise<boolean>} isLoggedIn
 * @property {(page: any, profile: SocialProfileRef) => Promise<OpenResult>} openConversation
 *   Profile → "Message" → composer. Reasons: "no_message_button" | "private" |
 *   "not_found" | "no_composer" | a Blocker.
 * @property {(page: any) => Promise<void>} closeConversation   closes a chat window the conversation opened (no-op where none)
 * @property {(page: any, text: string, composer?: any) => Promise<boolean>} confirmSent
 *   true when the composer emptied and a bubble with the text is visible within 8 s
 * @property {(page: any) => Promise<Blocker | null>} checkBlocker
 * @property {(page: any) => string | undefined} threadUrl     the current DM thread URL, if the page is one
 * @property {(page: any) => Promise<{ ok: true } | { ok: false, reason: Blocker }>} openInbox
 * @property {(page: any) => Promise<string>} listThreads       aria snapshot of the inbox list
 * @property {(page: any, ref: { url?: string, role?: string, name?: string, text?: string }) => Promise<OpenResult>} openThread
 * @property {(page: any) => Promise<string>} threadSnapshot    aria snapshot of the open conversation
 */
import { createFacebookDriver } from "./facebook-driver.mjs";
import { createInstagramDriver } from "./instagram-driver.mjs";

/** @returns {SocialChannelDriver} */
export function createSocialChannelDriver(network) {
  if (network === "instagram") return createInstagramDriver();
  if (network === "facebook") return createFacebookDriver();
  throw new Error(`Réseau inconnu : ${network}`);
}
