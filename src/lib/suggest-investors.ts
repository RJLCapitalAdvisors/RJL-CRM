import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { parseList } from "@/lib/taxonomy";
import { checkRangeFrom, CHECK_MAX } from "@/lib/ranges";
import { statusOf } from "@/lib/tracker";

/**
 * The CRM's own opinion on which equity groups belong in an engagement letter. It reads everything the
 * firm has produced about each candidate: criteria on file, how they responded to every deal we sent
 * them (tracker notes), and how much we correspond with them, then asks Claude for a short ranked list
 * with a one-line reason each. Cached on the deal for a day.
 */

const DAY = 86_400_000;
const CACHE_HOURS = 24;

export type Suggestion = { companyId: string; name: string; reason: string };
type Cache = { at: string; items: Suggestion[] };

const Out = z.object({
  picks: z.array(z.object({ companyId: z.string(), reason: z.string().describe("One short line, analyst tone, citing the evidence: e.g. 'Took a look at Everett; owns MF in the market; $5-15MM checks' or 'Asked for larger deals in Aug; 3+MM pref checks'") })).describe("6 to 10 groups, best first. Only groups whose evidence supports it."),
});

function covers(min: number | null, max: number | null, askMM: number | null) {
  if (askMM == null || min == null || max == null) return true;
  return askMM >= min && (max >= CHECK_MAX || askMM <= max);
}

export async function suggestInvestors(dealId: string, opts: { force?: boolean } = {}): Promise<Suggestion[]> {
  const deal = await prisma.deal.findUnique({ where: { id: dealId } });
  if (!deal || !process.env.ANTHROPIC_API_KEY) return [];
  const details = (() => {
    try {
      return JSON.parse(deal.details || "{}") as Record<string, unknown>;
    } catch {
      return {};
    }
  })();
  const cached = details.aiSuggestions as Cache | undefined;
  if (!opts.force && cached && Date.now() - new Date(cached.at).getTime() < CACHE_HOURS * 3_600_000) return cached.items;

  // 1) candidates: investors whose hard criteria fit (asset class or agnostic, check size covers the ask, position, strategy)
  const askMM = deal.requestedAmount ? Math.round(deal.requestedAmount / 1_000_000) : null;
  const companies = await prisma.company.findMany({ where: { roles: { contains: "Investor" } }, select: { id: true, name: true, criteria: true } });
  const candidates = companies.filter((c) => {
    const cr = c.criteria;
    if (!cr) return false;
    const assets = parseList(cr.assetClasses);
    if (deal.assetClass && assets.length && !assets.includes(deal.assetClass) && !assets.includes("Asset Class Agnostic")) return false;
    const range = cr.checkMinMM != null && cr.checkMaxMM != null ? [cr.checkMinMM, cr.checkMaxMM] : checkRangeFrom(parseList(cr.checkSizes));
    if (!covers(range?.[0] ?? null, range?.[1] ?? null, askMM)) return false;
    const pos = parseList(cr.investmentTypes);
    if (deal.executionType && pos.length && !pos.includes(deal.executionType)) return false;
    if (deal.strategy && cr.strategy && cr.strategy !== "Both" && cr.strategy !== deal.strategy) return false;
    return true;
  });
  if (!candidates.length) return [];
  const ids = candidates.map((c) => c.id);

  // 2) evidence: tracker history and email volume per candidate
  const [rows, emails] = await Promise.all([
    prisma.dealInvestor.findMany({ where: { contact: { companyId: { in: ids } }, dealId: { not: dealId } }, include: { contact: { select: { companyId: true } }, deal: { select: { propertyName: true, name: true, assetClass: true, city: true, state: true } } }, orderBy: { updatedAt: "desc" } }),
    prisma.activity.groupBy({ by: ["companyId", "direction"], where: { companyId: { in: ids }, type: "EMAIL", occurredAt: { gte: new Date(Date.now() - 180 * DAY) } }, _count: true }),
  ]);
  const history = new Map<string, string[]>();
  for (const r of rows) {
    const cid = r.contact.companyId!;
    const list = history.get(cid) ?? [];
    if (list.length < 6) list.push(`${r.deal.propertyName ?? r.deal.name} (${[r.deal.assetClass, r.deal.state].filter(Boolean).join(", ")}): ${statusOf(r.status).short}${r.note ? ` - ${r.note.slice(0, 160)}` : ""}`);
    history.set(cid, list);
  }
  const mail = new Map<string, { in: number; out: number }>();
  for (const e of emails) {
    if (!e.companyId) continue;
    const m = mail.get(e.companyId) ?? { in: 0, out: 0 };
    if (e.direction === "INBOUND") m.in += e._count;
    else m.out += e._count;
    mail.set(e.companyId, m);
  }

  const dossier = candidates
    .map((c) => {
      const cr = c.criteria!;
      const m = mail.get(c.id);
      const h = history.get(c.id) ?? [];
      return `[${c.id}] ${c.name}\n  criteria: ${[parseList(cr.assetClasses).join("/"), cr.checkMinMM != null ? `$${cr.checkMinMM}-${cr.checkMaxMM}MM` : parseList(cr.checkSizes).join("/"), parseList(cr.investmentTypes).join("/"), cr.strategy, cr.geographyNotes, parseList(cr.returnProfile).join("/")].filter(Boolean).join(" | ")}\n  emails (180d): ${m ? `${m.out} out / ${m.in} in` : "none"}\n  history: ${h.length ? h.join(" || ") : "never sent a deal"}`;
    })
    .join("\n");

  const client = new Anthropic();
  const res = await client.messages.parse({
    model: "claude-opus-5",
    max_tokens: 8000,
    system: `You are the deal team's memory at RJL Capital Advisors, a real estate capital advisor. Given a new deal and dossiers on candidate equity groups (criteria on file, how each responded to past deals we sent them, how much we email with them), pick the groups that most deserve to be on the sponsor engagement letter. Weigh: explicit fit with this deal's asset class, market, check size and position; past interest in similar deals (Taking A Look, Interested, Intro Made) or explicit asks for more deal flow; active correspondence; and penalize groups that passed on very similar deals for reasons that still apply (wrong geography, product type, size). Do not pick groups whose notes say they are out of the market or between funds. Be concrete in the reasons.`,
    messages: [{ role: "user", content: `DEAL\n${deal.propertyName ?? deal.name} - ${[deal.assetClass, deal.strategy, deal.city && deal.state ? `${deal.city}, ${deal.state}` : deal.state].filter(Boolean).join(", ")}\nAsk: ${askMM ? `$${askMM}MM` : "n/a"} ${deal.executionType ?? ""}\nSummary: ${deal.summary ?? ""}\n\nCANDIDATES\n${dossier}` }],
    output_config: { format: zodOutputFormat(Out) },
  });
  const byId = new Map(candidates.map((c) => [c.id, c.name]));
  const items: Suggestion[] = (res.parsed_output?.picks ?? []).filter((p) => byId.has(p.companyId)).map((p) => ({ companyId: p.companyId, name: byId.get(p.companyId)!, reason: p.reason }));
  await prisma.deal.update({ where: { id: dealId }, data: { details: JSON.stringify({ ...details, aiSuggestions: { at: new Date().toISOString(), items } satisfies Cache }) } });
  return items;
}
