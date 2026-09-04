import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { ASSET_CLASSES, ROLES, US_STATES, parseList, toJson } from "@/lib/taxonomy";
import { nameFromDomain } from "@/lib/domains";
import { syncContactRolesForCompany } from "@/lib/roles";

/**
 * Company enrichment from the email domain: read the company's website, pull out what a person
 * would glean from a quick look (what they do, where they are, phone, LinkedIn, year founded,
 * whether they invest / sponsor / lend / broker, asset classes), and fill any blanks on the record.
 * Never overwrites something Jonathan typed; description and enrichedAt are always refreshed.
 */

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) RJL-CRM/1.0";
const TIMEOUT = 9000;

async function get(url: string): Promise<string | null> {
  try {
    const res = await fetch(url, { headers: { "user-agent": UA, accept: "text/html,*/*" }, redirect: "follow", signal: AbortSignal.timeout(TIMEOUT) });
    if (!res.ok) return null;
    const ct = res.headers.get("content-type") ?? "";
    if (!ct.includes("html") && !ct.includes("text")) return null;
    return await res.text();
  } catch {
    return null;
  }
}

const strip = (html: string) =>
  html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<br\s*\/?>|<\/(p|div|li|h\d|tr|section|article)>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&#39;|&rsquo;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s*\n+/g, "\n")
    .trim();

const meta = (html: string, name: string) => {
  const m = html.match(new RegExp(`<meta[^>]+(?:name|property)=["']${name}["'][^>]+content=["']([^"']+)["']`, "i")) ?? html.match(new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+(?:name|property)=["']${name}["']`, "i"));
  return m?.[1]?.trim() ?? null;
};

export type SiteSnapshot = { url: string; title: string | null; siteName: string | null; metaDescription: string | null; linkedin: string | null; phone: string | null; text: string };

/** Fetch the homepage (and an About page if linked) and reduce it to text Claude can read. */
export async function readSite(domain: string): Promise<SiteSnapshot | null> {
  let url = `https://www.${domain}`;
  let html = await get(url);
  if (!html) {
    url = `https://${domain}`;
    html = await get(url);
  }
  if (!html) return null;
  const title = html.match(/<title[^>]*>([^<]*)<\/title>/i)?.[1]?.trim() ?? null;
  const linkedin = html.match(/https?:\/\/(?:www\.)?linkedin\.com\/company\/[A-Za-z0-9_-]+/i)?.[0] ?? null;
  const phone = html.match(/href=["']tel:([^"']+)["']/i)?.[1]?.trim() ?? null;
  let text = strip(html);
  const about = html.match(/href=["']([^"']*(?:about|who-we-are|our-story|team|firm)[^"']*)["']/i)?.[1];
  if (about) {
    const aboutUrl = about.startsWith("http") ? about : new URL(about, url).toString();
    if (aboutUrl.includes(domain)) {
      const aboutHtml = await get(aboutUrl);
      if (aboutHtml) text += "\n\n--- ABOUT PAGE ---\n" + strip(aboutHtml);
    }
  }
  return { url, title, siteName: meta(html, "og:site_name"), metaDescription: meta(html, "description") ?? meta(html, "og:description"), linkedin, phone, text: text.slice(0, 14000) };
}

const Out = z.object({
  companyName: z.string().describe("The company's proper name as it brands itself, e.g. 'Logistics Property Company'. Empty if unclear."),
  description: z.string().describe("One or two plain sentences: what the company does, its focus, and scale if stated. Empty if unclear."),
  streetAddress: z.string().describe("Headquarters street address, or empty."),
  city: z.string().describe("Headquarters city, or empty."),
  state: z.string().describe("Headquarters US state as a two-letter code, or empty."),
  phone: z.string().describe("Main phone number, or empty."),
  yearFounded: z.string().describe("Four-digit year founded, or empty."),
  linkedin: z.string().describe("LinkedIn company page URL, or empty."),
  roles: z.string().describe(`Comma-separated subset of: ${ROLES.join(", ")}. Investor = invests LP/JV/pref equity or has a fund; Sponsor = develops/acquires/operates real estate; Lender = originates debt; Broker = intermediary. Empty if unclear.`),
  assetClasses: z.string().describe(`Comma-separated subset of: ${ASSET_CLASSES.join(", ")}. Only those the site clearly says they focus on. Empty if unclear.`),
  geographies: z.string().describe("Markets or regions they say they focus on, as short free text (e.g. 'Sunbelt; Texas; Southeast'). Empty if unclear."),
});
export type Extracted = z.infer<typeof Out>;

const SYSTEM = `You read a real-estate-industry company's website text and fill in a CRM record for a capital advisory firm. Use only what the text supports. Leave a field empty rather than guessing. Keep the description factual and short, written the way an analyst would note it (no marketing adjectives).`;

export async function extractCompany(snap: SiteSnapshot): Promise<Extracted> {
  const client = new Anthropic();
  const res = await client.messages.parse({
    model: "claude-sonnet-5",
    max_tokens: 2000,
    system: SYSTEM,
    messages: [{ role: "user", content: `URL: ${snap.url}\nTitle: ${snap.title ?? ""}\nSite name: ${snap.siteName ?? ""}\nMeta description: ${snap.metaDescription ?? ""}\nLinkedIn: ${snap.linkedin ?? ""}\nPhone link: ${snap.phone ?? ""}\n\n${snap.text}` }],
    output_config: { format: zodOutputFormat(Out) },
  });
  if (!res.parsed_output) throw new Error("no structured output");
  return res.parsed_output;
}

/** No API key or the model failed: use what the HTML itself says. */
function heuristic(snap: SiteSnapshot): Extracted {
  const name = (snap.siteName ?? snap.title ?? "").split(/\s[|–—-]\s/)[0].trim();
  return { companyName: name, description: snap.metaDescription ?? "", streetAddress: "", city: "", state: "", phone: snap.phone ?? "", yearFounded: "", linkedin: snap.linkedin ?? "", roles: "", assetClasses: "", geographies: "" };
}

const pick = (csv: string, allowed: readonly string[]) => {
  const set = new Set(allowed.map((a) => a.toLowerCase()));
  return csv.split(/[,;]/).map((x) => x.trim()).filter((x) => set.has(x.toLowerCase())).map((x) => allowed.find((a) => a.toLowerCase() === x.toLowerCase())!);
};
const looksDomainish = (name: string, domain: string) => name === nameFromDomain(domain) || name.toLowerCase() === domain || /\.[a-z]{2,}$/i.test(name) || !/\s/.test(name) && name.toLowerCase() === domain.split(".")[0];
const clean = (s: string) => (s && s.trim() ? s.trim() : null);

export type EnrichResult = { ok: boolean; reason?: string; filled: string[] };

/** Read the company's website and fill blanks. `force` re-reads even if enriched recently. */
export async function enrichCompany(companyId: string, opts: { force?: boolean } = {}): Promise<EnrichResult> {
  const co = await prisma.company.findUnique({ where: { id: companyId }, include: { criteria: true } });
  if (!co) return { ok: false, reason: "not found", filled: [] };
  const domain = co.domain ?? co.website?.replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/.*$/, "") ?? null;
  if (!domain) return { ok: false, reason: "no domain or website on file", filled: [] };
  if (!opts.force && co.enrichedAt && Date.now() - co.enrichedAt.getTime() < 30 * 86_400_000) return { ok: true, reason: "read recently", filled: [] };

  const snap = await readSite(domain);
  if (!snap) {
    await prisma.company.update({ where: { id: co.id }, data: { website: co.website ?? `https://${domain}`, enrichedAt: new Date() } });
    return { ok: false, reason: `could not reach ${domain}`, filled: co.website ? [] : ["website"] };
  }
  let x: Extracted;
  try {
    x = process.env.ANTHROPIC_API_KEY ? await extractCompany(snap) : heuristic(snap);
  } catch {
    x = heuristic(snap);
  }

  const filled: string[] = [];
  const data: Record<string, unknown> = { enrichedAt: new Date() };
  const set = (k: keyof typeof co, v: string | null) => {
    if (v && !co[k]) {
      data[k] = v;
      filled.push(k);
    }
  };
  set("website", snap.url.replace(/\/$/, ""));
  set("streetAddress", clean(x.streetAddress));
  set("city", clean(x.city));
  set("phone", clean(x.phone) ?? clean(snap.phone ?? ""));
  set("linkedin", clean(x.linkedin) ?? clean(snap.linkedin ?? ""));
  const st = clean(x.state)?.toUpperCase();
  if (st && st in US_STATES && !co.state) {
    data.state = st;
    filled.push("state");
  }
  const yr = Number(clean(x.yearFounded));
  if (yr > 1700 && yr <= new Date().getFullYear() && !co.yearFounded) {
    data.yearFounded = yr;
    filled.push("yearFounded");
  }
  const desc = clean(x.description) ?? clean(snap.metaDescription ?? "");
  if (desc && desc !== co.description) {
    data.description = desc;
    filled.push("description");
  }
  const properName = clean(x.companyName);
  if (properName && looksDomainish(co.name, domain) && properName.toLowerCase() !== co.name.toLowerCase()) {
    data.name = properName;
    filled.push("name");
  }
  const roles = pick(x.roles, ROLES);
  if (roles.length && parseList(co.roles).length === 0) {
    data.roles = toJson(roles);
    filled.push("roles");
  }
  await prisma.company.update({ where: { id: co.id }, data });
  if (data.roles) await syncContactRolesForCompany(co.id, [], roles); // contacts inherit the company's roles

  const assets = pick(x.assetClasses, ASSET_CLASSES);
  const geo = clean(x.geographies);
  if ((assets.length && parseList(co.criteria?.assetClasses).length === 0) || (geo && !co.criteria?.geographyNotes)) {
    const cdata: Record<string, unknown> = {};
    if (assets.length && parseList(co.criteria?.assetClasses).length === 0) {
      cdata.assetClasses = toJson(assets);
      filled.push("assetClasses");
    }
    if (geo && !co.criteria?.geographyNotes) {
      cdata.geographyNotes = geo;
      filled.push("geographies");
    }
    await prisma.investorCriteria.upsert({ where: { companyId: co.id }, create: { companyId: co.id, ...cdata }, update: cdata });
  }
  return { ok: true, filled };
}
