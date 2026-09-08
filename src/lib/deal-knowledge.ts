import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { graph, type GraphAttachment } from "@/lib/graph";
import { ACTIVE_STAGES } from "@/lib/taxonomy";
import { CHECKLIST, parseDetails } from "@/lib/checklist";

/**
 * A deal keeps learning. Every email about it that reaches deals@ after the first one is a follow-up:
 * its files join the ticket's Attachments, and whatever the sponsor answered becomes Q&A facts on the ticket,
 * which the CRM later uses to answer LP questions. Nothing here creates a second ticket.
 */

const q = (s: string) => encodeURIComponent(s);
const IMAGE = /\.(png|jpe?g|gif|bmp|svg|webp)$/i;
const STOP = new Set(["opportunity", "acquisition", "development", "retail", "portfolio", "recap", "deal", "apartments", "multifamily", "ground", "capital", "group", "partners", "the", "and", "with"]);
const words = (s: string) => s.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 3 && !STOP.has(w));

/** Which existing active deal an incoming deals@ email belongs to, if any. */
export async function matchExistingDeal(opts: { conversationId?: string | null; subject: string; bodyText: string; senderEmail?: string | null }): Promise<string | null> {
  if (opts.conversationId) {
    const byThread = await prisma.dealEmail.findFirst({ where: { conversationId: opts.conversationId }, orderBy: { receivedAt: "desc" } });
    if (byThread) return byThread.dealId;
  }
  const deals = await prisma.deal.findMany({ where: { stage: { in: [...ACTIVE_STAGES] } }, select: { id: true, name: true, propertyName: true, city: true, sponsorCompanyId: true, sponsorCompany: { select: { domain: true } } } });
  const subj = opts.subject.toLowerCase();
  const head = opts.bodyText.slice(0, 1500).toLowerCase();
  const senderDomain = opts.senderEmail?.split("@")[1]?.toLowerCase();
  let best: { id: string; score: number } | null = null;
  for (const d of deals) {
    const ws = words(d.propertyName ?? d.name);
    if (!ws.length) continue;
    const inSubject = ws.filter((w) => subj.includes(w)).length;
    const inBody = ws.filter((w) => head.includes(w)).length;
    let score = inSubject * 2 + inBody;
    if (d.city && (subj.includes(d.city.toLowerCase()) || head.includes(d.city.toLowerCase()))) score += 1;
    if (senderDomain && d.sponsorCompany?.domain === senderDomain) score += 2;
    // need the deal's own name to be present, not just its city or sponsor
    if (inSubject + inBody === 0) continue;
    if (!best || score > best.score) best = { id: d.id, score };
  }
  return best && best.score >= 2 ? best.id : null;
}

export async function recordDealEmail(dealId: string, m: { messageId: string; graphId?: string | null; conversationId?: string | null; subject?: string | null; fromEmail?: string | null; receivedAt?: Date; kind: "INTAKE" | "FOLLOWUP" }) {
  return prisma.dealEmail.upsert({ where: { messageId: m.messageId }, create: { dealId, ...m, receivedAt: m.receivedAt ?? new Date() }, update: { dealId, graphId: m.graphId ?? undefined, conversationId: m.conversationId ?? undefined } });
}

/** Register the files on a deals@ message as the deal's attachments (images and signature logos skipped). */
export async function recordDealFiles(dealId: string, mailbox: string, graphId: string, fromEmail: string | null, receivedAt: Date, atts?: GraphAttachment[]) {
  const list = atts ?? (await graph<{ value: GraphAttachment[] }>(`/users/${q(mailbox)}/messages/${q(graphId)}/attachments?$select=id,name,contentType,size,isInline`)).value;
  let n = 0;
  for (const a of list) {
    if (a.isInline || a["@odata.type"] !== "#microsoft.graph.fileAttachment" || IMAGE.test(a.name)) continue;
    await prisma.dealFile.upsert({ where: { graphId_attachmentId: { graphId, attachmentId: a.id } }, create: { dealId, name: a.name, size: a.size, contentType: a.contentType, mailbox, graphId, attachmentId: a.id, fromEmail, receivedAt }, update: { dealId } });
    n++;
  }
  return n;
}

const Facts = z.object({
  facts: z.array(z.object({ question: z.string().describe("The question this answers, phrased the way an investor would ask it, e.g. 'What are the Class A sale comps in suburban Indianapolis?'"), answer: z.string().describe("The sponsor's answer, concrete, 1-3 sentences, with numbers where given.") })).describe("Every substantive piece of information the sponsor provided in this email and its attachments. Empty if nothing new."),
});

/** Turn a follow-up email (plus attachment text) into Q&A facts on the deal. Returns how many were added. */
export async function extractDealFacts(dealId: string, text: string, source: string): Promise<number> {
  if (!process.env.ANTHROPIC_API_KEY || text.trim().length < 20) return 0;
  const deal = await prisma.deal.findUnique({ where: { id: dealId }, include: { facts: { orderBy: { createdAt: "desc" }, take: 60 } } });
  if (!deal) return 0;
  const client = new Anthropic();
  const known = deal.facts.map((f) => `Q: ${f.question}\nA: ${f.answer}`).join("\n");
  const res = await client.messages.parse({
    model: "claude-sonnet-5",
    max_tokens: 2500,
    system: `A deal sponsor sent RJL Capital Advisors (a real estate capital advisor) more information about a deal they are raising capital for. Extract the information as question/answer pairs so the team can answer investors later. Cover everything substantive: numbers, comps, market data, timeline, structure, answers to earlier questions. Do not repeat facts already known (listed) unless the new email updates them. Skip pleasantries.`,
    messages: [{ role: "user", content: `Deal: ${deal.propertyName ?? deal.name}\nSponsor: ${deal.sponsorName ?? ""}\n\nALREADY KNOWN:\n${known || "(nothing yet)"}\n\nNEW EMAIL (${source}):\n${text.slice(0, 60000)}` }],
    output_config: { format: zodOutputFormat(Facts) },
  });
  const facts = res.parsed_output?.facts ?? [];
  if (facts.length) await prisma.dealFact.createMany({ data: facts.map((f) => ({ dealId, question: f.question.slice(0, 500), answer: f.answer.slice(0, 2000), source })) });
  return facts.length;
}

/** Fill blanks on the ticket from a follow-up: checklist items and core fields the extractor can see. */
export async function mergeIntoDeal(dealId: string, rawText: string, subject: string) {
  const { extractWithClaude } = await import("@/lib/intake");
  const deal = await prisma.deal.findUnique({ where: { id: dealId } });
  if (!deal) return 0;
  let d;
  try {
    d = await extractWithClaude(rawText, subject, []);
  } catch {
    return 0;
  }
  const details = parseDetails(deal.details);
  let filled = 0;
  for (const it of CHECKLIST) {
    const v = d.details?.[it.key];
    if (v && !details[it.key]) {
      details[it.key] = v;
      filled++;
    }
  }
  const core: Record<string, unknown> = {};
  const maybe = (k: keyof typeof deal, v: unknown) => {
    if (v != null && v !== "" && (deal[k] == null || deal[k] === "")) {
      core[k as string] = v;
      filled++;
    }
  };
  maybe("occupancy", d.occupancy); maybe("units", d.units != null ? Math.trunc(d.units) : null); maybe("squareFeet", d.squareFeet); maybe("yearBuilt", d.yearBuilt); maybe("unitMix", d.unitMix);
  maybe("totalCapitalization", d.totalCapitalization); maybe("totalDebt", d.totalDebt); maybe("purchasePrice", d.purchasePrice); maybe("requestedAmount", d.requestedAmount);
  maybe("interestRate", d.interestRate); maybe("loanTerm", d.loanTerm); maybe("lenderType", d.lenderType); maybe("irr", d.irr); maybe("equityMultiple", d.equityMultiple);
  maybe("capRateT12", d.capRateT12); maybe("capRateY1", d.capRateY1); maybe("yieldOnCost", d.yieldOnCost); maybe("cashOnCash", d.cashOnCash); maybe("holdPeriod", d.holdPeriod);
  maybe("sponsorExperience", d.sponsorExperience); maybe("expectedClose", (d as { expectedClose?: string | null }).expectedClose ?? null);
  await prisma.deal.update({ where: { id: dealId }, data: { ...core, details: JSON.stringify(details) } });
  return filled;
}

/** The facts most relevant to a question (simple word overlap; plenty for a handful of facts per deal). */
export async function factsFor(dealId: string, question: string, limit = 3) {
  const facts = await prisma.dealFact.findMany({ where: { dealId } });
  const qw = new Set(words(question));
  return facts
    .map((f) => ({ f, score: words(f.question + " " + f.answer).filter((w) => qw.has(w)).length }))
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((x) => x.f);
}
