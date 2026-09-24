import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { houseText, cleanBusinessPlan } from "@/lib/style";
import { missingFor, parseDetails, type ChecklistItem } from "@/lib/checklist";
import { loadChecklist } from "@/lib/required-items";
import { ACTIVE_STAGES, LENDER_TYPES, LOAN_TERMS, UNIT_MIXES } from "@/lib/taxonomy";

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
/** Words that appear in too many titles to point at one sponsor (Sep 24, 2026: "street" in a property name matched every call). */
const COMMON = new Set([...STOP, "street", "avenue", "road", "drive", "boulevard", "plaza", "place", "center", "centre", "park", "project", "projects", "qoz", "deal", "deals", "call", "meeting", "intro", "north", "south", "east", "west", "real", "estate", "opportunity", "fund", "trust", "ventures", "associates", "brothers", "family", "office", "square", "point", "lane", "court", "creek", "ridge", "hill", "lake", "river", "bay", "harbor", "harbour", "village", "town", "city", "district"]);
export async function findCalls(terms: string[], transcripts?: Transcript[], opts: { phrases?: string[] } = {}): Promise<Transcript[]> {
  // emails match anywhere; a firm's distinctive words match as whole words in the title or participants (Sep 24, 2026:
  // "nathan" inside jonathan@rjlcapadvisors.com had matched every call); people's names and the property count as phrases
  const emails = [...new Set(terms.filter((t) => t.includes("@")).map((t) => norm(t).trim()))];
  const words = [...new Set(terms.filter((t) => !t.includes("@") && !/\s/.test(t.trim()) === false ? false : !t.includes("@")).flatMap((t) => t.split(/[^A-Za-z0-9]+/)).map((x) => norm(x).trim()).filter((x) => x.length > 3 && !COMMON.has(x) && !/^\d+$/.test(x) && !/^(jonathan|aviel|shawn|esther|livi|livian)$/.test(x)))];
  const phrases = [...new Set([...terms.filter((t) => !t.includes("@")), ...(opts.phrases ?? [])].map((t) => norm(t).replace(/\s+/g, " ").trim()).filter((t) => t.length > 3 && !COMMON.has(t)))];
  if (!emails.length && !words.length && !phrases.length) return [];
  const all = transcripts ?? (await recentTranscripts());
  const wordRe = words.length ? new RegExp(`\\b(${words.map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})\\b`) : null;
  return all.filter((t) => {
    const hay = norm(`${t.title} ${t.participants.join(" ")} ${t.overview} ${t.keywords.join(" ")}`).replace(/\s+/g, " ");
    const head = norm(`${t.title} ${t.participants.join(" ")}`);
    return emails.some((e) => hay.includes(e)) || phrases.some((p) => hay.includes(p)) || (wordRe ? wordRe.test(head) : false);
  });
}

const Enriched = z.object({
  summary: z.string().describe("The business plan paragraph, rewritten to fold in what the calls added. Same rules: location and market first, anchors/key tenants, value-add thesis, physical attributes; 4-6 sentences; flowing prose; no dashes; nothing that has its own field. Return the existing text unchanged if the calls add nothing."),
  sponsorExperience: z.string().describe("The sponsor bio, 3-4 sentences: founding background, focus/strategy, scale/track record. No return figures, no dashes. Fold in what the calls added; return the existing text unchanged if nothing new."),
  facts: z.array(z.object({ question: z.string(), answer: z.string(), askedByInvestor: z.boolean().describe("True only if an investor (LP) on the call asked this and the sponsor answered it.") })).describe("Concrete things said on the calls that an investor would ask about and that are not already on the ticket. Empty if none."),
  changed: z.boolean().describe("True if either narrative changed."),
  // blank ticket fields the calls settle (Jonathan, Sep 24, 2026: closing date, sourcing, GC, loan terms, acreage and the rest come off calls too)
  fields: z.object({
    expectedClose: z.string().nullable().describe("The closing date or month the sponsor stated, as 'Month Year' or 'Q# Year'; null when not said"),
    unitMix: z.string().nullable().describe("The bedroom mix if stated, snapped to one of the listed options; null otherwise"),
    yearBuilt: z.string().nullable().describe("Year built if stated; null otherwise"),
    onMarket: z.enum(["on", "off", ""]).describe("'off' when the sponsor said the deal is off market, 'on' when marketed, '' when not said"),
    lenderType: z.string().nullable().describe("The lender type if named, one of the listed options; null otherwise"),
    loanTerm: z.string().nullable().describe("The loan term if stated, one of the listed options; null otherwise"),
    interestRate: z.string().nullable().describe("The debt rate if stated, as said (6.5% fixed, SOFR + 300); null otherwise"),
  }),
  details: z.array(z.object({ key: z.string(), answer: z.string() })).describe("Answers to the listed open checklist questions that the calls clearly give, by key; quote or closely paraphrase the sponsor. Skip anything not said. Never carry a number that belongs to the model (price, capitalization, debt, returns)."),
});

/** Enrich a deal's business plan and sponsor bio from Fireflies calls with the sponsor. Returns what happened. */
export async function enrichFromCalls(dealId: string, transcripts?: Transcript[]): Promise<{ calls: number; changed: boolean; facts: number; filled?: string[] }> {
  if (!firefliesConfigured() || !process.env.ANTHROPIC_API_KEY) return { calls: 0, changed: false, facts: 0 };
  const deal = await prisma.deal.findUnique({ where: { id: dealId }, include: { sponsorCompany: { include: { contacts: { where: { departedAt: null }, select: { firstName: true, lastName: true, email: true } } } }, facts: { orderBy: { createdAt: "desc" }, take: 40 } } });
  if (!deal) return { calls: 0, changed: false, facts: 0 };
  await loadChecklist();
  const open: ChecklistItem[] = missingFor(deal).filter((it) => it.kind !== "doc");
  const blankFields = { expectedClose: !deal.expectedClose, unitMix: !deal.unitMix, yearBuilt: !deal.yearBuilt, onMarket: deal.onMarket == null, lenderType: !deal.lenderType, loanTerm: !deal.loanTerm, interestRate: !deal.interestRate };
  const terms = [deal.sponsorName, deal.sponsorCompany?.name, deal.sponsorCompany?.domain, ...(deal.sponsorCompany?.contacts ?? []).flatMap((c) => [[c.firstName, c.lastName].filter(Boolean).join(" "), c.email ?? ""])].filter((x): x is string => Boolean(x && x.length > 3));
  const phrases = [deal.propertyName].filter((x): x is string => Boolean(x && x.length > 3));
  const calls = (await findCalls(terms, transcripts, { phrases }).catch(() => [])).slice(0, 5);
  if (!calls.length) {
    await prisma.deal.update({ where: { id: dealId }, data: { callsEnrichedAt: new Date() } }).catch(() => null);
    return { calls: 0, changed: false, facts: 0 };
  }
  const client = new Anthropic();
  const known = deal.facts.map((f) => `Q: ${f.question}\nA: ${f.answer}`).join("\n");
  void transcripts;
  const callText = calls.map((c) => `=== ${c.title} (${c.date.toISOString().slice(0, 10)}; ${c.participants.join(", ")}) ===\n${c.overview}\n${c.bullets}\n${c.actionItems}`).join("\n\n");
  const res = await client.messages.parse({
    model: "claude-opus-5",
    max_tokens: 3000,
    system: "You maintain deal tickets for RJL Capital Advisors, a real estate capital advisor. You get a deal's current business plan and sponsor bio, the sponsor's known Q&A, and summaries of recorded calls with the sponsor. Improve the two narratives only with what the calls clearly establish about this deal or this sponsor; never invent, never add numbers that have their own field (price, returns, costs, size, unit count, dates). No dashes as punctuation anywhere. Flag nothing as TBD; leave it out instead.",
    messages: [{ role: "user", content: `DEAL: ${deal.propertyName ?? deal.name}\nSPONSOR: ${deal.sponsorName ?? ""}\n\nCURRENT BUSINESS PLAN:\n${deal.summary ?? "(none yet)"}\n\nCURRENT SPONSOR BIO:\n${deal.sponsorExperience ?? "(none yet)"}\n\nKNOWN Q&A:\n${known || "(none)"}\n\nOPEN TICKET FIELDS (fill only from what the calls say; blank ones only): ${Object.entries(blankFields).filter(([, b]) => b).map(([k]) => k).join(", ") || "(none)"}. Options: unitMix one of ${UNIT_MIXES.join(" | ")}; lenderType one of ${LENDER_TYPES.join(" | ")}; loanTerm one of ${LOAN_TERMS.join(" | ")}.\n\nOPEN CHECKLIST QUESTIONS (answer by key only when the calls clearly do):\n${open.map((it) => `${it.key}: ${it.question ?? it.label}`).join("\n") || "(none)"}\n\nCALLS:\n${callText.slice(0, 40_000)}` }],
    output_config: { format: zodOutputFormat(Enriched) },
  });
  const out = res.parsed_output;
  if (!out) return { calls: calls.length, changed: false, facts: 0 };
  const data: Record<string, unknown> = { callsEnrichedAt: new Date() };
  const filled: string[] = [];
  if (out.changed) {
    const s = cleanBusinessPlan(out.summary), b = houseText(out.sponsorExperience);
    if (s && s !== deal.summary) { data.summary = s; filled.push("summary"); }
    if (b && b !== deal.sponsorExperience) { data.sponsorExperience = b; filled.push("sponsorExperience"); }
  }
  // blank ticket fields only; a value already on the ticket stands
  const f = out.fields;
  const clean = (v: string | null | undefined) => (v && v.trim() && !/^(null|n\/a|unknown|tbd)$/i.test(v.trim()) ? houseText(v.trim()) ?? v.trim() : null);
  if (blankFields.expectedClose && clean(f.expectedClose)) { data.expectedClose = clean(f.expectedClose); filled.push("expectedClose"); }
  if (blankFields.unitMix && clean(f.unitMix) && (UNIT_MIXES as readonly string[]).includes(clean(f.unitMix)!)) { data.unitMix = clean(f.unitMix); filled.push("unitMix"); }
  if (blankFields.yearBuilt && clean(f.yearBuilt)) { data.yearBuilt = clean(f.yearBuilt); filled.push("yearBuilt"); }
  if (blankFields.onMarket && (f.onMarket === "on" || f.onMarket === "off")) { data.onMarket = f.onMarket === "on"; filled.push("onMarket"); }
  if (blankFields.lenderType && clean(f.lenderType) && (LENDER_TYPES as readonly string[]).includes(clean(f.lenderType)!)) { data.lenderType = clean(f.lenderType); filled.push("lenderType"); }
  if (blankFields.loanTerm && clean(f.loanTerm) && (LOAN_TERMS as readonly string[]).includes(clean(f.loanTerm)!)) { data.loanTerm = clean(f.loanTerm); filled.push("loanTerm"); }
  if (blankFields.interestRate && clean(f.interestRate)) { data.interestRate = clean(f.interestRate); filled.push("interestRate"); }
  const details = parseDetails(deal.details);
  const openKeys = new Set(open.map((it) => it.key));
  let detailsChanged = false;
  for (const d of out.details ?? []) {
    const a = clean(d.answer);
    if (!a || !openKeys.has(d.key) || details[d.key]) continue;
    details[d.key] = a;
    detailsChanged = true;
    filled.push(d.key);
  }
  if (detailsChanged) data.details = JSON.stringify(details);
  await prisma.deal.update({ where: { id: dealId }, data });
  const source = `Call: ${calls.map((c) => `${c.title} (${c.date.toLocaleDateString("en-US", { month: "short", day: "numeric" })})`).join("; ")}`.slice(0, 500);
  const fresh = out.facts.filter((f) => f.question.trim() && f.answer.trim());
  if (fresh.length) await prisma.dealFact.createMany({ data: fresh.map((f) => ({ dealId, question: houseText(f.question) ?? f.question, answer: houseText(f.answer) ?? f.answer, source, inFaq: Boolean(f.askedByInvestor) })) });
  return { calls: calls.length, changed: filled.length > 0, facts: fresh.length, filled };
}

/**
 * The cron pass (Sep 24, 2026): every live deal whose sponsor has a call newer than the last read gets the calls read
 * into its ticket, so a closing date or a GC named on a call after intake still lands. One transcript fetch per pass,
 * a handful of deals per pass so the cron stays within its time.
 */
export async function enrichActiveDealsFromCalls(max = 6): Promise<{ checked: number; enriched: { deal: string; filled: string[] }[] }> {
  if (!firefliesConfigured() || !process.env.ANTHROPIC_API_KEY) return { checked: 0, enriched: [] };
  const transcripts = await recentTranscripts().catch(() => [] as Transcript[]);
  if (!transcripts.length) return { checked: 0, enriched: [] };
  const deals = await prisma.deal.findMany({ where: { stage: { in: [...ACTIVE_STAGES] } }, include: { sponsorCompany: { include: { contacts: { where: { departedAt: null }, select: { firstName: true, lastName: true, email: true } } } } }, orderBy: { updatedAt: "desc" } });
  const enriched: { deal: string; filled: string[] }[] = [];
  let checked = 0;
  for (const deal of deals) {
    if (enriched.length >= max) break;
    const terms = [deal.sponsorName, deal.sponsorCompany?.name, deal.sponsorCompany?.domain, ...(deal.sponsorCompany?.contacts ?? []).flatMap((c) => [[c.firstName, c.lastName].filter(Boolean).join(" "), c.email ?? ""])].filter((x): x is string => Boolean(x && x.length > 3));
  const phrases = [deal.propertyName].filter((x): x is string => Boolean(x && x.length > 3));
    if (!terms.length) continue;
    checked++;
    const since = deal.callsEnrichedAt ?? deal.createdAt;
    const fresh = (await findCalls(terms, transcripts, { phrases }).catch(() => [])).filter((c) => c.date > since);
    if (!fresh.length) continue;
    const r = await enrichFromCalls(deal.id, transcripts).catch(() => null);
    if (r) enriched.push({ deal: deal.propertyName ?? deal.name, filled: r.filled ?? [] });
  }
  return { checked, enriched };
}
