/**
 * Source-level guards for rules a unit test cannot reach by running code:
 * where Enter may be pressed, which module may touch the backend, what the
 * package may depend on.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function filesUnder(dir) {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) return name === "node_modules" || name === "fixtures" ? [] : filesUnder(full);
    return full.endsWith(".mjs") ? [full] : [];
  });
}

/** Code without its comments: the rules are about what runs, not what is explained. */
function stripComments(code) {
  return code.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}

const load = (file) => ({ file: path.relative(ROOT, file), code: stripComments(readFileSync(file, "utf8")) });
const sources = [...filesUnder(path.join(ROOT, "src")), ...filesUnder(path.join(ROOT, "bin"))].map(load);
const tests = filesUnder(path.join(ROOT, "test")).map(load);
const mockDriver = "src/drivers/mock-social-channel-driver.mjs";

describe("where a message can be sent", () => {
  it('only composer.mjs presses "Enter"', () => {
    const pressing = sources.filter(({ file, code }) => file !== mockDriver && /press\(\s*["'`]Enter["'`]\s*\)/.test(code)).map(({ file }) => file);
    expect(pressing).toEqual(["src/composer.mjs"]);
  });

  it("only the session machine calls sendFromComposer", () => {
    const callers = sources.filter(({ code }) => /sendFromComposer\(/.test(code) && !/export async function sendFromComposer/.test(code)).map(({ file }) => file);
    expect(callers).toEqual(["src/session-machine.mjs"]);
  });

  it("nothing types through keyboard.type, pressSequentially or fill (they turn line breaks into Enter)", () => {
    const offenders = sources
      .filter(({ file }) => file !== mockDriver)
      .filter(({ code }) => /\.(type|pressSequentially|fill)\(/.test(code))
      .map(({ file }) => file);
    expect(offenders).toEqual([]);
  });
});

describe("backend boundary", () => {
  it("only sdr.mjs imports bootstrap.mjs, and only bootstrap.mjs reaches functions/", () => {
    expect(sources.filter(({ code }) => /bootstrap\.mjs/.test(code)).map(({ file }) => file)).toEqual(["src/sdr.mjs"]);
    expect(sources.filter(({ code }) => /["'`]\.\.\/\.\.\/functions|functions\/lib|firebase-admin/.test(code)).map(({ file }) => file)).toEqual([
      "src/bootstrap.mjs"
    ]);
  });

  it("the CLI loads sdr.mjs lazily, after its arguments are checked", () => {
    const cli = sources.find(({ file }) => file === "bin/run.mjs").code;
    expect(cli).not.toMatch(/^import .*sdr\.mjs/m);
    expect(cli).toMatch(/await import\("\.\.\/src\/sdr\.mjs"\)/);
  });

  it("only browser.mjs imports playwright-core", () => {
    expect(sources.filter(({ code }) => /from\s+["']playwright/.test(code)).map(({ file }) => file)).toEqual(["src/browser.mjs"]);
  });

  it("tests never import the backend, the browser or the real SDR module", () => {
    const offenders = tests
      .filter(({ file }) => file !== "test/boundaries.test.mjs")
      .filter(({ code }) => /from\s+["'][^"']*(bootstrap|sdr|browser)\.mjs["']|functions\/lib|playwright/.test(code))
      .map(({ file }) => file);
    expect(offenders).toEqual([]);
  });
});

describe("package", () => {
  const pkg = JSON.parse(readFileSync(path.join(ROOT, "package.json"), "utf8"));
  const lock = JSON.parse(readFileSync(path.join(ROOT, "package-lock.json"), "utf8"));

  it("depends on an exact playwright-core and nothing else (no firebase-admin, no stealth plugin)", () => {
    expect(pkg.dependencies).toEqual({ "playwright-core": "1.61.1" });
    expect(pkg.devDependencies).toBeUndefined();
    expect(pkg.type).toBe("module");
    expect(Object.keys(lock.packages)).toEqual(["", "node_modules/playwright-core"]);
    expect(lock.packages["node_modules/playwright-core"].version).toBe("1.61.1");
  });

  it("has no install lifecycle script (installing never downloads anything by itself)", () => {
    for (const hook of ["preinstall", "install", "postinstall", "prepare"]) expect(pkg.scripts?.[hook]).toBeUndefined();
  });

  it("launches a plain headed browser: no proxy, no stealth, no automation-hiding flags", () => {
    const browser = sources.find(({ file }) => file === "src/browser.mjs").code;
    expect(browser).toMatch(/headless:\s*false/);
    expect(browser).not.toMatch(/proxy|stealth|ignoreDefaultArgs|AutomationControlled|userAgent/i);
  });
});
