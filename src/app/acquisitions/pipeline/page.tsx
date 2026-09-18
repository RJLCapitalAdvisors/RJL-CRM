import Link from "next/link";
import { prisma } from "@/lib/db";
import { PageHeader } from "@/components/ui";
import { fmtDate } from "@/lib/format";
import { aqDealStageTone, aqFullName, propertyLine, usd } from "@/lib/acquisitions";
import { getAqDealStages } from "@/lib/acquisitions-stages";
import { StageSelect } from "./stage-select";
import { StageEditor } from "./stage-editor";

export const metadata = { title: "Deal Pipeline" };
export const dynamic = "force-dynamic";

/** Deal Pipeline: every property marked Deal, one column per stage. The stages themselves are edited here (Edit stages): add, rename, reorder, remove when empty. */
export default async function AqPipelinePage() {
  const [stages, deals] = await Promise.all([
    getAqDealStages(),
    prisma.aqProperty.findMany({
      where: { stages: { contains: '"Deal"' } },
      orderBy: { updatedAt: "desc" },
      include: { companies: { include: { company: { select: { id: true, name: true } } } }, contacts: { include: { contact: { select: { id: true, firstName: true, lastName: true, email: true, phone: true } } } } },
    }),
  ]);
  // a deal whose stage no longer exists sits in the first column until someone moves it
  const stageOf = (d: { dealStage: string | null }) => (d.dealStage && stages.includes(d.dealStage) ? d.dealStage : stages[0]);
  const columns = stages.map((stage) => ({ stage, rows: deals.filter((d) => stageOf(d) === stage) }));
  const counts = Object.fromEntries(columns.map((c) => [c.stage, c.rows.length])) as Record<string, number>;
  return (
    <>
      <PageHeader
        compact
        title="Deal Pipeline"
        subtitle={`${deals.length} deal${deals.length === 1 ? "" : "s"} across ${stages.length} stage${stages.length === 1 ? "" : "s"} · a property joins when its stage carries Deal`}
        actions={
          <Link href="/acquisitions/properties/new" className="btn-primary">
            New property
          </Link>
        }
      />
      <div className="px-8 pt-3">
        <StageEditor stages={stages} counts={counts} />
      </div>
      <div className="overflow-x-auto px-8 py-4">
        <div className="grid gap-3" style={{ gridTemplateColumns: `repeat(${stages.length}, minmax(200px, 1fr))`, minWidth: `${stages.length * 212}px` }}>
          {columns.map((col) => (
            <div key={col.stage} id={col.stage} className="flex flex-col rounded-lg border border-line bg-cream-50">
              <div className="flex items-center justify-between border-b border-line px-3 py-2">
                <span className={`chip text-[11px] ${aqDealStageTone(col.stage)}`}>{col.stage}</span>
                <span className="text-xs text-muted">{col.rows.length}</span>
              </div>
              <div className="flex flex-col gap-2 p-2">
                {col.rows.map((d) => (
                  <div key={d.id} className="card p-3 text-sm">
                    <Link href={`/acquisitions/properties/${d.id}`} className="font-medium hover:underline">
                      {d.address}
                    </Link>
                    <div className="text-xs text-muted">{propertyLine(d)}</div>
                    {d.askingPrice != null && <div className="text-xs">asking {usd(d.askingPrice)}</div>}
                    {d.companies.length > 0 && <div className="mt-1 truncate text-xs text-muted">{d.companies.map((x) => x.company.name).join(", ")}</div>}
                    {d.contacts.length > 0 && <div className="truncate text-xs text-muted">{d.contacts.map((x) => aqFullName(x.contact)).join(", ")}</div>}
                    <div className="mt-2 flex items-center justify-between gap-2">
                      <StageSelect id={d.id} stage={stageOf(d)} stages={stages} />
                      <span className="text-[11px] text-muted">{fmtDate(d.updatedAt)}</span>
                    </div>
                  </div>
                ))}
                {col.rows.length === 0 && <div className="px-2 py-6 text-center text-xs text-muted">Nothing here</div>}
              </div>
            </div>
          ))}
        </div>
      </div>
    </>
  );
}
