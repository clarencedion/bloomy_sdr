/**
 * Opens the visible browser on the business's own persistent profile.
 *
 * Plain Playwright, nothing else: no stealth plugin, no proxy, no fingerprint
 * tweaks, one account per profile. The window is headed and real-size so the
 * operator sees everything the runner does.
 */
import { chromium } from "playwright-core";
import { prepareProfileDir, profileDir } from "./profile.mjs";

/** Provider-timeout rule: every action and navigation gives up after 15 s. */
const PAGE_TIMEOUT_MS = 15000;

/**
 * @param {{ businessId: string, channel?: "chrome" }} options
 *   `channel: "chrome"` uses the installed Google Chrome (own profile folder);
 *   by default the Chromium build Playwright ships with, which does not
 *   auto-update under the runner's feet.
 */
export async function openBrowser({ businessId, channel }) {
  const dir = profileDir(businessId, channel);
  await prepareProfileDir(dir);

  const context = await chromium.launchPersistentContext(dir, {
    headless: false,
    viewport: null,
    args: ["--window-size=1280,900"],
    locale: "fr-FR",
    // The runner closes the browser itself, after ending the session record:
    // Playwright killing it on a signal could lose the session cookies.
    handleSIGINT: false,
    handleSIGTERM: false,
    handleSIGHUP: false,
    ...(channel === "chrome" ? { channel: "chrome" } : {})
  });

  // A persistent launch already has a tab; reuse it rather than open a second window.
  const page = context.pages()[0] ?? (await context.newPage());
  page.setDefaultTimeout(PAGE_TIMEOUT_MS);
  page.setDefaultNavigationTimeout(PAGE_TIMEOUT_MS);

  let closed = false;
  return {
    context,
    page,
    profileDir: dir,
    async close() {
      if (closed) return;
      closed = true;
      try {
        await context.close();
      } catch {
        // Already gone (window closed by hand).
      }
    }
  };
}
