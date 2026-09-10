import Anthropic from "@anthropic-ai/sdk";
import { prisma } from "@/lib/db";
import { IL_SYSTEM, IL_TOOLS, runIl } from "@/lib/ask-israel";
import { ACTIVE_STAGES, parseList } from "@/lib/taxonomy";
import { investorLabel, statusOf } from "@/lib/tracker";
import { missingFor, itemLabel } from "@/lib/checklist";
import { listMomentum } from "@/lib/momentum";
import { quietIntros } from "@/lib/intros";
import { stripDashes } from "@/lib/style";

/**
 * "Ask the CRM": one chat box over everything the company has put into the CRM. Claude answers from real rows
 * through read-only lookups (deals, tickets, progress reports, companies and their criteria, contacts, the
 * email log, the Dashboard), and links every answer back to the pages it drew on. It never writes: roles and
 * criteria stay Jonathan's, and any change someone asks for is described as something to do in the CRM.
 */

export type ChatMessage = { role: "user" | "assistant"; content: string };
export type AskResult = { answer: string; lookups: string[] };

const MAX_TURNS = 8;
const fmtMoney = (n: number | null | undefined) => (n == null ? null : n >= 1_000_000 ? `$${(n / 1_000_000).toFixed(n % 1_000_000 ? 1 : 0)}MM` : `$${Math.round(n).toLocaleString("en-US")}`);
const day = (d: Date | null | undefined) => (d ? d.toISOString().slice(0, 10) : null);
const clip = (s: unknown, n = 12_000) => {
  const t = typeof s === "string" ? s : JSON.stringify(s);
  return t.length > n ? t.slice(0, n) + "\n…(truncated)" : t;
};
const ci = "insensitive" as const;

// ---------- the lookups ----------
const TOOLS: Anthropic.Tool[] = [
  {
    name: "search_deals",
    description: "Find deals (tickets) by any words in their name, property, sponsor or city, optionally by stage. Returns id, name, stage, sponsor, location, asset class, ask, last update. Use get_deal for details.",
    input_schema: { type: "object", properties: { query: { type: "string", description: "Words to match (name, property, sponsor, city). Empty for all active deals." }, stage: { type: "string", description: "Exact stage name, e.g. 'Deal Taken To Market'. Optional." }, includeClosed: { type: "boolean", description: "Include Deal Closed / Deal Lost. Default false." }, limit: { type: "number" } } },
  },
  {
    name: "get_deal",
    description: "Everything on one deal ticket: fields, business plan, sponsor, checklist items still missing, files on hand, Questions answered (sponsor Q&A), progress report summary, recent emails.",
    input_schema: { type: "object", properties: { dealId: { type: "string" } }, required: ["dealId"] },
  },
  {
    name: "get_progress_report",
    description: "The progress report for a deal: every firm with its status and notes, plus the feedback themes and items needed from the sponsor.",
    input_schema: { type: "object", properties: { dealId: { type: "string" } }, required: ["dealId"] },
  },
  {
    name: "search_companies",
    description: "Find companies (investors, sponsors, lenders, brokers) by name or domain, optionally by role. Returns id, name, roles, domain, location and a one-line criteria summary for investors.",
    input_schema: { type: "object", properties: { query: { type: "string" }, role: { type: "string", description: "Investor | Sponsor | Lender | Broker (optional)" }, limit: { type: "number" } } },
  },
  {
    name: "get_company",
    description: "One company in full: roles, investor criteria (check size, asset classes, markets, capital stack, strategy, returns, hold, vintages), contacts (with title, whether they left), deals they sponsor, every progress-report row they appear on across deals (status + notes), recent emails.",
    input_schema: { type: "object", properties: { companyId: { type: "string" } }, required: ["companyId"] },
  },
  {
    name: "search_contacts",
    description: "Find people by name or email. Returns id, name, email, title, company, whether they have left.",
    input_schema: { type: "object", properties: { query: { type: "string" }, limit: { type: "number" } }, required: ["query"] },
  },
  {
    name: "email_log",
    description: "Emails logged with a deal, a company or a contact (subject, direction, date, who, preview). Use for 'what did X say', 'when did we last talk to Y'.",
    input_schema: { type: "object", properties: { dealId: { type: "string" }, companyId: { type: "string" }, contactId: { type: "string" }, days: { type: "number", description: "Look-back window, default 90" }, limit: { type: "number" } } },
  },
  {
    name: "find_investors_for",
    description: "Investor companies whose criteria fit a deal (asset class, check size, strategy, capital stack), with their history on past deals. Give a dealId, or describe the spec.",
    input_schema: { type: "object", properties: { dealId: { type: "string" }, assetClass: { type: "string" }, checkMM: { type: "number" }, strategy: { type: "string" }, investmentType: { type: "string" }, limit: { type: "number" } } },
  },
  {
    name: "dashboard",
    description: "What the Dashboard shows right now: quiet LP follow-ups, deal momentum items (sponsor items, LP requests, engagement letters), intros to reconsider, ready for launch (signed deals and progress reports due), pending data updates.",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "pipeline_summary",
    description: "Counts of active deals by stage and by owner, and the newest tickets.",
    input_schema: { type: "object", properties: {} },
  },
];

async function run(name: string, input: Record<string, unknown>): Promise<unknown> {
  const lim = Math.min(Number(input.limit ?? 25), 60);
  switch (name) {
    case "search_deals": {
      const q = String(input.query ?? "").trim();
      const stages = input.includeClosed ? undefined : { in: [...ACTIVE_STAGES] };
      const deals = await prisma.deal.findMany({
        where: { ...(stages ? { stage: stages } : {}), ...(input.stage ? { stage: String(input.stage) } : {}), ...(q ? { OR: [{ name: { contains: q, mode: ci } }, { propertyName: { contains: q, mode: ci } }, { sponsorName: { contains: q, mode: ci } }, { city: { contains: q, mode: ci } }] } : {}) },
        orderBy: { updatedAt: "desc" },
        take: lim,
        include: { owner: { select: { name: true } }, _count: { select: { investors: true, files: true } } },
      });
      return deals.map((d) => ({ id: d.id, link: `/deals/${d.id}`, name: d.name, property: d.propertyName, stage: d.stage, sponsor: d.sponsorName, location: [d.city, d.state].filter(Boolean).join(", "), assetClass: d.assetClass, strategy: d.strategy, ask: fmtMoney(d.requestedAmount), owner: d.owner?.name, firmsOnReport: d._count.investors, files: d._count.files, updated: day(d.updatedAt) }));
    }
    case "get_deal": {
      const d = await prisma.deal.findUnique({ where: { id: String(input.dealId) }, include: { owner: true, sponsorCompany: { include: { contacts: { where: { departedAt: null, email: { not: null } }, take: 8 } } }, files: { orderBy: { receivedAt: "desc" } }, facts: { orderBy: { createdAt: "asc" } }, investors: true, activities: { where: { type: "EMAIL" }, orderBy: { occurredAt: "desc" }, take: 12, include: { contact: { include: { company: true } } } } } });
      if (!d) return { error: "no such deal" };
      const counts: Record<string, number> = {};
      for (const r of d.investors) counts[statusOf(r.status).short] = (counts[statusOf(r.status).short] ?? 0) + 1;
      const details = JSON.parse(d.details || "{}") as Record<string, unknown>;
      delete details.sendState;
      return {
        id: d.id, link: `/deals/${d.id}`, reportLink: `/deals/${d.id}/tracker`, name: d.name, property: d.propertyName, stage: d.stage, owner: d.owner?.name,
        sponsor: { name: d.sponsorName, companyId: d.sponsorCompanyId, link: d.sponsorCompanyId ? `/companies/${d.sponsorCompanyId}` : null, contacts: d.sponsorCompany?.contacts.map((c) => ({ id: c.id, name: [c.firstName, c.lastName].filter(Boolean).join(" "), email: c.email, title: c.title })) },
        location: { address: d.propertyAddress, city: d.city, state: d.state }, assetClass: d.assetClass, strategy: d.strategy, requestType: d.requestType, executionType: d.executionType,
        numbers: { ask: fmtMoney(d.requestedAmount), purchasePrice: fmtMoney(d.purchasePrice), totalCapitalization: fmtMoney(d.totalCapitalization), totalDebt: fmtMoney(d.totalDebt), ltv: d.ltv, ltc: d.ltc, units: d.units, squareFeet: d.squareFeet, yearBuilt: d.yearBuilt, occupancy: d.occupancy, irr: d.irr, equityMultiple: d.equityMultiple, capRateT12: d.capRateT12, capRateY1: d.capRateY1, yieldOnCost: d.yieldOnCost, holdPeriod: d.holdPeriod, loanTerm: d.loanTerm, interestRate: d.interestRate, lenderType: d.lenderType, expectedClose: d.expectedClose },
        businessPlan: d.summary, sponsorBackground: d.sponsorExperience, checklistDetails: details,
        stillMissing: missingFor(d).map((it) => itemLabel(it, d.strategy)),
        files: d.files.map((f) => ({ name: f.name, received: day(f.receivedAt), from: f.fromEmail })),
        questionsAnswered: d.facts.map((f) => ({ q: f.question, a: f.answer, source: f.source, onInvestorFaq: f.inFaq })),
        progressReport: { firms: d.investors.length, byStatus: counts },
        recentEmails: d.activities.map((a) => ({ date: day(a.occurredAt), direction: a.direction, subject: a.subject, with: a.contact ? `${[a.contact.firstName, a.contact.lastName].filter(Boolean).join(" ")} (${a.contact.company?.name ?? ""})` : null, preview: (a.body ?? "").slice(0, 200) })),
        closedLostReason: d.closedLostReason, closedWonReason: d.closedWonReason,
      };
    }
    case "get_progress_report": {
      const d = await prisma.deal.findUnique({ where: { id: String(input.dealId) }, include: { investors: { include: { contact: { include: { company: true } } }, orderBy: { status: "desc" } } } });
      if (!d) return { error: "no such deal" };
      return {
        deal: d.name, link: `/deals/${d.id}/tracker`, preparedFor: d.trackerPreparedFor ?? d.sponsorName,
        themes: (d.trackerThemes ?? "").split(/\n+/).filter(Boolean), itemsNeeded: (d.trackerItemsNote ?? "").split(/\n+/).filter(Boolean),
        rows: d.investors.map((r) => ({ firm: investorLabel(r.contact), companyId: r.contact.companyId, companyLink: r.contact.companyId ? `/companies/${r.contact.companyId}` : null, person: [r.contact.firstName, r.contact.lastName].filter(Boolean).join(" "), status: statusOf(r.status).label, note: r.note, updated: day(r.updatedAt) })),
      };
    }
    case "search_companies": {
      const q = String(input.query ?? "").trim();
      const cos = await prisma.company.findMany({ where: { ...(q ? { OR: [{ name: { contains: q, mode: ci } }, { domain: { contains: q, mode: ci } }] } : {}), ...(input.role ? { roles: { contains: String(input.role) } } : {}) }, take: lim, orderBy: { lastActivityAt: "desc" }, include: { criteria: true, _count: { select: { contacts: true } } } });
      return cos.map((c) => ({ id: c.id, link: `/companies/${c.id}`, name: c.name, roles: parseList(c.roles), domain: c.domain, location: [c.city, c.state].filter(Boolean).join(", "), contacts: c._count.contacts, lastActivity: day(c.lastActivityAt), criteria: c.criteria ? { checks: parseList(c.criteria.checkSizes), assetClasses: parseList(c.criteria.assetClasses), capitalStack: parseList(c.criteria.investmentTypes), strategy: c.criteria.strategy, markets: c.criteria.geographyNotes } : null }));
    }
    case "get_company": {
      const c = await prisma.company.findUnique({ where: { id: String(input.companyId) }, include: { criteria: true, contacts: { orderBy: { lastActivityAt: "desc" } }, deals: { select: { id: true, name: true, stage: true }, orderBy: { updatedAt: "desc" } }, activities: { where: { type: "EMAIL" }, orderBy: { occurredAt: "desc" }, take: 15, include: { contact: true, deal: { select: { id: true, name: true } } } } } });
      if (!c) return { error: "no such company" };
      const rows = await prisma.dealInvestor.findMany({ where: { contact: { companyId: c.id } }, include: { deal: { select: { id: true, name: true, stage: true, assetClass: true, city: true, state: true } } }, orderBy: { updatedAt: "desc" }, take: 40 });
      const cr = c.criteria;
      return {
        id: c.id, link: `/companies/${c.id}`, name: c.name, roles: parseList(c.roles), domain: c.domain, website: c.website, location: [c.city, c.state].filter(Boolean).join(", "), description: c.description,
        criteria: cr ? { checkSizes: parseList(cr.checkSizes), checkMinMM: cr.checkMinMM, checkMaxMM: cr.checkMaxMM, assetClasses: parseList(cr.assetClasses), capitalStack: parseList(cr.investmentTypes), strategy: cr.strategy, returnProfile: parseList(cr.returnProfile), holdPeriods: parseList(cr.holdPeriods), vintages: parseList(cr.vintages), markets: cr.geographyNotes, closingTimeframe: cr.closingTimeframe, opportunityZones: cr.ozInterest, openToMinority: cr.openToMinority, otherInfo: cr.otherInfo } : null,
        contacts: c.contacts.map((p) => ({ id: p.id, link: `/contacts/${p.id}`, name: [p.firstName, p.lastName].filter(Boolean).join(" "), email: p.email, title: p.title, phone: p.phone, left: p.departedAt ? day(p.departedAt) : null, lastActivity: day(p.lastActivityAt) })),
        dealsAsSponsor: c.deals.map((d) => ({ id: d.id, link: `/deals/${d.id}`, name: d.name, stage: d.stage })),
        investorHistory: rows.map((r) => ({ deal: r.deal.name, dealId: r.deal.id, link: `/deals/${r.deal.id}/tracker`, dealStage: r.deal.stage, assetClass: r.deal.assetClass, location: [r.deal.city, r.deal.state].filter(Boolean).join(", "), status: statusOf(r.status).label, note: r.note, updated: day(r.updatedAt) })),
        recentEmails: c.activities.map((a) => ({ date: day(a.occurredAt), direction: a.direction, subject: a.subject, person: a.contact ? [a.contact.firstName, a.contact.lastName].filter(Boolean).join(" ") : null, deal: a.deal?.name, preview: (a.body ?? "").slice(0, 200) })),
      };
    }
    case "search_contacts": {
      const q = String(input.query ?? "").trim();
      const parts = q.split(/\s+/).filter(Boolean);
      const people = await prisma.contact.findMany({ where: { OR: [{ email: { contains: q, mode: ci } }, { firstName: { contains: q, mode: ci } }, { lastName: { contains: q, mode: ci } }, ...(parts.length > 1 ? [{ AND: [{ firstName: { contains: parts[0], mode: ci } }, { lastName: { contains: parts[parts.length - 1], mode: ci } }] }] : [])] }, take: lim, include: { company: { select: { id: true, name: true, roles: true } } }, orderBy: { lastActivityAt: "desc" } });
      return people.map((p) => ({ id: p.id, link: `/contacts/${p.id}`, name: [p.firstName, p.lastName].filter(Boolean).join(" "), email: p.email, title: p.title, company: p.company ? { id: p.company.id, name: p.company.name, roles: parseList(p.company.roles) } : null, left: p.departedAt ? day(p.departedAt) : null, lastActivity: day(p.lastActivityAt) }));
    }
    case "email_log": {
      const since = new Date(Date.now() - Number(input.days ?? 90) * 86_400_000);
      const acts = await prisma.activity.findMany({ where: { type: "EMAIL", occurredAt: { gte: since }, ...(input.dealId ? { dealId: String(input.dealId) } : {}), ...(input.companyId ? { companyId: String(input.companyId) } : {}), ...(input.contactId ? { contactId: String(input.contactId) } : {}) }, orderBy: { occurredAt: "desc" }, take: Math.min(lim, 40), include: { contact: { include: { company: true } }, deal: { select: { name: true } } } });
      return acts.map((a) => ({ date: day(a.occurredAt), direction: a.direction, subject: a.subject, person: a.contact ? `${[a.contact.firstName, a.contact.lastName].filter(Boolean).join(" ")} (${a.contact.company?.name ?? ""})` : null, deal: a.deal?.name, preview: (a.body ?? "").slice(0, 240) }));
    }
    case "find_investors_for": {
      let spec = { assetClass: input.assetClass as string | undefined, checkMM: input.checkMM as number | undefined, strategy: input.strategy as string | undefined, investmentType: input.investmentType as string | undefined };
      if (input.dealId) {
        const d = await prisma.deal.findUnique({ where: { id: String(input.dealId) } });
        if (d) spec = { assetClass: d.assetClass ?? spec.assetClass, checkMM: d.requestedAmount ? d.requestedAmount / 1_000_000 : spec.checkMM, strategy: d.strategy ?? spec.strategy, investmentType: d.executionType ?? spec.investmentType };
      }
      const cos = await prisma.company.findMany({ where: { roles: { contains: "Investor" }, criteria: { isNot: null } }, include: { criteria: true }, take: 1500 });
      const fits = cos.filter((c) => {
        const cr = c.criteria!;
        const ac = parseList(cr.assetClasses), it = parseList(cr.investmentTypes);
        if (spec.assetClass && ac.length && !ac.some((x) => x === spec.assetClass || /agnostic/i.test(x))) return false;
        if (spec.strategy && cr.strategy && cr.strategy !== "Both" && cr.strategy !== spec.strategy) return false;
        if (spec.investmentType && it.length && !it.includes(spec.investmentType)) return false;
        if (spec.checkMM && cr.checkMinMM != null && cr.checkMaxMM != null && (spec.checkMM < cr.checkMinMM || spec.checkMM > cr.checkMaxMM)) return false;
        return true;
      });
      const ids = fits.map((c) => c.id);
      const rows = await prisma.dealInvestor.findMany({ where: { contact: { companyId: { in: ids } } }, include: { contact: { select: { companyId: true } }, deal: { select: { name: true } } }, orderBy: { updatedAt: "desc" } });
      const hist = new Map<string, string[]>();
      for (const r of rows) {
        const k = r.contact.companyId!;
        if ((hist.get(k) ?? []).length < 4) hist.set(k, [...(hist.get(k) ?? []), `${r.deal.name}: ${statusOf(r.status).short}`]);
      }
      return { spec, matches: fits.slice(0, Math.min(lim, 60)).map((c) => ({ id: c.id, link: `/companies/${c.id}`, name: c.name, checks: parseList(c.criteria!.checkSizes), assetClasses: parseList(c.criteria!.assetClasses), capitalStack: parseList(c.criteria!.investmentTypes), strategy: c.criteria!.strategy, markets: c.criteria!.geographyNotes, history: hist.get(c.id) ?? [] })), total: fits.length };
    }
    case "dashboard": {
      const since = new Date(Date.now() - 30 * 86_400_000);
      const [quiet, momentum, intros, ready, proposals] = await Promise.all([
        prisma.dealInvestor.findMany({ where: { status: { in: [2, 3] }, updatedAt: { lt: new Date(Date.now() - 5 * 86_400_000) }, deal: { stage: { in: [...ACTIVE_STAGES] } } }, include: { contact: { include: { company: true } }, deal: { select: { name: true, id: true } } }, orderBy: { updatedAt: "asc" }, take: 40 }),
        listMomentum(since),
        quietIntros(),
        prisma.deal.findMany({ where: { stage: "Engagement Letter Signed" }, select: { id: true, name: true } }),
        prisma.criteriaProposal.findMany({ where: { status: "PENDING" }, orderBy: { createdAt: "desc" }, take: 30 }),
      ]);
      return {
        lpFollowUps: quiet.map((r) => ({ deal: r.deal.name, dealLink: `/deals/${r.deal.id}/tracker`, firm: investorLabel(r.contact), status: statusOf(r.status).short, quietSince: day(r.updatedAt) })),
        momentum: momentum.map((m) => ({ kind: m.kind, party: m.party, summary: m.summary, since: day(m.waitingSince), dealId: m.dealId })),
        introsToReconsider: intros.map((i) => ({ subject: i.subject, introducedOn: day(i.introducedAt), replies: i.replies })),
        readyForLaunch: ready.map((d) => ({ name: d.name, link: `/deals/${d.id}/send` })),
        dataUpdatesPending: proposals.map((p) => ({ summary: p.summary, since: day(p.createdAt) })),
      };
    }
    case "pipeline_summary": {
      const deals = await prisma.deal.findMany({ where: { stage: { in: [...ACTIVE_STAGES] } }, select: { id: true, name: true, stage: true, createdAt: true, owner: { select: { name: true } } }, orderBy: { createdAt: "desc" } });
      const byStage: Record<string, number> = {}, byOwner: Record<string, number> = {};
      for (const d of deals) {
        byStage[d.stage] = (byStage[d.stage] ?? 0) + 1;
        byOwner[d.owner?.name ?? "unassigned"] = (byOwner[d.owner?.name ?? "unassigned"] ?? 0) + 1;
      }
      return { active: deals.length, byStage, byOwner, newest: deals.slice(0, 10).map((d) => ({ name: d.name, stage: d.stage, created: day(d.createdAt), link: `/deals/${d.id}` })) };
    }
    default:
      return { error: `unknown tool ${name}` };
  }
}

const SYSTEM = `You are the RJL Capital Advisors CRM assistant. RJL is a real estate capital advisor: sponsors bring deals, RJL takes them to institutional investors (LPs) and lenders, tracks every response on a progress report per deal, and runs the whole pipeline in this CRM.
Answer questions from the CRM's data using the lookups. Always look things up before answering; never guess names, numbers or statuses. When a question is about a deal, start with search_deals then get_deal or get_progress_report; about a firm, search_companies then get_company; about a person, search_contacts.
Write for Jonathan and his team: plain, direct, short. Lead with the answer. Use short bullet lists for several items. Link every deal, company or contact you mention the first time as a markdown link using the "link" paths returned by the lookups, e.g. [Everett Mall Plaza](/deals/abc). Quote notes and email previews briefly when they carry the answer. Dates as "Sep 3". Money as $11MM or $92.45MM. No dashes as punctuation (no em dashes, no " - " between clauses); write plain sentences. No headings unless the answer has several distinct parts.
If the data does not hold the answer, say so plainly and say where it would be found. You cannot change anything: roles and investor criteria are Jonathan's to set, and edits by others become Data updates for him to approve; if asked to change or send something, explain which page does it. Never invent facts.`;

export async function askCrm(history: ChatMessage[], userName: string, workspace: "CA" | "IL" = "CA"): Promise<AskResult> {
  const israel = workspace === "IL";
  const tools = israel ? IL_TOOLS : TOOLS;
  const system = israel ? IL_SYSTEM : SYSTEM;
  const exec = israel ? runIl : run;
  if (!process.env.ANTHROPIC_API_KEY) return { answer: "Claude is not configured on this server.", lookups: [] };
  const client = new Anthropic();
  const messages: Anthropic.MessageParam[] = history.slice(-12).map((m) => ({ role: m.role, content: m.content }));
  const lookups: string[] = [];
  const today = new Date().toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric" });
  for (let turn = 0; turn < MAX_TURNS; turn++) {
    const res = await client.messages.create({ model: "claude-opus-5", max_tokens: 3000, system: `${system}\nToday is ${today}. You are talking with ${userName}.`, tools, messages });
    const toolUses = res.content.filter((b): b is Anthropic.ToolUseBlock => b.type === "tool_use");
    if (res.stop_reason !== "tool_use" || !toolUses.length) {
      const text = res.content.filter((b): b is Anthropic.TextBlock => b.type === "text").map((b) => b.text).join("\n").trim();
      return { answer: stripDashes(text) || "I could not put an answer together. Try asking another way.", lookups };
    }
    messages.push({ role: "assistant", content: res.content });
    const results: Anthropic.ToolResultBlockParam[] = [];
    for (const tu of toolUses) {
      const input = (tu.input ?? {}) as Record<string, unknown>;
      lookups.push(`${tu.name}(${Object.entries(input).map(([k, v]) => `${k}: ${JSON.stringify(v)}`).join(", ")})`);
      let out: unknown;
      try {
        out = await exec(tu.name, input);
      } catch (e) {
        out = { error: String(e instanceof Error ? e.message : e).slice(0, 300) };
      }
      results.push({ type: "tool_result", tool_use_id: tu.id, content: clip(out) });
    }
    messages.push({ role: "user", content: results });
  }
  return { answer: "That took more lookups than I allow in one go. Ask a narrower question.", lookups };
}
