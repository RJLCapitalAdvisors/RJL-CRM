import { prisma } from "@/lib/db";
import { graph, sentMessagesTo, sentMessagesToDomain, type GraphMessage } from "@/lib/graph";
import { houseSubjectMatches, subjectMatchesDeal, words } from "@/lib/deal-match";

/**
 * The conversation with the sponsor to build on when we have something to ask them about a deal. Rules from
 * Jonathan: reply on the ongoing thread with the sponsor team alone (Kyle and us, nobody else), never an intro,
 * never a thread with a third party, never another deal's thread. The subject line is not the test: a thread
 * called "Citivest Retail Opportunities LP Progress" that talks about Everett is the Everett thread. Only when
 * no such conversation exists does a fresh email make sense.
 */
type Party = { emailAddress: { address: string; name?: string } };
type Msg = GraphMessage & { conversationId?: string; receivedDateTime?: string; isDraft?: boolean; from?: Party; toRecipients?: Party[]; ccRecipients?: Party[]; body?: { content: string } };
type DealLike = { id: string; name: string; propertyName: string | null; city: string | null; state: string | null; sponsorCompanyId: string | null; requestedAmount?: number | null };

const q = (s: string) => encodeURIComponent(s);
const strip = (html: string) => html.replace(/<style[\s\S]*?<\/style>/gi, " ").replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/\s+/g, " ").toLowerCase();
const mentions = (text: string, name: string) => {
  const ws = words(name);
  if (!ws.length) return false;
  const hit = ws.filter((w) => text.includes(w)).length;
  return hit >= Math.ceil(ws.length * 0.6);
};

export type SponsorThread = { messageId: string; conversationId: string | null; subject: string | null; aboutDeal: boolean };

export async function sponsorThreadFor(mailbox: string, deal: DealLike, sponsor: { emails: string[]; domain: string | null }): Promise<SponsorThread | null> {
  const my = mailbox.split("@")[1]?.toLowerCase();
  const sponsorDomain = sponsor.domain?.toLowerCase() ?? null;
  const sponsorEmails = new Set(sponsor.emails.map((e) => e.toLowerCase()));
  const parties = (m: Msg) => [m.from?.emailAddress.address, ...(m.toRecipients ?? []).map((r) => r.emailAddress.address), ...(m.ccRecipients ?? []).map((r) => r.emailAddress.address)].filter((a): a is string => Boolean(a)).map((a) => a.toLowerCase());
  const sponsorOnly = (m: Msg) => parties(m).every((a) => a.endsWith(`@${my}`) || (sponsorDomain && a.endsWith(`@${sponsorDomain}`)) || sponsorEmails.has(a));
  const notIntro = (m: Msg) => !/^\s*((re|fw|fwd)\s*:\s*)*intro\b/i.test(m.subject ?? "");

  const [toPerson, toFirm] = await Promise.all([sponsor.emails[0] ? sentMessagesTo(mailbox, sponsor.emails[0], 15).catch(() => [] as Msg[]) : [], sponsorDomain ? sentMessagesToDomain(mailbox, sponsorDomain, 25).catch(() => [] as Msg[]) : []]);
  const pool = ([...toPerson, ...toFirm] as Msg[]).filter((x, i, arr) => arr.findIndex((y) => y.id === x.id) === i).filter((m) => sponsorOnly(m) && notIntro(m)).sort((a, b) => (b.sentDateTime ?? "").localeCompare(a.sentDateTime ?? ""));
  const convs = [...new Map(pool.map((m) => [m.conversationId ?? m.id, m])).values()].slice(0, 8);
  if (!convs.length) return null;

  const others = (await prisma.deal.findMany({ where: { id: { not: deal.id }, sponsorCompanyId: deal.sponsorCompanyId ?? "none", stage: { notIn: ["Deal Lost", "Deal Closed"] } }, select: { name: true, propertyName: true } })).map((d) => d.propertyName ?? d.name);
  const dealName = deal.propertyName ?? deal.name;

  let general: SponsorThread | null = null;
  for (const seed of convs) {
    // the whole conversation as it stands in my mailbox, newest first; a third party joining later disqualifies it
    let msgs: Msg[] = [seed];
    if (seed.conversationId) {
      const r = await graph<{ value: Msg[] }>(`/users/${q(mailbox)}/messages?$filter=conversationId eq '${seed.conversationId.replace(/'/g, "''")}'&$top=12&$select=id,subject,conversationId,sentDateTime,receivedDateTime,isDraft,from,toRecipients,ccRecipients,body`).catch(() => ({ value: [seed] }));
      // an unsent draft of ours sitting on the thread (an earlier Handle click) cannot be replied to: leave drafts out
      const real = r.value.filter((m) => !m.isDraft);
      msgs = real.length ? real : [seed];
    }
    msgs.sort((a, b) => (b.receivedDateTime ?? b.sentDateTime ?? "").localeCompare(a.receivedDateTime ?? a.sentDateTime ?? ""));
    const latest = msgs[0];
    if (!msgs.every(sponsorOnly)) continue;
    const text = msgs.slice(0, 6).map((m) => `${m.subject ?? ""} ${strip(m.body?.content ?? "")}`).join(" ");
    const aboutThis = subjectMatchesDeal(latest.subject ?? "", deal) || houseSubjectMatches(latest.subject ?? "", deal) || mentions(text, dealName) || (deal.city ? text.includes(deal.city.toLowerCase()) && text.includes("deal") : false);
    if (aboutThis) return { messageId: latest.id, conversationId: seed.conversationId ?? null, subject: latest.subject ?? null, aboutDeal: true };
    const aboutAnother = others.some((n) => mentions(text, n));
    if (!aboutAnother && !general) general = { messageId: latest.id, conversationId: seed.conversationId ?? null, subject: latest.subject ?? null, aboutDeal: false };
  }
  // no thread names this deal, but there is an ongoing conversation with the sponsor that is not about another deal: build on it
  return general;
}
