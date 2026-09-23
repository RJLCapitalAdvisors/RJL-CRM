import Link from "next/link";
import { prisma } from "@/lib/db";
import { PageHeader } from "@/components/ui";
import { fmtDate } from "@/lib/format";
import { forgetJunkPhone } from "../../junk-actions";
import { AddJunkPhone } from "./add-junk-phone";

export const metadata = { title: "Junk Phone Numbers" };
export const dynamic = "force-dynamic";

/**
 * Settings > Junk Phone Numbers (Shawn, Sep 23, 2026): numbers sent to junk by a right-click on a contact card or an
 * owner or operator window, or labelled junk in an imported spreadsheet. A junk number is taken off every contact and
 * is never written onto one again. Forget puts it back in play (it is not put back on anyone).
 */
export default async function JunkPhonesPage() {
  const rows = await prisma.aqJunkPhone.findMany({ orderBy: { createdAt: "desc" } });
  return (
    <>
      <PageHeader compact title="Junk Phone Numbers" subtitle={`${rows.length} number${rows.length === 1 ? "" : "s"} · right-click a number on a contact card or in a property's Owners or Operators window to send it here; imports add the numbers a spreadsheet marks junk`} />
      <div className="mx-8 my-4 space-y-4">
        <AddJunkPhone />
        <div className="card overflow-hidden">
          <table className="table dense w-full">
            <thead>
              <tr>
                <th>Number</th>
                <th>Was on</th>
                <th>Field</th>
                <th>Why</th>
                <th>Junked</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td className="whitespace-nowrap font-medium tabular-nums">{r.raw}</td>
                  <td className="whitespace-nowrap">{r.contactId ? <Link href={`/acquisitions/contacts/${r.contactId}`} className="hover:underline">{r.contactName ?? "contact"}</Link> : <span className="text-muted">{r.contactName ?? (r.field === "import" ? "an import" : "—")}</span>}</td>
                  <td className="whitespace-nowrap text-xs text-muted">{r.field ?? "—"}</td>
                  <td className="max-w-[320px] truncate text-xs text-muted" title={r.reason ?? undefined}>{r.reason ?? "—"}</td>
                  <td className="whitespace-nowrap text-xs text-muted">{fmtDate(r.createdAt)}{r.createdBy ? ` · ${r.createdBy}` : ""}</td>
                  <td className="text-right">
                    <form action={forgetJunkPhone.bind(null, r.id)}>
                      <button type="submit" className="text-xs text-muted hover:underline" title="Off the junk list; the number may be typed onto a contact again">
                        Forget
                      </button>
                    </form>
                  </td>
                </tr>
              ))}
              {rows.length === 0 && (
                <tr>
                  <td colSpan={6} className="py-10 text-center text-muted">
                    No junk numbers yet.
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
