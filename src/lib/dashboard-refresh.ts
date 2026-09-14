import { prisma } from "@/lib/db";
import { graphConfigured, sentMessagesTo } from "@/lib/graph";

/**
 * Everything the dashboard used to ask Microsoft on every load now runs here, after the page is served and at
 * most once a minute: follow-up drafts that went out, report drafts that went out, Handle emails that went out
 * (intros, deal momentum, quiet deals), and the signed-in person's recent Sent Items. The page itself reads the
 * database only, so a load or a button click renders in a few hundred milliseconds; the next load shows what the
 * pass found.
 */
let last = 0;
let running: Promise<void> | null = null;

export async function refreshDashboardSignals(me?: string | null): Promise<void> {
  if (!graphConfigured()) return;
  const [{ syncFollowUpDrafts }, { syncReportDrafts }, { syncHandledMomentum, syncHandledStale }, { syncRecentSent }] = await Promise.all([import("@/lib/followup"), import("@/lib/report-due"), import("@/lib/handled"), import("@/lib/mail-sync")]);
  await Promise.all([
    syncFollowUpDrafts().catch(() => 0),
    syncReportDrafts().catch(() => 0),
    syncHandledIntros().catch(() => 0),
    syncHandledMomentum().catch(() => 0),
    syncHandledStale().catch(() => 0),
    me ? syncRecentSent(me).catch(() => 0) : Promise.resolve(0),
  ]);
}

/** From the dashboard render: run the pass in the background, throttled, never twice at once. */
export function kickDashboardRefresh(me: string | null | undefined, minSeconds = 45) {
  if (!graphConfigured()) return;
  if (running || Date.now() - last < minSeconds * 1000) return;
  last = Date.now();
  const run = async () => {
    running = refreshDashboardSignals(me).catch(() => undefined);
    await running;
    running = null;
  };
  import("next/server")
    .then(({ after }) => after(run))
    .catch(() => void run());
}

/** Intros whose Handle reply went out: Sent Items check, the part that used to run inside the page render. */
export async function syncHandledIntros(): Promise<number> {
  const rows = await prisma.intro.findMany({ where: { status: "OPEN", handledAt: { not: null } }, select: { id: true, mailbox: true, recipients: true, handledAt: true } });
  let n = 0;
  for (const r of rows) {
    const recips = (JSON.parse(r.recipients || "[]") as string[]).map((x) => x.toLowerCase());
    let sentAt: Date | null = null;
    for (const to of recips.slice(0, 3)) {
      const sent = await sentMessagesTo(r.mailbox, to, 5).catch(() => [] as { sentDateTime?: string }[]);
      const hit = sent.find((x) => x.sentDateTime && new Date(x.sentDateTime) > r.handledAt!);
      if (hit?.sentDateTime) {
        sentAt = new Date(hit.sentDateTime);
        break;
      }
    }
    if (!sentAt) continue;
    await prisma.intro.update({ where: { id: r.id }, data: { lastActivityAt: sentAt, replies: { increment: 1 }, handledAt: null } }).catch(() => null);
    n++;
  }
  return n;
}
