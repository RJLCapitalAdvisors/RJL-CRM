import { prisma } from "@/lib/db";
import { fmtMoney } from "@/lib/format";
import { missingFor, itemLabel } from "@/lib/checklist";
import { loadChecklist } from "@/lib/required-items";
import { fmtReportDate, investorLabel, rankOf } from "@/lib/tracker";

/** Everything the progress report needs, shared by the in-app tracker, the sponsor view, and the export. */
export async function loadReport(dealId: string) {
  await loadChecklist();
  const { ensureTrackerSummary } = await import("@/lib/tracker-summary");
  await ensureTrackerSummary(dealId).catch(() => null);
  const deal = await prisma.deal.findUnique({
    where: { id: dealId },
    include: {
      investors: { include: { contact: { include: { company: true } } } },
      actions: { orderBy: { createdAt: "asc" } },
    },
  });
  if (!deal) return null;
  const name = deal.propertyName ?? deal.name;
  // report order: Intro Made at the top down to Not A Fit and Pass at the bottom (rank), then by firm
  const rows = [...deal.investors].sort((a, b) => rankOf(b.status) - rankOf(a.status) || investorLabel(a.contact).localeCompare(investorLabel(b.contact)));
  const lastUpdated = deal.investors.reduce<Date>((m, r) => (r.updatedAt > m ? r.updatedAt : m), deal.updatedAt);
  const itemsNeeded = missingFor(deal).map((it) => itemLabel(it, deal.strategy));
  const chips = [
    deal.sponsorName ? { label: "Sponsor", value: deal.sponsorName } : null,
    { label: "Type", value: [deal.requestedAmount ? fmtMoney(deal.requestedAmount) : null, deal.executionType ?? deal.requestType, deal.assetClass, [deal.city, deal.state].filter(Boolean).join(", ")].filter(Boolean).join(" · ") },
    deal.units || deal.squareFeet || deal.yearBuilt || deal.occupancy != null
      ? { label: "Property", value: [deal.units ? `${deal.units.toLocaleString()} units` : null, deal.squareFeet ? `${deal.squareFeet.toLocaleString()} SF` : null, deal.yearBuilt ? `Built ${deal.yearBuilt}` : null, deal.occupancy != null ? `${deal.occupancy}% occupied` : null].filter(Boolean).join(" · ") }
      : null,
    deal.irr || deal.equityMultiple || deal.holdPeriod ? { label: "Returns", value: [deal.irr ? `${deal.irr}% IRR` : null, deal.equityMultiple ? `${deal.equityMultiple}x EM` : null, deal.holdPeriod, deal.cashOnCash ? `${deal.cashOnCash}% CoC` : null].filter(Boolean).join(" · ") } : null,
    deal.purchasePrice ? { label: "Purchase price", value: [fmtMoney(deal.purchasePrice), deal.capRateT12 ? `${deal.capRateT12}% T12 cap` : null].filter(Boolean).join(" · ") } : null,
    deal.expectedClose ? { label: "Target close", value: deal.expectedClose } : null,
  ].filter(Boolean) as { label: string; value: string }[];
  return { deal, name, rows, lastUpdated, itemsNeeded, chips, fmt: fmtReportDate };
}
export type Report = NonNullable<Awaited<ReturnType<typeof loadReport>>>;
