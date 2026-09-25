/**
 * What a sponsor did to the group list when they answered the engagement letter (Jonathan, Sep 25, 2026: Elan at
 * Certes erased the groups he had already contacted from the quoted list and wrote "let's get it going"). A reply
 * can erase names from the quoted list, cross them out, or say which to drop; every one of those unticks the group
 * on the ticket's engagement card and the struck list is kept on the deal so Jonathan sees what the sponsor did.
 */

export type StruckGroup = { name: string; companyId: string | null; how: "erased" | "crossed out" | "asked"; at: string; by: string | null };
type Group = { name: string; companyId: string | null; domain?: string | null };

export const normName = (s: string) => s.toLowerCase().replace(/&amp;/g, "&").replace(/[^a-z0-9]+/g, " ").trim();

/** A group's name matches a line of the list when it is the same, one starts with the other (four letters or more), or the line is the group's domain. */
export function lineMatchesGroup(line: string, g: Group): boolean {
  const l = normName(line), n = normName(g.name);
  if (!l || !n) return false;
  if (l === n) return true;
  if (l.length >= 4 && n.length >= 4 && (n.startsWith(l) || l.startsWith(n))) return true;
  if (l.length >= 3 && n.split(" ")[0] === l) return true; // "HPS" on the list for HPS Investment Partners
  const label = (g.domain ?? "").toLowerCase().split(".")[0];
  return Boolean(label && label.length >= 4 && (l === label || l === (g.domain ?? "").toLowerCase()));
}

const STRUCK_OPEN = "[struck]", STRUCK_CLOSE = "[/struck]";

/** The reply as lines of text; crossed-out passages (s, strike, del, line-through styles) carry a [struck] marker. */
export function replyLines(html: string): string[] {
  let h = html.replace(/<style[\s\S]*?<\/style>/gi, " ").replace(/<head[\s\S]*?<\/head>/gi, " ");
  h = h.replace(/<(s|strike|del)\b[^>]*>([\s\S]*?)<\/\1>/gi, (_m, _t, inner: string) => `${STRUCK_OPEN}${inner}${STRUCK_CLOSE}`);
  h = h.replace(/<(span|p|div|li|font|b|i|u|em|strong)\b[^>]*style="[^"]*line-through[^"]*"[^>]*>([\s\S]*?)<\/\1>/gi, (_m, _t, inner: string) => `${STRUCK_OPEN}${inner}${STRUCK_CLOSE}`);
  return h
    .replace(/<[^>]+>/g, "\n")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&rsquo;|&lsquo;/g, "'")
    .split(/\n/)
    .map((l) => l.trim())
    .filter(Boolean);
}

const isBoundary = (l: string) => /wrote:\s*$/i.test(l) || /^From:/.test(l) || /^-{3,}\s*Original Message/i.test(l);

/** The sponsor's own words (above the first quoted header) and the first quoted email (the letter they sent back). */
export function splitReply(lines: string[]): { own: string[]; quoted: string[] } {
  const b1 = lines.findIndex(isBoundary);
  if (b1 < 0) return { own: lines, quoted: [] };
  // the "On ... wrote:" header can run over several lines once tags become line breaks: step back to its "On " line
  let start = b1;
  for (let i = b1; i >= Math.max(0, b1 - 4); i--) if (/^On [A-Z][a-z]{2},? /.test(lines[i])) start = i;
  const b2 = lines.findIndex((l, i) => i > b1 && isBoundary(l));
  return { own: lines.slice(0, start), quoted: lines.slice(b1 + 1, b2 > 0 ? b2 : undefined) };
}

export type ListReading = { listSeen: boolean; erased: Group[]; crossed: Group[]; kept: Group[]; listText: string };

/**
 * Compare the deal's groups with the list the sponsor sent back. The list counts as seen when most of the groups
 * appear in the quoted email; then a group with no line is erased and a group on a crossed-out line is crossed out.
 * Without the list (a bare "confirmed"), nothing is erased.
 */
export function readGroupList(groups: Group[], html: string): ListReading {
  const { quoted } = splitReply(replyLines(html));
  const struckLine = (l: string) => l.includes(STRUCK_OPEN);
  const clean = (l: string) => l.replace(/\[\/?struck\]/g, "").trim();
  const erased: Group[] = [], crossed: Group[] = [], kept: Group[] = [];
  for (const g of groups) {
    const hits = quoted.filter((l) => lineMatchesGroup(clean(l), g));
    if (!hits.length) erased.push(g);
    else if (hits.every(struckLine)) crossed.push(g);
    else kept.push(g);
  }
  const listSeen = groups.length > 0 && kept.length + crossed.length >= Math.max(3, Math.ceil(groups.length / 2));
  const listText = quoted
    .filter((l) => groups.some((g) => lineMatchesGroup(clean(l), g)) || /remove|delete|strike|skip|drop|\bno\b|\bx\b|keep|ok|fine|already|relationship|contacted|talking/i.test(clean(l)))
    .slice(0, 160)
    .join("\n");
  return listSeen ? { listSeen, erased, crossed, kept, listText } : { listSeen: false, erased: [], crossed: [], kept: groups, listText: "" };
}
