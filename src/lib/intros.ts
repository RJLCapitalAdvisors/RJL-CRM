import { prisma } from "@/lib/db";
import { graph, graphConfigured, sentMessagesTo } from "@/lib/graph";

/**
 * Intros to reconsider. Every "Intro - Company A | Company B" email any of us sent is an introduction we
 * made; most get forgotten. We record each one from every team mailbox, watch its thread for activity,
 * and surface the ones that went quiet so Jonathan can nudge with one click.
 */

const DAY = 86_400_000;
const LOOKBACK_DAYS = 365;
export const QUIET_INTRO_DAYS = 30;
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
        const thread = await pageAll(`/users/${q(mailbox)}/messages?$filter=conversationId eq '${m.conversationId.replace(/'/g, "''")}'&$select=id,internetMessageId,receivedDateTime,sentDateTime,from,toRecipients,ccRecipients,isDraft&$top=50`, 100);
        const internal = (a?: string) => !a || /@(rjlcapadvisors|rjlequities|livikapital).com$/i.test(a);
        for (const t of thread) {
          if ((t as { isDraft?: boolean }).isDraft) continue; // a discarded reply draft is not activity and cannot be replied to
          // an internal-only side conversation (a teammate replying just to us) is not activity with the parties
          const everyone = [t.from?.emailAddress.address, ...(t.toRecipients ?? []).map((r) => r.emailAddress.address), ...(t.ccRecipients ?? []).map((r) => r.emailAddress.address)];
          if (everyone.every(internal)) continue;
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
/** An intro stops coming back once nothing has happened on it for this long, counted from the last touch, not from the day it was made. */
export const INTRO_WINDOW_DAYS = 365;

/**
 * Intros that went quiet: nothing on the thread for QUIET_INTRO_DAYS, last touched within INTRO_WINDOW_DAYS (a year).
 * They keep coming back every QUIET_INTRO_DAYS of silence until someone replies or the year runs out.
 * The same intro often exists in two mailboxes (sender + cc'd teammate) or was sent twice; one entry per subject,
 * keeping whichever copy saw the latest activity.
 */
export async function quietIntros(since = new Date(Date.now() - INTRO_WINDOW_DAYS * DAY)) {
  const cutoff = new Date(Date.now() - QUIET_INTRO_DAYS * DAY);
  const unanswered = new Date(Date.now() - UNANSWERED_INTRO_DAYS * DAY);
  const rows = await prisma.intro.findMany({ where: { status: "OPEN", lastActivityAt: { gte: since }, OR: [{ lastActivityAt: { lt: cutoff } }, { replies: 0, introducedAt: { lt: unanswered } }] }, orderBy: { lastActivityAt: "desc" } });
  const seen = new Map<string, (typeof rows)[number]>();
  for (const r of rows) {
    const recips = (JSON.parse(r.recipients || "[]") as string[]).map((x) => x.toLowerCase());
    // traction: the two sides of the intro are now on a live deal together (sponsor and an LP taking a look or further). Retired for good.
    if (await introHasTraction(recips)) {
      await prisma.intro.update({ where: { id: r.id }, data: { status: "DONE" } }).catch(() => null);
      continue;
    }
    if (r.handledAt) {
      const logged = recips.length
        ? await prisma.activity.findFirst({ where: { type: "EMAIL", direction: "OUTBOUND", occurredAt: { gt: r.handledAt }, contact: { email: { in: recips } } }, select: { occurredAt: true } })
        : null;
      // the email log only here; Sent Items is checked in the background (dashboard-refresh.ts), never in the render
      const sentAt: Date | null = logged?.occurredAt ?? null;
      if (sentAt) {
        // the thread moved: quiet clock restarts from the reply, and the intro comes back only after QUIET_INTRO_DAYS of silence
        await prisma.intro.update({ where: { id: r.id }, data: { lastActivityAt: sentAt, replies: { increment: 1 }, handledAt: null } }).catch(() => null);
        continue;
      }
    }
    const key = r.subject.toLowerCase().replace(/^s*intros*[-:–—]?s*/, "").replace(/s+/g, " ").trim();
    if (!seen.has(key)) seen.set(key, r);
  }
  return [...seen.values()];
}


/**
 * An intro has traction when the people on it are now on a live deal together: one recipient's firm sponsors an
 * active deal and someone at another recipient's firm sits on that deal's progress report at Taking a look or
 * better. Such an intro never comes back to the dashboard.
 */
async function introHasTraction(recipients: string[]): Promise<boolean> {
  const domains = [...new Set(recipients.map((e) => e.split("@")[1]).filter((d): d is string => Boolean(d) && !/rjlcapadvisors|rjlequities/i.test(d)))];
  if (domains.length < 2) return false;
  const companies = await prisma.company.findMany({ where: { domain: { in: domains } }, select: { id: true, domain: true } });
  if (companies.length < 2) return false;
  const ids = companies.map((c) => c.id);
  const hit = await prisma.dealInvestor.findFirst({
    where: { status: { gte: 4 }, deal: { stage: { notIn: ["Deal Lost", "Deal Closed"] }, sponsorCompanyId: { in: ids } }, contact: { companyId: { in: ids } } },
    select: { id: true, deal: { select: { sponsorCompanyId: true } }, contact: { select: { companyId: true } } },
  });
  return Boolean(hit && hit.deal.sponsorCompanyId !== hit.contact.companyId);
}
