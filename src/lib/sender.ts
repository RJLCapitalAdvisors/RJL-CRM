import { prisma } from "@/lib/db";
import { CA_TEAM } from "@/lib/access";
import { signatureFor } from "@/lib/followup";

/**
 * A deal email carries the sender's own signature and copies the other principal (Jonathan, Oct 27, 2026: Aviel sent the Bay
 * Harbor condo deal to Dave Laufer from his mailbox with Jonathan's signature on it, and copied himself; "When aviel sends a
 * deal email it should have his email signature and should CC jonathan. when jonathan sends a deal email it should have his
 * signature and cc aviel"). The General email on the Send deal page is rendered once, with the signature of whoever opened
 * the page first, and saved; so the signature is swapped for the sender's and the CC list corrected at send time, in the
 * launch queue, and again when the page opens for someone else.
 */

/** The principals copied on every deal email: each one is copied when the other sends. */
export const DEAL_CC_PRINCIPALS = ["jonathan@rjlcapadvisors.com", "aviel@rjlcapadvisors.com"];

/** The CC list for a deal email from this mailbox: what was asked for, never the sender, always the other principal(s). */
export function ccFor(mailbox: string, requested: string[] = []): string[] {
  const me = mailbox.toLowerCase();
  const out: string[] = [];
  for (const e of [...requested, ...DEAL_CC_PRINCIPALS]) {
    const a = e.trim().toLowerCase();
    if (!a.includes("@") || a === me || out.includes(a)) continue;
    out.push(a);
  }
  return out;
}

const VOID = new Set(["br", "img", "hr", "input", "meta", "link", "col", "wbr", "area", "base", "source", "embed", "param", "track"]);

/** The index just past the element that opens at `start` (its closing tag included), or html.length when it never closes. */
export function elementEnd(html: string, start: number): number {
  const re = /<\/?([a-zA-Z][\w:-]*)[^>]*?(\/?)>/g;
  re.lastIndex = start;
  let depth = 0;
  for (let m = re.exec(html); m; m = re.exec(html)) {
    const name = m[1].toLowerCase();
    if (m[0].startsWith("</")) {
      depth--;
      if (depth <= 0) return m.index + m[0].length;
    } else if (!VOID.has(name) && m[2] !== "/") depth++;
  }
  return html.length;
}

const text = (h: string) => h.replace(/<[^>]+>/g, " ").replace(/&nbsp;| /g, " ").replace(/\s+/g, " ").trim();

/**
 * Where a teammate's signature sits in an email: the block (div, p or table) whose text begins with the person's name, found
 * from the last place the name appears. Returns [start, end) or null.
 */
function signatureSpan(html: string, name: string): [number, number] | null {
  const idx = html.lastIndexOf(name);
  if (idx < 0) return null;
  const from = Math.max(0, idx - 600);
  const starts: number[] = [];
  const re = /<(div|p|table)\b/gi;
  re.lastIndex = from;
  for (let m = re.exec(html); m && m.index <= idx; m = re.exec(html)) starts.push(m.index);
  for (const s of starts) {
    const e = elementEnd(html, s);
    if (e <= idx) continue;
    if (text(html.slice(s, e)).startsWith(name)) return [s, e];
  }
  return null;
}

const MARK = /<div data-signature="1">/;

/**
 * The email with this mailbox's own signature in place of whatever signature it carries: the marked block when there is one,
 * else the block that starts with a teammate's name (the signature the page baked in). An email with no signature found is
 * returned as it is.
 */
export async function withSenderSignature(html: string, mailbox: string): Promise<string> {
  if (!html) return html;
  const own = await signatureFor(mailbox).catch(() => "");
  if (!own) return html;
  const block = `<div data-signature="1">${own}</div>`;
  const m = html.match(MARK);
  if (m && m.index != null) return html.slice(0, m.index) + block + html.slice(elementEnd(html, m.index));
  const team = await prisma.user.findMany({ where: { active: true, ...CA_TEAM }, select: { name: true } });
  // the signature nearest the end wins (a teammate named in the body sits earlier)
  let best: { span: [number, number]; at: number } | null = null;
  for (const u of team) {
    const name = u.name.trim();
    if (name.length < 4) continue;
    const span = signatureSpan(html, name);
    if (span && (!best || span[0] > best.at)) best = { span, at: span[0] };
  }
  if (!best) return html;
  return html.slice(0, best.span[0]) + block + html.slice(best.span[1]);
}

type Draftish = { html?: string | null } & Record<string, unknown>;
type StateLike = { general?: Draftish | null; drafts?: Record<string, Draftish>; cc?: string } & Record<string, unknown>;

/** A saved Send page as this person sees it: their signature on the General email and every firm's own copy, their CC list. */
export async function adoptSendState<T extends StateLike>(saved: T | null, mailbox: string): Promise<T | null> {
  if (!saved) return saved;
  const out: T = { ...saved };
  if (saved.general?.html) out.general = { ...saved.general, html: await withSenderSignature(saved.general.html, mailbox) };
  if (saved.drafts) {
    const drafts: Record<string, Draftish> = {};
    for (const [k, d] of Object.entries(saved.drafts)) drafts[k] = d.html ? { ...d, html: await withSenderSignature(d.html, mailbox) } : d;
    out.drafts = drafts;
  }
  const requested = (saved.cc ?? "").split(/[,;\s]+/).map((x) => x.trim()).filter((x) => x.includes("@"));
  out.cc = ccFor(mailbox, requested).join(", ");
  return out;
}
