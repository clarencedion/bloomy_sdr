export type WebsiteFetchResult = {
  sourceUrl?: string;
  text?: string;
  title?: string;
  success: boolean;
  error?: string;
};

const MAX_WEBSITE_TEXT_CHARS = 12000;

function stripHtml(html: string) {
  const title = html.match(/<title[^>]*>(.*?)<\/title>/is)?.[1]?.trim();
  const meta = html.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)["'][^>]*>/i)?.[1]?.trim();
  const text = html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
  return { title, text: [title, meta, text].filter(Boolean).join("\n").slice(0, MAX_WEBSITE_TEXT_CHARS) };
}

export async function fetchHomepageText(website?: string): Promise<WebsiteFetchResult> {
  if (!website) return { success: false, error: "No website configured." };
  let url: URL;
  try {
    url = new URL(website.startsWith("http") ? website : `https://${website}`);
  } catch {
    return { success: false, error: "Invalid website URL." };
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);
  try {
    const response = await fetch(url.toString(), {
      signal: controller.signal,
      headers: {
        "User-Agent": "DevcommSalesOS/0.1 Phase3Research (+https://devcomm-os.firebaseapp.com)"
      }
    });
    if (!response.ok) return { sourceUrl: url.toString(), success: false, error: `Website returned ${response.status}.` };
    const contentType = response.headers.get("content-type") ?? "";
    if (!contentType.includes("text/html") && !contentType.includes("text/plain")) {
      return { sourceUrl: url.toString(), success: false, error: `Unsupported content type: ${contentType}` };
    }
    const html = await response.text();
    const parsed = stripHtml(html);
    return { sourceUrl: url.toString(), success: true, title: parsed.title, text: parsed.text };
  } catch (error) {
    return { sourceUrl: url.toString(), success: false, error: error instanceof Error ? error.message : "Website fetch failed." };
  } finally {
    clearTimeout(timeout);
  }
}
