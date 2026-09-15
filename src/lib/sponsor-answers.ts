import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { graphConfigured } from "@/lib/graph";
import { findMessageCopy, lpOwnWords } from "@/lib/lp-message";
import { ACTIVE_STAGES } from "@/lib/taxonomy";
import { stripDashes } from "@/lib/style";

/**
 * The other half of the LP and sponsor back-and-forth. An LP asks for something (an LP_ASK item; Handle forwards
 * the asks to the sponsor). When the sponsor writes back with the answer, a SPONSOR_ANSWER item goes to the top of
 * Deal momentum for that LP: Handle replies on the LP's own thread with the sponsor's answers written on top, the
 * sponsor's words quoted, and the sponsor's files attached. The answered asks move off the LP's open list, so
 * Items Needed from Sponsor on the report drops them too.
 * Every sponsor email is read once (SponsorAnswerScan). Scheduling notes and "we will get back to you" answer
 * nothing and create nothing.
 */

const DAY = 86_400_000;
const LOOKBACK_DAYS = 90;

const Out = z.object({
  answers: z.array(
    z.object({
      lpFirm: z.string().describe("The investor firm whose question this answers, exactly as listed"),
      ask: z.string().describe("The question answered, exactly as listed"),
      answer: z.string().describe("The sponsor's answer in two or three plain sentences, from the sponsor's own words and numbers. Say 'see the attached ...' when the answer is a file. Never name any other investor. No dashes as punctuation."),
    }),
  ),
});

const SYSTEM = `You read an email from a deal sponsor to RJL Capital Advisors, a real estate capital advisor. RJL had passed the sponsor questions from investors (LPs). Decide which of the listed open questions this email actually answers: the sponsor gives the information, a number, an explanation, or attaches the document asked for. Scheduling, thanks, "we will get back to you", and questions the email does not address answer nothing. When the email answers a question for one firm in a way that also answers the same question listed under another firm, list both. Return only real answers.`;

type Pair = { ask: string; answer: string };
/** "Confirm the call time", "which timezone": logistics, not something the LP is waiting on the sponsor for. */
const SCHEDULING = /\b(call time|time works|timezone|time zone|calendar invite|send an invite|schedule (a |the )?call|confirm (the )?(call|meeting)|availability|reschedule)\b/i;
const key = (x: string) => x.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

/** "Sponsor answered X: Q -> A; Q -> A" */
export function parseAnswers(summary: string | null): Pair[] {
  if (!summary) return [];
  const body = summary.replace(/^.*?answered [^:]*:\s*/, "");
  return body.split(" ;; ").map((p) => p.split(" -> ")).filter((x) => x.length >= 2).map(([ask, ...rest]) => ({ ask: ask.trim(), answer: rest.join(" -> ").trim() })).filter((p) => p.ask && p.answer);
}
export const answersSummary = (lpFirm: string, pairs: Pair[]) => `Sponsor answered ${lpFirm}: ${pairs.map((p) => `${p.ask} -> ${p.answer}`).join(" ;; ")}`;

export async function detectSponsorAnswers(): Promise<{ emails: number; items: number }> {
  if (!graphConfigured() || !process.env.ANTHROPIC_API_KEY) return { emails: 0, items: 0 };
  const since = new Date(Date.now() - LOOKBACK_DAYS * DAY);
  const { parseAsks } = await import("@/lib/momentum");
  // deals with LP asks on them (open, handled or dismissed: the sponsor still owes the answer)
  const asks = await prisma.momentum.findMany({ where: { kind: "LP_ASK", updatedAt: { gte: since } }, select: { id: true, dealId: true, party: true, summary: true, contactId: true, waitingSince: true, lastMessageId: true } });
  const byDeal = new Map<string, typeof asks>();
  for (const a of asks) {
    if (!parseAsks(a.summary).asks.length) continue;
    const list = byDeal.get(a.dealId) ?? [];
    list.push(a);
    byDeal.set(a.dealId, list);
  }
  if (!byDeal.size) return { emails: 0, items: 0 };
  const client = new Anthropic();
  let emails = 0, items = 0;
  for (const [dealId, dealAsks] of byDeal) {
    const deal = await prisma.deal.findUnique({ where: { id: dealId }, select: { id: true, name: true, propertyName: true, stage: true, sponsorCompanyId: true, sponsorName: true } });
    if (!deal || !(ACTIVE_STAGES as readonly string[]).includes(deal.stage)) continue;
    const earliest = new Date(Math.min(...dealAsks.map((a) => a.waitingSince.getTime())));
    // Emails since the first ask that could carry the sponsor's answers: anything filed on this deal from someone who
    // is not an investor (the sponsor's people, whichever company they write from: a principal answering from a
    // second entity, a partner, their analyst), plus the sponsor company's emails with no deal pinned. Claude then
    // judges whether the words answer a listed question, so a broker or attorney on the thread creates nothing unless
    // they actually answer. The old rule (sender at deal.sponsorCompanyId only) missed Parker Webb and Cory Tuck
    // answering Nelnet on the BrightStar recap from ftwinvestmentsllc.com.
    const mails = await prisma.activity.findMany({
      where: {
        type: "EMAIL",
        direction: "INBOUND",
        externalId: { not: null },
        occurredAt: { gte: earliest },
        OR: [
          { dealId, contact: { OR: [{ companyId: null }, { company: { NOT: { roles: { contains: "Investor" } } } }] } },
          ...(deal.sponsorCompanyId ? [{ dealId: null, contact: { companyId: deal.sponsorCompanyId } }] : []),
        ],
      },
      orderBy: { occurredAt: "asc" },
      select: { id: true, externalId: true, subject: true, body: true, occurredAt: true, meta: true, contact: { select: { firstName: true, lastName: true } } },
    });
    const dealName = deal.propertyName ?? deal.name;
    for (const m of mails) {
      if (await prisma.sponsorAnswerScan.findUnique({ where: { externalId: m.externalId! } })) continue;
      const mailbox = m.meta ? ((JSON.parse(m.meta) as { mailbox?: string }).mailbox ?? null) : null;
      const copy = await findMessageCopy(m.externalId!, mailbox ?? "").catch(() => null);
      const text = copy ? lpOwnWords(copy.body) : (m.body ?? "");
      emails++;
      // nothing to answer with: a scheduling line, thanks, a one-liner without files
      if (text.replace(/\s+/g, " ").trim().length < 120 && !copy?.hasAttachments) {
        await prisma.sponsorAnswerScan.create({ data: { externalId: m.externalId!, result: "short" } }).catch(() => {});
        continue;
      }
      const openList = dealAsks.flatMap((a) => parseAsks(a.summary).asks.map((q) => `- [${a.party}] ${q}`));
      let out: z.infer<typeof Out> | null = null;
      try {
        const res = await client.messages.parse({
          model: "claude-sonnet-5",
          max_tokens: 1500,
          system: SYSTEM,
          messages: [{ role: "user", content: `Deal: ${dealName}\nSponsor: ${deal.sponsorName ?? ""} (${[m.contact?.firstName, m.contact?.lastName].filter(Boolean).join(" ")})\nEmail date: ${m.occurredAt.toISOString().slice(0, 10)}\nSubject: ${m.subject ?? ""}\nAttachments: ${copy?.hasAttachments ? "yes" : "no"}\n\nOpen questions from investors:\n${openList.join("\n")}\n\nSponsor's email:\n${text.slice(0, 8000)}` }],
          output_config: { format: zodOutputFormat(Out) },
        });
        out = res.parsed_output;
      } catch {
        out = null;
      }
      await prisma.sponsorAnswerScan.create({ data: { externalId: m.externalId!, result: out ? `${out.answers.length} answers` : "error" } }).catch(() => {});
      if (!out?.answers.length) continue;
      // group by LP firm, then one item per firm
      const byFirm = new Map<string, Pair[]>();
      for (const ans of out.answers) {
        const ask = dealAsks.find((a) => key(a.party) === key(ans.lpFirm));
        if (!ask) continue;
        if (SCHEDULING.test(ans.ask) || /^already on the ticket/i.test(ans.ask)) continue; // call times are not answers an LP is waiting on
        const list = byFirm.get(ask.party) ?? [];
        if (!list.some((p) => key(p.ask) === key(ans.ask))) list.push({ ask: stripDashes(ans.ask), answer: stripDashes(ans.answer) });
        byFirm.set(ask.party, list);
      }
      for (const [firm, pairs] of byFirm) {
        const ask = dealAsks.find((a) => a.party === firm)!;
        const lp = ask.contactId ? await prisma.contact.findUnique({ where: { id: ask.contactId }, select: { companyId: true } }) : null;
        const existing = await prisma.momentum.findUnique({ where: { dealId_kind_party: { dealId, kind: "SPONSOR_ANSWER", party: firm } } });
        const merged = [...(existing && existing.status === "OPEN" ? parseAnswers(existing.summary) : [])];
        for (const p of pairs) if (!merged.some((x) => key(x.ask) === key(p.ask))) merged.push(p);
        await prisma.momentum.upsert({
          where: { dealId_kind_party: { dealId, kind: "SPONSOR_ANSWER", party: firm } },
          create: { dealId, kind: "SPONSOR_ANSWER", party: firm, status: "OPEN", companyId: lp?.companyId ?? null, contactId: ask.contactId, summary: answersSummary(firm, merged), waitingSince: m.occurredAt, lastMessageId: ask.lastMessageId, refMessageId: m.externalId },
          update: { status: "OPEN", companyId: lp?.companyId ?? null, contactId: ask.contactId, summary: answersSummary(firm, merged), waitingSince: m.occurredAt, lastMessageId: ask.lastMessageId, refMessageId: m.externalId, handledAt: null, handledBy: null },
        });
        // the answered asks leave the LP's open list (and Items Needed from Sponsor on the report)
        const cur = parseAsks(ask.summary);
        const stillOpen = cur.asks.filter((q) => !pairs.some((p) => key(p.ask) === key(q)));
        const answered = [...cur.answered, ...pairs.map((p) => `${p.ask} -> ${p.answer.slice(0, 120)}`)];
        const summary = `${firm} asks: ${stillOpen.join("; ")}${answered.length ? ` | Already on the ticket: ${answered.join(" / ")}` : ""}`;
        await prisma.momentum.update({ where: { id: ask.id }, data: { summary } });
        ask.summary = summary;
        items++;
      }
    }
  }
  return { emails, items };
}
