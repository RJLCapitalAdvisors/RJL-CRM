import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { PageHeader, Pager, SearchForm } from "@/components/ui";
import { str } from "@/lib/format";
import { AQ_STAGES } from "@/lib/acquisitions";
import { getAqDealStages } from "@/lib/acquisitions-stages";
import { MultiSelect } from "@/components/multi-select";
import { paneColumns, paneRows } from "../../properties/columns";
import { PropertyPanes } from "../../properties/panes";
import { JunkRowActions } from "./junk-row-actions";

export const metadata = { title: "Junk Properties" };
export const dynamic = "force-dynamic";
const PAGE = 50;
const list = (v: string | string[] | undefined) => (Array.isArray(v) ? v : v ? [v] : []).filter(Boolean);

/**
 * Junk > Junk Properties (Oct 5, 2026; under Settings since Sep 23): the same three-pane sheet as Properties, holding
 * the properties sent to junk, with Removed Reason, Removed Date and Source File up front. Everything on the card is
 * kept (owners, operators, numbers, notes, transcripts). Restore puts a property back on the live list; Remove for
 * good deletes it.
 */
export default async function JunkPropertiesPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const q = str(sp.q).trim();
  const stages = list(sp.stage);
  const cities = list(sp.city);
  const states = list(sp.state);
  const page = Math.max(1, Number(str(sp.page)) || 1);
  const where: Prisma.AqPropertyWhereInput = {
    junkedAt: { not: null },
    AND: [
      q
        ? {
            OR: [
              { address: { contains: q, mode: "insensitive" } },
              { city: { contains: q, mode: "insensitive" } },
              { county: { contains: q, mode: "insensitive" } },
              { businessName: { contains: q, mode: "insensitive" } },
              { parcelId: { contains: q, mode: "insensitive" } },
              { junkReason: { contains: q, mode: "insensitive" } },
              { junkSource: { contains: q, mode: "insensitive" } },
              { companies: { some: { company: { name: { contains: q, mode: "insensitive" } } } } },
              { contacts: { some: { contact: { OR: [{ firstName: { contains: q, mode: "insensitive" } }, { lastName: { contains: q, mode: "insensitive" } }, { phone: { contains: q } }] } } } },
            ],
          }
        : {},
      stages.length ? { OR: [...stages.map((s) => ({ stages: { contains: `"${s}"` } })), { contacts: { some: { contact: { callResult: { in: stages } } } } }] } : {},
      cities.length ? { city: { in: cities } } : {},
      states.length ? { state: { in: states } } : {},
    ],
  };
  const [total, rows, allPlaces, dealStages, companies] = await Promise.all([
    prisma.aqProperty.count({ where }),
    prisma.aqProperty.findMany({
      where,
      orderBy: { junkedAt: "desc" },
      skip: (page - 1) * PAGE,
      take: PAGE,
      include: {
        companies: { include: { company: { select: { name: true } } } },
        contacts: { include: { contact: { include: { aqNotes: { orderBy: { createdAt: "desc" }, take: 1, select: { body: true } } } } } },
        aqNotes: { orderBy: { createdAt: "desc" }, take: 1, select: { body: true } },
      },
    }),
    prisma.aqProperty.findMany({ where: { junkedAt: { not: null } }, select: { city: true, state: true } }),
    getAqDealStages(),
    prisma.aqCompany.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true, domain: true, website: true } }),
  ]);
  const cityOptions = [...new Set(allPlaces.map((p) => p.city).filter((c): c is string => Boolean(c)))].sort();
  const stateOptions = [...new Set(allPlaces.map((p) => p.state).filter((c): c is string => Boolean(c)))].sort();
  const makeHref = (p: number) => {
    const u = new URLSearchParams();
    if (q) u.set("q", q);
    for (const s of stages) u.append("stage", s);
    for (const c of cities) u.append("city", c);
    for (const s of states) u.append("state", s);
    u.set("page", String(p));
    return `/acquisitions/junk/properties?${u}`;
  };
  return (
    <>
      <PageHeader title="Junk Properties" subtitle={`${total.toLocaleString()} propert${total === 1 ? "y" : "ies"} sent to junk · the whole card is kept · Restore puts one back on the Properties list`} />
      <div className="flex flex-wrap items-center gap-3 px-6 py-2">
        <SearchForm action="/acquisitions/junk/properties" q={q} placeholder="Search address, business, reason, source file, company or person">
          <div className="w-44">
            <MultiSelect name="stage" options={AQ_STAGES} selected={stages} placeholder="Any call result" />
          </div>
          <div className="w-44">
            <MultiSelect name="city" options={cityOptions} selected={cities} placeholder="Any city" />
          </div>
          <div className="w-32">
            <MultiSelect name="state" options={stateOptions} selected={states} placeholder="Any state" />
          </div>
        </SearchForm>
        <JunkRowActions rows={rows.map((p) => ({ id: p.id, address: p.address }))} />
        <div id="grid-tools" className="ml-auto" />
      </div>
      <div className="mx-6 h-[calc(100vh-150px)] min-h-[400px]">
        <PropertyPanes rows={paneRows(rows)} columns={paneColumns(dealStages, companies, { junk: true })} />
      </div>
      <Pager page={page} pageSize={PAGE} total={total} makeHref={makeHref} />
    </>
  );
}
