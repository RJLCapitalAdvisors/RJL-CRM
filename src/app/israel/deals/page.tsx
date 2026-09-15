import Link from "next/link";
import { prisma } from "@/lib/db";
import { PageHeader } from "@/components/ui";
import { ilFullName } from "@/lib/israel";
import { IlBoard } from "./board";

export const metadata = { title: "Deals" };
export const dynamic = "force-dynamic";

/** Deals: the RJL Israel pipeline funnel. A deal is a buyer pursuing an apartment. */
export default async function IlDealsPage() {
  const deals = await prisma.ilDeal.findMany({
    orderBy: { updatedAt: "desc" },
    include: { apartment: { select: { name: true, city: true, priceNis: true } }, buyer: { select: { firstName: true, lastName: true, email: true } }, agent: { select: { firstName: true, lastName: true, email: true } } },
  });
  const live = deals.filter((d) => d.stage !== "Closed" && d.stage !== "Lost" && d.stage !== "Mentioned").length;
  const mentioned = deals.filter((d) => d.stage === "Mentioned").length;
  return (
    <>
      <PageHeader
        compact
        title="Deals"
        subtitle={`${live} in the funnel · ${mentioned} mentioned · ${deals.length - live - mentioned} closed or lost`}
        actions={
          <Link href="/israel/deals/new" className="btn-primary">
            New deal
          </Link>
        }
      />
      <IlBoard
        deals={deals.map((d) => ({
          id: d.id,
          name: d.name,
          stage: d.stage,
          apartment: d.apartment?.name ?? null,
          city: d.apartment?.city ?? null,
          buyer: d.buyer ? ilFullName(d.buyer) : null,
          agent: d.agent ? ilFullName(d.agent) : null,
          price: d.agreedPriceNis ?? d.offerNis ?? d.apartment?.priceNis ?? null,
          updatedAt: d.updatedAt.toISOString(),
        }))}
      />
    </>
  );
}
