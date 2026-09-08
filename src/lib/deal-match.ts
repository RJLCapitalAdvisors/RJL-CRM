/**
 * Which deal is an email about? Shared by the mailbox sync (tagging as it logs), the deals@ matcher and the
 * deal page's email window, so every ticket shows the same emails no matter which name the deal goes by:
 * the property name, the segments of the ticket title ("Kansas City, KS"), or most of the property's words.
 */

export const STOP = new Set(["opportunity", "opportunities", "acquisition", "development", "retail", "portfolio", "recap", "deal", "deals", "apartments", "apartment", "multifamily", "industrial", "office", "ground", "capital", "group", "partners", "fund", "large", "equity", "debt", "pref", "preferred", "raise", "existing", "operating", "company", "looking", "actively", "deploying", "aggressively", "shopping", "center", "exposure", "value", "core", "class", "into", "with", "from", "that", "this", "their", "your", "realty", "properties", "property", "investments", "holdings", "llc"]);
export const words = (s: string) => s.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 3 && !STOP.has(w));

export type DealNames = { name: string; propertyName: string | null; sponsorName?: string | null };

const norm = (s: string) => ` ${s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim()} `;
const STATE_SUFFIX = /,\s*[A-Z]{2}\.?$/;

/** The names an email subject could carry for this deal. */
export function dealPhrases(d: DealNames): string[] {
  const out: string[] = [];
  const sponsor = d.sponsorName?.trim().toLowerCase();
  const add = (raw: string | null | undefined) => {
    const p = (raw ?? "").replace(STATE_SUFFIX, "").trim();
    if (p.length < 5) return;
    if (sponsor && p.toLowerCase() === sponsor) return;
    if (!p.toLowerCase().split(/[^a-z0-9]+/).some((w) => w.length > 3 && !STOP.has(w))) return; // all generic
    if (!out.some((x) => x.toLowerCase() === p.toLowerCase())) out.push(p);
  };
  add(d.propertyName);
  for (const seg of d.name.split("|")) add(seg);
  return out;
}

/** True when the subject names this deal: one of its phrases in full, or most of the property name's words. */
export function subjectMatchesDeal(subject: string | null | undefined, d: DealNames): boolean {
  if (!subject) return false;
  const subj = norm(subject.replace(/^\s*((re|fw|fwd|aw|wg)\s*:\s*)+/i, ""));
  if (subj.trim().length < 4) return false;
  for (const p of dealPhrases(d)) if (subj.includes(norm(p))) return true;
  const ws = words(d.propertyName ?? d.name);
  if (!ws.length) return false;
  const hits = ws.filter((w) => subj.includes(` ${w} `)).length; // whole words: "multi" is not "multifamily"
  const need = ws.length <= 2 ? ws.length : Math.ceil(ws.length * 0.6);
  return hits >= need;
}

/**
 * Looser test for people already tied to the deal (on its progress report, or at the sponsor): the subject
 * carries the deal's city or one distinctive word of the property name ("Everett, WA | $10MM of JV Equity").
 */
export function subjectLooselyMatchesDeal(subject: string | null | undefined, d: DealNames & { city?: string | null }): boolean {
  if (subjectMatchesDeal(subject, d)) return true;
  if (!subject) return false;
  const subj = norm(subject);
  const city = d.city?.trim();
  if (city && city.length >= 4 && subj.includes(norm(city))) return true;
  return words(d.propertyName ?? d.name).some((w) => w.length >= 5 && subj.includes(` ${w} `));
}

/** Dollar amounts written any way ("$11,000,000", "$11MM", "$5.6 million") as plain numbers. */
export function amountsIn(text: string): number[] {
  const out: number[] = [];
  for (const m of text.matchAll(/\$\s?([\d,.]+)\s*(mm|million|m|k|bn|b)?/gi)) {
    let n = Number(m[1].replace(/,/g, ""));
    if (!isFinite(n) || n <= 0) continue;
    const u = (m[2] ?? "").toLowerCase();
    if (u === "mm" || u === "m" || u === "million") n *= 1_000_000;
    else if (u === "k") n *= 1_000;
    else if (u === "bn" || u === "b") n *= 1_000_000_000;
    out.push(n);
  }
  return out;
}

/**
 * The subject is a house-style deal email for this deal ("Retail Acquisition Opportunity in Boynton Beach, FL |
 * $11,000,000 of JV Equity"): it says "opportunity", names the deal's city, and any amount in it is the deal's ask.
 * A deal with no city never matches this way (too generic).
 */
export function houseSubjectMatches(subject: string | null | undefined, deal: { city?: string | null; state?: string | null; requestedAmount?: number | null }): boolean {
  if (!subject || !deal.city || deal.city.trim().length < 3) return false;
  const subj = subject.toLowerCase().replace(/[\u200b\u200c\u200d\ufeff]/g, "");
  if (!/opportunit/.test(subj)) return false;
  const city = deal.city.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  const norm = " " + subj.replace(/[^a-z0-9$.,]+/g, " ") + " ";
  if (!norm.includes(" " + city + " ") && !norm.includes(" in " + city)) return false;
  const amounts = amountsIn(subject);
  if (!amounts.length) return true;
  if (!deal.requestedAmount) return false;
  return amounts.some((x) => Math.abs(x - deal.requestedAmount!) / deal.requestedAmount! < 0.02);
}
