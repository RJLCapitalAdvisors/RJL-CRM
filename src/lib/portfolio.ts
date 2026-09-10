import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { US_STATES } from "@/lib/taxonomy";
import { cleanBusinessPlan, stripDashes } from "@/lib/style";

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

const Plan = z.object({ summary: z.string().describe("One business plan for the whole portfolio, 4 to 6 sentences: market context first, then what the properties have in common and the value-add thesis, then physical attributes. No prices, returns, costs, exit, timing, square footage or unit counts. No dashes.") });

/**
 * Fold several tickets into a new portfolio ticket. The components keep their data and files; the portfolio holds
 * the totals, the shared narrative, the report and the sends.
 */
export async function combineIntoPortfolio(childIds: string[], name?: string | null): Promise<{ id: string; name: string }> {
  const children = await prisma.deal.findMany({ where: { id: { in: childIds }, parentDealId: null }, orderBy: { createdAt: "asc" } });
  if (children.length < 2) throw new Error("Pick at least two tickets to combine.");
  const first = children[0];
  const sum = (k: "units" | "squareFeet" | "purchasePrice" | "totalCapitalization" | "totalDebt" | "requestedAmount" | "totalEquity") => {
    const vals = children.map((c) => c[k]).filter((v): v is number => typeof v === "number");
    return vals.length ? vals.reduce((a, b) => a + b, 0) : null;
  };
  const units = sum("units");
  const occ = children.filter((c) => c.occupancy != null && c.units != null);
  const occupancy = occ.length && units ? Math.round((occ.reduce((a, c) => a + (c.occupancy as number) * (c.units as number), 0) / occ.reduce((a, c) => a + (c.units as number), 0)) * 10) / 10 : null;
  const years = children.map((c) => Number(String(c.yearBuilt ?? "").match(/(19|20)\d{2}/)?.[0])).filter((y) => y > 1800);
  const yearBuilt = years.length ? (Math.min(...years) === Math.max(...years) ? String(years[0]) : `${Math.min(...years)} to ${Math.max(...years)}`) : null;
  const dev = children.every((c) => c.strategy === "Development");
  const sponsor = first.sponsorName ?? "Sponsor";
  const propNames = children.map((c) => c.propertyName ?? c.name);
  const propertyName = name?.trim() || `${sponsor.split(/[,|]/)[0].trim()} Portfolio (${propNames.join(", ")})`;
  const cities = portfolioLocation(children);
  const shortCity = [...new Set(children.map((c) => c.city).filter(Boolean))].join(" and ");
  const states = [...new Set(children.map((c) => c.state).filter((s): s is string => Boolean(s)))];

  // one business plan for the set, written from the components' plans
  let summary: string | null = null;
  const plans = children.map((c) => c.summary).filter((s): s is string => Boolean(s?.trim()));
  if (plans.length && process.env.ANTHROPIC_API_KEY) {
    try {
      const client = new Anthropic();
      const res = await client.messages.parse({ model: "claude-opus-5", max_tokens: 800, system: "You write the business plan paragraph of a real estate capital raise email for RJL Capital Advisors. Plain, factual, house style: location and market context first, then anchor tenants or resident profile, the value-add thesis, then physical attributes. 4 to 6 sentences. Never include prices, returns, costs, exit strategy, timing, square footage, unit counts, seller profile or lender type: those live in their own fields. No dashes anywhere.", messages: [{ role: "user", content: `Sponsor: ${sponsor}\nPortfolio of ${children.length} ${first.assetClass ?? ""} properties in ${cities}:\n\n${children.map((c) => `${c.propertyName ?? c.name} (${[c.city, c.state].filter(Boolean).join(", ")}):\n${c.summary ?? ""}`).join("\n\n")}` }], output_config: { format: zodOutputFormat(Plan) } });
      summary = res.parsed_output ? cleanBusinessPlan(stripDashes(res.parsed_output.summary)) : null;
    } catch {
      summary = null;
    }
  }
  if (!summary) summary = plans[0] ? cleanBusinessPlan(plans[0]) : null;
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
      strategy: dev ? "Development" : "Acquisitions",
      assetClass: first.assetClass,
      executionType: first.executionType,
      requestType: first.requestType,
      city: shortCity || null,
      state: states.length === 1 ? states[0] : null,
      propertyAddress: children.map((c) => c.propertyAddress).filter(Boolean).join("; ") || null,
      units,
      squareFeet: sum("squareFeet"),
      purchasePrice: sum("purchasePrice"),
      totalCapitalization: sum("totalCapitalization"),
      totalDebt: sum("totalDebt"),
      requestedAmount: sum("requestedAmount"),
      totalEquity: sum("totalEquity"),
      occupancy,
      yearBuilt,
      summary,
      sponsorExperience: bio,
      expectedClose: first.expectedClose,
      holdPeriod: first.holdPeriod,
      details: JSON.stringify({ portfolio: true, states: states.map((s) => US_STATES[s] ?? s) }),
    },
  });
  await prisma.deal.updateMany({ where: { id: { in: children.map((c) => c.id) } }, data: { parentDealId: parent.id } });
  // anything already on the components' reports rides up to the portfolio
  for (const c of children) {
    const rows = await prisma.dealInvestor.findMany({ where: { dealId: c.id } });
    for (const r of rows) {
      const dup = await prisma.dealInvestor.findUnique({ where: { dealId_contactId: { dealId: parent.id, contactId: r.contactId } } });
      if (dup) await prisma.dealInvestor.delete({ where: { id: r.id } });
      else await prisma.dealInvestor.update({ where: { id: r.id }, data: { dealId: parent.id } });
    }
    await prisma.momentum.updateMany({ where: { dealId: c.id, status: "OPEN" }, data: { dealId: parent.id } }).catch(() => null);
  }
  await prisma.activity.create({ data: { type: "NOTE", body: `Portfolio formed from ${propNames.join(", ")}. The component tickets hold each property's own data and files.`, dealId: parent.id, occurredAt: new Date() } }).catch(() => null);
  return { id: parent.id, name: parent.propertyName ?? parent.name };
}

/** Take a component back out of its portfolio (the portfolio ticket stays). */
export async function detachFromPortfolio(childId: string) {
  await prisma.deal.update({ where: { id: childId }, data: { parentDealId: null } });
}
