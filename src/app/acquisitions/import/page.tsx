import Link from "next/link";
import { prisma } from "@/lib/db";
import { PageHeader } from "@/components/ui";
import { Uploader } from "./uploader";

export const metadata = { title: "Import" };
export const dynamic = "force-dynamic";

const STATUS: Record<string, { label: string; tone: string }> = {
  READING: { label: "Reading", tone: "bg-amber-100 text-amber-800" },
  REVIEW: { label: "Ready to review", tone: "bg-sky-100 text-sky-800" },
  IMPORTING: { label: "Importing", tone: "bg-amber-100 text-amber-800" },
  DONE: { label: "Imported", tone: "bg-emerald-100 text-emerald-800" },
  FAILED: { label: "Failed", tone: "bg-red-100 text-red-700" },
};

/**
 * Import (Oct 7, 2026; its own section, not under Ask the CRM): the dedicated place for call exports. Code reads the whole file and folds it
 * into properties, Claude reads the calls a few properties at a time, Shawn reviews one line per property, Import
 * writes it, and the result is checked against the file. The chat stays for questions and instructions.
 */
export default async function AqImportPage() {
  const runs = await prisma.aqImportRun.findMany({ orderBy: { createdAt: "desc" }, take: 30, select: { id: true, fileName: true, status: true, createdAt: true, createdBy: true, propertyCount: true, rowCount: true, importedAt: true } });
  return (
    <>
      <PageHeader title="Import" subtitle="Load a Terakotta call export: every row read, every property accounted for." />
      <div className="mx-auto max-w-5xl space-y-6 px-8 py-6">
        <Uploader />
        <div className="grid gap-3 text-xs text-muted sm:grid-cols-4">
          {[
            ["1. Read", "Code reads every row and folds the phone rows into properties by parcel and address."],
            ["2. Judge", "Claude reads the calls (tags, notes, transcripts) a few properties at a time, with your Import instructions."],
            ["3. Review", "One line per property: what will happen and why. Change any of them; answer the questions."],
            ["4. Import and check", "Written to the CRM, then checked: every property in the file is in the CRM, in Junk, or waiting on you."],
          ].map(([t, d]) => (
            <div key={t} className="rounded-lg border border-line bg-paper p-3">
              <div className="mb-1 font-semibold text-ink">{t}</div>
              {d}
            </div>
          ))}
        </div>
        <div className="card overflow-hidden">
          <div className="border-b border-line bg-cream px-4 py-2 text-sm font-semibold">Imports</div>
          {runs.length ? (
            <table className="w-full text-sm">
              <thead className="text-left text-xs text-muted">
                <tr className="border-b border-line">
                  <th className="px-4 py-2 font-medium">File</th>
                  <th className="px-4 py-2 font-medium">Properties</th>
                  <th className="px-4 py-2 font-medium">Status</th>
                  <th className="px-4 py-2 font-medium">Uploaded</th>
                </tr>
              </thead>
              <tbody>
                {runs.map((r) => (
                  <tr key={r.id} className="border-b border-line last:border-0 hover:bg-cream-50">
                    <td className="px-4 py-2">
                      <Link href={`/acquisitions/import/${r.id}`} className="font-medium text-sky-700 hover:underline">
                        {r.fileName}
                      </Link>
                    </td>
                    <td className="px-4 py-2 text-muted">
                      {r.propertyCount} from {r.rowCount} rows
                    </td>
                    <td className="px-4 py-2">
                      <span className={`rounded px-1.5 py-0.5 text-[11px] font-medium ${STATUS[r.status]?.tone ?? ""}`}>{STATUS[r.status]?.label ?? r.status}</span>
                    </td>
                    <td className="px-4 py-2 text-muted">
                      {r.createdAt.toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}
                      {r.createdBy ? ` · ${r.createdBy}` : ""}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <div className="px-4 py-6 text-sm text-muted">No imports yet.</div>
          )}
        </div>
        <div className="text-xs text-muted">
          How files are read: <Link href="/acquisitions/settings/import-instructions" className="text-sky-700 hover:underline">Import instructions</Link> and <Link href="/acquisitions/settings/data-rules" className="text-sky-700 hover:underline">Data rules</Link>. Change them there or tell <Link href="/acquisitions/ask" className="text-sky-700 hover:underline">Ask the CRM</Link> &quot;from now on…&quot;.
        </div>
      </div>
    </>
  );
}
