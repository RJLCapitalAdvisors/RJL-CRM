import { prisma } from "@/lib/db";
import { ilMerge } from "@/lib/il-merge";
import { mailConfigured, sendBatch, sendEmail } from "@/lib/mailer";
import { signContactToken } from "@/lib/tokens";

/**
 * RJL Israel email blasts: the same idea as RJL Capital Advisors' blasts, on the Israel contacts. Pick who (roles,
 * a city they want), write the email (or start from an RJL Israel blast template), send through Resend with a
 * one-click unsubscribe, each send logged on the contact. No follow-up rounds yet; the Send apartment/house/
 * project flow covers the one-unit emails.
 */
export type IlSegment = { roles: string[]; city: string | null };
export type IlSegmentRow = { id: string; email: string; name: string; company: string | null; companyId: string | null };

const INTERNAL = /@(rjlcapadvisors|rjlequities|rjlisrael|liviemisrael)\.com$/i;
const NO_PERSON = /^(noreply|no-reply|info|admin|office|contact|hello|support|marketing|deals|team|sales)@/i;
const VALID = /^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i;

export const parseIlSegment = (s: string | null | undefined): IlSegment => {
  try {
    const j = JSON.parse(s ?? "{}") as Partial<IlSegment>;
    return { roles: Array.isArray(j.roles) ? j.roles.filter((x): x is string => typeof x === "string") : [], city: typeof j.city === "string" && j.city.trim() ? j.city.trim() : null };
  } catch {
    return { roles: [], city: null };
  }
};

/** Who a blast goes to: contacts with an email in one of the roles (or everyone), wanting the city when one is given; nobody unsubscribed or internal. */
export async function ilSegmentContacts(seg: IlSegment): Promise<IlSegmentRow[]> {
  const contacts = await prisma.ilContact.findMany({
    where: { email: { not: null }, unsubscribed: false, ...(seg.roles.length ? { OR: seg.roles.map((r) => ({ roles: { contains: `"${r}"` } })) } : {}), ...(seg.city ? { wantsCities: { contains: seg.city, mode: "insensitive" } } : {}) },
    select: { id: true, firstName: true, lastName: true, email: true, companyId: true, company: { select: { name: true } } },
    orderBy: [{ lastName: "asc" }, { firstName: "asc" }],
  });
  const seen = new Set<string>();
  const out: IlSegmentRow[] = [];
  for (const c of contacts) {
    const email = c.email!.toLowerCase();
    if (!VALID.test(email) || INTERNAL.test(email) || NO_PERSON.test(email) || seen.has(email)) continue;
    seen.add(email);
    out.push({ id: c.id, email, name: [c.firstName, c.lastName].filter(Boolean).join(" ") || email, company: c.company?.name ?? null, companyId: c.companyId });
  }
  return out;
}

/** The unsubscribe link for an Israel contact: the same signed token as RJL CA's, with an il: prefix the route understands. */
export const ilUnsubscribeUrl = (contactId: string) => `${(process.env.APP_URL ?? "http://localhost:3000").replace(/\/$/, "")}/unsubscribe/${signContactToken(`il:${contactId}`)}`;

/** A starter email when there is no RJL Israel blast template yet. */
export const IL_STARTER = {
  subject: "New listings that may fit what you are looking for",
  bodyHtml: `<div style="font-family:Helvetica,Arial,sans-serif;font-size:15px;line-height:1.55;color:#1a2321;max-width:600px;margin:0 auto;padding:24px">
<p>Hi {{contact.firstName|there}},</p>
<p>A few new apartments and houses came across our desk this week that may fit what you are looking for. Reply to this email and I will send the details and floorplans.</p>
<p>Best,<br>RJL Israel</p>
</div>`,
};

const footer = (url: string) => `<p style="margin:24px 0 0;font-family:Helvetica,Arial,sans-serif;font-size:12px;color:#6b716e;text-align:center">RJL Israel · <a href="${url}" style="color:#6b716e">Unsubscribe</a></p>`;

export async function createIlBlast(input: { name: string; subject: string; bodyHtml: string; segment: IlSegment; templateId?: string | null; replyTo?: string | null }): Promise<string> {
  const rows = await ilSegmentContacts(input.segment);
  const c = await prisma.ilCampaign.create({ data: { name: input.name, status: "DRAFT", subject: input.subject, bodyHtml: input.bodyHtml, segment: JSON.stringify(input.segment), templateId: input.templateId ?? null, replyTo: input.replyTo ?? null } });
  for (let i = 0; i < rows.length; i += 500) await prisma.ilCampaignRecipient.createMany({ data: rows.slice(i, i + 500).map((r) => ({ campaignId: c.id, contactId: r.id })), skipDuplicates: true });
  return c.id;
}

/** Send every pending recipient, 100 at a time through Resend. From the RJL Israel sender when one is set (IL_MAIL_FROM), else the company sender. */
export async function sendIlBlast(id: string): Promise<{ sent: number; failed: number; skipped: number }> {
  if (!mailConfigured()) throw new Error("Email sending is not configured (RESEND_API_KEY / MAIL_FROM).");
  const campaign = await prisma.ilCampaign.findUniqueOrThrow({ where: { id } });
  await prisma.ilCampaign.update({ where: { id }, data: { status: "SENDING" } });
  const from = process.env.IL_MAIL_FROM || undefined;
  let sent = 0, failed = 0, skipped = 0;
  for (;;) {
    const batch = await prisma.ilCampaignRecipient.findMany({ where: { campaignId: id, status: "PENDING" }, take: 100, include: { contact: { include: { company: { select: { name: true } } } } } });
    if (!batch.length) break;
    const ready: { r: (typeof batch)[number]; subject: string; html: string }[] = [];
    for (const r of batch) {
      if (!r.contact.email || r.contact.unsubscribed) {
        await prisma.ilCampaignRecipient.update({ where: { id: r.id }, data: { status: r.contact.unsubscribed ? "UNSUBSCRIBED" : "SKIPPED", error: r.contact.email ? null : "no email" } });
        skipped++;
        continue;
      }
      const person = { firstName: r.contact.firstName, lastName: r.contact.lastName, company: r.contact.company?.name ?? null };
      const url = ilUnsubscribeUrl(r.contactId);
      ready.push({ r, subject: ilMerge(campaign.subject, person), html: ilMerge(campaign.bodyHtml, person) + footer(url) });
    }
    if (!ready.length) continue;
    try {
      const ids = await sendBatch(ready.map((x) => ({ to: x.r.contact.email!, subject: x.subject, html: x.html, from, replyTo: campaign.replyTo ?? undefined, headers: { "List-Unsubscribe": `<${ilUnsubscribeUrl(x.r.contactId)}>`, "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" } })));
      const now = new Date();
      for (const [i, x] of ready.entries()) {
        await prisma.ilCampaignRecipient.update({ where: { id: x.r.id }, data: { status: "SENT", providerId: ids[i] ?? null, sentAt: now } });
        await prisma.ilActivity.create({ data: { type: "EMAIL", direction: "OUTBOUND", subject: x.subject, body: `Email blast: ${campaign.name}`, occurredAt: now, contactId: x.r.contactId, companyId: x.r.contact.companyId, meta: JSON.stringify({ blast: campaign.id, to: [{ address: x.r.contact.email }] }) } }).catch(() => null);
        await prisma.ilContact.update({ where: { id: x.r.contactId }, data: { lastActivityAt: now } }).catch(() => null);
        sent++;
      }
    } catch (e) {
      for (const x of ready) await prisma.ilCampaignRecipient.update({ where: { id: x.r.id }, data: { status: "FAILED", error: String(e instanceof Error ? e.message : e).slice(0, 500) } });
      failed += ready.length;
    }
    await new Promise((res) => setTimeout(res, 600));
  }
  const remaining = await prisma.ilCampaignRecipient.count({ where: { campaignId: id, status: { in: ["PENDING", "FAILED"] } } });
  await prisma.ilCampaign.update({ where: { id }, data: { status: remaining ? "PARTIAL" : "SENT", sentAt: new Date() } });
  return { sent, failed, skipped };
}

/** One email to yourself with the blast as the first recipient would get it. */
export async function sendIlTest(id: string, toEmail: string): Promise<void> {
  const campaign = await prisma.ilCampaign.findUniqueOrThrow({ where: { id }, include: { recipients: { take: 1, include: { contact: { include: { company: { select: { name: true } } } } } } } });
  const c = campaign.recipients[0]?.contact;
  const person = { firstName: c?.firstName ?? "Test", lastName: c?.lastName ?? "Recipient", company: c?.company?.name ?? null };
  await sendEmail({ to: toEmail, subject: `[TEST] ${ilMerge(campaign.subject, person)}`, html: ilMerge(campaign.bodyHtml, person) + footer("#"), from: process.env.IL_MAIL_FROM || undefined, replyTo: campaign.replyTo ?? undefined });
}

export async function ilBlastStats(id: string) {
  const rows = await prisma.ilCampaignRecipient.groupBy({ by: ["status"], where: { campaignId: id }, _count: true });
  const n = (s: string) => rows.find((r) => r.status === s)?._count ?? 0;
  return { total: rows.reduce((a, r) => a + r._count, 0), pending: n("PENDING"), sent: n("SENT"), failed: n("FAILED"), skipped: n("SKIPPED"), unsubscribed: n("UNSUBSCRIBED") };
}
