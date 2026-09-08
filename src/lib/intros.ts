import { prisma } from "@/lib/db";
import { graph, graphConfigured } from "@/lib/graph";

/**
 * Intros to reconsider. Every "Intro - Company A | Company B" email any of us sent is an introduction we
 * made; most get forgotten. We record each one from every team mailbox, watch its thread for activity,
 * and surface the ones that went quiet so Jonathan can nudge with one click.
 */

const DAY = 86_400_000;
const LOOKBACK_DAYS = 365;
export const QUIET_INTRO_DAYS = 14;
/** An intro nobody has answered at all is flagged much sooner. */
export const UNANSWERED_INTRO_DAYS = 3;
const q = (s: string) => encodeURIComponent(s);
const INTRO_RE = /^\s*intro\b\s*[-:–—]?\s*(.*)$/i;

type Msg = { id: string; internetMessageId?: string; subject: string | null; sentDateTime?: string; receivedDateTime?: string; conversationId?: string; toRecipients?: { emailAddress: { address: string } }[]; ccRecipients?: { emailAddress: { address: string } }[]; from?: { emailAddress: { address: string } } };

export function parseParties(subject: string): { a: string | null; b: string | null } {
  const m = subject.match(INTRO_RE);
  const rest = (m?.[1] ?? "").trim();
  const parts = rest.split(/\s*[|\/]\s*|\s+x\s+|\s+&\s+|\s+and\s+/i).map((s) => s.trim()).filter(Boolean);
  return { a: parts[0] ?? null, b: parts[1] ?? null };
}

async function pageAll(url: string | null, max = 400): Promise<Msg[]> {
  const out: Msg[] = [];
  while (url && out.length < max) {
    const r: { value: Msg[]; "@odata.nextLink"?: string } = await graph(url);
    out.push(...r.value);
    url = r["@odata.nextLink"] ?? null;
  }
  return out;
}

/** Scan one mailbox: new intros get recorded; known ones get their thread activity refreshed. */
export async function scanIntros(mailbox: string): Promise<{ found: number; updated: number }> {
  const since = new Date(Date.now() - LOOKBACK_DAYS * DAY).toISOString();
  const sent = (await pageAll(`/users/${q(mailbox)}/mailFolders/sentitems/messages?$filter=startswith(subject,'Intro')&$top=50&$select=id,internetMessageId,subject,sentDateTime,conversationId,toRecipients,ccRecipients`)).filter((m) => (m.sentDateTime ?? "") >= since);
  let found = 0, updated = 0;
  for (const m of sent) {
    if (!/^\s*intro\b/i.test(m.subject ?? "") || /^\s*(re|fw|fwd):/i.test(m.subject ?? "")) continue;
    const ext = m.internetMessageId ?? m.id;
    const parties = parseParties(m.subject ?? "");
    const recipients = [...(m.toRecipients ?? []), ...(m.ccRecipients ?? [])].map((r) => r.emailAddress.address.toLowerCase()).filter((a) => !/@(rjlcapadvisors|rjlequities)\.com$/i.test(a));
    // the thread: everything in this mailbox with the same conversationId
    let lastAt = new Date(m.sentDateTime ?? Date.now());
    let lastId: string | null = ext;
    let replies = 0;
    if (m.conversationId) {
      try {
        const thread = await pageAll(`/users/${q(mailbox)}/messages?$filter=conversationId eq '${m.conversationId.replace(/'/g, "''")}'&$select=id,internetMessageId,receivedDateTime,sentDateTime,from&$top=50`, 100);
        for (const t of thread) {
          const at = new Date(t.sentDateTime ?? t.receivedDateTime ?? 0);
          if ((t.internetMessageId ?? t.id) !== ext) replies++;
          if (at > lastAt) {
            lastAt = at;
            lastId = t.internetMessageId ?? t.id;
          }
        }
      } catch {
        /* keep the intro's own date */
      }
    }
    const existing = await prisma.intro.findUnique({ where: { messageId: ext } });
    if (existing) {
      if (existing.lastActivityAt.getTime() !== lastAt.getTime() || existing.replies !== replies) {
        await prisma.intro.update({ where: { id: existing.id }, data: { lastActivityAt: lastAt, lastMessageId: lastId, replies, ...(existing.status === "DISMISSED" && lastAt > existing.updatedAt ? { status: "OPEN" } : {}) } });
        updated++;
      }
    } else {
      await prisma.intro.create({ data: { mailbox, subject: m.subject ?? "Intro", partyA: parties.a, partyB: parties.b, recipients: JSON.stringify(recipients), conversationId: m.conversationId ?? null, messageId: ext, introducedAt: new Date(m.sentDateTime ?? Date.now()), lastActivityAt: lastAt, lastMessageId: lastId, replies } });
      found++;
    }
  }
  return { found, updated };
}

export async function scanAllIntros(): Promise<Record<string, { found: number; updated: number } | string>> {
  if (!graphConfigured()) return {};
  const users = await prisma.user.findMany({ where: { active: true, email: { not: null } } });
  const out: Record<string, { found: number; updated: number } | string> = {};
  for (const u of users) out[u.email!] = await scanIntros(u.email!).catch((e) => String(e).slice(0, 120));
  return out;
}

/** Recent intros only, so the window is a working list rather than an archive. */
export const INTRO_WINDOW_DAYS = 120;

/**
 * Intros that went quiet: nothing on the thread for QUIET_INTRO_DAYS, introduced in the last INTRO_WINDOW_DAYS.
 * The same intro often exists in two mailboxes (sender + cc'd teammate) or was sent twice; one entry per subject,
 * keeping whichever copy saw the latest activity.
 */
export async function quietIntros(since = new Date(Date.now() - INTRO_WINDOW_DAYS * DAY)) {
  const cutoff = new Date(Date.now() - QUIET_INTRO_DAYS * DAY);
  const unanswered = new Date(Date.now() - UNANSWERED_INTRO_DAYS * DAY);
  const rows = await prisma.intro.findMany({ where: { status: "OPEN", introducedAt: { gte: since }, OR: [{ lastActivityAt: { lt: cutoff } }, { replies: 0, introducedAt: { lt: unanswered } }] }, orderBy: { lastActivityAt: "desc" } });
  const seen = new Map<string, (typeof rows)[number]>();
  for (const r of rows) {
    const key = r.subject.toLowerCase().replace(/^s*intros*[-:–—]?s*/, "").replace(/s+/g, " ").trim();
    if (!seen.has(key)) seen.set(key, r);
  }
  return [...seen.values()];
}
