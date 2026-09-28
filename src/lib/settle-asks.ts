import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { stripDashes } from "@/lib/style";

/**
 * Items Needed from Sponsor must empty out as the sponsor answers (Jonathan, Sep 28, 2026: Kyle at Citivest had
 * answered every Corebridge question and the report still listed them). The sponsor-answer detector reads each
 * sponsor email once; this pass is the safety net behind it: whatever the ticket now knows (Questions answered from
 * emails and calls, files on the ticket) is held against every open ask, and the answered ones move off the list.
 * It runs when the ticket has learned something since the last pass.
 */

const Out = z.object({
  answered: z.array(z.object({
    party: z.string().describe("The investor firm, exactly as listed."),
    ask: z.string().describe("The ask, exactly as listed."),
    answer: z.string().describe("The sponsor's answer in one or two plain sentences from the ticket's facts, or 'see the attached <file>' when a file on the ticket is the answer. No dashes as punctuation."),
  })).describe("Every listed ask the ticket now answers: the sponsor gave the information, a number, an explanation, said they do not have it, or the document asked for is on the ticket. A scheduling ask (a call, a tour) counts as answered only when the ticket says it happened."),
});

const SYSTEM = `You keep the "Items Needed from Sponsor" list on an investor progress report honest for RJL Capital Advisors, a real estate capital advisor. Investors asked the sponsor for things (listed). The ticket carries what the sponsor has since told RJL (question and answer pairs from emails and calls) and the files on the ticket. Decide which asks are now answered. Be literal but fair: an ask is answered when the facts give the information or the number, when the sponsor said they do not have it, or when a file on the ticket is the document asked for (a roof map answers roof age, a Placer report answers store performance, sales comps answer cap rates and comps). An ask is not answered by a vague or unrelated fact. Return only real answers.`;

const key = (x: string) => x.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

export async function settleAsksFromTicket(dealId: string, opts: { force?: boolean } = {}): Promise<{ settled: number; skipped?: string }> {
  if (!process.env.ANTHROPIC_API_KEY) return { settled: 0, skipped: "no key" };
  const { parseAsks, sameAsk } = await import("@/lib/momentum");
  const since = new Date(Date.now() - 90 * 86_400_000);
  const items = (await prisma.momentum.findMany({ where: { dealId, kind: "LP_ASK", updatedAt: { gte: since } } })).map((m) => ({ ...m, open: parseAsks(m.summary).asks })).filter((m) => m.open.length);
  if (!items.length) return { settled: 0, skipped: "no open asks" };
  const deal = await prisma.deal.findUnique({ where: { id: dealId }, include: { facts: { orderBy: { createdAt: "asc" } }, files: { select: { name: true, receivedAt: true, fromEmail: true } } } });
  if (!deal) return { settled: 0, skipped: "no deal" };
  const det = (() => { try { return JSON.parse(deal.details || "{}") as Record<string, unknown>; } catch { return {}; } })();
  const lastAt = typeof det.asksSettledAt === "string" ? new Date(det.asksSettledAt).getTime() : 0;
  const newest = Math.max(0, ...deal.facts.map((f) => f.createdAt.getTime()), ...deal.files.map((f) => f.receivedAt.getTime()), ...items.map((m) => m.updatedAt.getTime()));
  if (!opts.force && newest <= lastAt) return { settled: 0, skipped: "nothing new" };
  const facts = deal.facts.map((f) => `Q: ${f.question}\nA: ${f.answer}`).join("\n");
  const files = deal.files.map((f) => `${f.name} (${f.receivedAt.toISOString().slice(0, 10)}${f.fromEmail ? `, from ${f.fromEmail}` : ""})`).join("\n");
  const asks = items.flatMap((m) => m.open.filter((q, i, arr) => arr.findIndex((x) => sameAsk(x, q)) === i).map((q) => `- [${m.party}] ${q}`)).join("\n");
  let out: z.infer<typeof Out> | null = null;
  try {
    const res = await new Anthropic().messages.parse({
      model: "claude-sonnet-5",
      max_tokens: 4000,
      system: SYSTEM,
      messages: [{ role: "user", content: `Deal: ${deal.propertyName ?? deal.name}\nSponsor: ${deal.sponsorName ?? ""}\n\nOPEN ASKS:\n${asks}\n\nWHAT THE TICKET KNOWS (question and answer pairs):\n${facts.slice(0, 40000) || "(nothing yet)"}\n\nFILES ON THE TICKET:\n${files || "(none)"}` }],
      output_config: { format: zodOutputFormat(Out) },
    });
    out = res.parsed_output;
  } catch (e) {
    console.error("settle asks failed", dealId, String(e).slice(0, 200));
    return { settled: 0, skipped: "error" };
  }
  if (!out?.answered.length) console.log("settle asks: nothing answered on", deal.propertyName ?? deal.name);
  let settled = 0;
  for (const m of items) {
    const pairs = (out?.answered ?? []).filter((a) => key(a.party) === key(m.party) && m.open.some((q) => key(q) === key(a.ask) || sameAsk(q, a.ask)));
    if (!pairs.length) continue;
    const cur = parseAsks(m.summary);
    const stillOpen = cur.asks.filter((q) => !pairs.some((p) => key(p.ask) === key(q) || sameAsk(p.ask, q)));
    const answered = [...cur.answered, ...pairs.map((p) => `${stripDashes(p.ask)} -> ${stripDashes(p.answer).slice(0, 120)}`)];
    await prisma.momentum.update({ where: { id: m.id }, data: { summary: `${m.party} asks: ${stillOpen.join("; ")}${answered.length ? ` | Already on the ticket: ${answered.join(" / ")}` : ""}`, ...(stillOpen.length === 0 && m.status === "OPEN" ? { status: "DONE" } : {}) } });
    settled += pairs.length;
  }
  const fresh = await prisma.deal.findUnique({ where: { id: dealId }, select: { details: true } });
  const detNow = (() => { try { return JSON.parse(fresh?.details || "{}") as Record<string, unknown>; } catch { return {}; } })();
  await prisma.deal.update({ where: { id: dealId }, data: { details: JSON.stringify({ ...detNow, asksSettledAt: new Date().toISOString() }) } });
  if (settled) await prisma.activity.create({ data: { type: "NOTE", dealId, body: `${settled} investor request${settled === 1 ? "" : "s"} answered by what the sponsor has provided; taken off Items Needed from Sponsor.` } }).catch(() => null);
  return { settled };
}

/** Every active deal with open LP asks that has learned something since its last pass. */
export async function settleAsksEverywhere(): Promise<number> {
  const { ACTIVE_STAGES } = await import("@/lib/taxonomy");
  const withAsks = [...new Set((await prisma.momentum.findMany({ where: { kind: "LP_ASK", updatedAt: { gte: new Date(Date.now() - 90 * 86_400_000) } }, select: { dealId: true } })).map((m) => m.dealId))];
  const dealIds = (await prisma.deal.findMany({ where: { id: { in: withAsks }, stage: { in: [...ACTIVE_STAGES] } }, select: { id: true } })).map((d) => d.id);
  let n = 0;
  for (const id of dealIds) n += (await settleAsksFromTicket(id).catch(() => ({ settled: 0 }))).settled;
  return n;
}
