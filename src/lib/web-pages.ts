import { emailHtmlToText } from "@/lib/attachments";

/**
 * Websites named in a deals@ email (Jonathan, Sep 23, 2026): a developer's project site holds the project-level facts
 * (address, units, stories, delivery, amenities, sometimes prices and plans). The pages are fetched and read as text,
 * the way an attachment is: the linked page plus a few same-site pages whose link says apartments, plans or prices.
 */
export type WebPage = { url: string; title: string | null; text: string };

const SKIP_HOST = /(dropbox\.com|drive\.google\.com|docs\.google\.com|1drv\.ms|onedrive\.live\.com|sharepoint\.com|box\.com|egnyte\.com|linkedin\.com|facebook\.com|instagram\.com|twitter\.com|x\.com|youtube\.com|youtu\.be|google\.com\/maps|maps\.app\.goo\.gl|waze\.com|wa\.me|whatsapp\.com|rjlcapadvisors\.com|rjlisrael\.com|rjl-crm\.vercel\.app|vercel\.app|microsoft\.com|office\.com|outlook\.com|aka\.ms|unsubscribe|mailchimp|list-manage|safelinks)/i;
const SKIP_PATH = /\.(png|jpe?g|gif|svg|webp|ico|css|js|pdf|zip|mp4|mov)(\?|$)/i;
const FOLLOW = /(apartment|unit|floor|plan|price|pricing|project|about|spec|amenit|gallery|building|דירות|דירה|תכניות|תכנית|מחיר|מפרט|פרויקט|אודות|קומה)/i;
const MAX_SITES = 3;
const MAX_PAGES_PER_SITE = 6;
const MAX_CHARS_PER_PAGE = 30_000;

export function findWebLinks(html: string | null | undefined, text: string | null | undefined): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const add = (u: string) => {
    let url: URL;
    try {
      url = new URL(u.replace(/[)>\]"'.,;]+$/, ""));
    } catch {
      return;
    }
    if (!/^https?:$/.test(url.protocol) || SKIP_HOST.test(url.href) || SKIP_PATH.test(url.pathname)) return;
    const key = url.origin + url.pathname.replace(/\/$/, "");
    if (seen.has(key)) return;
    seen.add(key);
    out.push(url.href);
  };
  for (const m of (html ?? "").matchAll(/href\s*=\s*["']([^"']+)["']/gi)) add(m[1]);
  for (const m of (text ?? "").matchAll(/https?:\/\/[^\s<>"')\]]+/gi)) add(m[0]);
  return out;
}

async function getHtml(url: string): Promise<string | null> {
  try {
    const res = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0 (compatible; RJL CRM reader; jonathan@rjlcapadvisors.com)", Accept: "text/html,application/xhtml+xml" }, redirect: "follow", signal: AbortSignal.timeout(15_000) });
    if (!res.ok) return null;
    const ct = res.headers.get("content-type") ?? "";
    if (!/html|xml/i.test(ct)) return null;
    return await res.text();
  } catch {
    return null;
  }
}

const strip = (html: string) => emailHtmlToText(html.replace(/<(script|style|noscript|svg|nav|footer|header)[\s\S]*?<\/\1>/gi, " ")).replace(/\n{3,}/g, "\n\n").trim();

/** The linked pages, and the same-site pages worth following, as text. Sites that do not answer are skipped quietly. */
export async function fetchWebPages(urls: string[]): Promise<WebPage[]> {
  const out: WebPage[] = [];
  const sites = new Map<string, string[]>();
  for (const u of urls) {
    const host = new URL(u).host;
    if (!sites.has(host) && sites.size >= MAX_SITES) continue;
    sites.set(host, [...(sites.get(host) ?? []), u]);
  }
  for (const [host, starts] of sites) {
    const seen = new Set<string>();
    const queue = [...starts];
    while (queue.length && seen.size < MAX_PAGES_PER_SITE) {
      const url = queue.shift()!;
      const key = url.replace(/#.*$/, "").replace(/\/$/, "");
      if (seen.has(key)) continue;
      seen.add(key);
      const html = await getHtml(url);
      if (!html) continue;
      const title = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]?.replace(/\s+/g, " ").trim() ?? null;
      const text = strip(html).slice(0, MAX_CHARS_PER_PAGE);
      if (text.length > 200) out.push({ url, title, text });
      // same-site pages the link text or path says are about the units, plans or prices
      for (const m of html.matchAll(/<a[^>]+href\s*=\s*["']([^"'#]+)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
        let next: URL;
        try {
          next = new URL(m[1], url);
        } catch {
          continue;
        }
        if (next.host !== host || SKIP_PATH.test(next.pathname)) continue;
        const label = m[2].replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
        if (FOLLOW.test(label) || FOLLOW.test(next.pathname)) queue.push(next.href);
      }
    }
  }
  return out;
}
