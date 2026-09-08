import Link from "next/link";
import { prisma } from "@/lib/db";
import { ACTIVE_STAGES } from "@/lib/taxonomy";
import { PageHeader } from "@/components/ui";
import { Board, type BoardDeal } from "./board";
import { str } from "@/lib/format";

export const metadata = { title: "Deals" };

export const dynamic = "force-dynamic";
const CLOSED_PREVIEW = 15;

export default async function DealsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const ownerId = str(sp.owner);
  const ownerFilter = ownerId ? { ownerId } : {};

  const select = {
    id: true,
    name: true,
    stage: true,
    sponsorName: true,
    propertyName: true,
    city: true,
    state: true,
    assetClass: true,
    requestType: true,
    requestedAmount: true,
    closeDate: true,
    updatedAt: true,
    owner: { select: { name: true } },
  } as const;

  const [active, closed, lost, closedCount, lostCount, users] = await Promise.all([
    prisma.deal.findMany({ where: { stage: { in: [...ACTIVE_STAGES] }, ...ownerFilter }, orderBy: { updatedAt: "desc" }, select }),
    prisma.deal.findMany({ where: { stage: "Deal Closed", ...ownerFilter }, orderBy: { updatedAt: "desc" }, take: CLOSED_PREVIEW, select }),
    prisma.deal.findMany({ where: { stage: "Deal Lost", ...ownerFilter }, orderBy: { updatedAt: "desc" }, take: CLOSED_PREVIEW, select }),
    prisma.deal.count({ where: { stage: "Deal Closed", ...ownerFilter } }),
    prisma.deal.count({ where: { stage: "Deal Lost", ...ownerFilter } }),
    prisma.user.findMany({ where: { active: true }, orderBy: { name: "asc" } }),
  ]);

  const toBoard = (d: (typeof active)[number]): BoardDeal => ({
    ...d,
    ownerName: d.owner?.name ?? null,
    closeDate: d.closeDate?.toISOString() ?? null,
    updatedAt: d.updatedAt.toISOString(),
  });

  return (
    <>
      <PageHeader
        title="Deals"
        subtitle={`${active.length} active · ${closedCount} closed · ${lostCount} lost`}
        actions={
          <>
            <form action="/deals" className="flex items-center gap-2">
              <select name="owner" defaultValue={ownerId} className="input w-44">
                <option value="">All owners</option>
                {users.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.name}
                  </option>
                ))}
              </select>
              <button className="btn-secondary" type="submit">
                Filter
              </button>
            </form>
            <Link href="/intake" className="btn-secondary" title="Paste a forwarded deal email; it becomes a deal in Deal Received">
              From email
            </Link>
            <Link href="/deals/new" className="btn-primary">
              New deal
            </Link>
          </>
        }
      />
      <Board
        deals={[...active, ...closed, ...lost].map(toBoard)}
        counts={{ "Deal Closed": closedCount, "Deal Lost": lostCount }}
        preview={CLOSED_PREVIEW}
      />
    </>
  );
}
