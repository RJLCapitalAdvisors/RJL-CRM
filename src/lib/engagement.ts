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
const P = (s: string) => `<p style="margin:0 0 10pt 0;${FONT}">${s}</p>`;
const LI = (s: string) => `<li style="margin:0 0 6pt 0;${FONT}">${s}</li>`;

export function engagementSubject(sponsor: string, address: string) {
  return `Engagement Letter - RJL Capital Advisors & ${sponsor} - ${address}`;
}

export function engagementHtml(opts: { firstName: string | null; sponsor: string; address: string; groups: string[]; signature: string }) {
  const { firstName, sponsor, address, groups, signature } = opts;
  const groupList = groups.length ? `<ul style="margin:6pt 0 0 18pt;">${groups.map((g) => LI(g)).join("")}</ul>` : `<ul style="margin:6pt 0 0 18pt;">${LI("")}</ul>`;
  return `<div style="${FONT}">
${P(`Hi${firstName ? ` ${firstName}` : ""} - hope you are well. Please find the below terms of our engagement. If you agree with the terms, please confirm our engagement via email by replying "confirmed."`)}
<ul style="margin:0 0 10pt 18pt;">
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
  return prisma.contact.findFirst({ where: { companyId, email: { not: null }, unsubscribed: false }, orderBy: [{ marketingContact: "desc" }, { lastActivityAt: "desc" }] });
}

/** Who at the sponsor gets the letter: the person who sent us the deal, else our most-emailed contact there. */
async function sponsorRecipient(dealId: string, sponsorCompanyId: string | null) {
  const sent = await prisma.activity.findFirst({ where: { dealId, type: "EMAIL", direction: "INBOUND", contactId: { not: null } }, orderBy: { occurredAt: "asc" }, include: { contact: true } });
  if (sent?.contact?.email) return sent.contact;
  return sponsorCompanyId ? bestContactForCompany(sponsorCompanyId) : null;
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
  await prisma.deal.update({ where: { id: dealId }, data: { details: JSON.stringify({ ...details, engagementGroups: groups.map((g) => g.name), engagementDraftedAt: new Date().toISOString() }) } });

  return { ok: true, webLink: fresh.webLink ?? "", outlookLink: await outlookDesktopLink(mailbox, draft.id), messageId: fresh.internetMessageId ?? null, mode: "new", attachments: 0, added };
}
