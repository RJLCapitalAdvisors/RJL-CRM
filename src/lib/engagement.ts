import { prisma } from "@/lib/db";
import { createDraft, getMessage, graphConfigured, outlookDesktopLink } from "@/lib/graph";
import { signatureFor, type FollowUpResult } from "@/lib/followup";

/**
 * Engagement letter to a sponsor: a fresh email (not a reply) listing the equity groups RJL wants the
 * exclusive right to approach. Generated from the investor search in "engagement" mode: Jonathan ticks
 * the groups, clicks Done, and the draft opens in his Outlook to review and send.
 * The ticked groups also go onto the deal's progress report as "Deal Not Sent".
 */

const FONT = "font-family:Calibri,Arial,sans-serif;font-size:11pt;";
const P = (s: string) => `<p style="margin:0;${FONT}">${s}</p>`;
const LI = (s: string) => `<li style="margin:0;${FONT}">${s}</li>`;

export function engagementSubject(sponsor: string, address: string) {
  return `Engagement Letter - RJL Capital Advisors & ${sponsor} - ${address}`;
}

export function engagementHtml(opts: { firstName: string | null; sponsor: string; address: string; groups: string[]; signature: string }) {
  const { firstName, sponsor, address, groups, signature } = opts;
  const groupList = groups.length ? `<ul style="margin:0 0 0 18pt;">${groups.map((g) => LI(g)).join("")}</ul>` : `<ul style="margin:0 0 0 18pt;">${LI("")}</ul>`;
  return `<div style="${FONT}">
${P(`Hi${firstName ? ` ${firstName}` : ""} - hope you are well. Please find the below terms of our engagement. If you agree with the terms, please confirm our engagement via email by replying "confirmed."`)}
<ul style="margin:0 0 0 18pt;">
${LI(`<b>Address:</b> ${address}`)}
${LI(`<b>Sponsor:</b> ${sponsor}`)}
${LI(`<b>Fees:</b> 2% for first deal. Tail to be negotiated.`)}
${LI(`<b>Carveouts:</b> RJL Capital Advisors shall have the exclusive right to approach the following equity groups. The Sponsor reserves the right to amend this list at their sole discretion. The above fee applies to the below groups and/or any other group that RJL Capital Advisors may introduce to the sponsor:${groupList}`)}
${LI(`<b>Time Period Of Carveout:</b> The carveout shall remain in effect for thirty (30) days from the date of your confirmation of this engagement. During this period, RJL Capital Advisors shall have exclusive representation and outreach rights to the aforementioned groups.`)}
${LI(`<b>Non-disclosure of list:</b> The Sponsor agrees that the above-listed equity groups shall not be disclosed to any third party outside the Sponsor’s organization, including developers, service providers, or any other external entities. Furthermore, the Sponsor agrees not to utilize the provided list to independently build relationships with the named groups.`)}
${LI(`<b>Non-circumvention:</b> During the carveout period, the Sponsor agrees not to engage in communications with any of the equity groups listed above without prior written consent from RJL Capital Advisors. In the event that RJL Capital Advisors facilitates an introduction to any equity group for this transaction but the transaction does not close, the Sponsor shall not re-engage with said equity group without RJL Capital Advisors' explicit permission.`)}
${LI(`<b>Indemnity:</b> RJL Capital Advisors acts solely as an introducer and is not a party to any investment transactions. We make no representations or warranties regarding any investment and assume no liability for any losses or disputes arising from such transactions. Investors and sponsors agree to indemnify and hold RJL Capital Advisors harmless from any claims, damages, or liabilities related to their dealings.`)}
</ul>
${P(`We look forward to working together and achieving successful outcomes for both parties. Should you have any questions or require further clarification, please do not hesitate to reach out.`)}
${signature}
</div>`;
}

/** The person at a firm we actually correspond with: most emails in the log, then marketing contact, then anyone with an email. */
export async function bestContactForCompany(companyId: string) {
  const counts = await prisma.activity.groupBy({ by: ["contactId"], where: { companyId, type: "EMAIL", contactId: { not: null } }, _count: true, orderBy: { _count: { contactId: "desc" } }, take: 1 });
  if (counts[0]?.contactId) {
    const c = await prisma.contact.findUnique({ where: { id: counts[0].contactId } });
    if (c?.email) return c;
  }
  return prisma.contact.findFirst({ where: { companyId, email: { not: null }, unsubscribed: false, departedAt: null }, orderBy: [{ marketingContact: "desc" }, { lastActivityAt: "desc" }] });
}

/** Who at the sponsor gets the letter: the person who sent us the deal, else our most-emailed contact there. */
async function sponsorRecipient(dealId: string, sponsorCompanyId: string | null) {
  const sent = await prisma.activity.findFirst({ where: { dealId, type: "EMAIL", direction: "INBOUND", contactId: { not: null } }, orderBy: { occurredAt: "asc" }, include: { contact: true } });
  if (sent?.contact?.email) return sent.contact;
  const fromCompany = sponsorCompanyId ? await bestContactForCompany(sponsorCompanyId) : null;
  if (fromCompany) return fromCompany;
  const [first] = await sponsorContactsFor(dealId);
  return first ? prisma.contact.findUnique({ where: { id: first.id } }) : null;
}

export async function createEngagementDraft(dealId: string, companyIds: string[], mailbox: string): Promise<FollowUpResult & { added?: number }> {
  if (!graphConfigured()) return { ok: false, reason: "Microsoft 365 is not connected" };
  const deal = await prisma.deal.findUnique({ where: { id: dealId }, include: { sponsorCompany: true } });
  if (!deal) return { ok: false, reason: "deal not found" };
  const groups = await prisma.company.findMany({ where: { id: { in: companyIds } }, select: { id: true, name: true } });
  const to = await sponsorRecipient(deal.id, deal.sponsorCompanyId);
  const sponsor = deal.sponsorName ?? deal.sponsorCompany?.name ?? "Sponsor";
  const address = [deal.propertyAddress, [deal.city, deal.state].filter(Boolean).join(", ")].filter(Boolean).join(", ") || (deal.propertyName ?? deal.name);

  const html = engagementHtml({ firstName: to?.firstName ?? null, sponsor, address, groups: groups.map((g) => g.name).sort(), signature: await signatureFor(mailbox) });
  const draft = await createDraft(mailbox, { subject: engagementSubject(sponsor, address), toRecipients: to?.email ? [to.email] : [], bodyHtml: `<html><body>${html}</body></html>` });
  const fresh = await getMessage(mailbox, draft.id, "id,webLink,internetMessageId");

  // the ticked groups start the progress report as "Deal Not Sent"
  let added = 0;
  for (const g of groups) {
    const contact = await bestContactForCompany(g.id);
    if (!contact) continue;
    const exists = await prisma.dealInvestor.findFirst({ where: { dealId, contactId: contact.id } });
    if (!exists) {
      await prisma.dealInvestor.create({ data: { dealId, contactId: contact.id, status: 1 } });
      added++;
    }
  }
  const details = (() => {
    try {
      return JSON.parse(deal.details || "{}") as Record<string, unknown>;
    } catch {
      return {};
    }
  })();
  await prisma.deal.update({ where: { id: dealId }, data: { details: JSON.stringify({ ...details, engagementGroups: groups.map((g) => g.name), engagementDraftedAt: new Date().toISOString(), engagementDraftId: draft.id, engagementMailbox: mailbox }) } });

  return { ok: true, webLink: fresh.webLink ?? "", outlookLink: await outlookDesktopLink(mailbox, draft.id), messageId: fresh.internetMessageId ?? null, mode: "new", attachments: 0, added };
}

const STAGE_ORDER = ["Deal Mentioned", "Deal Received", "Deal Underwritten", "Engagement Letter Sent", "Engagement Letter Signed", "Deal Taken To Market", "Intro To Capital Made", "Term Sheet Issued", "Term Sheet Signed", "Deal Closed"];

/** Deals with an engagement letter drafted: once Outlook shows it sent, move the deal to "Engagement Letter Sent" (never backwards). */
export async function syncEngagementDrafts(): Promise<number> {
  if (!graphConfigured()) return 0;
  const deals = await prisma.deal.findMany({ where: { details: { contains: "engagementDraftId" }, stage: { notIn: ["Deal Closed", "Deal Lost"] } }, select: { id: true, stage: true, details: true, propertyName: true, name: true, sponsorCompanyId: true } });
  let moved = 0;
  for (const d of deals) {
    let det: Record<string, unknown>;
    try {
      det = JSON.parse(d.details || "{}");
    } catch {
      continue;
    }
    const draftId = det.engagementDraftId as string | undefined;
    const mailbox = det.engagementMailbox as string | undefined;
    if (!draftId || !mailbox || det.engagementSentAt) continue;
    try {
      const m = await getMessage(mailbox, draftId, "id,isDraft,sentDateTime");
      if (m.isDraft) continue;
      const sentAt = m.sentDateTime ? new Date(m.sentDateTime) : new Date();
      const advance = STAGE_ORDER.indexOf(d.stage) < STAGE_ORDER.indexOf("Engagement Letter Sent");
      await prisma.deal.update({ where: { id: d.id }, data: { details: JSON.stringify({ ...det, engagementSentAt: sentAt.toISOString() }), ...(advance ? { stage: "Engagement Letter Sent" } : {}) } });
      const { logActivity } = await import("@/lib/activity");
      await logActivity({ type: "NOTE", body: `Engagement letter sent${advance ? "; moved to Engagement Letter Sent" : ""}`, dealId: d.id, companyId: d.sponsorCompanyId, occurredAt: sentAt });
      moved++;
    } catch (err) {
      if (String(err).includes("404")) await prisma.deal.update({ where: { id: d.id }, data: { details: JSON.stringify({ ...det, engagementDraftId: undefined, engagementMailbox: undefined }) } }); // draft deleted; forget it
    }
  }
  return moved;
}

/**
 * The sponsor-side people for a deal, in order of confidence: contacts at the sponsor company we usually
 * email (or all of them), else external people on the deal's own email threads who are not LPs on the
 * report, else the person who sent the deal in. Never empty when any email about the deal exists.
 */
export async function sponsorContactsFor(dealId: string): Promise<{ id: string; email: string; firstName: string | null }[]> {
  const deal = await prisma.deal.findUnique({ where: { id: dealId }, include: { sponsorCompany: { include: { contacts: { where: { email: { not: null }, departedAt: null } } } } } });
  if (!deal) return [];
  const pick = (cs: { id: string; email: string | null; firstName: string | null }[]) => cs.filter((c) => c.email).map((c) => ({ id: c.id, email: c.email!, firstName: c.firstName }));
  if (deal.sponsorCompany?.contacts.length) {
    const { usualRecipients } = await import("@/lib/send-deal");
    const ids = await usualRecipients(deal.sponsorCompany.id, deal.sponsorCompany.contacts);
    const usual = deal.sponsorCompany.contacts.filter((c) => ids.includes(c.id));
    return pick(usual.length ? usual : deal.sponsorCompany.contacts);
  }
  // people on the deal's email threads who are not investors on the report
  const lpCompanyIds = new Set((await prisma.dealInvestor.findMany({ where: { dealId }, select: { contact: { select: { companyId: true } } } })).map((r) => r.contact.companyId).filter(Boolean));
  const acts = await prisma.activity.findMany({ where: { dealId, type: "EMAIL", contactId: { not: null } }, include: { contact: true }, orderBy: { occurredAt: "desc" }, take: 50 });
  const seen = new Map<string, { id: string; email: string; firstName: string | null }>();
  for (const a of acts) {
    const c = a.contact!;
    if (!c.email || (c.companyId && lpCompanyIds.has(c.companyId)) || /@(rjlcapadvisors|rjlequities)\.com$/i.test(c.email)) continue;
    if (!seen.has(c.id)) seen.set(c.id, { id: c.id, email: c.email, firstName: c.firstName });
  }
  if (seen.size) {
    // remember the link so the next lookup is instant
    const first = acts.find((a) => a.contact?.id === [...seen.keys()][0])?.contact;
    if (first?.companyId && !deal.sponsorCompanyId) await prisma.deal.update({ where: { id: dealId }, data: { sponsorCompanyId: first.companyId } }).catch(() => {});
    return [...seen.values()];
  }
  const intake = await prisma.dealIntake.findFirst({ where: { dealId }, select: { fromEmail: true } });
  if (intake?.fromEmail) {
    const c = await prisma.contact.findUnique({ where: { email: intake.fromEmail.toLowerCase() } });
    if (c?.email) return pick([c]);
  }
  return [];
}
