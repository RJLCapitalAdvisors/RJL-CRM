import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { houseText } from "@/lib/style";

/**
 * Fireflies call transcripts. Before a deal's sponsor bio and business plan are final, look for calls with
 * the sponsor (by sponsor name, property name, contact name) and fold in what was said. Also files anything
 * concrete from the call under Questions answered. Skipped quietly when no Fireflies key is configured.
 */

const API = "https://api.fireflies.ai/graphql";
export const firefliesConfigured = () => Boolean(process.env.FIREFLIES_API_KEY);

export type Transcript = { id: string; title: string; date: Date; participants: string[]; overview: string; bullets: string; actionItems: string; keywords: string[] };

async function gql<T>(query: string, variables: Record<string, unknown>): Promise<T> {
  const res = await fetch(API, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${process.env.FIREFLIES_API_KEY}` }, body: JSON.stringify({ query, variables }), signal: AbortSignal.timeout(25_000) });
  const json = (await res.json()) as { data?: T; errors?: { message: string }[] };
  if (!res.ok || json.errors?.length) throw new Error(`Fireflies: ${json.errors?.[0]?.message ?? res.status}`);
  return json.data as T;
}

type Raw = { id: string; title: string | null; date: number | string | null; participants: string[] | null; summary: { overview?: string | null; bullet_gist?: string | null; shorthand_bullet?: string | null; action_items?: string | null; keywords?: string[] | null } | null };

/** The most recent transcripts (two pages of 50). */
export async function recentTranscripts(pages = 2): Promise<Transcript[]> {
  if (!firefliesConfigured()) return [];
  const out: Transcript[] = [];
  for (let p = 0; p < pages; p++) {
    const data = await gql<{ transcripts: Raw[] }>(`query ($limit: Int, $skip: Int) { transcripts(limit: $limit, skip: $skip) { id title date participants summary { overview bullet_gist shorthand_bullet action_items keywords } } }`, { limit: 50, skip: p * 50 }).catch(() => ({ transcripts: [] as Raw[] }));
    for (const t of data.transcripts ?? []) {
      out.push({ id: t.id, title: t.title ?? "(untitled)", date: new Date(typeof t.date === "number" ? t.date : Number(t.date) || Date.parse(String(t.date))), participants: t.participants ?? [], overview: t.summary?.overview ?? "", bullets: t.summary?.shorthand_bullet ?? t.summary?.bullet_gist ?? "", actionItems: t.summary?.action_items ?? "", keywords: t.summary?.keywords ?? [] });
    }
    if ((data.transcripts ?? []).length < 50) break;
  }
  return out;
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9@. ]+/g, " ");
const STOP = new Set(["capital", "partners", "group", "development", "realty", "properties", "property", "investments", "holdings", "llc", "portfolio", "the", "and", "management", "advisors", "company", "inc", "equity", "fund"]);

/** Calls that mention any of the terms in their title, participants or summary. */
export async function findCalls(terms: string[]): Promise<Transcript[]> {
  const needles = [...new Set(terms.flatMap((t) => [t, ...t.split(/[^A-Za-z0-9@.]+/)]).map((x) => norm(x).trim()).filter((x) => x.length > 3 && !STOP.has(x)))];
  if (!needles.length) return [];
  const all = await recentTranscripts();
  return all.filter((t) => {
    const hay = norm(`${t.title} ${t.participants.join(" ")} ${t.overview} ${t.keywords.join(" ")}`);
    // a full term (sponsor name, property) anywhere; or a distinctive single word in the title / participants
    return terms.some((term) => term.length > 3 && hay.includes(norm(term).trim())) || needles.some((n) => n.includes("@") ? hay.includes(n) : norm(`${t.title} ${t.participants.join(" ")}`).includes(n));
  });
}

const Enriched = z.object({
  summary: z.string().describe("The business plan paragraph, rewritten to fold in what the calls added. Same rules: location and market first, anchors/key tenants, value-add thesis, physical attributes; 4-6 sentences; flowing prose; no dashes; nothing that has its own field. Return the existing text unchanged if the calls add nothing."),
  sponsorExperience: z.string().describe("The sponsor bio, 3-4 sentences: founding background, focus/strategy, scale/track record. No return figures, no dashes. Fold in what the calls added; return the existing text unchanged if nothing new."),
  facts: z.array(z.object({ question: z.string(), answer: z.string(), askedByInvestor: z.boolean().describe("True only if an investor (LP) on the call asked this and the sponsor answered it.") })).describe("Concrete things said on the calls that an investor would ask about and that are not already on the ticket. Empty if none."),
  changed: z.boolean().describe("True if either narrative changed."),
});

/** Enrich a deal's business plan and sponsor bio from Fireflies calls with the sponsor. Returns what happened. */
export async function enrichFromCalls(dealId: string): Promise<{ calls: number; changed: boolean; facts: number }> {
  if (!firefliesConfigured() || !process.env.ANTHROPIC_API_KEY) return { calls: 0, changed: false, facts: 0 };
  const deal = await prisma.deal.findUnique({ where: { id: dealId }, include: { sponsorCompany: { include: { contacts: { where: { departedAt: null }, select: { firstName: true, lastName: true, email: true } } } }, facts: { orderBy: { createdAt: "desc" }, take: 40 } } });
  if (!deal) return { calls: 0, changed: false, facts: 0 };
  const terms = [deal.sponsorName, deal.propertyName, deal.sponsorCompany?.name, deal.sponsorCompany?.domain, ...(deal.sponsorCompany?.contacts ?? []).flatMap((c) => [[c.firstName, c.lastName].filter(Boolean).join(" "), c.email ?? ""])].filter((x): x is string => Boolean(x && x.length > 3));
  const calls = (await findCalls(terms).catch(() => [])).slice(0, 5);
  if (!calls.length) return { calls: 0, changed: false, facts: 0 };
  const client = new Anthropic();
  const known = deal.facts.map((f) => `Q: ${f.question}\nA: ${f.answer}`).join("\n");
  const callText = calls.map((c) => `=== ${c.title} (${c.date.toISOString().slice(0, 10)}; ${c.participants.join(", ")}) ===\n${c.overview}\n${c.bullets}\n${c.actionItems}`).join("\n\n");
  const res = await client.messages.parse({
    model: "claude-opus-5",
    max_tokens: 3000,
    system: "You maintain deal tickets for RJL Capital Advisors, a real estate capital advisor. You get a deal's current business plan and sponsor bio, the sponsor's known Q&A, and summaries of recorded calls with the sponsor. Improve the two narratives only with what the calls clearly establish about this deal or this sponsor; never invent, never add numbers that have their own field (price, returns, costs, size, unit count, dates). No dashes as punctuation anywhere. Flag nothing as TBD; leave it out instead.",
    messages: [{ role: "user", content: `DEAL: ${deal.propertyName ?? deal.name}\nSPONSOR: ${deal.sponsorName ?? ""}\n\nCURRENT BUSINESS PLAN:\n${deal.summary ?? "(none yet)"}\n\nCURRENT SPONSOR BIO:\n${deal.sponsorExperience ?? "(none yet)"}\n\nKNOWN Q&A:\n${known || "(none)"}\n\nCALLS:\n${callText.slice(0, 40_000)}` }],
    output_config: { format: zodOutputFormat(Enriched) },
  });
  const out = res.parsed_output;
  if (!out) return { calls: calls.length, changed: false, facts: 0 };
  const data: { summary?: string | null; sponsorExperience?: string | null } = {};
  if (out.changed) {
    const s = houseText(out.summary), b = houseText(out.sponsorExperience);
    if (s && s !== deal.summary) data.summary = s;
    if (b && b !== deal.sponsorExperience) data.sponsorExperience = b;
  }
  if (Object.keys(data).length) await prisma.deal.update({ where: { id: dealId }, data });
  const source = `Call: ${calls.map((c) => `${c.title} (${c.date.toLocaleDateString("en-US", { month: "short", day: "numeric" })})`).join("; ")}`.slice(0, 500);
  const fresh = out.facts.filter((f) => f.question.trim() && f.answer.trim());
  if (fresh.length) await prisma.dealFact.createMany({ data: fresh.map((f) => ({ dealId, question: houseText(f.question) ?? f.question, answer: houseText(f.answer) ?? f.answer, source, inFaq: Boolean(f.askedByInvestor) })) });
  return { calls: calls.length, changed: Object.keys(data).length > 0, facts: fresh.length };
}
