import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { US_STATES } from "@/lib/taxonomy";
import { cleanBusinessPlan, stripDashes } from "@/lib/style";
import { roundAsk } from "@/lib/intake";

/**
 * A portfolio: several properties from one sponsor taken out together as one deal. The portfolio is a deal ticket
 * of its own (the one on the board, sent, tracked); the property tickets stay as its components, out of the board
 * and the dashboard. The deal email carries one intro, one Deal Metrics block per property, one business plan and
 * one sponsor bio. Emails about any component file on the portfolio.
 */

export type ChildLike = Record<string, unknown> & { id: string; propertyName: string | null; name: string; city: string | null; state: string | null };

/** The deal with its component tickets attached as `children`, for the copy builders. */
export async function withChildren<T extends { id: string }>(deal: T): Promise<T & { children?: ChildLike[] }> {
  const children = await prisma.deal.findMany({ where: { parentDealId: deal.id }, orderBy: { createdAt: "asc" } });
  return children.length ? { ...deal, children: children as unknown as ChildLike[] } : deal;
}

/** "Las Vegas, NV and Phoenix, AZ" from the components' cities. */
export function portfolioLocation(children: { city: string | null; state: string | null }[]): string {
  const seen = new Set<string>();
  const parts: string[] = [];
  for (const c of children) {
    const loc = [c.city, c.state].filter(Boolean).join(", ");
    if (loc && !seen.has(loc)) {
      seen.add(loc);
      parts.push(loc);
    }
  }
  return parts.length <= 1 ? parts[0] ?? "" : `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;
}

type Kid = { units: number | null; squareFeet: number | null; purchasePrice: number | null; totalCapitalization: number | null; totalDebt: number | null; totalEquity: number | null; requestedAmount: number | null; occupancy: number | null; yearBuilt: string | null; city: string | null; state: string | null; propertyAddress: string | null; strategy: string | null };

/**
 * The portfolio's numbers are the sum of its components' capital stacks (Jonathan, Oct 8, 2026): price, total capitalization,
 * debt, equity, square feet and units added up; the ask is the components' asks added and rounded the house way; occupancy
 * weighted by units; year built as a range. Recomputed whenever a component joins, leaves or is edited.
 */
export function portfolioTotals(children: Kid[]) {
  const sum = (k: "units" | "squareFeet" | "purchasePrice" | "totalCapitalization" | "totalDebt" | "requestedAmount" | "totalEquity") => {
    const vals = children.map((c) => c[k]).filter((v): v is number => typeof v === "number");
    return vals.length ? vals.reduce((a, b) => a + b, 0) : null;
  };
  const units = sum("units");
  const occ = children.filter((c) => c.occupancy != null && c.units != null);
  const occupancy = occ.length && units ? Math.round((occ.reduce((a, c) => a + (c.occupancy as number) * (c.units as number), 0) / occ.reduce((a, c) => a + (c.units as number), 0)) * 10) / 10 : null;
  const years = children.map((c) => Number(String(c.yearBuilt ?? "").match(/(19|20)\d{2}/)?.[0])).filter((y) => y > 1800);
  const yearBuilt = years.length ? (Math.min(...years) === Math.max(...years) ? String(years[0]) : `${Math.min(...years)} to ${Math.max(...years)}`) : null;
  const ask = sum("requestedAmount");
  const states = [...new Set(children.map((c) => c.state).filter((s): s is string => Boolean(s)))];
  return {
    units,
    squareFeet: sum("squareFeet"),
    purchasePrice: sum("purchasePrice"),
    totalCapitalization: sum("totalCapitalization"),
    totalDebt: sum("totalDebt"),
    totalEquity: sum("totalEquity"),
    requestedAmount: ask ? roundAsk(ask) : null,
    occupancy,
    yearBuilt,
    city: (() => { const cs = [...new Set(children.map((c) => c.city).filter((x): x is string => Boolean(x)))]; return cs.length <= 1 ? cs[0] ?? null : `${cs.slice(0, -1).join(", ")} and ${cs[cs.length - 1]}`; })(),
    state: states.length === 1 ? states[0] : null,
    propertyAddress: children.map((c) => c.propertyAddress).filter(Boolean).join("; ") || null,
    strategy: children.length && children.every((c) => c.strategy === "Development") ? "Development" : "Acquisitions",
    states,
  };
}

/** Write the sum of the components onto the portfolio ticket (nothing else on it changes: sponsor, narrative, report, letter stay). */
export async function recomputePortfolioTotals(parentId: string): Promise<void> {
  const children = await prisma.deal.findMany({ where: { parentDealId: parentId }, orderBy: { createdAt: "asc" } });
  if (!children.length) return;
  const t = portfolioTotals(children);
  const parent = await prisma.deal.findUnique({ where: { id: parentId }, select: { details: true } });
  const details = (() => { try { return JSON.parse(parent?.details || "{}") as Record<string, unknown>; } catch { return {}; } })();
  const { states, ...nums } = t;
  await prisma.deal.update({ where: { id: parentId }, data: { ...nums, details: JSON.stringify({ ...details, portfolio: true, states: states.map((s) => US_STATES[s] ?? s) }) } });
}

/** One business plan for the set, written from the components' plans (house rules); the first plan when Claude is not reachable. */
async function portfolioPlan(sponsor: string, assetClass: string | null, cities: string, children: { propertyName: string | null; name: string; city: string | null; state: string | null; summary: string | null }[]): Promise<string | null> {
  const plans = children.map((c) => c.summary).filter((s): s is string => Boolean(s?.trim()));
  if (plans.length && process.env.ANTHROPIC_API_KEY) {
    try {
      const client = new Anthropic();
      const res = await client.messages.parse({ model: "claude-opus-5", max_tokens: 800, system: "You write the business plan paragraph of a real estate capital raise email for RJL Capital Advisors. Plain, factual, house style: location and market context first, then anchor tenants or resident profile, the value-add thesis, then physical attributes. 4 to 6 sentences. Never include prices, returns, costs, exit strategy, timing, square footage, unit counts, seller profile or lender type: those live in their own fields. No dashes anywhere.", messages: [{ role: "user", content: `Sponsor: ${sponsor}\nPortfolio of ${children.length} ${assetClass ?? ""} properties in ${cities}:\n\n${children.map((c) => `${c.propertyName ?? c.name} (${[c.city, c.state].filter(Boolean).join(", ")}):\n${c.summary ?? ""}`).join("\n\n")}` }], output_config: { format: zodOutputFormat(Plan) } });
      if (res.parsed_output) return cleanBusinessPlan(stripDashes(res.parsed_output.summary));
    } catch {
      /* fall through */
    }
  }
  return plans[0] ? cleanBusinessPlan(plans[0]) : null;
}

/** Report rows and open momentum items on a component ride up to the portfolio. */
async function liftOntoPortfolio(parentId: string, childIds: string[]) {
  for (const cid of childIds) {
    const rows = await prisma.dealInvestor.findMany({ where: { dealId: cid } });
    for (const r of rows) {
      const dup = await prisma.dealInvestor.findUnique({ where: { dealId_contactId: { dealId: parentId, contactId: r.contactId } } });
      if (dup) await prisma.dealInvestor.delete({ where: { id: r.id } });
      else await prisma.dealInvestor.update({ where: { id: r.id }, data: { dealId: parentId } });
    }
    await prisma.momentum.updateMany({ where: { dealId: cid, status: "OPEN" }, data: { dealId: parentId } }).catch(() => null);
  }
}

/**
 * An existing ticket becomes the portfolio (Jonathan, Oct 8, 2026: the IndiCap Shallow Bay ticket already carried the
 * engagement letter, the agreed groups and the report, so the four property tickets join it rather than a new ticket).
 * The picked tickets become its components; its numbers become the sum of theirs; its sponsor, bio, business plan
 * (written from the components when it has none), report, letter and emails stay as they are.
 */
export async function attachToPortfolio(parentId: string, childIds: string[]): Promise<{ id: string; name: string; added: number }> {
  const parent = await prisma.deal.findUnique({ where: { id: parentId } });
  if (!parent) throw new Error("Portfolio ticket not found.");
  if (parent.parentDealId) throw new Error("This ticket is itself part of a portfolio.");
  const children = await prisma.deal.findMany({ where: { id: { in: childIds.filter((id) => id !== parentId) }, parentDealId: null }, orderBy: { createdAt: "asc" } });
  if (!children.length) throw new Error("Pick at least one other ticket.");
  await prisma.deal.updateMany({ where: { id: { in: children.map((c) => c.id) } }, data: { parentDealId: parent.id } });
  await liftOntoPortfolio(parent.id, children.map((c) => c.id));
  const all = await prisma.deal.findMany({ where: { parentDealId: parent.id }, orderBy: { createdAt: "asc" } });
  const sponsor = parent.sponsorName ?? "Sponsor";
  const summary = parent.summary?.trim() ? null : await portfolioPlan(sponsor, parent.assetClass, portfolioLocation(all), all);
  const bio = parent.sponsorExperience?.trim() ? null : all.map((c) => c.sponsorExperience).find((b) => b?.trim()) ?? null;
  await prisma.deal.update({ where: { id: parent.id }, data: { ...(summary ? { summary } : {}), ...(bio ? { sponsorExperience: bio } : {}), assetClass: parent.assetClass ?? all[0].assetClass, executionType: parent.executionType ?? all[0].executionType, requestType: parent.requestType ?? all[0].requestType } });
  await recomputePortfolioTotals(parent.id);
  const names = children.map((c) => c.propertyName ?? c.name);
  await prisma.activity.create({ data: { type: "NOTE", body: `${names.join(", ")} joined this portfolio as ${names.length === 1 ? "a component" : "components"}; the totals are the sum of the components' capital stacks.`, dealId: parent.id, occurredAt: new Date() } }).catch(() => null);
  return { id: parent.id, name: parent.propertyName ?? parent.name, added: children.length };
}

const Plan = z.object({ summary: z.string().describe("One business plan for the whole portfolio, 4 to 6 sentences: market context first, then what the properties have in common and the value-add thesis, then physical attributes. No prices, returns, costs, exit, timing, square footage or unit counts. No dashes.") });

/**
 * Fold several tickets into a new portfolio ticket. The components keep their data and files; the portfolio holds
 * the totals, the shared narrative, the report and the sends.
 */
export async function combineIntoPortfolio(childIds: string[], name?: string | null): Promise<{ id: string; name: string }> {
  const children = await prisma.deal.findMany({ where: { id: { in: childIds }, parentDealId: null }, orderBy: { createdAt: "asc" } });
  if (children.length < 2) throw new Error("Pick at least two tickets to combine.");
  const first = children[0];
  const t = portfolioTotals(children);
  const { states, ...nums } = t;
  const sponsor = first.sponsorName ?? "Sponsor";
  const propNames = children.map((c) => c.propertyName ?? c.name);
  const propertyName = name?.trim() || `${sponsor.split(/[,|]/)[0].trim()} Portfolio (${propNames.join(", ")})`;
  const cities = portfolioLocation(children);
  const summary = await portfolioPlan(sponsor, first.assetClass, cities, children);
  const bio = children.map((c) => c.sponsorExperience).find((b) => b?.trim()) ?? null;
  const stageRank = ["Deal Mentioned", "Deal Received", "Deal Underwritten", "Engagement Letter Sent", "Engagement Letter Signed", "Deal Taken To Market", "Intro To Capital Made", "Term Sheet Issued", "Term Sheet Signed"];
  const stage = children.map((c) => c.stage).filter((s) => stageRank.includes(s)).sort((a, b) => stageRank.indexOf(b) - stageRank.indexOf(a))[0] ?? "Deal Received";

  const parent = await prisma.deal.create({
    data: {
      name: `${sponsor} | ${propertyName}`,
      propertyName,
      sponsorName: first.sponsorName,
      sponsorCompanyId: first.sponsorCompanyId,
      ownerId: first.ownerId,
      stage,
      assetClass: first.assetClass,
      executionType: first.executionType,
      requestType: first.requestType,
      ...nums,
      summary,
      sponsorExperience: bio,
      expectedClose: first.expectedClose,
      holdPeriod: first.holdPeriod,
      details: JSON.stringify({ portfolio: true, states: states.map((s) => US_STATES[s] ?? s) }),
    },
  });
  await prisma.deal.updateMany({ where: { id: { in: children.map((c) => c.id) } }, data: { parentDealId: parent.id } });
  // anything already on the components' reports rides up to the portfolio
  await liftOntoPortfolio(parent.id, children.map((c) => c.id));
  await prisma.activity.create({ data: { type: "NOTE", body: `Portfolio formed from ${propNames.join(", ")}. The component tickets hold each property's own data and files.`, dealId: parent.id, occurredAt: new Date() } }).catch(() => null);
  return { id: parent.id, name: parent.propertyName ?? parent.name };
}

/** Take a component back out of its portfolio (the portfolio ticket stays; its totals are the sum of what is left). */
export async function detachFromPortfolio(childId: string) {
  const child = await prisma.deal.findUnique({ where: { id: childId }, select: { parentDealId: true } });
  await prisma.deal.update({ where: { id: childId }, data: { parentDealId: null } });
  if (child?.parentDealId) await recomputePortfolioTotals(child.parentDealId);
}
