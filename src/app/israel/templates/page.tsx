import Link from "next/link";
import { prisma } from "@/lib/db";
import { PageHeader, Empty } from "@/components/ui";
import { fmtDate } from "@/lib/format";
import { createTemplateAndOpen, deleteTemplateInline, duplicateTemplate } from "@/app/templates/actions";

export const metadata = { title: "Email templates" };
export const dynamic = "force-dynamic";

const KINDS = [
  { key: "projects", label: "Projects", noun: "project" },
  { key: "apartments", label: "Apartments", noun: "apartment" },
  { key: "houses", label: "Houses", noun: "house" },
] as const;

/**
 * RJL Israel > Templates > Email templates: a list per kind of ticket. Open one and the email is there to edit,
 * with that kind's tokens (an apartment's floor, a house's migrash, a project's total units) plus the person and
 * the sender. Send apartment/house/project starts from the template you pick.
 */
export default async function IlTemplatesPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const raw = Array.isArray(sp.kind) ? sp.kind[0] : sp.kind;
  const kind = (KINDS.find((k) => k.key === raw) ?? KINDS[1]);
  const templates = await prisma.emailTemplate.findMany({ where: { workspace: "IL", kind: kind.key, NOT: { name: { startsWith: "(archived)" } } }, orderBy: { name: "asc" }, select: { id: true, name: true, createdAt: true, updatedAt: true } });
  return (
    <>
      <PageHeader
        title="Email templates"
        subtitle="The emails a unit goes out with. Open one and the email is there to edit, with tokens that fill in from the ticket and the person."
        actions={
          <form action={createTemplateAndOpen.bind(null, "IL", kind.key)}>
            <button type="submit" className="btn-primary">
              New {kind.noun} template
            </button>
          </form>
        }
      />
      <div className="flex flex-col gap-4 px-8 py-5">
        <div className="flex gap-1">
          {KINDS.map((k) => (
            <Link key={k.key} href={`/israel/templates?kind=${k.key}`} className={`rounded-md px-4 py-2 text-sm font-medium ${kind.key === k.key ? "bg-ink text-paper" : "bg-cream text-ink hover:bg-sky/40"}`}>
              {k.label}
            </Link>
          ))}
        </div>
        {templates.length === 0 ? (
          <Empty>No {kind.noun} templates yet. New {kind.noun} template opens a blank one; until there is one, sends use the built-in summary.</Empty>
        ) : (
          <div className="overflow-hidden rounded-lg border border-line bg-paper">
            <table className="table w-full">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Created</th>
                  <th>Modified</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {templates.map((t) => (
                  <tr key={t.id}>
                    <td>
                      <Link href={`/israel/templates/${t.id}`} className="font-medium text-sky-800 hover:underline">
                        {t.name}
                      </Link>
                    </td>
                    <td className="whitespace-nowrap text-muted">{fmtDate(t.createdAt)}</td>
                    <td className="whitespace-nowrap text-muted">{fmtDate(t.updatedAt)}</td>
                    <td className="text-right">
                      <div className="flex justify-end gap-1">
                        <form action={duplicateTemplate.bind(null, t.id)}>
                          <button type="submit" className="btn-ghost px-2 py-1 text-xs">
                            Duplicate
                          </button>
                        </form>
                        <form action={deleteTemplateInline.bind(null, t.id, "")}>
                          <button type="submit" className="btn-ghost px-2 py-1 text-xs text-red-700">
                            Delete
                          </button>
                        </form>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  );
}
