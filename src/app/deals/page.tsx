import Link from "next/link";
import { prisma } from "@/lib/db";
import { ACTIVE_STAGES, isBlindIntro } from "@/lib/taxonomy";
import { PageHeader } from "@/components/ui";
import { Board, type BoardDeal } from "./board";
import { str } from "@/lib/format";
import type { Prisma } from "@prisma/client";

export const metadata = { title: "Deals" };

export const dynamic = "force-dynamic";
const CLOSED_PREVIEW = 15;

export default async function DealsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const ownerId = str(sp.owner);
  const q = str(sp.q).trim();
  // search digs through everything on a ticket: name, property, sponsor, city, state, address, the business plan
  const match: Prisma.DealWhereInput = q
    ? { OR: [{ name: { contains: q, mode: "insensitive" } }, { propertyName: { contains: q, mode: "insensitive" } }, { sponsorName: { contains: q, mode: "insensitive" } }, { city: { contains: q, mode: "insensitive" } }, { state: { contains: q, mode: "insensitive" } }, { propertyAddress: { contains: q, mode: "insensitive" } }, { summary: { contains: q, mode: "insensitive" } }, { sponsorCompany: { name: { contains: q, mode: "insensitive" } } }] }
    : {};
  const ownerFilter: Prisma.DealWhereInput = { ...(ownerId ? { ownerId } : {}), ...match };
  // a search shows every closed and lost match; without one the two columns show a preview
  const closedTake = q ? undefined : CLOSED_PREVIEW;

  const select = {
    id: true,
    name: true,
    stage: true,
    sponsorName: true,
    propertyName: true,
    city: true,
    state: true,
    assetClass: true,
    strategy: true,
    propertyAddress: true,
    hubspotId: true,
    _count: { select: { files: true, facts: true } },
    requestType: true,
    requestedAmount: true,
    closeDate: true,
    updatedAt: true,
    owner: { select: { name: true } },
  } as const;

  const [active, closed, lost, closedCount, lostCount, users] = await Promise.all([
    prisma.deal.findMany({ where: { stage: { in: [...ACTIVE_STAGES] }, parentDealId: null, ...ownerFilter }, orderBy: { updatedAt: "desc" }, select }),
    prisma.deal.findMany({ where: { stage: "Deal Closed", ...ownerFilter }, orderBy: { updatedAt: "desc" }, take: closedTake, select }),
    prisma.deal.findMany({ where: { stage: "Deal Lost", ...ownerFilter }, orderBy: { updatedAt: "desc" }, take: closedTake, select }),
    prisma.deal.count({ where: { stage: "Deal Closed", ...ownerFilter } }),
    prisma.deal.count({ where: { stage: "Deal Lost", ...ownerFilter } }),
    prisma.user.findMany({ where: { active: true }, orderBy: { name: "asc" } }),
  ]);

  const toBoard = (d: (typeof active)[number]): BoardDeal => ({
    ...d,
    intro: isBlindIntro({ ...d, fileCount: d._count.files, factCount: d._count.facts }),
    ownerName: d.owner?.name ?? null,
    closeDate: d.closeDate?.toISOString() ?? null,
    updatedAt: d.updatedAt.toISOString(),
  });

  return (
    <>
      <PageHeader
        title="Deals"
        subtitle={q ? `${active.length + closed.length + lost.length} deals match "${q}" · ${active.length} active · ${closed.length} closed · ${lost.length} lost` : `${active.length} active · ${closedCount} closed · ${lostCount} lost`}
        actions={
          <>
            <form action="/deals" className="flex items-center gap-2">
              <input name="q" defaultValue={q} placeholder="Search deals: name, sponsor, city, address, plan" className="input w-72" />
              <select name="owner" defaultValue={ownerId} className="input w-44">
                <option value="">All owners</option>
                {users.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.name}
                  </option>
                ))}
              </select>
              <button className="btn-secondary" type="submit">
                {q ? "Search" : "Filter"}
              </button>
              {q && (
                <Link href={ownerId ? `/deals?owner=${ownerId}` : "/deals"} className="text-xs text-muted hover:underline">
                  Clear
                </Link>
              )}
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
        counts={{ "Deal Closed": q ? closed.length : closedCount, "Deal Lost": q ? lost.length : lostCount }}
        preview={q ? Number.MAX_SAFE_INTEGER : CLOSED_PREVIEW}
      />
    </>
  );
}
