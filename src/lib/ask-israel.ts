import type Anthropic from "@anthropic-ai/sdk";
import { prisma } from "@/lib/db";
import { IL_DEAL_STAGES, apartmentLine, ilFullName, nis, parseJsonList, pricePerMeter } from "@/lib/israel";

/** Ask the CRM, RJL Israel edition: the lookups run over apartments, projects, companies, contacts and the deals funnel. */
const ci = "insensitive" as const;
const day = (d: Date | null | undefined) => (d ? d.toISOString().slice(0, 10) : null);

export const IL_TOOLS: Anthropic.Tool[] = [
  { name: "search_apartments", description: "Find apartments by name, address, neighborhood, city, project or developer. Optional filters: minRooms, maxPriceNis, city.", input_schema: { type: "object", properties: { q: { type: "string" }, city: { type: "string" }, minRooms: { type: "number" }, maxPriceNis: { type: "number" } } } },
  { name: "get_apartment", description: "Everything on one apartment ticket: specs, price, conversions, project, developer, agent, seller, notes, deals.", input_schema: { type: "object", properties: { id: { type: "string" } }, required: ["id"] } },
  { name: "search_projects", description: "Find projects (whole buildings or developments) by name, address, city, neighborhood or developer.", input_schema: { type: "object", properties: { q: { type: "string" } } } },
  { name: "get_project", description: "One project with its apartments.", input_schema: { type: "object", properties: { id: { type: "string" } }, required: ["id"] } },
  { name: "search_companies", description: "Developers, agencies, law firms and other companies by name or city.", input_schema: { type: "object", properties: { q: { type: "string" } } } },
  { name: "search_contacts", description: "Buyers, sellers, brokers, developers and attorneys by name, email, phone or company. Optional role filter: Sponsor (Yazam), Kablan, Broker, Buyer, Seller, Attorneys, Mortgage Broker.", input_schema: { type: "object", properties: { q: { type: "string" }, role: { type: "string" } } } },
  { name: "get_contact", description: "One contact with what they want (buyers), their company, apartments and deals.", input_schema: { type: "object", properties: { id: { type: "string" } }, required: ["id"] } },
  { name: "deals_funnel", description: "The deals pipeline: every deal by stage (Lead, Viewing Scheduled, Offer Made, Negotiation, Under Contract, Closed, Lost) with apartment, buyer, agent and price. Optional stage filter.", input_schema: { type: "object", properties: { stage: { type: "string" } } } },
  { name: "match_buyers", description: "Buyers whose budget and wanted cities fit an apartment (by apartment id).", input_schema: { type: "object", properties: { apartmentId: { type: "string" } }, required: ["apartmentId"] } },
];

const aptRow = (a: { id: string; name: string; city: string | null; neighborhood: string | null; street: string | null; rooms: number | null; internalSqm: number | null; mirpesetSqm: number | null; priceNis: number | null; floor: number | null; completionDate: string | null; parkingSpots: string | null; developer?: { name: string } | null; project?: { name: string } | null }) => ({
  id: a.id,
  link: `/israel/apartments/${a.id}`,
  name: a.name,
  line: apartmentLine(a),
  address: a.street,
  price: nis(a.priceNis) || null,
  pricePerMeter: nis(pricePerMeter(a.priceNis, a.internalSqm, a.mirpesetSqm)) || null,
  parking: a.parkingSpots,
  builtOrDelivery: a.completionDate,
  developer: a.developer?.name ?? null,
  project: a.project?.name ?? null,
});

export async function runIl(name: string, input: Record<string, unknown>): Promise<unknown> {
  const q = typeof input.q === "string" ? input.q.trim() : "";
  switch (name) {
    case "search_apartments": {
      const rows = await prisma.ilApartment.findMany({
        where: {
          AND: [
            { pendingApproval: false },
            q ? { OR: [{ name: { contains: q, mode: ci } }, { street: { contains: q, mode: ci } }, { neighborhood: { contains: q, mode: ci } }, { city: { contains: q, mode: ci } }, { developer: { name: { contains: q, mode: ci } } }, { project: { name: { contains: q, mode: ci } } }] } : {},
            typeof input.city === "string" && input.city ? { city: { contains: input.city, mode: ci } } : {},
            typeof input.minRooms === "number" ? { rooms: { gte: input.minRooms } } : {},
            typeof input.maxPriceNis === "number" ? { priceNis: { lte: input.maxPriceNis } } : {},
          ],
        },
        include: { developer: { select: { name: true } }, project: { select: { name: true } } },
        orderBy: { updatedAt: "desc" },
        take: 25,
      });
      return rows.map(aptRow);
    }
    case "get_apartment": {
      const a = await prisma.ilApartment.findUnique({ where: { id: String(input.id) }, include: { developer: true, project: true, agent: { include: { company: true } }, seller: true, notes: { orderBy: { createdAt: "desc" }, take: 20 }, deals: { include: { buyer: true } } } });
      if (!a) return { error: "not found" };
      return {
        ...aptRow(a),
        specs: { rooms: a.rooms, floor: a.floor, buildingStories: a.totalFloors, buildingUnits: a.buildingUnits, internalSqm: a.internalSqm, mirpesetSqm: a.mirpesetSqm, ceilingCm: a.ceilingCm, machsanSqm: a.machsanSqm, machsanLocation: a.machsanLocation, direction: parseJsonList(a.direction), mirpesetDirection: parseJsonList(a.mirpesetDirection), mamad: a.mamad, condition: a.condition, sellerType: a.sellerType, renovationYear: a.renovationYear },
        description: a.description,
        floorplan: a.floorplanName ? "on file" : "missing",
        agent: a.agent ? { name: ilFullName(a.agent), company: a.agent.company?.name, phone: a.agent.phone, email: a.agent.email, link: `/israel/contacts/${a.agent.id}` } : null,
        seller: a.seller ? { name: ilFullName(a.seller), phone: a.seller.phone, link: `/israel/contacts/${a.seller.id}` } : null,
        deals: a.deals.map((d) => ({ link: `/israel/deals/${d.id}`, stage: d.stage, buyer: d.buyer ? ilFullName(d.buyer) : null, offer: nis(d.offerNis) || null })),
        notes: a.notes.map((n) => ({ date: day(n.createdAt), body: n.body })),
      };
    }
    case "search_projects": {
      const rows = await prisma.ilProject.findMany({ where: q ? { OR: [{ name: { contains: q, mode: ci } }, { street: { contains: q, mode: ci } }, { city: { contains: q, mode: ci } }, { neighborhood: { contains: q, mode: ci } }, { developer: { name: { contains: q, mode: ci } } }] } : {}, include: { developer: { select: { name: true } }, _count: { select: { apartments: true } } }, take: 25 });
      return rows.map((p) => ({ id: p.id, link: `/israel/projects/${p.id}`, name: p.name, developer: p.developer?.name ?? null, address: [p.street, p.neighborhood, p.city].filter(Boolean).join(", "), units: p.totalUnits, parking: p.parkingSpaces, stories: p.stories, builtOrDelivery: p.completionDate, apartmentsListed: p._count.apartments }));
    }
    case "get_project": {
      const p = await prisma.ilProject.findUnique({ where: { id: String(input.id) }, include: { developer: true, apartments: { include: { developer: { select: { name: true } } } }, notes: { orderBy: { createdAt: "desc" }, take: 20 } } });
      if (!p) return { error: "not found" };
      return { id: p.id, link: `/israel/projects/${p.id}`, name: p.name, developer: p.developer?.name ?? null, address: [p.street, p.neighborhood, p.city].filter(Boolean).join(", "), units: p.totalUnits, parking: p.parkingSpaces, stories: p.stories, builtOrDelivery: p.completionDate, description: p.description, apartments: p.apartments.map(aptRow), notes: p.notes.map((n) => ({ date: day(n.createdAt), body: n.body })) };
    }
    case "search_companies": {
      const rows = await prisma.ilCompany.findMany({ where: q ? { OR: [{ name: { contains: q, mode: ci } }, { city: { contains: q, mode: ci } }] } : {}, include: { _count: { select: { contacts: true, apartments: true, projects: true } } }, take: 25 });
      return rows.map((c) => ({ id: c.id, link: `/israel/companies/${c.id}`, name: c.name, roles: JSON.parse(c.roles || "[]"), city: c.city, phone: c.phone, website: c.website, contacts: c._count.contacts, apartments: c._count.apartments, projects: c._count.projects }));
    }
    case "search_contacts": {
      const role = typeof input.role === "string" ? input.role : "";
      const rows = await prisma.ilContact.findMany({ where: { AND: [q ? { OR: [{ firstName: { contains: q, mode: ci } }, { lastName: { contains: q, mode: ci } }, { email: { contains: q, mode: ci } }, { phone: { contains: q, mode: ci } }, { company: { name: { contains: q, mode: ci } } }] } : {}, role ? { roles: { contains: `"${role}"` } } : {}] }, include: { company: { select: { name: true } } }, take: 25 });
      return rows.map((c) => ({ id: c.id, link: `/israel/contacts/${c.id}`, name: ilFullName(c), roles: parseJsonList(c.roles), company: c.company?.name ?? null, email: c.email, phone: c.phone, language: c.language, budget: c.budgetMaxNis ? `${nis(c.budgetMinNis) || "up to"} ${nis(c.budgetMaxNis)}` : null, wants: [c.wantsCities, c.wantsRooms ? `${c.wantsRooms} rooms` : null].filter(Boolean).join(", ") || null }));
    }
    case "get_contact": {
      const c = await prisma.ilContact.findUnique({ where: { id: String(input.id) }, include: { company: true, agentOf: true, sellerOf: true, buyerDeals: { include: { apartment: true } }, ilNotes: { orderBy: { createdAt: "desc" }, take: 20 } } });
      if (!c) return { error: "not found" };
      return { id: c.id, link: `/israel/contacts/${c.id}`, name: ilFullName(c), roles: parseJsonList(c.roles), company: c.company?.name ?? null, email: c.email, phone: c.phone, language: c.language, budget: { min: c.budgetMinNis, max: c.budgetMaxNis }, wantsCities: c.wantsCities, wantsRooms: c.wantsRooms, notes: c.notes, agentOf: c.agentOf.map(aptRow), sellerOf: c.sellerOf.map(aptRow), deals: c.buyerDeals.map((d) => ({ link: `/israel/deals/${d.id}`, stage: d.stage, apartment: d.apartment?.name ?? null, offer: nis(d.offerNis) || null })), log: c.ilNotes.map((n) => ({ date: day(n.createdAt), body: n.body })) };
    }
    case "deals_funnel": {
      const stage = typeof input.stage === "string" && (IL_DEAL_STAGES as readonly string[]).includes(input.stage) ? input.stage : null;
      const rows = await prisma.ilDeal.findMany({ where: stage ? { stage } : {}, include: { apartment: { select: { name: true, city: true, priceNis: true } }, buyer: true, agent: true }, orderBy: { updatedAt: "desc" }, take: 100 });
      const byStage: Record<string, number> = {};
      for (const d of rows) byStage[d.stage] = (byStage[d.stage] ?? 0) + 1;
      return { byStage, deals: rows.map((d) => ({ id: d.id, link: `/israel/deals/${d.id}`, name: d.name, stage: d.stage, apartment: d.apartment?.name ?? null, city: d.apartment?.city ?? null, asking: nis(d.apartment?.priceNis) || null, offer: nis(d.offerNis) || null, agreed: nis(d.agreedPriceNis) || null, buyer: d.buyer ? ilFullName(d.buyer) : null, agent: d.agent ? ilFullName(d.agent) : null, expectedClose: d.expectedClose, updated: day(d.updatedAt) })) };
    }
    case "match_buyers": {
      const a = await prisma.ilApartment.findUnique({ where: { id: String(input.apartmentId) } });
      if (!a) return { error: "apartment not found" };
      const buyers = await prisma.ilContact.findMany({ where: { roles: { contains: '"Buyer"' } } });
      return buyers
        .filter((b) => (b.budgetMaxNis == null || a.priceNis == null || a.priceNis <= b.budgetMaxNis * 1.05) && (!b.wantsCities || !a.city || b.wantsCities.toLowerCase().includes(a.city.toLowerCase())))
        .map((b) => ({ id: b.id, link: `/israel/contacts/${b.id}`, name: ilFullName(b), budget: nis(b.budgetMaxNis) || null, wants: [b.wantsCities, b.wantsRooms ? `${b.wantsRooms} rooms` : null].filter(Boolean).join(", ") || null }));
    }
    default:
      return { error: `unknown lookup ${name}` };
  }
}

export const IL_SYSTEM = `You are the RJL Israel CRM assistant. RJL Israel helps buyers find and buy apartments in Israel: it tracks projects (whole buildings), apartments (with internal and mirpeset square metres, price in shekels and per metre, parking, machsan, direction, mamad), developers and agencies, buyers and sellers, and a deals funnel (Lead, Viewing Scheduled, Offer Made, Negotiation, Under Contract, Closed, Lost).
Answer questions from the CRM's data using the lookups. Always look things up before answering; never guess names, numbers or statuses. For an apartment start with search_apartments then get_apartment; for a project search_projects then get_project; for a person search_contacts then get_contact; for the pipeline deals_funnel.
Write for Jonathan and his team: plain, direct, short. Lead with the answer. Short bullet lists for several items. Link every apartment, project, company, contact or deal you mention the first time as a markdown link using the "link" paths returned by the lookups, e.g. [Rehavia Gardens, Apt 12](/israel/apartments/abc). Money in shekels as ₪5,900,000; square metres as m². Dates as "Sep 3". No dashes as punctuation. No headings unless the answer has several distinct parts.
If the data does not hold the answer, say so plainly and say where it would be found. You cannot change anything; if asked to change or send something, explain which page does it. Never invent facts.`;
