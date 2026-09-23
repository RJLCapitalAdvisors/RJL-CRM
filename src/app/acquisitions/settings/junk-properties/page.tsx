import Link from "next/link";
import { prisma } from "@/lib/db";
import { PageHeader } from "@/components/ui";
import { fmtDate } from "@/lib/format";
import { propertyLine } from "@/lib/acquisitions";
import { restoreAqProperty } from "../../junk-actions";
import { DestroyButton } from "./destroy-button";

export const metadata = { title: "Junk Properties" };
export const dynamic = "force-dynamic";

/**
 * Settings > Junk Properties (Shawn, Sep 23, 2026): property cards sent to junk by a right-click on the address, or
 * marked junk in an imported spreadsheet. The whole card is kept (people, notes, transcripts, calls) and hidden from
 * the lists, the map, the pipeline and the assistant. Restore puts it back; Remove for good deletes it.
 */
export default async function JunkPropertiesPage() {
  const rows = await prisma.aqProperty.findMany({
    where: { junkedAt: { not: null } },
    orderBy: { junkedAt: "desc" },
    include: { companies: { include: { company: { select: { name: true } } } }, contacts: { include: { contact: { select: { firstName: true, lastName: true, email: true } } } }, _count: { select: { aqNotes: true, transcripts: true } } },
  });
  return (
    <>
      <PageHeader compact title="Junk Properties" subtitle={`${rows.length} propert${rows.length === 1 ? "y" : "ies"} · right-click a property's address anywhere to send its whole card here; the card is kept until removed for good`} />
      <div className="mx-8 my-4 card overflow-hidden">
        <table className="table dense w-full">
          <thead>
            <tr>
              <th>Property</th>
              <th>Where</th>
              <th>Business</th>
              <th>People</th>
              <th>On the card</th>
              <th>Why</th>
              <th>Junked</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((p) => (
              <tr key={p.id}>
                <td className="whitespace-nowrap font-medium">
                  <Link href={`/acquisitions/properties/${p.id}`} className="hover:underline">
                    {p.address}
                  </Link>
                </td>
                <td className="whitespace-nowrap text-xs text-muted">{propertyLine(p) || "—"}</td>
                <td className="max-w-[200px] truncate text-xs">{p.businessName ?? "—"}</td>
                <td className="max-w-[240px] truncate text-xs text-muted" title={p.contacts.map((x) => [x.contact.firstName, x.contact.lastName].filter(Boolean).join(" ") || x.contact.email).join(", ")}>
                  {[...p.companies.map((x) => x.company.name), ...p.contacts.map((x) => [x.contact.firstName, x.contact.lastName].filter(Boolean).join(" ") || x.contact.email)].filter(Boolean).join(", ") || "—"}
                </td>
                <td className="whitespace-nowrap text-xs text-muted">{[p._count.aqNotes ? `${p._count.aqNotes} note${p._count.aqNotes === 1 ? "" : "s"}` : null, p._count.transcripts ? `${p._count.transcripts} transcript${p._count.transcripts === 1 ? "" : "s"}` : null].filter(Boolean).join(", ") || "—"}</td>
                <td className="max-w-[240px] truncate text-xs text-muted" title={p.junkReason ?? undefined}>{p.junkReason ?? "—"}</td>
                <td className="whitespace-nowrap text-xs text-muted">{p.junkedAt ? fmtDate(p.junkedAt) : ""}{p.junkedBy ? ` · ${p.junkedBy}` : ""}</td>
                <td className="whitespace-nowrap text-right">
                  <div className="flex items-center justify-end gap-3">
                    <form action={restoreAqProperty.bind(null, p.id)}>
                      <button type="submit" className="text-xs text-sky-700 hover:underline" title="Back to the Properties list with everything on the card">
                        Restore
                      </button>
                    </form>
                    <DestroyButton id={p.id} address={p.address} />
                  </div>
                </td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={8} className="py-10 text-center text-muted">
                  No junk properties.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </>
  );
}
