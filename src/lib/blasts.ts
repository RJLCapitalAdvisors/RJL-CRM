import { prisma } from "@/lib/db";
import { parseList } from "@/lib/taxonomy";
import { mailConfigured, sendBatch, sendEmail } from "@/lib/mailer";
import { renderForRecipient } from "@/lib/campaign-render";
import { unsubscribeUrl } from "@/lib/tokens";
import { logActivity } from "@/lib/activity";

/**
 * Email blasts: the Mailchimp / HubSpot marketing replacement. Pick a segment (investors, sponsors or everyone,
 * optionally by asset class), a template, a send time, and a follow-up cadence. Emails go out from Jonathan's
 * address through Resend (so his mailbox never sends bulk mail), replies land in his inbox, every email carries
 * a one-click unsubscribe, and anyone who has not replied gets the same email again after N days until they do.
 */

export type Segment = { audience: "Investor" | "Sponsor" | "All"; assetClasses: string[] };
export type SegmentRow = { id: string; email: string; name: string; company: string | null; companyId: string | null };

const INTERNAL = /@(rjlcapadvisors|rjlequities)\.com$/i;
const NO_PERSON = /^(noreply|no-reply|info|admin|office|contact|hello|support|marketing|invest|ir|deals|team|sales)@/i;
const VALID = /^[^s@]+@[^s@]+.[a-z]{2,}$/i;
const JUNK = /.(com|net|org).(com|net|org)$/i; // jon@x.com.com and the like
const anyOverlap = (have: string[], want: string[]) => !want.length || have.some((h) => want.includes(h) || /agnostic|all asset|any/i.test(h));

/** Who a blast goes to. One row per person with an email; nobody unsubscribed, departed, bounced or internal. */
export async function segmentContacts(seg: Segment): Promise<SegmentRow[]> {
  const roleFilter = seg.audience === "All" ? {} : { OR: [{ company: { roles: { contains: `"${seg.audience}"` } } }, { roles: { contains: `"${seg.audience}"` } }] };
  const contacts = await prisma.contact.findMany({
    where: { email: { not: null }, unsubscribed: false, departedAt: null, bounceReason: null, ...roleFilter },
    select: { id: true, firstName: true, lastName: true, email: true, companyId: true, company: { select: { name: true, roles: true, criteria: { select: { assetClasses: true } } } } },
    orderBy: [{ company: { name: "asc" } }, { lastName: "asc" }],
  });
  const seen = new Set<string>();
  const out: SegmentRow[] = [];
  for (const c of contacts) {
    const email = c.email!.toLowerCase();
    if (!VALID.test(email) || JUNK.test(email) || INTERNAL.test(email) || NO_PERSON.test(email) || seen.has(email)) continue;
    if (seg.assetClasses.length) {
      const roles = parseList(c.company?.roles);
      // asset classes live on the company criteria for investors and sponsors alike (sponsors get theirs from their website)
      const have = parseList(c.company?.criteria?.assetClasses);
      // no asset classes on file: keep investors (we may not know their mandate yet) but skip sponsors
      if (!have.length && (seg.audience === "Sponsor" || (seg.audience === "All" && !roles.includes("Investor")))) continue;
      if (have.length && !anyOverlap(have, seg.assetClasses)) continue;
    }
    seen.add(email);
    out.push({ id: c.id, email, name: [c.firstName, c.lastName].filter(Boolean).join(" ") || email, company: c.company?.name ?? null, companyId: c.companyId });
  }
  return out;
}

export const parseSegment = (s: string | null | undefined): Segment => {
  try {
    const j = JSON.parse(s ?? "{}") as Partial<Segment>;
    return { audience: j.audience === "Investor" || j.audience === "Sponsor" ? j.audience : "All", assetClasses: Array.isArray(j.assetClasses) ? j.assetClasses : [] };
  } catch {
    return { audience: "All", assetClasses: [] };
  }
};
export const parseDays = (s: string | null | undefined) => (s ?? "").split(/[,\s]+/).map((x) => Number(x)).filter((n) => n > 0);

/** A new blast: template snapshot, segment, schedule and cadence; recipients from the segment. */
export async function createBlast(input: { name: string; templateId: string; segment: Segment; scheduledAt: Date | null; followUpDays: number[]; fromName?: string | null; replyTo?: string | null }): Promise<string> {
  const template = await prisma.emailTemplate.findUniqueOrThrow({ where: { id: input.templateId } });
  const rows = await segmentContacts(input.segment);
  const campaign = await prisma.campaign.create({
    data: {
      name: input.name,
      mode: "BLAST",
      status: input.scheduledAt ? "SCHEDULED" : "DRAFT",
      templateId: template.id,
      subject: template.subject,
      bodyHtml: template.bodyHtml,
      roleFilter: input.segment.audience === "All" ? null : input.segment.audience,
      segment: JSON.stringify(input.segment),
      scheduledAt: input.scheduledAt,
      followUpDays: input.followUpDays.join(","),
      fromName: input.fromName ?? null,
      replyTo: input.replyTo ?? null,
    },
  });
  for (let i = 0; i < rows.length; i += 500) {
    await prisma.campaignRecipient.createMany({ data: rows.slice(i, i + 500).map((r) => ({ campaignId: campaign.id, contactId: r.id })), skipDuplicates: true });
  }
  return campaign.id;
}

const headersFor = (contactId: string) => ({ "List-Unsubscribe": `<${unsubscribeUrl(contactId)}>`, "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" });

/** Send every pending recipient of a blast, 100 at a time through Resend's batch endpoint. */
export async function sendBlast(id: string): Promise<{ sent: number; failed: number; skipped: number }> {
  if (!mailConfigured()) throw new Error("Email sending is not configured (RESEND_API_KEY / MAIL_FROM).");
  const campaign = await prisma.campaign.findUniqueOrThrow({ where: { id }, include: { deal: true } });
  await prisma.campaign.update({ where: { id }, data: { status: "SENDING" } });
  const days = parseDays(campaign.followUpDays);
  let sent = 0, failed = 0, skipped = 0;
  const ctx = { ...campaign, deal: campaign.deal as unknown as Record<string, unknown> | null };
  for (;;) {
    const batch = await prisma.campaignRecipient.findMany({ where: { campaignId: id, status: "PENDING" }, take: 100, include: { contact: { include: { company: true } } } });
    if (!batch.length) break;
    const ready: { r: (typeof batch)[number]; subject: string; html: string }[] = [];
    for (const r of batch) {
      if (!r.contact.email || r.contact.unsubscribed || r.contact.departedAt || r.contact.bounceReason) {
        await prisma.campaignRecipient.update({ where: { id: r.id }, data: { status: r.contact.unsubscribed ? "UNSUBSCRIBED" : "SKIPPED", error: r.contact.bounceReason ? "bounced before" : r.contact.departedAt ? "left the firm" : null } });
        skipped++;
        continue;
      }
      const { subject, html } = renderForRecipient(ctx, r);
      ready.push({ r, subject, html });
    }
    if (!ready.length) continue;
    try {
      const ids = await sendBatch(ready.map((x) => ({ to: x.r.contact.email!, subject: x.subject, html: x.html, replyTo: campaign.replyTo ?? undefined, headers: headersFor(x.r.contactId) })));
      const now = new Date();
      const next = days[0] ? new Date(now.getTime() + days[0] * 86_400_000) : null;
      for (const [i, x] of ready.entries()) {
        await prisma.campaignRecipient.update({ where: { id: x.r.id }, data: { status: "SENT", sentVia: "resend", providerId: ids[i] ?? null, sentAt: now, lastSentAt: now, nextFollowUpAt: next } });
        await logActivity({ type: "EMAIL", direction: "OUTBOUND", subject: x.subject, body: `Email blast: ${campaign.name}`, contactId: x.r.contactId, companyId: x.r.contact.companyId, occurredAt: now }).catch(() => null);
        sent++;
      }
    } catch (e) {
      for (const x of ready) await prisma.campaignRecipient.update({ where: { id: x.r.id }, data: { status: "FAILED", error: String(e instanceof Error ? e.message : e).slice(0, 500) } });
      failed += ready.length;
    }
    await new Promise((res) => setTimeout(res, 600));
  }
  const remaining = await prisma.campaignRecipient.count({ where: { campaignId: id, status: { in: ["PENDING", "FAILED"] } } });
  await prisma.campaign.update({ where: { id }, data: { status: remaining ? "PARTIAL" : "SENT", sentAt: new Date(), scheduledAt: null } });
  return { sent, failed, skipped };
}

/** Blasts whose time has come. */
export async function sendDueBlasts(): Promise<number> {
  const due = await prisma.campaign.findMany({ where: { status: "SCHEDULED", scheduledAt: { lte: new Date() } }, select: { id: true } });
  for (const c of due) await sendBlast(c.id).catch((e) => console.error("blast send failed", c.id, e));
  return due.length;
}

/** Nobody answered in N days: the same email again, as a reply on the same subject, until they answer or the steps run out. */
export async function runFollowUps(): Promise<{ followedUp: number; replied: number }> {
  if (!mailConfigured()) return { followedUp: 0, replied: 0 };
  const due = await prisma.campaignRecipient.findMany({ where: { nextFollowUpAt: { lte: new Date() }, repliedAt: null, status: { in: ["SENT", "OPENED", "CLICKED"] } }, include: { contact: { include: { company: true } }, campaign: { include: { deal: true } } }, take: 400 });
  let followedUp = 0, replied = 0;
  for (const r of due) {
    // did they answer since the last send? (their reply lands in the sender's inbox and is logged by the mail sync)
    const reply = await prisma.activity.findFirst({ where: { type: "EMAIL", direction: "INBOUND", contactId: r.contactId, occurredAt: { gt: r.lastSentAt ?? r.sentAt ?? new Date(0) } }, select: { id: true } });
    if (reply || r.contact.unsubscribed || r.contact.departedAt) {
      await prisma.campaignRecipient.update({ where: { id: r.id }, data: { status: reply ? "REPLIED" : r.contact.unsubscribed ? "UNSUBSCRIBED" : "SKIPPED", repliedAt: reply ? new Date() : null, nextFollowUpAt: null } });
      if (reply) replied++;
      continue;
    }
    const days = parseDays(r.campaign.followUpDays);
    const step = r.followUpsSent + 1;
    if (step > days.length || !r.contact.email) {
      await prisma.campaignRecipient.update({ where: { id: r.id }, data: { nextFollowUpAt: null } });
      continue;
    }
    const ctx = { ...r.campaign, deal: r.campaign.deal as unknown as Record<string, unknown> | null };
    const { subject, html } = renderForRecipient(ctx, r);
    const nudge = `<p style="margin:0 0 16px;font-family:Helvetica,Arial,sans-serif;font-size:15px;line-height:1.55;color:#1a2321">${step === 1 ? "Following up on my note below in case it got buried." : "Circling back once more on the note below."}</p>`;
    try {
      const res = await sendEmail({ to: r.contact.email, subject: `Re: ${subject}`, html: nudge + html, replyTo: r.campaign.replyTo ?? undefined, headers: headersFor(r.contactId) });
      const now = new Date();
      const nextDays = days[step]; // the gap to the following step, if any
      await prisma.campaignRecipient.update({ where: { id: r.id }, data: { followUpsSent: step, lastSentAt: now, providerId: res.id, nextFollowUpAt: nextDays ? new Date(now.getTime() + nextDays * 86_400_000) : null } });
      await logActivity({ type: "EMAIL", direction: "OUTBOUND", subject: `Re: ${subject}`, body: `Email blast follow-up ${step}: ${r.campaign.name}`, contactId: r.contactId, companyId: r.contact.companyId, occurredAt: now }).catch(() => null);
      followedUp++;
    } catch (e) {
      await prisma.campaignRecipient.update({ where: { id: r.id }, data: { error: String(e instanceof Error ? e.message : e).slice(0, 300), nextFollowUpAt: null } });
    }
    await new Promise((res) => setTimeout(res, 400));
  }
  return { followedUp, replied };
}

/** One email to yourself with the blast exactly as the first recipient would get it. */
export async function sendTestBlast(id: string, toEmail: string): Promise<void> {
  const campaign = await prisma.campaign.findUniqueOrThrow({ where: { id }, include: { deal: true, recipients: { take: 1, include: { contact: { include: { company: true } } } } } });
  const r = campaign.recipients[0];
  const fake = { contactId: r?.contactId ?? "test", openingLine: null, bodyOverride: null, contact: r?.contact ?? { firstName: "Test", lastName: "Recipient", email: toEmail, company: null } };
  const { subject, html } = renderForRecipient({ ...campaign, deal: campaign.deal as unknown as Record<string, unknown> | null }, fake);
  await sendEmail({ to: toEmail, subject: `[TEST] ${subject}`, html, replyTo: campaign.replyTo ?? undefined });
}

export async function blastStats(id: string) {
  const rows = await prisma.campaignRecipient.groupBy({ by: ["status"], where: { campaignId: id }, _count: true });
  const n = (s: string) => rows.find((r) => r.status === s)?._count ?? 0;
  const followUps = await prisma.campaignRecipient.aggregate({ where: { campaignId: id }, _sum: { followUpsSent: true } });
  return { total: rows.reduce((a, r) => a + r._count, 0), pending: n("PENDING"), sent: n("SENT") + n("OPENED") + n("CLICKED") + n("REPLIED"), opened: n("OPENED") + n("CLICKED"), replied: n("REPLIED"), unsubscribed: n("UNSUBSCRIBED"), bounced: n("BOUNCED"), failed: n("FAILED"), skipped: n("SKIPPED"), followUps: followUps._sum.followUpsSent ?? 0 };
}

let lastKick = 0;
/** From page loads: anything due goes out; anyone quiet gets their follow-up. Cheap when nothing is due. */
export function kickBlasts(minMinutes = 5) {
  if (!mailConfigured() || Date.now() - lastKick < minMinutes * 60_000) return;
  lastKick = Date.now();
  const run = async () => {
    await sendDueBlasts().catch(() => 0);
    await runFollowUps().catch(() => null);
  };
  void run();
}

export async function scheduleBlast(id: string, at: Date) {
  await prisma.campaign.update({ where: { id }, data: { scheduledAt: at, status: "SCHEDULED" } });
}
export async function cancelScheduleFor(id: string) {
  await prisma.campaign.update({ where: { id }, data: { scheduledAt: null, status: "DRAFT" } });
}
