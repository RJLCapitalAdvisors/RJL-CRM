import Link from "next/link";
import { prisma } from "@/lib/db";
import { PageHeader, SearchForm } from "@/components/ui";
import { fmtDate, str } from "@/lib/format";
import { AddJunkPhone } from "./add-junk-phone";
import { JunkPhoneButtons } from "./junk-phone-buttons";

export const metadata = { title: "Junk Phone Numbers" };
export const dynamic = "force-dynamic";

/**
 * Junk > Junk Phone Numbers (Oct 5, 2026; under Settings since Sep 23): numbers flagged junk by a right-click on a
 * contact card or a property's Owners or Operators window, typed here, or marked in an imported call list. Each row
 * keeps the contact and the property it came from, the reason (Wrong number or Bad number), the date and the source
 * file. A junk number is taken off the contact and no import writes it onto anyone again. Restore puts it back on
 * its contact; Forget just drops it from the list.
 */
export default async function JunkPhonesPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const q = str(sp.q).trim();
  const rows = await prisma.aqJunkPhone.findMany({
    where: q ? { OR: [{ raw: { contains: q } }, { digits: { contains: q.replace(/\D/g, "") || "~" } }, { contactName: { contains: q, mode: "insensitive" } }, { reason: { contains: q, mode: "insensitive" } }, { sourceFile: { contains: q, mode: "insensitive" } }] } : undefined,
    orderBy: { createdAt: "desc" },
    take: 500,
  });
  const propertyIds = [...new Set(rows.map((r) => r.propertyId).filter((x): x is string => Boolean(x)))];
  const props = propertyIds.length ? await prisma.aqProperty.findMany({ where: { id: { in: propertyIds } }, select: { id: true, address: true, city: true, junkedAt: true } }) : [];
  const propertyOf = new Map(props.map((p) => [p.id, p]));
  return (
    <>
      <PageHeader title="Junk Phone Numbers" subtitle={`${rows.length} number${rows.length === 1 ? "" : "s"} · off their contacts, never written back by an import · Restore puts one back on its contact`} />
      <div className="flex flex-wrap items-center gap-3 px-6 py-2">
        <SearchForm action="/acquisitions/junk/phones" q={q} placeholder="Search number, person, reason or source file" />
      </div>
      <div className="mx-6 mb-4 space-y-3">
        <AddJunkPhone />
        <div className="card overflow-hidden">
          <table className="table dense w-full">
            <thead>
              <tr>
                <th>Phone Number</th>
                <th>Contact Name</th>
                <th>Property</th>
                <th>Reason</th>
                <th>Date</th>
                <th>Source File</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const p = r.propertyId ? propertyOf.get(r.propertyId) : null;
                return (
                  <tr key={r.id}>
                    <td className="whitespace-nowrap font-medium tabular-nums">{r.raw}</td>
                    <td className="whitespace-nowrap">{r.contactId ? <Link href={`/acquisitions/contacts/${r.contactId}`} className="hover:underline">{r.contactName ?? "contact"}</Link> : <span className="text-muted">{r.contactName ?? (r.field === "import" ? "an import" : "—")}</span>}</td>
                    <td className="max-w-[260px] truncate whitespace-nowrap">
                      {p ? (
                        <Link href={`/acquisitions/properties/${p.id}`} className="hover:underline">
                          {p.address}
                          {p.city ? <span className="text-muted">, {p.city}</span> : null}
                          {p.junkedAt && <span className="ml-1 chip bg-red-100 text-[10px] text-red-800">Junk</span>}
                        </Link>
                      ) : (
                        <span className="text-muted">—</span>
                      )}
                    </td>
                    <td className="max-w-[240px] truncate text-xs" title={r.reason ?? undefined}>{r.reason ?? <span className="text-muted">—</span>}</td>
                    <td className="whitespace-nowrap text-xs text-muted">{fmtDate(r.createdAt)}{r.createdBy ? ` · ${r.createdBy}` : ""}</td>
                    <td className="max-w-[200px] truncate text-xs text-muted" title={r.sourceFile ?? undefined}>{r.sourceFile ?? (r.field && r.field !== "import" && r.field !== "by hand" ? `from ${r.field}` : r.field ?? "—")}</td>
                    <td className="whitespace-nowrap text-right">
                      <JunkPhoneButtons id={r.id} hasContact={Boolean(r.contactId)} />
                    </td>
                  </tr>
                );
              })}
              {rows.length === 0 && (
                <tr>
                  <td colSpan={7} className="py-10 text-center text-muted">
                    {q ? "No junk numbers match." : "No junk numbers yet. Right-click a number on a contact card or in a property's Owners or Operators window, or type one above."}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}
