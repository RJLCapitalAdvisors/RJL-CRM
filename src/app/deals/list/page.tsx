import Link from "next/link";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { DEAL_STAGES, stageTone } from "@/lib/taxonomy";
import { PageHeader, Pager, SearchForm } from "@/components/ui";
import { fmtDate, fmtMoney, str } from "@/lib/format";

export const metadata = { title: "Deals list" };

export const dynamic = "force-dynamic";
const PAGE = 50;

export default async function DealListPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const q = str(sp.q).trim();
  const stage = str(sp.stage);
  const page = Math.max(1, Number(str(sp.page)) || 1);
  const where: Prisma.DealWhereInput = {
    AND: [q ? { OR: [{ name: { contains: q, mode: "insensitive" } }, { propertyName: { contains: q, mode: "insensitive" } }, { sponsorName: { contains: q, mode: "insensitive" } }, { city: { contains: q, mode: "insensitive" } }, { state: { contains: q, mode: "insensitive" } }, { propertyAddress: { contains: q, mode: "insensitive" } }, { summary: { contains: q, mode: "insensitive" } }, { sponsorCompany: { name: { contains: q, mode: "insensitive" } } }] } : {}, stage ? { stage } : {}],
  };
  const [total, rows] = await Promise.all([
    prisma.deal.count({ where }),
    prisma.deal.findMany({ where, orderBy: { updatedAt: "desc" }, skip: (page - 1) * PAGE, take: PAGE, include: { owner: true } }),
  ]);

  const makeHref = (p: number) => {
    const u = new URLSearchParams();
    if (q) u.set("q", q);
    if (stage) u.set("stage", stage);
    u.set("page", String(p));
    return `/deals/list?${u}`;
  };
  return (
    <>
      <PageHeader
        title="Deal list"
        subtitle={`${total.toLocaleString()} deals${stage ? ` in ${stage}` : ""}`}
        actions={
          <Link href="/deals" className="btn-secondary">
            Back to board
          </Link>
        }
      />
      <div className="px-6 py-2">
        <SearchForm action="/deals/list" q={q} placeholder="Search deal, property, sponsor, city, address or plan">
          <select name="stage" defaultValue={stage} className="input w-52">
            <option value="">All stages</option>
            {DEAL_STAGES.map((s) => (
              <option key={s}>{s}</option>
            ))}
          </select>
        </SearchForm>
      </div>
      <div className="mx-8 overflow-x-auto rounded-lg border border-line bg-paper">
        <table className="table w-full">
          <thead>
            <tr>
              <th>Deal</th>
              <th>Stage</th>
              <th>Sponsor</th>
              <th>Requested</th>
              <th>Owner</th>
              <th>Close date</th>
              <th>Updated</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((d) => (
              <tr key={d.id}>
                <td>
                  <Link href={`/deals/${d.id}`} className="font-medium hover:underline">
                    {d.propertyName ?? d.name}
                  </Link>
                </td>
                <td>
                  <span className={`chip border ${stageTone(d.stage)}`}>{d.stage}</span>
                </td>
                <td>{d.sponsorName}</td>
                <td className="whitespace-nowrap">{fmtMoney(d.requestedAmount)}</td>
                <td className="whitespace-nowrap">{d.owner?.name}</td>
                <td className="whitespace-nowrap text-muted">{fmtDate(d.closeDate)}</td>
                <td className="whitespace-nowrap text-muted">{fmtDate(d.updatedAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Pager page={page} pageSize={PAGE} total={total} makeHref={makeHref} />
    </>
  );
}
