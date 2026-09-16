import { prisma } from "@/lib/db";
import { graphConfigured } from "@/lib/graph";
import { logActivity } from "@/lib/activity";
import { toJson } from "@/lib/taxonomy";
import { advance, chosenFiles, sendMessage, type LaunchItem } from "@/lib/send-deal";

/**
 * LAUNCH, paced like a person: one deal email every LAUNCH_GAP_MS from a mailbox, so thirty firms get thirty
 * individually sent emails over fifteen minutes instead of a burst that spam filters flag. The emails sit in a
 * queue (DealLaunch); a pump sends whatever is due. The Send deal page keeps pumping while it is open, and page
 * loads elsewhere pump too, so a launch finishes even if the page is closed.
 */
export const LAUNCH_GAP_MS = 30_000;
/**
 * Microsoft throttles attachment uploads per mailbox ("Application is over its IncomingBytes limit", HTTP 429): on
 * Sep 16 the Gateway launch carried 9.9 MB per email and 13 of 28 failed after the first fifteen went out. So the gap
 * between two emails also grows with what they carry (about 40 MB of attachments per five minutes), and a throttled
 * email goes back in the queue with a wait instead of failing.
 */
const BYTES_PER_WINDOW = 40 * 1024 * 1024;
const WINDOW_MS = 5 * 60_000;
const MAX_ATTEMPTS = 8;
export const gapForBytes = (bytes: number) => Math.max(LAUNCH_GAP_MS, Math.ceil((bytes / BYTES_PER_WINDOW) * WINDOW_MS));
const isThrottle = (msg: string) => /\b429\b|throttl|IncomingBytes|TooManyRequests|MailboxConcurrency/i.test(msg);
const backoffMs = (attempt: number) => Math.min(30, 5 * attempt) * 60_000;
const bytesOf = (src: Awaited<ReturnType<typeof chosenFiles>>) => (src ? src.atts.reduce((t, a) => t + ((a as { size?: number }).size ?? (a as { _bytes?: Uint8Array })._bytes?.byteLength ?? 0), 0) : 0);

export type LaunchStatus = { total: number; sent: number; failed: number; queued: number; nextInMs: number; heldUntil: string | null; rows: { rowId: string; status: string; error: string | null }[] };

/** Put a deal's failed emails back in the queue (fresh attempts, no hold). Returns how many. */
export async function retryFailed(dealId: string): Promise<number> {
  const since = new Date(Date.now() - 24 * 3_600_000);
  const r = await prisma.dealLaunch.updateMany({ where: { dealId, status: "FAILED", createdAt: { gte: since } }, data: { status: "QUEUED", attempts: 0, notBefore: null, error: null, claimedAt: null } });
  return r.count;
}

/** Put every firm's email in the queue. Nothing is sent here; the first goes out on the first pump. */
export async function queueDealEmails(dealId: string, items: LaunchItem[], mailbox: string, fileKeys?: string[]): Promise<void> {
  for (const item of items) {
    const row = await prisma.dealInvestor.findUnique({ where: { id: item.rowId }, select: { id: true, contactId: true } });
    if (!row) continue;
    const people = await prisma.contact.findMany({ where: { id: { in: item.toContactIds.length ? item.toContactIds : [row.contactId] }, email: { not: null } }, select: { id: true } });
    // one live entry per row: a second LAUNCH click while the first is still going does not double-send
    const open = await prisma.dealLaunch.findFirst({ where: { rowId: row.id, status: { in: ["QUEUED", "SENDING"] } } });
    if (open) continue;
    await prisma.dealLaunch.create({
      data: { dealId, rowId: row.id, mailbox, toContactIds: toJson(people.map((p) => p.id)), cc: toJson(item.cc ?? []), subject: item.subject, html: item.html, fileKeys: fileKeys ? toJson(fileKeys) : null, status: people.length ? "QUEUED" : "FAILED", error: people.length ? null : "nobody with an email picked" },
    });
  }
}

/** Milliseconds until the mailbox may send again (0 when it may send now); the gap grows with the attachments the next email carries. */
async function waitFor(mailbox: string, gapMs = LAUNCH_GAP_MS): Promise<number> {
  const last = await prisma.dealLaunch.findFirst({ where: { mailbox, status: { in: ["SENT", "SENDING"] } }, orderBy: [{ claimedAt: "desc" }], select: { claimedAt: true, sentAt: true } });
  const t = Math.max(last?.claimedAt?.getTime() ?? 0, last?.sentAt?.getTime() ?? 0);
  return Math.max(0, t + gapMs - Date.now());
}
/** Queued emails that may go now (none held back by a throttle wait). */
const ready = (mailbox: string) => ({ mailbox, status: "QUEUED", OR: [{ notBefore: null }, { notBefore: { lte: new Date() } }] });

/**
 * Send what is due from one mailbox, one email per gap, for as long as the time budget allows. Two pumps at once
 * cannot send the same email: a row is claimed (QUEUED -> SENDING) before it is sent, and the claim counts for pacing.
 */
export async function pumpLaunches(mailbox: string, budgetMs = 8_000): Promise<{ sent: number; remaining: number }> {
  const started = Date.now();
  let sent = 0;
  const cache = new Map<string, Awaited<ReturnType<typeof chosenFiles>>>();
  if (!graphConfigured()) return { sent: 0, remaining: await prisma.dealLaunch.count({ where: { mailbox, status: "QUEUED" } }) };
  for (;;) {
    const peek = await prisma.dealLaunch.findFirst({ where: ready(mailbox), orderBy: { createdAt: "asc" } });
    if (!peek) break;
    const peekKeys = peek.fileKeys ? (JSON.parse(peek.fileKeys) as string[]) : undefined;
    const peekCache = `${peek.dealId}:${peek.fileKeys ?? ""}`;
    if (!cache.has(peekCache)) cache.set(peekCache, await chosenFiles(peek.dealId, peekKeys));
    const wait = await waitFor(mailbox, gapForBytes(bytesOf(cache.get(peekCache)!)));
    if (wait > 0) {
      if (Date.now() + wait - started > budgetMs) break;
      await new Promise((r) => setTimeout(r, wait));
    }
    const next = await prisma.dealLaunch.findFirst({ where: ready(mailbox), orderBy: { createdAt: "asc" } });
    if (!next) break;
    const claimed = await prisma.dealLaunch.updateMany({ where: { id: next.id, status: "QUEUED" }, data: { status: "SENDING", claimedAt: new Date() } });
    if (claimed.count === 0) continue; // another pump took it
    try {
      const row = await prisma.dealInvestor.findUniqueOrThrow({ where: { id: next.rowId }, include: { contact: { select: { companyId: true } } } });
      const ids = JSON.parse(next.toContactIds) as string[];
      const people = await prisma.contact.findMany({ where: { id: { in: ids }, email: { not: null } } });
      const to = people.map((p) => p.email!);
      if (!to.length) throw new Error("nobody with an email picked");
      const keys = next.fileKeys ? (JSON.parse(next.fileKeys) as string[]) : undefined;
      const cacheKey = `${next.dealId}:${next.fileKeys ?? ""}`;
      if (!cache.has(cacheKey)) cache.set(cacheKey, await chosenFiles(next.dealId, keys));
      const messageId = await sendMessage(mailbox, to, next.subject, next.html, cache.get(cacheKey)!, JSON.parse(next.cc) as string[]);
      const now = new Date();
      await prisma.dealInvestor.update({ where: { id: row.id }, data: { status: Math.max(row.status, 2), bodyOverride: next.html, extraContactIds: toJson(people.map((p) => p.id).filter((id) => id !== row.contactId)), sendDraftId: null, sendMailbox: null, sendDraftAt: null, updatedAt: now } });
      for (const p of people) await logActivity({ type: "EMAIL", direction: "OUTBOUND", subject: next.subject, body: "Deal email sent (Send deal)", externalId: p.id === people[0].id ? messageId : null, contactId: p.id, companyId: row.contact.companyId, dealId: next.dealId, occurredAt: now }).catch(() => {});
      await prisma.dealLaunch.update({ where: { id: next.id }, data: { status: "SENT", sentAt: now } });
      await advance(next.dealId, "Deal Taken To Market").catch(() => {});
      sent++;
    } catch (e) {
      const msg = String(e instanceof Error ? e.message : e).slice(0, 300);
      if (isThrottle(msg) && next.attempts + 1 < MAX_ATTEMPTS) {
        // Microsoft said slow down: back in the queue with a wait, and this pump stops hammering
        const attempt = next.attempts + 1;
        await prisma.dealLaunch.update({ where: { id: next.id }, data: { status: "QUEUED", attempts: attempt, notBefore: new Date(Date.now() + backoffMs(attempt)), error: msg, claimedAt: null } });
        break;
      }
      await prisma.dealLaunch.update({ where: { id: next.id }, data: { status: "FAILED", attempts: next.attempts + 1, error: msg } });
    }
    if (Date.now() - started > budgetMs) break;
  }
  return { sent, remaining: await prisma.dealLaunch.count({ where: { mailbox, status: "QUEUED" } }) };
}

/** Every mailbox with something queued gets a pump. Called from page loads and the cron so a closed tab does not strand a launch. */
export async function pumpAllLaunches(budgetMs = 45_000): Promise<number> {
  const boxes = await prisma.dealLaunch.findMany({ where: { status: "QUEUED" }, distinct: ["mailbox"], select: { mailbox: true } });
  let sent = 0;
  for (const b of boxes) sent += (await pumpLaunches(b.mailbox, budgetMs).catch(() => ({ sent: 0 }))).sent;
  return sent;
}

/** Where a deal's launch stands, for the progress note on the Send deal page. */
export async function launchStatus(dealId: string): Promise<LaunchStatus> {
  const since = new Date(Date.now() - 24 * 3_600_000);
  const rows = await prisma.dealLaunch.findMany({ where: { dealId, createdAt: { gte: since } }, orderBy: { createdAt: "asc" }, select: { rowId: true, status: true, error: true, mailbox: true, notBefore: true } });
  const latest = new Map<string, (typeof rows)[number]>();
  for (const r of rows) latest.set(r.rowId, r);
  const list = [...latest.values()];
  const n = (s: string[]) => list.filter((r) => s.includes(r.status)).length;
  const mailbox = list[0]?.mailbox;
  const holds = list.filter((r) => r.status === "QUEUED" && r.notBefore && r.notBefore.getTime() > Date.now()).map((r) => r.notBefore!.getTime());
  const allHeld = holds.length > 0 && holds.length === n(["QUEUED"]);
  const heldUntil = allHeld ? new Date(Math.min(...holds)).toISOString() : null;
  const baseWait = mailbox ? await waitFor(mailbox) : 0;
  return { total: list.length, sent: n(["SENT"]), failed: n(["FAILED"]), queued: n(["QUEUED", "SENDING"]), nextInMs: heldUntil ? Math.max(baseWait, Math.min(...holds) - Date.now()) : baseWait, heldUntil, rows: list.map((r) => ({ rowId: r.rowId, status: r.status, error: r.error })) };
}
