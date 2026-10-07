import { notFound } from "next/navigation";
import Link from "next/link";
import { prisma } from "@/lib/db";
import { PageHeader } from "@/components/ui";
import { effective } from "@/lib/aq-import-build";
import { runContext, runDecisions, runGroups, runOverrides, runReport } from "@/lib/aq-import-runs";
import { dialed, isBadNumber, lastCallOf, tagsOf } from "@/lib/aq-terakotta";
import { RunClient, type ReviewRow } from "./run-client";

export const metadata = { title: "Import" };
export const dynamic = "force-dynamic";

const when = (iso: string | undefined) => (iso ? new Date(iso).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : "");

/** One import: reading progress, then one line per property to review, then Import and the check against the file. */
export default async function AqImportRunPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const run = await prisma.aqImportRun.findUnique({ where: { id } });
  if (!run) notFound();
  const parsed = runGroups(run);
  const decisions = runDecisions(run);
  const overrides = runOverrides(run);
  const ctx = runContext(run);
  const rows: ReviewRow[] = parsed.groups.map((g, i) => {
    const read = decisions[g.key];
    const r = read ? effective(read, overrides[g.key]) : null;
    const c = ctx.crm[g.key] ?? null;
    const wrong = new Set((r?.wrong ?? []).map((w) => w.phone));
    const nameOf = (k: string | null) => g.people.find((p) => p.key === k)?.name ?? null;
    return {
      key: g.key,
      n: i + 1,
      address: g.facts.address,
      city: [g.facts.city, g.facts.state].filter(Boolean).join(", "),
      business: g.facts.businessName ?? null,
      crmId: c?.id ?? null,
      crmNote: c ? [c.junk ? `in Junk (${c.junk})` : null, c.isDeal ? `deal at ${c.dealStage}` : c.pipeline ? "on the Deals Pipeline" : null, c.result, c.lastCall ? `last call ${c.lastCall}` : null].filter(Boolean).join(" · ") || "in the CRM" : null,
      hint: ctx.hints[g.key] ?? [],
      read: Boolean(read),
      outcome: r?.outcome ?? null,
      list: r?.deal ? "deal" : r?.pipeline ? "pipeline" : null,
      callResult: r?.callResult ?? null,
      callBackDate: r?.callBackDate ?? null,
      junkReason: r?.junkReason ?? null,
      question: r?.question ?? null,
      guess: r?.guess ?? null,
      why: r?.why ?? null,
      by: read?.by ?? null,
      override: overrides[g.key]?.outcome ?? null,
      tags: tagsOf(g),
      lastCall: when(lastCallOf(g)),
      dialed: g.phones.filter(dialed).length,
      numbers: g.phones.length,
      junkNumbers: g.phones.filter((p) => isBadNumber(p) || wrong.has(p.digits)).length,
      people: g.people.map((p) => p.name + (p.unconfirmed ? " (unconfirmed)" : "")),
      owner: g.facts.ownerEntity ?? null,
      calls: g.phones
        .filter((p) => dialed(p) || p.tags.length || p.notes.length)
        .map((p) => ({ number: p.number, who: nameOf(p.person) ?? (p.slot.startsWith("Store") ? "the business" : p.slot), when: when(p.lastCall), disposition: p.disposition ?? "", tags: p.tags, notes: p.notes.map((n) => n.text), transcript: p.transcript ? p.transcript.slice(0, 1500) : null, junk: isBadNumber(p) || wrong.has(p.digits) })),
    };
  });
  return (
    <>
      <PageHeader title={<Link href="/acquisitions/import" className="hover:underline">Import</Link>} subtitle={`${run.fileName} · ${run.rowCount} rows → ${run.propertyCount} properties`} />
      <RunClient id={run.id} status={run.status} fileName={run.fileName} readDone={run.readDone} importDone={run.importDone} total={parsed.groups.length} rows={rows} report={runReport(run)} ignored={parsed.ignored} error={run.error} />
    </>
  );
}
