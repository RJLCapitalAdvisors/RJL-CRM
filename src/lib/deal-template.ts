import { prisma } from "@/lib/db";
import { isCondo, isPref } from "@/lib/pref";
import { renderTemplate, toHtml, type MergeContext } from "@/lib/merge";

/**
 * Which stored deal email template fits a ticket (Jonathan, Sep 23, 2026): pref or JV equity, development or existing,
 * multifamily-type or not, and Condo pref developments their own template. The deals@ reply and the Send deal page
 * start from it; the house copy (deal-copy.ts) is the fallback when no template matches.
 */
const RESIDENTIAL = ["Multifamily", "Build-For-Rent (SFR)", "Student Housing", "Senior Housing"];

export type DealForTemplate = { assetClass?: string | null; strategy?: string | null; executionType?: string | null; requestType?: string | null };

export function templateNameFor(deal: DealForTemplate): RegExp | null {
  const exec = deal.executionType ?? "";
  if (exec === "Senior Debt") return /^Deal Template For All Debt Deals/i;
  if (exec === "Fund Investment") return /^Fund Raise Template$/i;
  const pref = isPref(exec);
  const dev = deal.strategy === "Development";
  if (isCondo(deal.assetClass) && pref && dev) return /^Condo Pref Equity Development Deals/i;
  const prefix = deal.assetClass && RESIDENTIAL.includes(deal.assetClass) ? "Multifamily" : "NON-Multifamily";
  return new RegExp(`^${prefix} ${pref ? "Pref" : "JV"} Equity ${dev ? "Development" : "Existing"} Deals`, "i");
}

export async function templateForDeal(deal: DealForTemplate): Promise<{ id: string; name: string; subject: string; bodyHtml: string } | null> {
  const re = templateNameFor(deal);
  if (!re) return null;
  const all = await prisma.emailTemplate.findMany({ where: { kind: "DEAL", workspace: "CA", NOT: { name: { startsWith: "(archived)" } } }, select: { id: true, name: true, subject: true, bodyHtml: true } });
  return all.find((t) => re.test(t.name)) ?? null;
}

/** The template filled from the ticket alone: no investor yet, so the greeting falls back to its default. */
export function renderDealTemplate(t: { subject: string; bodyHtml: string }, deal: Record<string, unknown>): { subject: string; html: string } {
  const ctx: MergeContext = { contact: { firstName: null, lastName: null, email: null }, company: null, deal, sender: { name: "RJL Capital Advisors" }, unsubscribeUrl: "" };
  return { subject: renderTemplate(t.subject, ctx), html: toHtml(renderTemplate(t.bodyHtml, ctx)) };
}
