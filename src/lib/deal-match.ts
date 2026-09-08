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
  const hits = ws.filter((w) => subj.includes(w)).length;
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
