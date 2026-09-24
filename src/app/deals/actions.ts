"use server";

import { cleanInterestRate } from "@/lib/rates";
/** LTV = total debt / purchase price, LTC = total debt / total capitalization, two decimals; null when a side is missing. */
const pctCalc = (a: number | null, b: number | null) => (a != null && b ? Math.round((a / b) * 10000) / 100 : null);

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { currentUser } from "@/lib/current-user";
import { logActivity } from "@/lib/activity";
import { DEAL_STAGES } from "@/lib/taxonomy";
import { parseDetails } from "@/lib/checklist";
import { detailsFromForm } from "@/components/checklist-fields";

const s = (fd: FormData, k: string) => {
  const v = fd.get(k);
  return typeof v === "string" && v.trim() ? v.trim() : null;
};
const num = (fd: FormData, k: string) => {
  const v = s(fd, k);
  if (v == null) return null;
  const n = Number(v.replace(/[^0-9.-]/g, ""));
  return isNaN(n) ? null : n;
};
const date = (fd: FormData, k: string) => {
  const v = s(fd, k);
  if (!v) return null;
  const d = new Date(v);
  return isNaN(d.getTime()) ? null : d;
};

export async function moveDeal(id: string, stage: string) {
  if (!(DEAL_STAGES as readonly string[]).includes(stage)) throw new Error("Unknown stage");
  await prisma.deal.update({ where: { id }, data: { stage } });
  revalidatePath("/deals");
  revalidatePath(`/deals/${id}`);
  revalidatePath("/");
}

async function dealData(fd: FormData) {
  const sponsorName = s(fd, "sponsorName");
  const propertyName = s(fd, "propertyName");
  const sourcing = s(fd, "detail.sourcing");
  const onMarketRaw = s(fd, "onMarket") ?? (sourcing ? (/off-market|note purchase|reo|recapitalization|sale-leaseback/i.test(sourcing) ? "off" : "on") : null);
  let sponsorCompanyId = s(fd, "sponsorCompanyId");
  if (!sponsorCompanyId && sponsorName) {
    const match = await prisma.company.findFirst({ where: { name: sponsorName }, select: { id: true } });
    sponsorCompanyId = match?.id ?? null;
  }
  const name = s(fd, "name") ?? ([sponsorName, propertyName].filter(Boolean).join(" | ") || "(Unnamed deal)");
  const stage = s(fd, "stage") ?? "Deal Received";
  return {
    name,
    stage: (DEAL_STAGES as readonly string[]).includes(stage) ? stage : "Deal Received",
    sponsorName,
    sponsorCompanyId,
    propertyName,
    propertyAddress: s(fd, "propertyAddress"),
    city: s(fd, "city"),
    state: s(fd, "state"),
    assetClass: s(fd, "assetClass"),
    strategy: s(fd, "strategy"),
    onMarket: onMarketRaw == null ? null : onMarketRaw === "on",
    requestType: s(fd, "requestType") ?? (/Debt/.test(s(fd, "executionType") ?? "") ? "Debt" : s(fd, "executionType") ? "Equity" : null),
    requestedAmount: num(fd, "requestedAmount"),
    // Total equity is derived: total capitalization minus total debt (falls back to a typed value if only that exists).
    totalEquity: num(fd, "totalCapitalization") != null && num(fd, "totalDebt") != null ? num(fd, "totalCapitalization")! - num(fd, "totalDebt")! : num(fd, "totalEquity"),
    purchasePrice: num(fd, "purchasePrice"),
    ltv: fd.has("totalDebt") ? pctCalc(num(fd, "totalDebt"), num(fd, "purchasePrice")) : num(fd, "ltv"),
    loanTerm: s(fd, "loanTerm"),
    amortization: s(fd, "amortization"),
    equityMultiple: num(fd, "equityMultiple"),
    occupancy: num(fd, "occupancy"),
    sponsorExperience: s(fd, "sponsorExperience"),
    summary: s(fd, "summary"),
    closeDate: fd.has("closeDate") ? date(fd, "closeDate") : undefined,
    ownerId: s(fd, "ownerId"),
    executionType: s(fd, "executionType"),
    totalDebt: num(fd, "totalDebt"),
    totalCapitalization: num(fd, "totalCapitalization"),
    ltc: fd.has("totalDebt") ? pctCalc(num(fd, "totalDebt"), num(fd, "totalCapitalization")) : num(fd, "ltc"),
    interestRate: cleanInterestRate(s(fd, "interestRate")), // one simple rate, whatever was typed (Jonathan, Sep 24, 2026)
    lenderType: s(fd, "lenderType"),
    irr: num(fd, "irr"),
    holdPeriod: s(fd, "holdPeriod"),
    yieldOnCost: num(fd, "yieldOnCost"),
    capRateY1: num(fd, "capRateY1"),
    capRateT12: num(fd, "capRateT12"),
    cashOnCash: num(fd, "cashOnCash"),
    projectedSellout: num(fd, "projectedSellout"),
    // blank per-unit and per-foot figures follow the sellout (Jonathan, Sep 23, 2026)
    selloutPerUnit: num(fd, "selloutPerUnit") ?? (num(fd, "projectedSellout") && num(fd, "units") ? Math.round(num(fd, "projectedSellout")! / num(fd, "units")!) : null),
    selloutPerFoot: num(fd, "selloutPerFoot") ?? (num(fd, "projectedSellout") && num(fd, "squareFeet") ? Math.round((num(fd, "projectedSellout")! / num(fd, "squareFeet")!) * 100) / 100 : null),
    units: num(fd, "units") != null ? Math.trunc(num(fd, "units")!) : null,
    squareFeet: num(fd, "squareFeet"),
    yearBuilt: s(fd, "yearBuilt"),
    unitMix: s(fd, "unitMix"),
    expectedClose: s(fd, "expectedClose"),
    closedLostReason: s(fd, "closedLostReason"),
    closedWonReason: s(fd, "closedWonReason"),
  };
}

export async function createDeal(fd: FormData) {
  const details: Record<string, string | null> = {};
  for (const key of Array.from(fd.keys())) if (key.startsWith("detail.") && s(fd, key)) details[key.slice(7)] = s(fd, key);
  const d = await prisma.deal.create({ data: { ...(await dealData(fd)), details: JSON.stringify(details) } });
  revalidatePath("/deals");
  redirect(`/deals/${d.id}`);
}

export async function updateDeal(id: string, fd: FormData) {
  const existing = await prisma.deal.findUniqueOrThrow({ where: { id }, select: { details: true } });
  const details = parseDetails(existing.details);
  for (const key of Array.from(fd.keys())) if (key.startsWith("detail.")) details[key.slice(7)] = s(fd, key);
  await prisma.deal.update({ where: { id }, data: { ...(await dealData(fd)), details: JSON.stringify(details) } });
  revalidatePath(`/deals/${id}`);
  revalidatePath("/deals");
}

export async function addDealNote(id: string, fd: FormData) {
  const body = s(fd, "body");
  if (!body) return;
  const deal = await prisma.deal.findUnique({ where: { id }, select: { sponsorCompanyId: true } });
  await logActivity({ type: "NOTE", body, dealId: id, companyId: deal?.sponsorCompanyId ?? null });
  revalidatePath(`/deals/${id}`);
}

export async function updateDealDetails(id: string, fd: FormData) {
  const deal = await prisma.deal.findUniqueOrThrow({ where: { id }, select: { details: true } });
  const details = detailsFromForm(fd, parseDetails(deal.details));
  await prisma.deal.update({ where: { id }, data: { details: JSON.stringify(details) } });
  revalidatePath(`/deals/${id}`);
}

/** Take a question/answer off the ticket (and out of the Investor FAQ): private to one conversation, wrong, or stale. */
export async function deleteFact(dealId: string, factId: string) {
  await prisma.dealFact.deleteMany({ where: { id: factId, dealId } });
  revalidatePath(`/deals/${dealId}`);
}

/** Put a Questions-answered item on the Investor FAQ, or take it off. Only questions somebody asked belong there. */
export async function toggleFactFaq(dealId: string, factId: string) {
  const f = await prisma.dealFact.findFirst({ where: { id: factId, dealId } });
  if (!f) return;
  await prisma.dealFact.update({ where: { id: factId }, data: { inFaq: !f.inFaq } });
  revalidatePath(`/deals/${dealId}`);
}

// ---------- Send to one person ----------
/** People to send a deal to, by name, email or firm. */
export async function searchContactsForDeal(q: string) {
  const t = q.trim();
  if (t.length < 2) return [];
  const rows = await prisma.contact.findMany({
    where: { email: { not: null }, departedAt: null, OR: [{ firstName: { contains: t, mode: "insensitive" } }, { lastName: { contains: t, mode: "insensitive" } }, { email: { contains: t, mode: "insensitive" } }, { company: { name: { contains: t, mode: "insensitive" } } }] },
    select: { id: true, firstName: true, lastName: true, email: true, company: { select: { name: true } } },
    orderBy: [{ lastActivityAt: { sort: "desc", nulls: "last" } }, { lastName: "asc" }],
    take: 8,
  });
  return rows.map((r) => ({ id: r.id, name: [r.firstName, r.lastName].filter(Boolean).join(" ") || r.email!, email: r.email!, company: r.company?.name ?? null }));
}

/** Draft the deal email to one person in the signed-in user's Outlook, attachments on, ready to send. */
export async function sendDealToOneAction(dealId: string, contactId: string) {
  const me = await currentUser();
  if (!me) return { ok: false as const, reason: "Sign in with Microsoft (bottom of the sidebar) so the draft lands in your own mailbox." };
  const { draftDealToOne } = await import("@/lib/send-deal");
  const r = await draftDealToOne(dealId, contactId, me.email, me.name);
  revalidatePath(`/deals/${dealId}`);
  revalidatePath(`/deals/${dealId}/tracker`);
  return r;
}

/** Companies on file matching a few typed letters, for the sponsor picker on the deal ticket. */
export async function searchCompaniesAction(q: string) {
  const t = q.trim();
  if (t.length < 2) return [];
  return prisma.company.findMany({ where: { name: { contains: t, mode: "insensitive" } }, select: { id: true, name: true, city: true, state: true, roles: true }, orderBy: [{ lastActivityAt: { sort: "desc", nulls: "last" } }, { name: "asc" }], take: 8 });
}

// ---------- portfolios ----------
/** Other live tickets from the same sponsor that could be taken out together with this one. */
export async function portfolioCandidatesAction(dealId: string) {
  const d = await prisma.deal.findUnique({ where: { id: dealId }, select: { sponsorCompanyId: true, sponsorName: true } });
  if (!d) return [];
  const bySponsor = [d.sponsorCompanyId ? { sponsorCompanyId: d.sponsorCompanyId } : null, d.sponsorName ? { sponsorName: { contains: d.sponsorName.split(/[,|]/)[0].trim().split(" ")[0], mode: "insensitive" as const } } : null].filter((x): x is NonNullable<typeof x> => Boolean(x));
  if (!bySponsor.length) return [];
  const rows = await prisma.deal.findMany({
    where: { id: { not: dealId }, parentDealId: null, stage: { notIn: ["Deal Lost", "Deal Closed"] }, OR: bySponsor },
    select: { id: true, name: true, propertyName: true, city: true, state: true, stage: true, requestedAmount: true },
    orderBy: { updatedAt: "desc" },
  });
  const { fmtMoney } = await import("@/lib/format");
  return rows.map((r) => ({ id: r.id, name: r.propertyName ?? r.name, city: [r.city, r.state].filter(Boolean).join(", ") || null, stage: r.stage, ask: r.requestedAmount ? fmtMoney(r.requestedAmount) : null }));
}
export async function combinePortfolioAction(dealIds: string[], name: string | null) {
  const { combineIntoPortfolio } = await import("@/lib/portfolio");
  let out: { id: string; name: string };
  try {
    out = await combineIntoPortfolio(dealIds, name);
  } catch (e) {
    return { error: String(e instanceof Error ? e.message : e).slice(0, 200) };
  }
  revalidatePath("/deals");
  revalidatePath("/");
  redirect(`/deals/${out.id}`);
}
export async function detachFromPortfolioAction(childId: string, parentId: string) {
  const { detachFromPortfolio } = await import("@/lib/portfolio");
  await detachFromPortfolio(childId);
  revalidatePath("/deals");
  revalidatePath(`/deals/${parentId}`);
  revalidatePath(`/deals/${childId}`);
}
