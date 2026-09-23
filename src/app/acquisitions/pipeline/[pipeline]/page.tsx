import Link from "next/link";
import { JunkTarget } from "@/components/junk-target";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { PageHeader } from "@/components/ui";
import { fmtDate } from "@/lib/format";
import { AQ_PIPELINES, aqDealStageTone, aqFullName, aqRoleColor, isAqPipeline, parseJsonList, propertyLine, usd } from "@/lib/acquisitions";
import { getAqStages } from "@/lib/acquisitions-stages";
import { StageSelect } from "../stage-select";
import { StageEditor } from "../stage-editor";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ pipeline: string }> }) {
  const { pipeline } = await params;
  return { title: isAqPipeline(pipeline) ? AQ_PIPELINES[pipeline].label : "Pipeline" };
}

type Card = { id: string; stage: string | null; updatedAt: Date; body: React.ReactNode };

/**
 * The three pipelines (Jonathan, Sep 23, 2026), same board each: one column per stage, cards moved with the picker on
 * them, the stages edited on the board (Edit stages: add, rename, reorder, remove when empty). Buyers holds every contact
 * with the role Buyer, Operators every contact with the role Operator, Deals every property whose Call Result carries
 * Deal. A card whose stage no longer exists sits in the first column until someone moves it.
 */
export default async function AqPipelinePage({ params }: { params: Promise<{ pipeline: string }> }) {
  const { pipeline } = await params;
  if (!isAqPipeline(pipeline)) notFound();
  const def = AQ_PIPELINES[pipeline];
  const stages = await getAqStages(pipeline);
  let cards: Card[];
  if (pipeline === "deals") {
    const deals = await prisma.aqProperty.findMany({
      where: { stages: { contains: '"Deal"' }, junkedAt: null },
      orderBy: { updatedAt: "desc" },
      include: { companies: { include: { company: { select: { id: true, name: true } } } }, contacts: { include: { contact: { select: { id: true, firstName: true, lastName: true, email: true, phone: true } } } } },
    });
    cards = deals.map((d) => ({
      id: d.id,
      stage: d.dealStage,
      updatedAt: d.updatedAt,
      body: (
        <>
          <JunkTarget target={{ kind: "property", propertyId: d.id, label: d.address }}>
            <Link href={`/acquisitions/properties/${d.id}`} className="font-medium hover:underline">
              {d.address}
            </Link>
          </JunkTarget>
          <div className="text-xs text-muted">{propertyLine(d)}</div>
          {d.askingPrice != null && <div className="text-xs">asking {usd(d.askingPrice)}</div>}
          {d.companies.length > 0 && <div className="mt-1 truncate text-xs text-muted">{d.companies.map((x) => x.company.name).join(", ")}</div>}
          {d.contacts.length > 0 && <div className="truncate text-xs text-muted">{d.contacts.map((x) => aqFullName(x.contact)).join(", ")}</div>}
        </>
      ),
    }));
  } else {
    const people = await prisma.aqContact.findMany({
      where: { roles: { contains: `"${def.role}"` } },
      orderBy: { updatedAt: "desc" },
      include: { company: { select: { id: true, name: true } } },
    });
    cards = people.map((c) => ({
      id: c.id,
      stage: pipeline === "buyers" ? c.buyerStage : c.operatorStage,
      updatedAt: c.updatedAt,
      body: (
        <>
          <Link href={`/acquisitions/contacts/${c.id}`} className="font-medium hover:underline">
            {aqFullName(c)}
          </Link>
          {(c.company || (pipeline === "operators" && c.operatorBrandName)) && <div className="truncate text-xs text-muted">{pipeline === "operators" && c.operatorBrandName ? c.operatorBrandName : c.company?.name}</div>}
          {(c.phone || c.email) && <div className="truncate text-xs text-muted">{[c.phone, c.email].filter(Boolean).join(" · ")}</div>}
          <div className="mt-1 flex flex-wrap gap-1">
            {parseJsonList(c.roles).map((r) => (
              <span key={r} className={`chip text-[10px] ${aqRoleColor(r)}`}>
                {r}
              </span>
            ))}
            {pipeline === "operators" && c.operatorPipelineStatus && <span className="chip bg-cream text-[10px]">{c.operatorPipelineStatus}</span>}
          </div>
          {(c.callResult || c.lastCallDate) && <div className="mt-1 text-xs text-muted">{[c.callResult, c.lastCallDate ? `called ${fmtDate(c.lastCallDate)}` : null].filter(Boolean).join(" · ")}</div>}
        </>
      ),
    }));
  }
  const stageOf = (c: Card) => (c.stage && stages.includes(c.stage) ? c.stage : stages[0]);
  const columns = stages.map((stage) => ({ stage, rows: cards.filter((c) => stageOf(c) === stage) }));
  const counts = Object.fromEntries(columns.map((c) => [c.stage, c.rows.length])) as Record<string, number>;
  const joins = pipeline === "deals" ? "a property joins when its Call Result carries Deal" : `a contact joins when its role carries ${def.role}`;
  return (
    <>
      <PageHeader
        compact
        title={def.label}
        subtitle={`${cards.length} ${def.noun}${cards.length === 1 ? "" : "s"} across ${stages.length} stage${stages.length === 1 ? "" : "s"} · ${joins}`}
        actions={
          pipeline === "deals" ? (
            <Link href="/acquisitions/properties/new" className="btn-primary">
              New property
            </Link>
          ) : (
            <Link href={`/acquisitions/contacts/new?role=${def.role}`} className="btn-primary">
              New {def.noun}
            </Link>
          )
        }
      />
      <div className="px-8 pt-3">
        <StageEditor pipeline={pipeline} noun={def.noun} stages={stages} counts={counts} />
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
                {col.rows.map((c) => (
                  <div key={c.id} className="card p-3 text-sm">
                    {c.body}
                    <div className="mt-2 flex items-center justify-between gap-2">
                      <StageSelect pipeline={pipeline} id={c.id} stage={stageOf(c)} stages={stages} />
                      <span className="text-[11px] text-muted">{fmtDate(c.updatedAt)}</span>
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
