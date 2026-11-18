import { prisma } from "@/lib/db";
import { servesSide } from "@/lib/side";
import { statusOf } from "@/lib/tracker";
import { parseList } from "@/lib/taxonomy";
import { CHECK_STOPS, HOLD_STOPS, VINTAGE_STOPS, checkRangeFrom, holdRangeFrom, rangeLabel, vintageRangeFrom } from "@/lib/ranges";

export const maxDuration = 60;
export const dynamic = "force-dynamic";

/**
 * A remote MCP server for RJL Capital Advisors (Jonathan, Oct 9, 2026): claude.ai (Settings > Connectors > Add custom
 * connector) and Claude Code can read deals, contacts and activity straight from the CRM. Read only. Streamable HTTP in
 * its stateless form: every call is one JSON-RPC POST answered with JSON, which is all a hosted client needs, so there is
 * no SDK, no session and nothing to keep alive between Vercel invocations. The key is MCP_API_KEY: as a bearer header
 * (Claude Code) or as ?key= on the URL (claude.ai's connector form has nowhere to put a header). Nothing here writes.
 */

const PROTOCOL = "2025-06-18";
type Rpc = { jsonrpc: "2.0"; id?: string | number | null; method: string; params?: Record<string, unknown> };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });
const result = (id: Rpc["id"], r: unknown) => json({ jsonrpc: "2.0", id: id ?? null, result: r });
const error = (id: Rpc["id"], code: number, message: string, status = 200) => json({ jsonrpc: "2.0", id: id ?? null, error: { code, message } }, status);
const text = (v: unknown) => ({ content: [{ type: "text", text: typeof v === "string" ? v : JSON.stringify(v, null, 2) }] });

/** MCP_API_KEY holds one key per person, comma separated (Jonathan and Aviel, Oct 13, 2026), so one can be revoked without the other. */
function authorized(req: Request): boolean {
  const keys = (process.env.MCP_API_KEY ?? "").split(",").map((k) => k.trim()).filter(Boolean);
  if (!keys.length) return false;
  const h = req.headers.get("authorization") ?? "";
  const bearer = /^bearer\s+(.+)$/i.exec(h)?.[1]?.trim();
  const q = new URL(req.url).searchParams.get("key");
  const x = req.headers.get("x-api-key");
  return keys.some((key) => bearer === key || q === key || x === key);
}

const TOOLS = [
  {
    name: "search_deals",
    description: "Find deals (tickets) in the RJL Capital Advisors CRM. Searches the deal name, property name, sponsor, city and state; filter by stage, asset class or strategy. Returns a short record per deal; use get_deal for the full ticket.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Words from the deal, property, sponsor, city or state (optional)" },
        stage: { type: "string", description: "Exact stage, e.g. Deal Received, Engagement Letter Signed, Deal Taken To Market, Intro To Capital Made, Term Sheet Issued, Deal Closed, Deal Lost (optional)" },
        assetClass: { type: "string", description: "Asset class, e.g. Multifamily, Industrial, Retail, Land (optional)" },
        strategy: { type: "string", description: "Development or Acquisitions (optional)" },
        live: { type: "boolean", description: "true: only deals not lost or closed (default true)" },
        limit: { type: "integer", description: "How many to return, default 25, max 100" },
      },
    },
  },
  {
    name: "get_deal",
    description: "The full ticket for one deal by id: every field, the details, the sponsor's answered questions (facts), the investor progress report (which firms were sent it and where each stands), the files on it and the latest activity.",
    inputSchema: { type: "object", properties: { id: { type: "string", description: "The deal id (from search_deals)" } }, required: ["id"] },
  },
  {
    name: "search_contacts",
    description: "Find people and firms. Matches a person's name, email or title, or their company's name or domain. Returns contacts with their company, roles and when we last corresponded.",
    inputSchema: { type: "object", properties: { query: { type: "string", description: "A name, part of an email, a firm name or a domain" }, limit: { type: "integer", description: "How many to return, default 25, max 100" } }, required: ["query"] },
  },
  {
    name: "get_company",
    description:
      "One firm by id or email domain: who they are (name, domains, website, location, description) and the whole \"Role and investor criteria\" section of its CRM page: role (Investor, Sponsor, Lender or Broker), asset classes, position in the capital stack, check size range, deal locations, return profile, acquisition or development, hold period, year built, Opportunity Zone, closing time frame, open to a minority position, and other information. A field nobody has filled in comes back as null. Get the id from search_contacts (each contact's company.id) or pass the firm's domain.",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string", description: "The company id (from search_contacts)" },
        domain: { type: "string", description: "The firm's email or web domain, e.g. example.com; a full email address or website URL also works" },
      },
    },
  },
  {
    name: "list_recent_activity",
    description: "The latest emails and notes logged in the CRM, newest first: who wrote to whom, the subject, what it said, and the deal, contact and company it is filed on. Filter by deal, company or contact, or by how many days back.",
    inputSchema: {
      type: "object",
      properties: {
        limit: { type: "integer", description: "How many to return, default 25, max 100" },
        days: { type: "integer", description: "Only the last N days (optional)" },
        dealId: { type: "string", description: "Only activity on this deal (optional)" },
        companyId: { type: "string", description: "Only activity with this company (optional)" },
        contactId: { type: "string", description: "Only activity with this person (optional)" },
      },
    },
  },
];

const lim = (v: unknown, d = 25) => Math.min(100, Math.max(1, Number(v) || d));
const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);
const money = (v: number | null) => (v == null ? null : `$${Math.round(v).toLocaleString("en-US")}`);

async function searchDeals(a: Record<string, unknown>) {
  const q = str(a.query);
  const live = a.live !== false;
  const deals = await prisma.deal.findMany({
    where: {
      AND: [
        q ? { OR: [{ name: { contains: q, mode: "insensitive" } }, { propertyName: { contains: q, mode: "insensitive" } }, { sponsorName: { contains: q, mode: "insensitive" } }, { city: { contains: q, mode: "insensitive" } }, { state: { equals: q.toUpperCase() } }] } : {},
        str(a.stage) ? { stage: str(a.stage)! } : {},
        str(a.assetClass) ? { assetClass: { equals: str(a.assetClass)!, mode: "insensitive" } } : {},
        str(a.strategy) ? { strategy: { equals: str(a.strategy)!, mode: "insensitive" } } : {},
        live ? { stage: { notIn: ["Deal Lost", "Deal Closed"] } } : {},
        { parentDealId: null },
      ],
    },
    orderBy: { updatedAt: "desc" },
    take: lim(a.limit),
    select: { id: true, name: true, propertyName: true, sponsorName: true, stage: true, assetClass: true, strategy: true, executionType: true, requestType: true, city: true, state: true, requestedAmount: true, totalCapitalization: true, units: true, squareFeet: true, expectedClose: true, updatedAt: true, _count: { select: { investors: true, children: true } } },
  });
  return deals.map((d) => ({ id: d.id, deal: d.name, property: d.propertyName, sponsor: d.sponsorName, stage: d.stage, assetClass: d.assetClass, strategy: d.strategy, execution: d.executionType ?? d.requestType, location: [d.city, d.state].filter(Boolean).join(", ") || null, ask: money(d.requestedAmount), totalCapitalization: money(d.totalCapitalization), units: d.units, squareFeet: d.squareFeet, expectedClose: d.expectedClose, firmsOnReport: d._count.investors, portfolioOf: d._count.children || undefined, updatedAt: d.updatedAt.toISOString() }));
}

async function getDeal(a: Record<string, unknown>) {
  const id = str(a.id);
  if (!id) return "id is required";
  const d = await prisma.deal.findUnique({
    where: { id },
    include: {
      sponsorCompany: { select: { id: true, name: true, domain: true } },
      owner: { select: { name: true } },
      facts: { orderBy: { createdAt: "asc" }, select: { question: true, answer: true, source: true } },
      investors: { include: { contact: { select: { firstName: true, lastName: true, email: true, company: { select: { name: true } } } } }, orderBy: { updatedAt: "desc" } },
      files: { select: { name: true, size: true, receivedAt: true }, orderBy: { receivedAt: "asc" } },
      children: { select: { id: true, propertyName: true, name: true, city: true, state: true, requestedAmount: true, totalCapitalization: true } },
      parent: { select: { id: true, propertyName: true, name: true } },
    },
  });
  if (!d) return `No deal with id ${id}`;
  const { facts, investors, files, children, parent, details, sponsorCompany, owner, ...core } = d;
  let det: Record<string, unknown> = {};
  try { det = JSON.parse(details || "{}"); } catch { /* ignore */ }
  for (const k of ["sendState", "followupState", "followupState2", "aiSuggestions", "engagementStruck", "engagementDraftId", "engagementMailbox"]) delete det[k];
  const activity = await prisma.activity.findMany({ where: { dealId: id }, orderBy: { occurredAt: "desc" }, take: 20, select: { type: true, direction: true, subject: true, body: true, occurredAt: true, contact: { select: { firstName: true, lastName: true } }, company: { select: { name: true } } } });
  return {
    ...core,
    sponsorCompany,
    owner: owner?.name ?? null,
    details: det,
    portfolio: children.length ? { properties: children } : parent ? { partOf: parent } : undefined,
    factsFromSponsor: facts,
    progressReport: investors.map((r) => ({ firm: r.contact.company?.name ?? null, person: [r.contact.firstName, r.contact.lastName].filter(Boolean).join(" ") || r.contact.email, status: statusOf(r.status).short, notes: r.note ?? null, updatedAt: r.updatedAt.toISOString() })),
    files: files.map((f) => ({ name: f.name, size: f.size, receivedAt: f.receivedAt?.toISOString() ?? null })),
    recentActivity: activity.map((x) => ({ when: x.occurredAt.toISOString(), type: x.type, direction: x.direction, who: [x.contact?.firstName, x.contact?.lastName].filter(Boolean).join(" ") || null, company: x.company?.name ?? null, subject: x.subject, text: (x.body ?? "").slice(0, 600) })),
  };
}

async function searchContacts(a: Record<string, unknown>) {
  const q = str(a.query);
  if (!q) return "query is required";
  const rows = await prisma.contact.findMany({
    where: { OR: [{ firstName: { contains: q, mode: "insensitive" } }, { lastName: { contains: q, mode: "insensitive" } }, { email: { contains: q, mode: "insensitive" } }, { title: { contains: q, mode: "insensitive" } }, { company: { name: { contains: q, mode: "insensitive" } } }, { company: { domain: { contains: q, mode: "insensitive" } } }] },
    orderBy: [{ lastActivityAt: { sort: "desc", nulls: "last" } }, { lastName: "asc" }],
    take: lim(a.limit),
    select: { id: true, firstName: true, lastName: true, email: true, phone: true, title: true, linkedin: true, roles: true, lastActivityAt: true, departedAt: true, unsubscribed: true, company: { select: { id: true, name: true, domain: true, roles: true, city: true, state: true } } },
  });
  return rows.map((c) => ({ id: c.id, name: [c.firstName, c.lastName].filter(Boolean).join(" ") || null, email: c.email, phone: c.phone, title: c.title, linkedin: c.linkedin, roles: parseList(c.roles), company: c.company ? { id: c.company.id, name: c.company.name, domain: c.company.domain, roles: parseList(c.company.roles), location: [c.company.city, c.company.state].filter(Boolean).join(", ") || null } : null, lastActivityAt: c.lastActivityAt?.toISOString() ?? null, leftTheFirm: c.departedAt ? c.departedAt.toISOString() : undefined, unsubscribed: c.unsubscribed || undefined }));
}

/** "jane@example.com", "https://www.example.com/about" or "Example.com" all become "example.com". */
const bareDomain = (v: string) => v.trim().toLowerCase().replace(/^.*@/, "").replace(/^[a-z]+:\/\//, "").replace(/^www\./, "").split(/[/?#:]/)[0];
const yesNo = (v: boolean | null | undefined) => (v == null ? null : v ? "Yes" : "No");
const listOrNull = (v: string | null | undefined) => {
  const l = parseList(v);
  return l.length ? l : null;
};

/**
 * get_company (Aviel, Nov 18, 2026): a firm and its "Role and investor criteria" section, read the way the company
 * page reads it. Ranges come from the sliders when they were set, else from the old buckets (HubSpot imports), as on
 * the page. Saved values only: a change waiting for Jonathan's approval is not in here yet.
 */
async function getCompany(a: Record<string, unknown>) {
  const id = str(a.id);
  const domain = str(a.domain) ? bareDomain(str(a.domain)!) : null;
  if (!id && !domain) return "Pass id or domain";
  const select = { id: true, name: true, roles: true, domain: true, altDomains: true, website: true, description: true, city: true, state: true, criteria: true } as const;
  const c = id
    ? await prisma.company.findUnique({ where: { id }, select })
    : ((await prisma.company.findFirst({ where: { domain: { equals: domain!, mode: "insensitive" } }, select })) ??
       (await prisma.company.findFirst({ where: { altDomains: { contains: `"${domain}"`, mode: "insensitive" } }, select })));
  if (!c) return id ? `No company with id ${id}` : `No company with the domain ${domain}`;
  const k = c.criteria;
  const check = k?.checkMinMM != null && k?.checkMaxMM != null ? [k.checkMinMM, k.checkMaxMM] : checkRangeFrom(parseList(k?.checkSizes));
  const hold = k?.holdMinYears != null && k?.holdMaxYears != null ? [k.holdMinYears, k.holdMaxYears] : holdRangeFrom(parseList(k?.holdPeriods));
  const built = k?.vintageMin != null && k?.vintageMax != null ? [k.vintageMin, k.vintageMax] : vintageRangeFrom(parseList(k?.vintages));
  const base = (process.env.APP_URL ?? "https://rjl-crm.vercel.app").replace(/\/$/, "");
  return {
    id: c.id,
    name: c.name,
    domain: c.domain,
    otherDomains: listOrNull(c.altDomains),
    website: c.website,
    location: [c.city, c.state].filter(Boolean).join(", ") || null,
    description: c.description,
    crmPage: `${base}/companies/${c.id}`,
    criteria: {
      role: listOrNull(c.roles),
      assetClasses: listOrNull(k?.assetClasses),
      positionInCapitalStack: listOrNull(k?.investmentTypes),
      checkSize: check ? { range: rangeLabel(CHECK_STOPS, check[0], check[1]), minMM: check[0], maxMM: check[1], note: "$MM; a max of 100 means $100MM and up" } : null,
      dealLocations: k?.geographyNotes?.trim() || null,
      returnProfile: listOrNull(k?.returnProfile),
      acquisitionOrDevelopment: k?.strategy ?? null,
      holdPeriod: hold ? { range: rangeLabel(HOLD_STOPS, hold[0], hold[1]), minYears: hold[0], maxYears: hold[1] } : null,
      yearBuilt: built ? { range: rangeLabel(VINTAGE_STOPS, built[0], built[1]) } : null,
      opportunityZone: yesNo(k?.ozInterest),
      closingTimeFrame: k?.closingTimeframe ?? null,
      openToMinorityPosition: yesNo(k?.openToMinority),
      otherInformation: k?.otherInfo?.trim() || null,
      lastUpdated: k?.updatedAt?.toISOString() ?? null,
    },
  };
}

async function listRecentActivity(a: Record<string, unknown>) {
  const days = Number(a.days) > 0 ? Number(a.days) : null;
  const rows = await prisma.activity.findMany({
    where: { ...(days ? { occurredAt: { gte: new Date(Date.now() - days * 86_400_000) } } : {}), ...(str(a.dealId) ? { dealId: str(a.dealId)! } : {}), ...(str(a.companyId) ? { companyId: str(a.companyId)! } : {}), ...(str(a.contactId) ? { contactId: str(a.contactId)! } : {}) },
    orderBy: { occurredAt: "desc" },
    take: lim(a.limit),
    select: { id: true, type: true, direction: true, subject: true, body: true, occurredAt: true, contact: { select: { id: true, firstName: true, lastName: true, email: true } }, company: { select: { id: true, name: true } }, deal: { select: { id: true, name: true, stage: true } } },
  });
  return rows.map((x) => ({ id: x.id, when: x.occurredAt.toISOString(), type: x.type, direction: x.direction, subject: x.subject, text: (x.body ?? "").slice(0, 800), contact: x.contact ? { id: x.contact.id, name: [x.contact.firstName, x.contact.lastName].filter(Boolean).join(" ") || x.contact.email } : null, company: x.company, deal: x.deal }));
}

async function callTool(name: string, args: Record<string, unknown>) {
  switch (name) {
    case "search_deals": return searchDeals(args);
    case "get_deal": return getDeal(args);
    case "search_contacts": return searchContacts(args);
    case "get_company": return getCompany(args);
    case "list_recent_activity": return listRecentActivity(args);
    default: return null;
  }
}

export async function POST(req: Request) {
  if (!servesSide("CA")) return new Response("Not found", { status: 404 });
  if (!authorized(req)) return error(null, -32001, "Unauthorized: pass the key as Authorization: Bearer <key> or ?key=<key>", 401);
  let body: Rpc | Rpc[];
  try {
    body = await req.json();
  } catch {
    return error(null, -32700, "Parse error", 400);
  }
  const handle = async (m: Rpc): Promise<Response | null> => {
    if (m.method.startsWith("notifications/")) return null; // nothing to answer
    switch (m.method) {
      case "initialize":
        return result(m.id, { protocolVersion: PROTOCOL, capabilities: { tools: {} }, serverInfo: { name: "rjl-crm", title: "RJL Capital Advisors CRM", version: "1.0.0" }, instructions: "Read-only access to the RJL Capital Advisors CRM: deals (tickets), contacts and firms, and the logged email and note activity. Start with search_deals or search_contacts, then get_deal for the whole ticket, or get_company for a firm's role and investor criteria." });
      case "ping":
        return result(m.id, {});
      case "tools/list":
        return result(m.id, { tools: TOOLS });
      case "tools/call": {
        const name = String(m.params?.name ?? "");
        const args = (m.params?.arguments as Record<string, unknown>) ?? {};
        try {
          const r = await callTool(name, args);
          if (r === null) return error(m.id, -32602, `Unknown tool ${name}`);
          return result(m.id, text(r));
        } catch (e) {
          return result(m.id, { ...text(`Error: ${String(e instanceof Error ? e.message : e).slice(0, 300)}`), isError: true });
        }
      }
      default:
        return error(m.id, -32601, `Method not found: ${m.method}`);
    }
  };
  if (Array.isArray(body)) {
    const out = (await Promise.all(body.map(handle))).filter((r): r is Response => Boolean(r));
    if (!out.length) return new Response(null, { status: 202 });
    return json(await Promise.all(out.map((r) => r.json())));
  }
  const r = await handle(body);
  return r ?? new Response(null, { status: 202 });
}

/** No server-to-client stream: a hosted client that opens one gets 405 and carries on with plain POSTs. */
export async function GET(req: Request) {
  if (!servesSide("CA")) return new Response("Not found", { status: 404 });
  if (!authorized(req)) return error(null, -32001, "Unauthorized", 401);
  return new Response("Method Not Allowed", { status: 405, headers: { Allow: "POST, DELETE" } });
}
export async function DELETE() {
  return new Response(null, { status: 200 });
}
