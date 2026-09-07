import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { ASSET_CLASSES, CHECK_SIZES, CLOSING_TIMEFRAMES, HOLD_PERIODS, INVESTMENT_TYPES, RETURN_PROFILES, VINTAGES, normalizeGeographies, parseList, toJson } from "@/lib/taxonomy";

/**
 * Investor criteria proposals. When an investor tells us something about what they do (an email
 * reply, a tracker note, a Fireflies call), compare it with the criteria on file and, if it
 * disagrees, queue a correction for Jonathan to approve on the To-do page. Nothing is written to
 * the criteria until he clicks Approve.
 */

export const PROPOSAL_FIELDS = {
  checkSizes: { label: "Check size", list: true, allowed: CHECK_SIZES },
  geographyNotes: { label: "Deal locations", list: false, allowed: null },
  assetClasses: { label: "Asset classes", list: true, allowed: ASSET_CLASSES },
  investmentTypes: { label: "Position in the capital stack", list: true, allowed: INVESTMENT_TYPES },
  strategy: { label: "Development / acquisitions", list: false, allowed: ["Development", "Acquisitions", "Both"] },
  returnProfile: { label: "Return profile", list: true, allowed: RETURN_PROFILES },
  holdPeriods: { label: "Hold period", list: true, allowed: HOLD_PERIODS },
  vintages: { label: "Vintages", list: true, allowed: VINTAGES },
  closingTimeframe: { label: "Closing time frame", list: false, allowed: CLOSING_TIMEFRAMES },
  ozInterest: { label: "Opportunity Zone interest", list: false, allowed: ["Yes", "No"] },
  openToMinority: { label: "Open to minority position", list: false, allowed: ["Yes", "No"] },
  otherInfo: { label: "Other info", list: false, allowed: null },
} as const;
export type ProposalField = keyof typeof PROPOSAL_FIELDS;
export type Change = { field: ProposalField; from: string; to: string; evidence: string };

const Out = z.object({
  summary: z.string().describe("One sentence: what the investor said that changes their criteria. Empty if nothing changes."),
  changes: z.array(
    z.object({
      field: z.enum(Object.keys(PROPOSAL_FIELDS) as [ProposalField, ...ProposalField[]]),
      to: z.string().describe("The corrected value. For list fields, a comma-separated list of the allowed values that should be on file AFTER the change (the full list, not just additions). For Yes/No fields 'Yes' or 'No'. For free-text fields the corrected text."),
      evidence: z.string().describe("Short quote or close paraphrase of what they said that supports this."),
    }),
  ),
});

const SYSTEM = `You keep investor criteria accurate for a real estate capital advisory CRM. You get (1) the criteria currently on file for one investor and (2) something that investor just communicated (an email reply, a call note, or a transcript). Propose corrections ONLY where the communication clearly contradicts or clearly adds to what is on file about the investor's own program: minimum or typical check size, target markets, asset classes, type of investment (senior debt, mezz, pref, JV, co-GP), development vs acquisitions, return profile, hold period, vintages, closing speed, opportunity zones, minority positions. Be conservative. A pass on one specific deal, a preference between two deals, timing ("between funds right now"), or a comment about a deal's pricing is NOT a criteria change. Only propose when they state a standing rule about their program ("we don't do retail", "we need $20MM minimum", "Kansas isn't a market for us", "we only do acquisitions", "no spec industrial"). Use otherInfo only for a durable program rule that fits no other field (e.g. "Won't do programmatic ventures"), never for deal commentary or temporary status. Map check sizes to the allowed buckets covering what they said (e.g. "$20MM minimum" -> $20-30MM, $30-50MM, $50-100MM, $100MM+ ; keep any current buckets at or above the minimum, drop those below). Use the allowed values exactly. If nothing changes, return an empty changes list.`;

const current = (c: Record<string, unknown> | null, f: ProposalField): string => {
  if (!c) return "";
  const v = c[f];
  if (PROPOSAL_FIELDS[f].list) return parseList(v as string).join(", ");
  if (typeof v === "boolean") return v ? "Yes" : "No";
  return (v as string | null) ?? "";
};

const canon = (f: ProposalField, to: string): string => {
  const spec = PROPOSAL_FIELDS[f];
  if (!spec.allowed) return to.trim();
  const allowed = spec.allowed as readonly string[];
  const pick = (x: string) => allowed.find((a) => a.toLowerCase() === x.trim().toLowerCase());
  if (spec.list) return [...new Set(to.split(/[,;]/).map(pick).filter(Boolean) as string[])].join(", ");
  return pick(to) ?? "";
};

export async function proposeCriteriaChanges(opts: { companyId: string; contactId?: string | null; text: string; source: "EMAIL" | "FIREFLIES" | "NOTE" | "MANUAL"; sourceRef?: string | null }) {
  if (!process.env.ANTHROPIC_API_KEY || !opts.text.trim()) return null;
  const co = await prisma.company.findUnique({ where: { id: opts.companyId }, include: { criteria: true } });
  if (!co) return null;
  const roles = parseList(co.roles);
  if (!roles.some((r) => r === "Investor" || r === "Retail Investor" || r === "Lender")) return null;
  const crit = (co.criteria ?? null) as Record<string, unknown> | null;
  const onFile = (Object.keys(PROPOSAL_FIELDS) as ProposalField[]).map((f) => `${PROPOSAL_FIELDS[f].label}: ${current(crit, f) || "(blank)"}`).join("\n");
  const allowed = (Object.keys(PROPOSAL_FIELDS) as ProposalField[]).filter((f) => PROPOSAL_FIELDS[f].allowed).map((f) => `${f}: ${(PROPOSAL_FIELDS[f].allowed as readonly string[]).join(" | ")}`).join("\n");

  const client = new Anthropic();
  const res = await client.messages.parse({
    model: "claude-opus-5",
    max_tokens: 1500,
    system: SYSTEM,
    messages: [{ role: "user", content: `Investor: ${co.name}\n\nCriteria on file:\n${onFile}\n\nAllowed values:\n${allowed}\n\nWhat they communicated (${opts.source.toLowerCase()}):\n${opts.text.slice(0, 12000)}` }],
    output_config: { format: zodOutputFormat(Out) },
  });
  const out = res.parsed_output;
  if (!out) return null;

  const changes: Change[] = [];
  for (const ch of out.changes) {
    const to = canon(ch.field, ch.to);
    const from = current(crit, ch.field);
    if (!to || to === from) continue;
    changes.push({ field: ch.field, from, to, evidence: ch.evidence });
  }
  if (!changes.length) return null;

  // one open proposal per company; fold new changes into it rather than piling up cards
  const pending = await prisma.criteriaProposal.findFirst({ where: { companyId: co.id, status: "PENDING" } });
  if (pending) {
    const existing = JSON.parse(pending.changes) as Change[];
    const merged = [...existing.filter((e) => !changes.some((c) => c.field === e.field)), ...changes];
    return prisma.criteriaProposal.update({ where: { id: pending.id }, data: { changes: toJson(merged as unknown as string[]), summary: out.summary || pending.summary, source: opts.source, sourceRef: opts.sourceRef ?? pending.sourceRef, contactId: opts.contactId ?? pending.contactId } });
  }
  return prisma.criteriaProposal.create({ data: { source: opts.source, sourceRef: opts.sourceRef ?? null, companyId: co.id, contactId: opts.contactId ?? null, summary: out.summary || `${co.name} clarified their criteria`, changes: JSON.stringify(changes) } });
}

/** Write an approved proposal onto the company's criteria. */
export async function applyProposal(id: string, onlyFields?: ProposalField[]) {
  const p = await prisma.criteriaProposal.findUnique({ where: { id } });
  if (!p || !p.companyId) return;
  const changes = (JSON.parse(p.changes) as Change[]).filter((c) => !onlyFields || onlyFields.includes(c.field));
  const data: Record<string, unknown> = {};
  for (const c of changes) {
    const spec = PROPOSAL_FIELDS[c.field];
    if (c.field === "ozInterest" || c.field === "openToMinority") data[c.field] = c.to === "Yes";
    else if (spec.list) data[c.field] = toJson(c.to.split(",").map((x) => x.trim()).filter(Boolean));
    else data[c.field] = c.to;
    if (c.field === "geographyNotes") data.geographies = toJson(normalizeGeographies(c.to));
  }
  await prisma.investorCriteria.upsert({ where: { companyId: p.companyId }, create: { companyId: p.companyId, ...data }, update: data });
  await prisma.criteriaProposal.update({ where: { id }, data: { status: "APPROVED", reviewedAt: new Date() } });
}

export async function rejectProposal(id: string) {
  await prisma.criteriaProposal.update({ where: { id }, data: { status: "REJECTED", reviewedAt: new Date() } });
}

/**
 * A teammate edited criteria on a company page. Instead of writing it, turn the difference into a
 * proposal for Jonathan to approve on Home. `data` is the criteriaData() shape from the form.
 */
export async function proposeManualChanges(companyId: string, data: Record<string, unknown>, byName: string) {
  const co = await prisma.company.findUnique({ where: { id: companyId }, include: { criteria: true } });
  if (!co) return null;
  const crit = (co.criteria ?? null) as Record<string, unknown> | null;
  const changes: Change[] = [];
  for (const f of Object.keys(PROPOSAL_FIELDS) as ProposalField[]) {
    if (!(f in data)) continue;
    const v = data[f];
    let to: string;
    if (PROPOSAL_FIELDS[f].list) to = parseList(v as string).join(", ");
    else if (typeof v === "boolean") to = v ? "Yes" : "No";
    else to = ((v as string | null) ?? "").trim();
    const from = current(crit, f);
    if (to === from) continue;
    changes.push({ field: f, from, to, evidence: `Edited by ${byName} on the company page` });
  }
  if (!changes.length) return null;
  const pending = await prisma.criteriaProposal.findFirst({ where: { companyId, status: "PENDING" } });
  if (pending) {
    const existing = JSON.parse(pending.changes) as Change[];
    const merged = [...existing.filter((e) => !changes.some((c) => c.field === e.field)), ...changes];
    return prisma.criteriaProposal.update({ where: { id: pending.id }, data: { changes: JSON.stringify(merged), summary: `${byName} proposed criteria changes`, source: "MANUAL", sourceRef: byName } });
  }
  return prisma.criteriaProposal.create({ data: { source: "MANUAL", sourceRef: byName, companyId, summary: `${byName} proposed criteria changes`, changes: JSON.stringify(changes) } });
}
