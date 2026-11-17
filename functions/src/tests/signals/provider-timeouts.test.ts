import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

/**
 * `.claude/rules/provider-integrations.md` caps external HTTP timeouts at
 * 8-15s. PageSpeed Insights is a documented exception: it renders the target
 * page server-side and measured 30-40s against real French salon sites (the
 * slower the site, the longer Lighthouse waits - so the prospects we most want
 * to find are the ones most likely to be cut off). At 8s it aborted on every
 * single run and the website speed audit silently produced nothing, which is
 * indistinguishable from "this site is fine".
 *
 * See ADR-011. This test exists so the bound is not "tidied" back down.
 */
describe("Signal provider timeouts", () => {
  const providersDir = fs.existsSync(path.resolve(process.cwd(), "src/providers/signals"))
    ? path.resolve(process.cwd(), "src/providers/signals")
    : path.resolve(process.cwd(), "functions/src/providers/signals");

  const pagespeed = fs.readFileSync(path.join(providersDir, "pagespeed-provider.ts"), "utf8");

  it("gives PageSpeed a bound long enough to actually complete", () => {
    const declared = pagespeed.match(/readonly timeoutMs = (\d+);/);
    expect(declared, "PageSpeed must declare its own timeout").not.toBeNull();
    expect(Number(declared![1])).toBeGreaterThanOrEqual(60000);

    const fetchTimeout = pagespeed.match(/AbortSignal\.timeout\((\d+)\)/);
    expect(fetchTimeout).not.toBeNull();
    expect(Number(fetchTimeout![1])).toBeGreaterThanOrEqual(45000);

    // The provider bound must exceed the fetch bound, or the coordinator
    // aborts the provider before its own request can fail cleanly.
    expect(Number(declared![1])).toBeGreaterThan(Number(fetchTimeout![1]));
  });

  it("still retries on 429 with backoff", () => {
    expect(pagespeed).toMatch(/429/);
    expect(pagespeed).toMatch(/maxAttempts/);
  });

  it("names the missing key when the anonymous quota is exhausted", () => {
    // A bare "429" told the operator nothing actionable.
    expect(pagespeed).toMatch(/Add a Google API key/);
  });

  it("lets the coordinator honour a provider's own timeout", () => {
    const coordinatorPath = fs.existsSync(path.resolve(process.cwd(), "src/services/signal-coordinator.ts"))
      ? path.resolve(process.cwd(), "src/services/signal-coordinator.ts")
      : path.resolve(process.cwd(), "functions/src/services/signal-coordinator.ts");
    const coordinator = fs.readFileSync(coordinatorPath, "utf8");
    expect(coordinator).toMatch(/provider\.timeoutMs \?\? timeoutMs/);
  });

  it("keeps the queue worker able to outlast a full batch of slow audits", () => {
    const indexPath = fs.existsSync(path.resolve(process.cwd(), "src/index.ts"))
      ? path.resolve(process.cwd(), "src/index.ts")
      : path.resolve(process.cwd(), "functions/src/index.ts");
    const index = fs.readFileSync(indexPath, "utf8");
    const worker = index.slice(index.indexOf("export const taskQueueProcessorJob"));
    const timeout = worker.slice(0, 600).match(/timeoutSeconds:\s*(\d+)/);
    expect(timeout).not.toBeNull();
    expect(Number(timeout![1])).toBeGreaterThanOrEqual(300);
  });
});
