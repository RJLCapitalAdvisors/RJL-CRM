import { emailHtmlToText } from "@/lib/attachments";

/**
 * Websites named in a deals@ email (Jonathan, Sep 23, 2026): a developer's project site holds the project-level facts
 * (address, units, stories, delivery, amenities, sometimes prices and plans). The pages are fetched and read as text,
 * the way an attachment is: the linked page plus a few same-site pages whose link says apartments, plans or prices.
 */
export type WebPage = { url: string; title: string | null; text: string };

const SKIP_HOST = /(dropbox\.com|drive\.google\.com|docs\.google\.com|1drv\.ms|onedrive\.live\.com|sharepoint\.com|box\.com|egnyte\.com|linkedin\.com|facebook\.com|instagram\.com|twitter\.com|x\.com|youtube\.com|youtu\.be|google\.com\/maps|maps\.app\.goo\.gl|waze\.com|wa\.me|whatsapp\.com|rjlcapadvisors\.com|rjlisrael\.com|rjl-crm\.vercel\.app|vercel\.app|microsoft\.com|office\.com|outlook\.com|aka\.ms|unsubscribe|mailchimp|list-manage|safelinks)/i;
const SKIP_PATH = /\.(png|jpe?g|gif|svg|webp|ico|css|js|pdf|zip|mp4|mov)(\?|$)/i;
const FOLLOW = /(apartment|unit|floor|plan|price|pricing|project|complex|about|spec|amenit|gallery|building|develop|architect|location|residen|tower|overview|feature|דירות|דירה|תכניות|תכנית|מחיר|מפרט|פרויקט|אודות|קומה|יזם|מיקום)/i;
/** Pages of a site not worth reading: legal, accessibility, the other-language copy, forms. */
const SKIP_PAGE = /(terms|privacy|accessib|cookie|legal|disclaimer|login|signin|register|cart|checkout|sitemap|\/(he|en|ru|fr)\/)/i;
const MAX_SITES = 3;
const MAX_PAGES_PER_SITE = 8;
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

// the header stays: a project site's hero often carries the facts (units, floors, site size); menus and footers go
const strip = (html: string) => emailHtmlToText(html.replace(/<(script|style|noscript|svg|nav|footer)[\s\S]*?<\/\1>/gi, " ")).replace(/\n{3,}/g, "\n\n").trim();
/** What the page says about itself in its head: title, description, Open Graph text, keywords and structured data. Often the only text a script-built site serves. */
function headText(html: string): string {
  const out: string[] = [];
  const title = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]?.replace(/\s+/g, " ").trim();
  if (title) out.push(`Title: ${title}`);
  for (const m of html.matchAll(/<meta[^>]+(?:name|property)=["']([^"']+)["'][^>]+content=["']([^"']+)["']/gi)) {
    if (/^(description|keywords|og:title|og:description|og:site_name|twitter:title|twitter:description)$/i.test(m[1])) out.push(`${m[1]}: ${m[2].trim()}`);
  }
  for (const m of html.matchAll(/<script[^>]+application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi)) out.push(`Structured data: ${m[1].replace(/\s+/g, " ").trim().slice(0, 4000)}`);
  return out.join("\n");
}
/** A page built by scripts serves no text ("This site relies on JavaScript", a loading line). */
const scriptBuilt = (html: string, text: string) => text.length < 400 || /relies on JavaScript|enable JavaScript|Loading, please wait|noscript/i.test(html.replace(/<noscript>[\s\S]*?<\/noscript>/gi, (m) => m));
/**
 * The page as a browser shows it, for a site built by scripts (Sep 23, 2026: mophetraanana.com serves only a loading line;
 * the address "Eliezer Yaffe 6-8" appears once the scripts run). Read through a public rendering reader (Jina Reader by
 * default, given only the page's public address); WEB_RENDER_READER overrides the prefix, "off" turns it off.
 */
async function renderedText(url: string): Promise<string | null> {
  const reader = process.env.WEB_RENDER_READER ?? "https://r.jina.ai/";
  if (!reader || reader === "off") return null;
  try {
    const res = await fetch(reader + url, { headers: { Accept: "text/plain", "X-Return-Format": "text", "User-Agent": "RJL CRM reader" }, signal: AbortSignal.timeout(45_000) });
    if (!res.ok) return null;
    const t = (await res.text()).replace(/!\[[^\]]*\]\([^)]*\)/g, " ").replace(/\n{3,}/g, "\n\n").trim();
    return t.length > 200 ? t.slice(0, MAX_CHARS_PER_PAGE) : null;
  } catch {
    return null;
  }
}

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
    // the linked page first, then the site's front page: a developer's site is small and its facts sit on one page
    // ("The Complex": 176 apartments, 7 floors), which the link in the email rarely points at (Mophet, Sep 23, 2026)
    const queue = [...starts, new URL("/", starts[0]).href];
    while (queue.length && seen.size < MAX_PAGES_PER_SITE) {
      const url = queue.shift()!;
      const key = url.replace(/#.*$/, "").replace(/\/$/, "");
      if (seen.has(key)) continue;
      seen.add(key);
      const html = await getHtml(url);
      if (!html) continue;
      const title = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]?.replace(/\s+/g, " ").trim() ?? null;
      let body = strip(html);
      if (scriptBuilt(html, body)) body = (await renderedText(url)) ?? body; // a script-built page is read as a browser shows it
      const head = headText(html);
      const text = [head, body].filter(Boolean).join("\n\n").slice(0, MAX_CHARS_PER_PAGE);
      if (text.length > 120) out.push({ url, title, text });
      // every same-site page is read while the budget lasts; the ones whose link says units, plans, prices or the
      // project go first, legal and other-language pages never
      const hot: string[] = [], cold: string[] = [];
      for (const m of html.matchAll(/<a[^>]+href\s*=\s*["']([^"'#]+)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
        let next: URL;
        try {
          next = new URL(m[1], url);
        } catch {
          continue;
        }
        if (next.host !== host || SKIP_PATH.test(next.pathname) || SKIP_PAGE.test(next.pathname) || /^(mailto|tel|javascript):/i.test(m[1])) continue;
        const label = m[2].replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
        (FOLLOW.test(label) || FOLLOW.test(next.pathname) ? hot : cold).push(next.href);
      }
      queue.unshift(...hot);
      queue.push(...cold);
    }
  }
  return out;
}
