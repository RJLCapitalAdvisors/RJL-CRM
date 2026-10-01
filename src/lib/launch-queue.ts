import { prisma } from "@/lib/db";
import { graph, graphConfigured } from "@/lib/graph";
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
// Exchange sometimes loses the draft between creating it and uploading a file ("ErrorItemNotFound", Leste on Mila + Alma, Sep 28, 2026): worth another go
const isPassing = (msg: string) => /ErrorItemNotFound|\b50[234]\b|ECONNRESET|ETIMEDOUT|fetch failed|socket hang up|ServiceUnavailable|InternalServerError/i.test(msg);
const backoffMs = (attempt: number) => Math.min(30, 5 * attempt) * 60_000;
const bytesOf = (src: Awaited<ReturnType<typeof chosenFiles>>) => (src ? src.atts.reduce((t, a) => t + ((a as { size?: number }).size ?? (a as { _bytes?: Uint8Array })._bytes?.byteLength ?? 0), 0) : 0);

export type LaunchStatus = { total: number; sent: number; failed: number; bounced: number; queued: number; nextInMs: number; heldUntil: string | null; rows: { rowId: string; status: string; error: string | null; bounced?: string[] }[] };

const BOUNCE_PREFIX = /^(?:(?:re|fw|fwd)\s*:\s*)?(?:undeliverable|undelivered(?: mail returned to sender)?|delivery (?:status notification|has failed|failure)|mail delivery failed|returned mail|failure notice)\s*[:(]?\s*/i;
const EMAIL_RE = /[\w.+-]+@[\w-]+\.[\w.-]+/g;
/** The addresses a bounce names, minus mail systems and us. */
const bouncedAddressesIn = (text: string) => [...new Set((text.match(EMAIL_RE) ?? []).map((e) => e.toLowerCase().replace(/[.,;:)]+$/, "")).filter((e) => !/rjlcapadvisors|rjlequities|postmaster|mailer-daemon|noreply|no-reply|microsoft\.com|outlook\.com/i.test(e)))];

/**
 * A bounce ("Undeliverable: <subject>") in the sending mailbox names the addresses that did not get the email. Matched to
 * the launch rows with that subject, the row becomes BOUNCED with the addresses in its error, so the Send deal page
 * shows the firm as bounced and lets Jonathan pick other people there and send again (Fortress on Mila + Alma, Sep 28,
 * 2026: both people had left). Each bounced person is proposed for removal in Data updates as before.
 */
export async function noteLaunchBounce(opts: { mailbox: string; subject: string | null; text: string; messageId?: string | null }): Promise<number> {
  const subject = (opts.subject ?? "").trim();
  if (!BOUNCE_PREFIX.test(subject)) return 0;
  const strip = (s: string) => s.replace(/\{[^}]*\}|\[[^\]]*\]/g, "").replace(/\s+/g, " ").trim().toLowerCase(); // "{EXTERNAL}", "[EXT]" tags that mail systems add
  const original = strip(subject.replace(BOUNCE_PREFIX, ""));
  if (!original) return 0;
  const addresses = bouncedAddressesIn(opts.text);
  if (!addresses.length) return 0;
  const since = new Date(Date.now() - 14 * 86_400_000);
  const rows = (await prisma.dealLaunch.findMany({ where: { mailbox: { equals: opts.mailbox, mode: "insensitive" }, status: { in: ["SENT", "BOUNCED"] }, createdAt: { gte: since } } })).filter((r) => strip(r.subject) === original);
  let n = 0;
  for (const r of rows) {
    const people = await prisma.contact.findMany({ where: { id: { in: JSON.parse(r.toContactIds) as string[] } }, select: { id: true, email: true } });
    const hit = people.filter((p) => p.email && addresses.includes(p.email.toLowerCase()));
    if (!hit.length) continue;
    const already = new Set((r.error?.match(EMAIL_RE) ?? []).map((e) => e.toLowerCase()));
    const all = [...new Set([...already, ...hit.map((p) => p.email!.toLowerCase())])];
    if (r.status === "BOUNCED" && all.length === already.size) continue; // this bounce was seen
    await prisma.dealLaunch.update({ where: { id: r.id }, data: { status: "BOUNCED", error: `bounced: ${all.join(", ")}${all.length < people.length ? " (the others got it)" : ""}` } });
    const { proposeContactRemoval } = await import("@/lib/departures");
    for (const p of hit) if (!already.has(p.email!.toLowerCase())) await proposeContactRemoval(p.id, `Bounced on the deal email "${original}": ${opts.text.slice(0, 200)}`, opts.messageId ?? null).catch(() => false);
    n++;
  }
  return n;
}

/** Bounces in a mailbox's inbox since its recent launches, matched to their rows. Runs when a launch ends and when the Send deal page opens. */
export async function scanLaunchBounces(mailbox: string): Promise<number> {
  if (!graphConfigured()) return 0;
  const first = await prisma.dealLaunch.findFirst({ where: { mailbox: { equals: mailbox, mode: "insensitive" }, status: { in: ["SENT", "BOUNCED"] }, createdAt: { gte: new Date(Date.now() - 14 * 86_400_000) } }, orderBy: { createdAt: "asc" }, select: { createdAt: true } });
  if (!first) return 0;
  const since = new Date(first.createdAt.getTime() - 60_000).toISOString();
  const r = await graph<{ value: { id: string; subject?: string; internetMessageId?: string; body?: { content: string } }[] }>(`/users/${encodeURIComponent(mailbox)}/mailFolders/inbox/messages?$filter=${encodeURIComponent(`receivedDateTime ge ${since} and startswith(subject,'Undeliverable')`)}&$select=id,subject,internetMessageId,body&$top=50`).catch(() => ({ value: [] }));
  let n = 0;
  for (const m of r.value) {
    const text = (m.body?.content ?? "").replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
    n += await noteLaunchBounce({ mailbox, subject: m.subject ?? null, text, messageId: m.internetMessageId ?? null }).catch(() => 0);
  }
  return n;
}

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
      if ((isThrottle(msg) || isPassing(msg)) && next.attempts + 1 < MAX_ATTEMPTS) {
        // Microsoft said slow down (or hiccuped): back in the queue with a wait; a throttle also stops this pump hammering
        const attempt = next.attempts + 1;
        await prisma.dealLaunch.update({ where: { id: next.id }, data: { status: "QUEUED", attempts: attempt, notBefore: new Date(Date.now() + (isThrottle(msg) ? backoffMs(attempt) : 60_000 * attempt)), error: msg, claimedAt: null } });
        if (isThrottle(msg)) break;
        continue;
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
  // bounces on recent launches, so a firm whose people left shows as bounced without anyone opening the page
  const recent = await prisma.dealLaunch.findMany({ where: { status: "SENT", createdAt: { gte: new Date(Date.now() - 3 * 86_400_000) } }, distinct: ["mailbox"], select: { mailbox: true } });
  for (const b of recent) await scanLaunchBounces(b.mailbox).catch(() => 0);
  return sent;
}

/** Where a deal's launch stands, for the progress note on the Send deal page. */
export async function launchStatus(dealId: string): Promise<LaunchStatus> {
  const since = new Date(Date.now() - 7 * 86_400_000); // a bounce can arrive a day later; the firm still has to show as bounced
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
  return { total: list.length, sent: n(["SENT"]), failed: n(["FAILED"]), bounced: n(["BOUNCED"]), queued: n(["QUEUED", "SENDING"]), nextInMs: heldUntil ? Math.max(baseWait, Math.min(...holds) - Date.now()) : baseWait, heldUntil, rows: list.map((r) => ({ rowId: r.rowId, status: r.status, error: r.error, ...(r.status === "BOUNCED" ? { bounced: (r.error?.match(EMAIL_RE) ?? []).map((e) => e.toLowerCase()) } : {}) })) };
}
