import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { graph, type GraphAttachment } from "@/lib/graph";
import { ACTIVE_STAGES } from "@/lib/taxonomy";
import { CHECKLIST, parseDetails, reconcileDocuments } from "@/lib/checklist";

/**
 * A deal keeps learning. Every email about it that reaches deals@ after the first one is a follow-up:
 * its files join the ticket's Attachments, and whatever the sponsor answered becomes Q&A facts on the ticket,
 * which the CRM later uses to answer LP questions. Nothing here creates a second ticket.
 */

const q = (s: string) => encodeURIComponent(s);
const IMAGE = /\.(png|jpe?g|gif|bmp|svg|webp)$/i;
export { STOP, words } from "@/lib/deal-match";
import { words } from "@/lib/deal-match";
import { stripDashes } from "@/lib/style";

const SameDeal = z.object({ sameDeal: z.boolean().describe("True only if the email is about this exact deal (same property / same capital raise), not merely a similar deal or the same sponsor."), why: z.string().describe("One short line.") });

/** A word-overlap candidate is only a match once Claude agrees the email is about that very deal. */
async function confirmSameDeal(deal: { name: string; propertyName: string | null; sponsorName: string | null; city: string | null; state: string | null; summary: string | null }, subject: string, senderEmail: string | null | undefined, bodyText: string, attachments: { names: string[]; text: string }): Promise<boolean> {
  if (!process.env.ANTHROPIC_API_KEY) return false;
  try {
    const client = new Anthropic();
    const res = await client.messages.parse({
      model: "claude-sonnet-5",
      max_tokens: 200,
      system: "You keep a real estate capital advisor's deal board free of duplicates and mis-filed emails. Decide whether an incoming email is about the SAME deal as an existing ticket. Same deal means the same property or the same specific capital raise. A different property, a different sponsor's deal, a fund blast, or a deal that merely shares an asset class, tenant type, or market is NOT the same deal. The subject line is often stale (a reply on an old thread, a forward under an old subject): the attachments (their names and contents) and the body decide. A sponsor sending a new property on an old thread is a NEW deal.",
      messages: [{ role: "user", content: ["EXISTING TICKET", `Name: ${deal.propertyName ?? deal.name}`, `Sponsor: ${deal.sponsorName ?? "unknown"}`, `Location: ${[deal.city, deal.state].filter(Boolean).join(", ") || "unknown"}`, `Notes: ${deal.summary ?? ""}`, "", "INCOMING EMAIL", `Subject: ${subject}`, `From: ${senderEmail ?? ""}`, bodyText.slice(0, 5000), "", `ATTACHMENTS: ${attachments.names.join(" | ") || "(none)"}`, attachments.text.slice(0, 3000)].join("\n") }],
      output_config: { format: zodOutputFormat(SameDeal) },
    });
    return res.parsed_output?.sameDeal === true;
  } catch {
    return false;
  }
}

/** Which existing active deal an incoming deals@ email belongs to, if any. */
export async function matchExistingDeal(opts: { conversationId?: string | null; subject: string; bodyText: string; senderEmail?: string | null; attachmentNames?: string[]; attachmentText?: string }): Promise<string | null> {
  if (opts.conversationId) {
    const byThread = await prisma.dealEmail.findFirst({ where: { conversationId: opts.conversationId }, orderBy: { receivedAt: "desc" }, include: { deal: { select: { name: true, propertyName: true, sponsorName: true, city: true, state: true, summary: true } } } });
    if (byThread) {
      // same thread, but a sponsor sometimes sends the next property on the old thread: with documents attached, check
      if (!opts.attachmentNames?.length) return byThread.dealId;
      if (await confirmSameDeal(byThread.deal, opts.subject, opts.senderEmail, opts.bodyText, { names: opts.attachmentNames, text: opts.attachmentText ?? "" })) return byThread.dealId;
    }
  }
  const deals = await prisma.deal.findMany({ where: { stage: { in: [...ACTIVE_STAGES] } }, select: { id: true, name: true, propertyName: true, sponsorName: true, city: true, state: true, summary: true, sponsorCompanyId: true, sponsorCompany: { select: { domain: true } } } });
  const subj = opts.subject.toLowerCase();
  const head = opts.bodyText.slice(0, 1500).toLowerCase();
  const senderDomain = opts.senderEmail?.split("@")[1]?.toLowerCase();
  const scored: { deal: (typeof deals)[number]; score: number }[] = [];
  for (const d of deals) {
    const ws = words(d.propertyName ?? d.name);
    if (!ws.length) continue;
    const inSubject = ws.filter((w) => subj.includes(w)).length;
    const inBody = ws.filter((w) => head.includes(w)).length;
    // the deal's own name has to be substantially present (all of a short name, most of a long one),
    // not just its city, its sponsor, or a generic word or two
    const hit = Math.max(inSubject, inBody);
    if (hit === 0 || hit < Math.ceil(ws.length * 0.6)) continue;
    let score = inSubject * 2 + inBody;
    if (d.city && (subj.includes(d.city.toLowerCase()) || head.includes(d.city.toLowerCase()))) score += 1;
    if (senderDomain && d.sponsorCompany?.domain === senderDomain) score += 2;
    if (score >= 2) scored.push({ deal: d, score });
  }
  scored.sort((a, b) => b.score - a.score);
  // words can lie ("grocery anchored", "value-add"): the top candidates have to survive a same-deal check
  for (const { deal } of scored.slice(0, 3)) {
    if (await confirmSameDeal(deal, opts.subject, opts.senderEmail, opts.bodyText, { names: opts.attachmentNames ?? [], text: opts.attachmentText ?? "" })) return deal.id;
  }
  return null;
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

/** Files pulled from a Drive / Dropbox / OneDrive link in the email join the ticket like attachments (bytes re-fetched from the link when needed). */
export async function recordLinkFiles(dealId: string, messageKey: string, files: { name: string; contentType: string | null; size: number; url: string; source: string }[], fromEmail: string | null, receivedAt: Date) {
  let n = 0;
  for (const f of files) {
    const attachmentId = `link:${f.url}`.slice(0, 900);
    await prisma.dealFile.upsert({ where: { graphId_attachmentId: { graphId: messageKey, attachmentId } }, create: { dealId, name: f.name, size: f.size, contentType: f.contentType, mailbox: "link", graphId: messageKey, attachmentId, url: f.url, fromEmail, receivedAt }, update: { dealId, url: f.url } });
    n++;
  }
  return n;
}

const Facts = z.object({
  facts: z.array(z.object({ question: z.string().describe("The question this answers, phrased the way an investor would ask it, e.g. 'What are the Class A sale comps in suburban Indianapolis?'"), answer: z.string().describe("The sponsor's answer, concrete, 1-3 sentences, with numbers where given."), asked: z.boolean().describe("True only if this answers a question that was actually put to the sponsor: an item RJL requested (checklist, follow-up), a question an investor asked that RJL relayed, or a question asked on a call. False for information the sponsor volunteered or that comes from an OM, deck or model.") })).describe("Every substantive piece of information the sponsor provided in this email and its attachments. Empty if nothing new."),
});

/** Turn a follow-up email (plus attachment text) into Q&A facts on the deal. Returns how many were added. */
export async function extractDealFacts(dealId: string, text: string, source: string, opts: { mayEnterFaq?: boolean } = {}): Promise<number> {
  if (!process.env.ANTHROPIC_API_KEY || text.trim().length < 20) return 0;
  const deal = await prisma.deal.findUnique({ where: { id: dealId }, include: { facts: { orderBy: { createdAt: "desc" }, take: 60 } } });
  if (!deal) return 0;
  const client = new Anthropic();
  const known = deal.facts.map((f) => `Q: ${f.question}\nA: ${f.answer}`).join("\n");
  const res = await client.messages.parse({
    model: "claude-sonnet-5",
    max_tokens: 2500,
    system: `A deal sponsor sent RJL Capital Advisors (a real estate capital advisor) more information about a deal they are raising capital for. Extract the information as question/answer pairs so the team can answer investors later; these pairs go into an Investor FAQ that ANY investor may receive. Cover what is substantive and general to the deal: the property, market, business plan, numbers, comps, capital structure, returns, timeline, sponsor track record, answers to earlier questions about the deal. Leave out anything that was private to one conversation or one counterparty: other or prior offerings the sponsor mentioned, what a particular investor said or asked, terms or concessions offered to one party, negotiation back-and-forth, opinions about people, internal or personal remarks. Do not repeat facts already known (listed) unless the new email updates them. Skip pleasantries. NEVER record anything about which investors, LPs, equity groups or capital sources RJL is or was approaching, which groups the sponsor knows or has relationships with, or the engagement list of groups: other investors read these pairs. Investor groups named in an engagement discussion are equity investors, never lenders. No dashes as punctuation. Never produce process or status questions (what is the status, has the sponsor sent X, when did RJL receive it); only substance about the property, market, plan, numbers, structure and timeline.`,
    messages: [{ role: "user", content: `Deal: ${deal.propertyName ?? deal.name}\nSponsor: ${deal.sponsorName ?? ""}\n\nALREADY KNOWN:\n${known || "(nothing yet)"}\n\nNEW EMAIL (${source}):\n${text.slice(0, 60000)}` }],
    output_config: { format: zodOutputFormat(Facts) },
  });
  // belt and braces: nothing that names an investor group on this deal's report or engagement list
  const dd = parseDetails(deal.details) as Record<string, unknown>;
  const groupNames = [...new Set([...((dd.engagementGroups as string[] | undefined) ?? []), ...((dd.agreedGroups as string[] | undefined) ?? []), ...(await prisma.dealInvestor.findMany({ where: { dealId }, select: { contact: { select: { company: { select: { name: true } } } } } })).map((r) => r.contact.company?.name ?? "")])].filter((n) => n.length > 3);
  const namesGroup = (t: string) => groupNames.some((g) => { const w = g.toLowerCase().split(/[^a-z0-9]+/).find((x) => x.length >= 5 && !/capital|partners|group|investments|realty|equity|management|advisors|holdings|financial|property|properties/.test(x)); return w ? t.toLowerCase().includes(w) : t.toLowerCase().includes(g.toLowerCase()); });
  const facts = (res.parsed_output?.facts ?? []).filter((f) => !namesGroup(`${f.question} ${f.answer}`) && !/\b(LPs?|investor groups?|equity groups?|capital (?:sources?|groups?)|groups? (?:we|RJL))\b[^.]{0,80}\b(approach|talking|speaking|relationship|know|introduc|list)/i.test(`${f.question} ${f.answer}`));
  if (facts.length) await prisma.dealFact.createMany({ data: facts.map((f) => ({ dealId, question: stripDashes(f.question).slice(0, 500), answer: stripDashes(f.answer).slice(0, 2000), source, inFaq: Boolean(opts.mayEnterFaq && f.asked) })) });
  return facts.length;
}

/** Fill blanks on the ticket from a follow-up: checklist items and core fields the extractor can see. */
export async function mergeIntoDeal(dealId: string, rawText: string, subject: string, opts: { modelAttached?: boolean } = {}) {
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
  // numbers from a freshly attached Excel model replace what an OM or deck said earlier; everything else only fills blanks
  const NUMERIC_FROM_MODEL = new Set(["purchasePrice", "totalCapitalization", "totalDebt", "requestedAmount", "totalEquity", "ltv", "ltc", "irr", "equityMultiple", "yieldOnCost", "capRateT12", "capRateY1", "cashOnCash", "units", "squareFeet", "occupancy"]);
  const maybe = (k: keyof typeof deal, v: unknown) => {
    if (opts.modelAttached && NUMERIC_FROM_MODEL.has(k as string) && v != null && v !== "" && deal[k] !== v) {
      core[k as string] = v;
      filled++;
      return;
    }
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
  const fileNames = (await prisma.dealFile.findMany({ where: { dealId }, select: { name: true } })).map((f) => f.name);
  const reconciled = reconcileDocuments(details as Record<string, string | null | undefined>, fileNames);
  await prisma.deal.update({ where: { id: dealId }, data: { ...core, details: JSON.stringify(reconciled) } });
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

const Split = z.object({
  deals: z.array(z.object({
    name: z.string().describe("Property or deal name, e.g. 'Westwind Apartments'."),
    attachments: z.array(z.string()).describe("File names (exactly as listed) that belong to this deal. A file that clearly covers all deals can appear under each."),
    hint: z.string().describe("One line that identifies this deal in the email body (location, size, asset), so the extractor can focus on it."),
  })).describe("One entry per distinct deal in the email. A single deal with several files is ONE entry. Empty if the email is not about any deal."),
});

/**
 * Some forwards carry several deals at once (two OMs, a portfolio split into separate opportunities). Each needs
 * its own ticket, so we first ask how many there are and which files belong to which.
 */
export async function detectMultipleDeals(bodyText: string, attachmentNames: string[], attachmentTexts: { name: string; text: string }[]): Promise<{ name: string; attachments: string[]; hint: string }[]> {
  if (!process.env.ANTHROPIC_API_KEY) return [];
  const client = new Anthropic();
  const peek = attachmentTexts.map((a) => `=== ${a.name} ===\n${a.text.slice(0, attachmentTexts.length > 12 ? 600 : 1500)}`).join("\n\n");
  const res = await client.messages.parse({
    model: "claude-sonnet-5",
    max_tokens: 2000,
    system: "You triage emails sent to a real estate capital advisor's deal inbox. Decide how many DISTINCT deals (separate properties or separately-capitalized opportunities) the email presents. Most emails present exactly one deal, often with several files (OM, model, comps) that all belong to it: that is one entry. Only split when the email clearly offers separate deals (different properties, each with its own ask). Assign every listed file to the deal it belongs to.",
    messages: [{ role: "user", content: `EMAIL BODY:\n${bodyText.slice(0, 6000)}\n\nATTACHMENTS: ${attachmentNames.join(" | ") || "(none)"}\n\nFIRST LINES OF EACH ATTACHMENT:\n${peek.slice(0, 40000)}` }],
    output_config: { format: zodOutputFormat(Split) },
  });
  return res.parsed_output?.deals ?? [];
}

const normName = (s: string) => s.toLowerCase().replace(/(.*?)/g, "").replace(/[^a-z0-9 ]/g, " ").replace(/(the|apartments|apartment|portfolio|deal|llc)/g, "").replace(/s+/g, " ").trim();

/** Rule: one deal, one ticket. An active deal with the same (normalized) name is the same deal. */
export async function findSameDeal(propertyName: string | null | undefined, excludeId?: string): Promise<{ id: string; name: string } | null> {
  const key = normName(propertyName ?? "");
  if (key.length < 4) return null;
  const deals = await prisma.deal.findMany({ where: { stage: { notIn: ["Deal Lost", "Deal Closed"] }, ...(excludeId ? { id: { not: excludeId } } : {}) }, select: { id: true, name: true, propertyName: true } });
  return deals.find((d) => normName(d.propertyName ?? d.name) === key) ?? null;
}
