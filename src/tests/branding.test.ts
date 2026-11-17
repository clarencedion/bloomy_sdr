import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");

/**
 * The tab belongs to the business using the app, not to the tool that built it.
 */
describe("The workspace carries the owner's identity", () => {
  it("sets the tab title from the business, not from a fixed string", () => {
    const branding = read("src/components/layout/workspace-branding.tsx");
    expect(branding).toContain("document.title");
    expect(branding).toContain("currentBusiness?.name");

    // The static fallback advertised the vendor on every customer's tab.
    expect(read("src/app/layout.tsx")).not.toContain("Devcomm Sales OS");
  });

  it("waits for the real name instead of flashing a fallback", () => {
    expect(read("src/components/layout/workspace-branding.tsx")).toContain("if (loading) return");
  });

  it("uses the logo as the tab icon and restores the previous one on switch", () => {
    const branding = read("src/components/layout/workspace-branding.tsx");
    expect(branding).toContain('rel="icon"');
    expect(branding).toContain("if (previous) link.href = previous");
  });

  it("shows the logo in the sidebar, falling back to the coloured initial", () => {
    const switcher = read("src/components/layout/business-switcher.tsx");
    expect(switcher).toContain("currentBusiness?.branding?.logoUrl");
    // A business with no logo must still read as itself.
    expect(switcher).toContain("currentBusiness?.name?.[0]?.toUpperCase()");
  });

  it("persists the logo with the rest of the branding", () => {
    expect(read("src/features/settings/settings-page.tsx")).toContain("logoUrl: bizLogo || undefined");
  });
});

describe("Uploads are bounded and typed", () => {
  const field = read("src/features/settings/logo-field.tsx");
  const rules = read("storage.rules");

  it("rejects anything that is not a web image", () => {
    expect(field).toContain('"image/png"');
    expect(rules).toContain(String.raw`image/(png|jpeg|svg\\+xml|webp)`);
  });

  it("caps the size in the field and again in the rules", () => {
    // The field's limit is a convenience; the rule is what actually holds when
    // someone calls the Storage API directly.
    expect(field).toContain("MAX_BYTES = 1024 * 1024");
    expect(rules).toContain("request.resource.size < 1 * 1024 * 1024");
  });

  it("scopes the path to the workspace and business", () => {
    expect(field).toContain("`branding/${workspaceId}/${businessId}/logo.");
    expect(rules).toContain("match /branding/{workspaceId}/{businessId}/{fileName}");
  });

  it("never lets a browser write a proposal PDF", () => {
    // Those are written by the backend; a client that could write one could
    // put anything in front of a prospect.
    const pdfs = rules.slice(rules.indexOf("match /pdfs/"), rules.indexOf("match /{allPaths"));
    expect(pdfs).toContain("allow write, delete: if false");
  });

  it("denies every path it does not name", () => {
    expect(rules).toContain("match /{allPaths=**}");
    expect(rules.slice(rules.indexOf("match /{allPaths=**}"))).toContain("allow read, write: if false");
  });
});
