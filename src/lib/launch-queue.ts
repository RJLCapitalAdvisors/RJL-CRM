import { prisma } from "@/lib/db";
import { graph, graphConfigured } from "@/lib/graph";
import { logActivity } from "@/lib/activity";
import { toJson } from "@/lib/taxonomy";
import { advance, chosenFiles, dealFiles, FAQ_KEY, sendMessage, sendReplyAll, type LaunchItem } from "@/lib/send-deal";

/**
 * LAUNCH, paced like a person: one deal email every LAUNCH_GAP_MS from a mailbox, so thirty firms get thirty
 * individually sent emails over fifteen minutes instead of a burst that spam filters flag. The emails sit in a
 * queue (DealLaunch); a pump sends whatever is due. The database's minute scheduler (pg_cron on Supabase) calls the pump
 * route every minute and each run lasts under a minute, so a launch goes on by itself with the page closed and the
 * laptop shut, and two minute runs never overlap. The Send deal page's poll sends what is due while it is open, so the
 * countdown and the send agree to the second. Any number of pumps cannot burst: the claim checks the pacing in the database.
 */
export const LAUNCH_GAP_MS = 12_000; // Oct 1, 2026: twelve seconds (Microsoft allows thirty a minute); heavy attachments still pace by size below
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

export type LaunchStatus = { total: number; sent: number; failed: number; bounced: number; queued: number; nextInMs: number; nextAt: string | null; serverNow: string; gapMs: number; heldUntil: string | null; rows: { rowId: string; status: string; error: string | null; bounced?: string[] }[] };

/** The attachment bytes an email will carry, from the files' recorded sizes (no download): the pacing gap is set from this when the email is queued. */
export async function attachmentBytes(dealId: string, keys: string[] | undefined): Promise<number> {
  const files = await dealFiles(dealId).catch(() => []);
  const picked = keys ? files.filter((f) => keys.includes(f.key)) : files.filter((f) => f.key !== FAQ_KEY);
  return picked.reduce((t, f) => t + (f.key === FAQ_KEY ? 150_000 : f.size || 0), 0);
}

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
  // only what arrived since the last pass: a full read of the inbox took 27 seconds and ran on every page open (Oct 1, 2026)
  const key = `bounceScan:${mailbox.toLowerCase()}`;
  const mark = await prisma.setting.findUnique({ where: { key } }).catch(() => null);
  const from = Math.max(first.createdAt.getTime() - 60_000, mark?.value ? new Date(mark.value).getTime() - 5 * 60_000 : 0);
  const since = new Date(from).toISOString();
  const r = await graph<{ value: { id: string; subject?: string; internetMessageId?: string; receivedDateTime?: string; body?: { content: string } }[] }>(`/users/${encodeURIComponent(mailbox)}/mailFolders/inbox/messages?$filter=${encodeURIComponent(`receivedDateTime ge ${since} and startswith(subject,'Undeliverable')`)}&$orderby=receivedDateTime desc&$select=id,subject,internetMessageId,receivedDateTime,body&$top=50`).catch(() => ({ value: [] }));
  let n = 0;
  for (const m of r.value) {
    const text = (m.body?.content ?? "").replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
    n += await noteLaunchBounce({ mailbox, subject: m.subject ?? null, text, messageId: m.internetMessageId ?? null }).catch(() => 0);
  }
  await prisma.setting.upsert({ where: { key }, create: { key, value: new Date().toISOString() }, update: { value: new Date().toISOString() } }).catch(() => null);
  return n;
}

/** Every row's first sent deal email at once (the Follow ups page asked one row at a time: seven seconds for seventy firms). */
export async function firstSentMessageIds(dealId: string): Promise<Map<string, { messageId: string; sentAt: Date }>> {
  const out = new Map<string, { messageId: string; sentAt: Date }>();
  const sends = await prisma.dealLaunch.findMany({ where: { dealId, kind: "SEND", status: { in: ["SENT", "BOUNCED"] }, sentMessageId: { not: null } }, orderBy: { sentAt: "asc" }, select: { rowId: true, sentMessageId: true, sentAt: true } });
  for (const s of sends) if (!out.has(s.rowId)) out.set(s.rowId, { messageId: s.sentMessageId!, sentAt: s.sentAt ?? new Date() });
  const rows = await prisma.dealInvestor.findMany({ where: { dealId }, select: { id: true, contactId: true, extraContactIds: true } });
  const missing = rows.filter((r) => !out.has(r.id));
  if (!missing.length) return out;
  const ids = [...new Set(missing.flatMap((r) => [r.contactId, ...(r.extraContactIds ? (JSON.parse(r.extraContactIds) as string[]) : [])]))];
  const acts = await prisma.activity.findMany({ where: { dealId, type: "EMAIL", direction: "OUTBOUND", contactId: { in: ids }, externalId: { not: null }, NOT: { subject: { startsWith: "RE:", mode: "insensitive" } } }, orderBy: { occurredAt: "asc" }, select: { contactId: true, externalId: true, occurredAt: true } });
  for (const r of missing) {
    const mine = new Set([r.contactId, ...(r.extraContactIds ? (JSON.parse(r.extraContactIds) as string[]) : [])]);
    const a = acts.find((x) => x.contactId && mine.has(x.contactId));
    if (a?.externalId) out.set(r.id, { messageId: a.externalId, sentAt: a.occurredAt });
  }
  return out;
}

/** Put a deal's failed emails back in the queue (fresh attempts, no hold). Returns how many. */
export async function retryFailed(dealId: string, kind: "SEND" | "FOLLOWUP" = "SEND"): Promise<number> {
  const since = new Date(Date.now() - 24 * 3_600_000);
  const r = await prisma.dealLaunch.updateMany({ where: { dealId, kind, status: "FAILED", createdAt: { gte: since }, NOT: { OR: [{ error: { contains: "no sent deal email" } }, { error: { contains: "already followed up" } }] } }, data: { status: "QUEUED", attempts: 0, notBefore: null, error: null, claimedAt: null } });
  return r.count;
}

/**
 * The deal email a firm was first sent, for a follow-up to reply to: the Internet Message-ID the launch recorded, else the
 * outbound email the log holds for that deal and that firm's people (the launches before Oct 1, 2026 did not record it).
 * Null when nothing on record: a follow-up then never goes out, because a reply on the wrong thread would be worse than none.
 */
export async function firstSentMessageId(dealId: string, rowId: string): Promise<{ messageId: string; sentAt: Date } | null> {
  const sent = await prisma.dealLaunch.findFirst({ where: { dealId, rowId, kind: "SEND", status: { in: ["SENT", "BOUNCED"] }, sentMessageId: { not: null } }, orderBy: { sentAt: "asc" }, select: { sentMessageId: true, sentAt: true } });
  if (sent?.sentMessageId) return { messageId: sent.sentMessageId, sentAt: sent.sentAt ?? new Date() };
  const row = await prisma.dealInvestor.findUnique({ where: { id: rowId }, select: { contactId: true, extraContactIds: true } });
  if (!row) return null;
  const ids = [row.contactId, ...(row.extraContactIds ? (JSON.parse(row.extraContactIds) as string[]) : [])];
  const act = await prisma.activity.findFirst({ where: { dealId, type: "EMAIL", direction: "OUTBOUND", contactId: { in: ids }, externalId: { not: null }, NOT: { subject: { startsWith: "RE:", mode: "insensitive" } } }, orderBy: { occurredAt: "asc" }, select: { externalId: true, occurredAt: true } });
  return act?.externalId ? { messageId: act.externalId, sentAt: act.occurredAt } : null;
}

/** Put every firm's email in the queue. Nothing is sent here; the first goes out on the first pump. A follow-up replies all on the deal email that firm was sent. */
export async function queueDealEmails(dealId: string, items: LaunchItem[], mailbox: string, fileKeys?: string[], opts: { followup?: boolean } = {}): Promise<void> {
  const kind = opts.followup ? "FOLLOWUP" : "SEND";
  const bytes = await attachmentBytes(dealId, fileKeys);
  for (const item of items) {
    const row = await prisma.dealInvestor.findUnique({ where: { id: item.rowId }, select: { id: true, contactId: true } });
    if (!row) continue;
    const people = await prisma.contact.findMany({ where: { id: { in: item.toContactIds.length ? item.toContactIds : [row.contactId] }, email: { not: null } }, select: { id: true } });
    // one live entry per row and kind: a second LAUNCH click while the first is still going does not double-send
    const open = await prisma.dealLaunch.findFirst({ where: { rowId: row.id, kind, status: { in: ["QUEUED", "SENDING"] } } });
    if (open) continue;
    const replyTo = opts.followup ? await firstSentMessageId(dealId, row.id) : null;
    // a firm is followed up once (Jonathan, Oct 1, 2026: Royce got a second one after a single send and the launch): never again
    const already = opts.followup ? await prisma.dealLaunch.findFirst({ where: { dealId, rowId: row.id, kind: "FOLLOWUP", status: { in: ["SENT", "BOUNCED"] } }, orderBy: { sentAt: "asc" }, select: { sentAt: true } }) : null;
    const error = !people.length ? "nobody with an email picked" : opts.followup && already ? `already followed up${already.sentAt ? ` on ${already.sentAt.toLocaleDateString("en-US", { month: "short", day: "numeric" })}` : ""}; a firm is followed up once` : opts.followup && !replyTo ? "no sent deal email on record to reply to" : null;
    await prisma.dealLaunch.create({
      data: { dealId, rowId: row.id, mailbox, kind, replyToMessageId: replyTo?.messageId ?? null, toContactIds: toJson(people.map((p) => p.id)), cc: toJson(item.cc ?? []), subject: item.subject, html: item.html, fileKeys: fileKeys ? toJson(fileKeys) : null, bytes, status: error ? "FAILED" : "QUEUED", error },
    });
  }
}

/**
 * The pump drives itself from the server (Oct 1, 2026: a launch used to stop when Jonathan's laptop went to sleep,
 * because only the open page and the next page load pumped it). After queueing, the Send deal page calls this once;
 * the pump route answers at once, sends for up to four and a half minutes in the background, and calls itself again
 * while anything is queued. Needs APP_URL and CRON_SECRET; without them the caller falls back to pumping in place.
 */
export async function kickPump(): Promise<boolean> {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const base = (process.env.APP_URL ?? process.env.NEXT_PUBLIC_APP_URL ?? "https://rjl-crm.vercel.app").replace(/\/$/, "");
  try {
    const res = await fetch(`${base}/api/launch/pump?key=${encodeURIComponent(secret)}&quick=1`, { method: "POST", cache: "no-store", signal: AbortSignal.timeout(20_000) });
    return res.ok;
  } catch {
    return false;
  }
}

/** When the mailbox last started or finished sending (0 when never). The gap is measured from here: Microsoft counts the upload, which starts at the claim. */
async function lastSendMark(mailbox: string): Promise<number> {
  const last = await prisma.dealLaunch.findFirst({ where: { mailbox, status: { in: ["SENT", "SENDING"] } }, orderBy: [{ claimedAt: "desc" }], select: { claimedAt: true, sentAt: true } });
  return Math.max(last?.claimedAt?.getTime() ?? 0, last?.sentAt?.getTime() ?? 0);
}
/** Milliseconds until the mailbox may send again (0 when it may send now); the gap grows with the attachments the next email carries. */
async function waitFor(mailbox: string, gapMs = LAUNCH_GAP_MS): Promise<number> {
  return Math.max(0, (await lastSendMark(mailbox)) + gapMs - Date.now());
}
/** Queued emails that may go now (none held back by a throttle wait). */
const ready = (mailbox: string) => ({ mailbox, status: "QUEUED", OR: [{ notBefore: null }, { notBefore: { lte: new Date() } }] });
/**
 * Claim one email, in one statement that also checks the pacing: the claim fails when another pump sent (or started
 * sending) from this mailbox inside the gap. Oct 7, 2026: three pumps that had each slept through the same gap woke
 * together and each claimed a different email, so three went out within three seconds; a check before the sleep is not
 * a check at the claim. The database decides, so any number of pumps cannot burst.
 */
async function claim(id: string, mailbox: string, gapMs: number): Promise<boolean> {
  const n = await prisma.$executeRaw`UPDATE "DealLaunch" SET status = 'SENDING', "claimedAt" = (now() at time zone 'utc')
    WHERE id = ${id} AND status = 'QUEUED'
    AND NOT EXISTS (SELECT 1 FROM "DealLaunch" l WHERE l.mailbox = ${mailbox} AND l.status IN ('SENT', 'SENDING')
      AND GREATEST(COALESCE(l."claimedAt", 'epoch'::timestamp), COALESCE(l."sentAt", 'epoch'::timestamp)) > (now() at time zone 'utc') - (${gapMs} * interval '1 millisecond'))`;
  return n > 0;
}

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
    const next = await prisma.dealLaunch.findFirst({ where: ready(mailbox), orderBy: { createdAt: "asc" } });
    if (!next) break;
    const gap = gapForBytes(next.bytes);
    const wait = await waitFor(mailbox, gap);
    if (wait > 0) {
      if (Date.now() + wait - started > budgetMs) break; // the gap does not fit in this run: the next run takes it
      await new Promise((r) => setTimeout(r, wait));
    }
    if (!(await claim(next.id, mailbox, gap))) {
      // another pump sent inside the gap (or took this email): look again, and if the new wait does not fit, stop
      if (Date.now() - started > budgetMs) break;
      continue;
    }
    try {
      const row = await prisma.dealInvestor.findUniqueOrThrow({ where: { id: next.rowId }, include: { contact: { select: { companyId: true } } } });
      const ids = JSON.parse(next.toContactIds) as string[];
      const people = await prisma.contact.findMany({ where: { id: { in: ids }, email: { not: null } } });
      const to = people.map((p) => p.email!);
      if (!to.length) throw new Error("nobody with an email picked");
      const keys = next.fileKeys ? (JSON.parse(next.fileKeys) as string[]) : undefined;
      const cacheKey = `${next.dealId}:${next.fileKeys ?? ""}`;
      if (!cache.has(cacheKey)) cache.set(cacheKey, await chosenFiles(next.dealId, keys));
      const followup = next.kind === "FOLLOWUP";
      if (followup && !next.replyToMessageId) throw new Error("no sent deal email on record to reply to");
      if (followup && (await prisma.dealLaunch.findFirst({ where: { dealId: next.dealId, rowId: next.rowId, kind: "FOLLOWUP", status: { in: ["SENT", "BOUNCED"] }, NOT: { id: next.id } }, select: { id: true } }))) throw new Error("already followed up; a firm is followed up once");
      const messageId = followup
        ? await sendReplyAll(mailbox, next.replyToMessageId!, to, next.html, cache.get(cacheKey)!, JSON.parse(next.cc) as string[])
        : await sendMessage(mailbox, to, next.subject, next.html, cache.get(cacheKey)!, JSON.parse(next.cc) as string[]);
      const now = new Date();
      const meta = JSON.stringify({ from: { address: mailbox }, to: people.map((p) => ({ name: [p.firstName, p.lastName].filter(Boolean).join(" ") || undefined, address: p.email! })), cc: (JSON.parse(next.cc) as string[]).map((address) => ({ address })), mailbox, hasAttachments: Boolean(cache.get(cacheKey)?.atts.length) });
      if (followup) {
        // a follow-up after no response: the row reads Followed Up, nothing else moves
        await prisma.dealInvestor.update({ where: { id: row.id }, data: { ...(row.status === 2 ? { status: 3 } : {}), updatedAt: now } });
        for (const p of people) await logActivity({ type: "EMAIL", direction: "OUTBOUND", subject: next.subject, body: "Follow-up sent (Follow ups): reply-all on the deal email", externalId: p.id === people[0].id ? messageId : null, contactId: p.id, companyId: row.contact.companyId, dealId: next.dealId, occurredAt: now, meta }).catch(() => {});
      } else {
        await prisma.dealInvestor.update({ where: { id: row.id }, data: { status: Math.max(row.status, 2), bodyOverride: next.html, extraContactIds: toJson(people.map((p) => p.id).filter((id) => id !== row.contactId)), sendDraftId: null, sendMailbox: null, sendDraftAt: null, updatedAt: now } });
        for (const p of people) await logActivity({ type: "EMAIL", direction: "OUTBOUND", subject: next.subject, body: "Deal email sent (Send deal)", externalId: p.id === people[0].id ? messageId : null, contactId: p.id, companyId: row.contact.companyId, dealId: next.dealId, occurredAt: now, meta }).catch(() => {});
      }
      await prisma.dealLaunch.update({ where: { id: next.id }, data: { status: "SENT", sentAt: now, sentMessageId: messageId } });
      if (!followup) await advance(next.dealId, "Deal Taken To Market").catch(() => {});
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
  void bytesOf;
  return { sent, remaining: await prisma.dealLaunch.count({ where: { mailbox, status: "QUEUED" } }) };
}

/** Every mailbox with something queued gets a pump. Called from page loads and the cron so a closed tab does not strand a launch. */
export async function pumpAllLaunches(budgetMs = 45_000): Promise<number> {
  const boxes = await prisma.dealLaunch.findMany({ where: { status: "QUEUED" }, distinct: ["mailbox"], select: { mailbox: true } });
  let sent = 0;
  const started = Date.now();
  for (const b of boxes) sent += (await pumpLaunches(b.mailbox, Math.max(2_000, budgetMs - (Date.now() - started))).catch(() => ({ sent: 0 }))).sent;
  // bounces on recent launches, so a firm whose people left shows as bounced without anyone opening the page
  const recent = await prisma.dealLaunch.findMany({ where: { status: "SENT", createdAt: { gte: new Date(Date.now() - 3 * 86_400_000) } }, distinct: ["mailbox"], select: { mailbox: true } });
  for (const b of recent) await scanLaunchBounces(b.mailbox).catch(() => 0);
  return sent;
}

/** Where a deal's launch stands, for the progress note on the Send deal page. */
export async function launchStatus(dealId: string, kind: "SEND" | "FOLLOWUP" = "SEND"): Promise<LaunchStatus> {
  const since = new Date(Date.now() - 7 * 86_400_000); // a bounce can arrive a day later; the firm still has to show as bounced
  const rows = await prisma.dealLaunch.findMany({ where: { dealId, kind, createdAt: { gte: since } }, orderBy: { createdAt: "asc" }, select: { rowId: true, status: true, error: true, mailbox: true, notBefore: true, bytes: true } });
  const latest = new Map<string, (typeof rows)[number]>();
  for (const r of rows) latest.set(r.rowId, r);
  const list = [...latest.values()];
  const n = (s: string[]) => list.filter((r) => s.includes(r.status)).length;
  const mailbox = list[0]?.mailbox;
  const holds = list.filter((r) => r.status === "QUEUED" && r.notBefore && r.notBefore.getTime() > Date.now()).map((r) => r.notBefore!.getTime());
  const allHeld = holds.length > 0 && holds.length === n(["QUEUED"]);
  const heldUntil = allHeld ? new Date(Math.min(...holds)).toISOString() : null;
  // the next email in line for this mailbox (any deal) sets the gap; the countdown on the page is this moment, not a guess
  const nextRow = mailbox ? await prisma.dealLaunch.findFirst({ where: ready(mailbox), orderBy: { createdAt: "asc" }, select: { bytes: true } }) : null;
  const gapMs = gapForBytes(nextRow?.bytes ?? list.find((r) => r.status === "QUEUED")?.bytes ?? 0);
  const now = Date.now();
  const mark = mailbox ? await lastSendMark(mailbox) : 0;
  const due = Math.max(mark + gapMs, heldUntil ? Math.min(...holds) : 0, now);
  const sendingNow = list.some((r) => r.status === "SENDING");
  return { total: list.length, sent: n(["SENT"]), failed: n(["FAILED"]), bounced: n(["BOUNCED"]), queued: n(["QUEUED", "SENDING"]), nextInMs: due - now, nextAt: n(["QUEUED", "SENDING"]) > 0 ? new Date(sendingNow ? now : due).toISOString() : null, serverNow: new Date(now).toISOString(), gapMs, heldUntil, rows: list.map((r) => ({ rowId: r.rowId, status: r.status, error: r.error, ...(r.status === "BOUNCED" ? { bounced: (r.error?.match(EMAIL_RE) ?? []).map((e) => e.toLowerCase()) } : {}) })) };
}
