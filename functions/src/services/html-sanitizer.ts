/**
 * HTML Sanitizer for Inbound Prospect Content (Security & Invariant 4).
 * Strips executable scripts, dangerous tags, inline event handlers, and javascript: links.
 */

const SCRIPT_STYLE_BLOCKS_REGEX = /<(script|style|template)[^>]*>[\s\S]*?<\/\1>/gi;
const DANGEROUS_TAGS_REGEX = /<\/?(iframe|object|embed|applet|form|input|button|svg|math|meta|link|base)[^>]*>/gi;
const DANGEROUS_ATTRS_REGEX = /\s*(on\w+|formaction|action|srcdoc|xlink:href)\s*=\s*(['"][^'"]*['"]|[^\s>]+)/gi;
const JAVASCRIPT_PROTOCOL_REGEX = /(href|src|action)\s*=\s*(?:(['"])(?:javascript|vbscript|data:\s*text\/html)[\s\S]*?\2|(?:javascript|vbscript|data:\s*text\/html)[^\s>]*)/gi;

/**
 * Sanitizes an HTML string to ensure safe storage and rendering.
 */
export function sanitizeHtml(rawHtml?: string | null): string {
  if (!rawHtml || typeof rawHtml !== "string") {
    return "";
  }

  let clean = rawHtml
    // 1. Remove script, style, and template blocks with their contents
    .replace(SCRIPT_STYLE_BLOCKS_REGEX, "")
    // 2. Remove dangerous executable/embed tags
    .replace(DANGEROUS_TAGS_REGEX, "")
    // 3. Remove event handlers like onclick, onload, onerror, etc.
    .replace(DANGEROUS_ATTRS_REGEX, "")
    // 4. Remove javascript:, vbscript:, and data:text/html URIs in links/src
    .replace(JAVASCRIPT_PROTOCOL_REGEX, '$1="#"')
    .trim();

  return clean;
}


/**
 * Converts HTML to plain text when bodyText is missing.
 */
export function htmlToPlainText(html?: string | null): string {
  if (!html || typeof html !== "string") {
    return "";
  }

  return html
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n\n")
    .replace(/<\/div>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
