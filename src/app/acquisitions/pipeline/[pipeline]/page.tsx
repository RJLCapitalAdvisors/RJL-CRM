import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { PageHeader, SearchForm } from "@/components/ui";
import { str } from "@/lib/format";
import { getAqDealStages } from "@/lib/acquisitions-stages";
import { AqGrid } from "../../grid";
import { contactColumns, contactGridRow } from "../../contacts/columns";
import { paneColumns, paneRows } from "../../properties/columns";
import { PropertyPanes } from "../../properties/panes";

export const dynamic = "force-dynamic";

const LISTS = {
  buyers: { title: "Buyers Pipeline", role: "Buyer", noun: "buyer", from: "the Buyers list" },
  operators: { title: "Operators Pipeline", role: "Operator", noun: "operator", from: "the Operators list" },
  deals: { title: "Deals Pipeline", role: null, noun: "property", from: "the Properties list" },
} as const;
type Key = keyof typeof LISTS;
const isKey = (s: string): s is Key => s in LISTS;

export async function generateMetadata({ params }: { params: Promise<{ pipeline: string }> }) {
  const { pipeline } = await params;
  return { title: isKey(pipeline) ? LISTS[pipeline].title : "Pipeline" };
}

/**
 * The three pipelines as lists (Jonathan, Sep 24, 2026): the same sheets as Contacts and Properties, holding only what
 * was sent to the pipeline ("Send to pipeline" on a contact card or a property ticket; the record stays where it was).
 * Buyers holds pipeline contacts with the role Buyer, Operators those with Operator, Deals the pipeline properties.
 * Each row carries a 1 to 5 priority; the highest sit at the top. The Deals board (stages across columns) is its own
 * page under Deals in the sidebar.
 */
export default async function AqPipelineListPage({ params, searchParams }: { params: Promise<{ pipeline: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { pipeline } = await params;
  if (!isKey(pipeline)) notFound();
  const def = LISTS[pipeline];
  const sp = await searchParams;
  const q = str(sp.q).trim();
  const companies = await prisma.aqCompany.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true, domain: true, website: true } });
  const orderBy = [{ pipelinePriority: { sort: "desc" as const, nulls: "last" as const } }, { pipelineAt: "desc" as const }];

  if (pipeline === "deals") {
    const rows = await prisma.aqProperty.findMany({
      where: {
        pipelineAt: { not: null },
        junkedAt: null,
        ...(q ? { OR: [{ address: { contains: q, mode: "insensitive" } }, { city: { contains: q, mode: "insensitive" } }, { businessName: { contains: q, mode: "insensitive" } }, { companies: { some: { company: { name: { contains: q, mode: "insensitive" } } } } }] } : {}),
      },
      orderBy,
      include: {
        companies: { include: { company: { select: { name: true } } } },
        contacts: { include: { contact: { include: { aqNotes: { orderBy: { createdAt: "desc" }, take: 1, select: { body: true } } } } } },
        aqNotes: { orderBy: { createdAt: "desc" }, take: 1, select: { body: true } },
      },
    });
    const dealStages = await getAqDealStages();
    return (
      <>
        <PageHeader compact title={def.title} subtitle={`${rows.length} propert${rows.length === 1 ? "y" : "ies"} sent to the pipeline from ${def.from} · highest priority first · Send to pipeline on a property ticket adds one`} actions={<Link href="/acquisitions/deals" className="btn-secondary">Deals board</Link>} />
        <div className="flex flex-wrap items-center gap-3 px-6 py-2">
          <SearchForm action={`/acquisitions/pipeline/${pipeline}`} q={q} placeholder="Search address, city, business or company" />
          <div id="grid-tools" className="ml-auto" />
        </div>
        <div className="mx-6 h-[calc(100vh-110px)] min-h-[400px]">
          <PropertyPanes rows={paneRows(rows)} columns={paneColumns(dealStages, companies)} />
        </div>
      </>
    );
  }

  const rows = await prisma.aqContact.findMany({
    where: {
      pipelineAt: { not: null },
      roles: { contains: `"${def.role}"` },
      ...(q ? { OR: [{ firstName: { contains: q, mode: "insensitive" } }, { lastName: { contains: q, mode: "insensitive" } }, { email: { contains: q, mode: "insensitive" } }, { phone: { contains: q } }, { operatorBrandName: { contains: q, mode: "insensitive" } }, { company: { name: { contains: q, mode: "insensitive" } } }] } : {}),
    },
    orderBy,
    include: { properties: { include: { property: { select: { address: true } } } }, aqNotes: { orderBy: { createdAt: "desc" }, take: 1, select: { body: true } } },
  });
  const columns = contactColumns(companies, pipeline === "operators");
  // priority first, then the name: the pipeline reads top down
  const pri = columns.findIndex((c) => c.key === "pipelinePriority");
  const front = pri >= 0 ? [columns[pri], ...columns.slice(0, pri), ...columns.slice(pri + 1)] : columns;
  return (
    <>
      <PageHeader compact title={def.title} subtitle={`${rows.length} ${def.noun}${rows.length === 1 ? "" : "s"} sent to the pipeline from ${def.from} · highest priority first · Send to pipeline on a contact card adds one`} actions={<Link href={`/acquisitions/contacts?role=${def.role}`} className="btn-secondary">{def.role}s list</Link>} />
      <div className="flex flex-wrap items-center gap-3 px-6 py-2">
        <SearchForm action={`/acquisitions/pipeline/${pipeline}`} q={q} placeholder="Search name, email, phone, brand or company" />
        <div id="grid-tools" className="ml-auto" />
      </div>
      <div className="mx-8 flex h-[calc(100vh-110px)] min-h-[400px] flex-col overflow-hidden rounded-lg border border-line bg-paper">
        <AqGrid kind="contact" columns={front} rows={rows.map(contactGridRow)} gridId={`pipeline-${pipeline}`} empty={`Nothing on the ${def.title} yet. Open a ${def.noun} and click Send to pipeline.`} />
      </div>
    </>
  );
}
