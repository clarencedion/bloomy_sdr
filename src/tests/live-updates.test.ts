import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");

/**
 * Navigating between pages must change only the page.
 *
 * The App Router already keeps the layout mounted, but the shell refetched
 * global settings and the sidebar refetched the approval count with `pathname`
 * in their dependency arrays. So every navigation re-ran both, the topbar
 * status, safe-mode banner and badge all re-resolved, and a client-side
 * navigation looked like a full page reload. It also cost a read per page view.
 */
describe("Navigation changes the page, not the shell", () => {
  it("does not refetch settings when the route changes", () => {
    const shell = read("src/components/layout/app-shell.tsx");
    expect(shell).not.toContain("usePathname");
    expect(shell).toContain("useLiveDoc");
  });

  it("does not refetch the approval badge when the route changes", () => {
    const sidebar = read("src/components/layout/app-sidebar.tsx");
    // `pathname` is still used to highlight the active link — that is layout,
    // not a fetch. What must not come back is a data call keyed on it.
    expect(sidebar).not.toMatch(/\}, \[[^\]]*pathname[^\]]*\]\);\s*$/m);
    expect(sidebar).toContain("useLiveQuery");
  });

  it("keeps the shell in the layout so it is never remounted per page", () => {
    const layout = read("src/app/(app)/app/layout.tsx");
    expect(layout).toContain("AppShell");
    expect(layout).toContain("{children}");
  });

  it("never prerenders the authenticated app to static HTML", () => {
    // A prerendered route is written to disk as `app/inbox.html`, and Firebase
    // Hosting serves that file for every request to the path — including the
    // RSC request the client router makes for a soft navigation. Verified on
    // the deployed site: `/app/inbox` with `RSC: 1` returned text/html and a
    // one-hour cache header, while the non-prerendered `/app/campaigns/[id]`
    // correctly returned text/x-component. Getting HTML where it expects a
    // component payload, the router falls back to a full document navigation —
    // remounting the tree and flashing the auth loader on every page change.
    expect(read("src/app/(app)/app/layout.tsx")).toContain('export const dynamic = "force-dynamic"');
  });
});

describe("Numbers move without a reload", () => {
  const screens = [
    "src/features/approvals/approvals-page.tsx",
    "src/features/campaigns/campaign-overview.tsx",
    "src/features/campaigns/campaigns-page.tsx",
    "src/features/home/agent-home.tsx"
  ];

  it("subscribes on every screen whose figures change while the SDR works", () => {
    for (const screen of screens) {
      expect(read(screen), screen).toContain("useChangeSignal");
    }
  });

  it("replaced polling, which re-read the whole scope on a timer", () => {
    // 250 documents every 30 seconds is ~30,000 reads an hour to watch numbers
    // that are usually still. A listener bills only what actually changes.
    for (const screen of screens) {
      expect(read(screen), screen).not.toContain("setInterval");
    }
  });

  it("refreshes silently, so a live update never blanks the screen", () => {
    // Re-entering the loading state on every update would reintroduce exactly
    // the flicker this change exists to remove.
    for (const screen of screens) {
      const source = read(screen);
      expect(source, screen).toContain("silent = false");
      expect(source, screen).toContain("void refresh(true)");
    }
  });

  it("drops the cached read before recomputing, so an update cannot be stale", () => {
    for (const screen of screens) {
      expect(read(screen), screen).toContain("invalidateReadCache()");
    }
  });
});

describe("The listener layer is not itself a cost problem", () => {
  const live = read("src/lib/sdr/use-live.ts");

  it("keys the subscription on a string, not on the query object", () => {
    // Firestore builds a new Query on every render and they are never
    // referentially equal, so depending on one resubscribes every render —
    // a listener storm that re-reads the full result set each time.
    expect(live).toContain("}, [key]");
    expect(live).toContain("build.current");
  });

  it("debounces, so one discovery run does not trigger one recompute per company", () => {
    expect(live).toContain("debounceMs");
    expect(live).toContain("clearTimeout");
  });

  it("ignores the first snapshot, which the caller has already loaded", () => {
    expect(live).toContain("first = false");
  });

  it("ignores the local echo of our own pending writes", () => {
    expect(live).toContain("hasPendingWrites");
  });

  it("unsubscribes on unmount", () => {
    expect(live).toContain("return unsubscribe");
    expect(live).toContain("unsubscribe();");
  });

  it("surfaces a listener error instead of rendering it as no data", () => {
    // A rules or connectivity failure that looks like "nothing here" is the
    // class of bug that had the app asserting settings it never read.
    expect(live).toContain("loading: false, error }");
  });
});
