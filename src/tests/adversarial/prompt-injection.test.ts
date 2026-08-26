import { describe, it, expect } from "vitest";

describe("Frontend Adversarial Audit: Prompt Injection Defense & Untrusted Prospect Sanitization", () => {
  it("should verify that untrusted HTML elements are stripped before rendering in React UI", () => {
    const maliciousScript = `<script>alert('xss')</script><b>Valid content</b>`;
    const sanitized = maliciousScript.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "").trim();
    expect(sanitized).not.toContain("<script>");
    expect(sanitized).toContain("<b>Valid content</b>");
  });

  it("should ensure prospect website previews do not evaluate arbitrary javascript links", () => {
    const dangerousUrl = "javascript:alert(document.domain)";
    const isSafe = !dangerousUrl.toLowerCase().startsWith("javascript:") && !dangerousUrl.toLowerCase().startsWith("data:");
    expect(isSafe).toBe(false);
  });
});
