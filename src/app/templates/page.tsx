import Link from "next/link";
import { prisma } from "@/lib/db";
import { PageHeader, Empty } from "@/components/ui";
import { fmtDate } from "@/lib/format";
import { createTemplateAndOpen, deleteTemplateInline, duplicateTemplate } from "./actions";

export const metadata = { title: "Email templates" };
export const dynamic = "force-dynamic";

/**
 * Templates > Email templates, the HubSpot way: a list (name, kind, created, modified). Open one and the email
 * itself is there to edit, with tokens as light blue chips. New template opens a blank one.
 */
export default async function TemplatesPage() {
  const templates = await prisma.emailTemplate.findMany({ where: { workspace: "CA", kind: "DEAL", NOT: { name: { startsWith: "(archived)" } } }, orderBy: { name: "asc" }, select: { id: true, name: true, kind: true, createdAt: true, updatedAt: true, _count: { select: { campaigns: true } } } });
  return (
    <>
      <PageHeader
        title="Email templates"
        subtitle="The one-at-a-time deal emails. Open a template and the email is there to edit, with tokens that fill in from the deal and the person. Send deal picks from these; blast templates live under Email blasts."
        actions={
          <form action={createTemplateAndOpen.bind(null, "CA", "DEAL")}>
            <button type="submit" className="btn-primary">
              New template
            </button>
          </form>
        }
      />
      <div className="px-8 py-6">
        {templates.length === 0 ? (
          <Empty>No templates yet. New template opens a blank one.</Empty>
        ) : (
          <div className="overflow-hidden rounded-lg border border-line bg-paper">
            <table className="table w-full">
              <thead>
                <tr>
                  <th>Name</th>
                  <th className="text-right">Sends</th>
                  <th>Created</th>
                  <th>Modified</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {templates.map((t) => (
                  <tr key={t.id}>
                    <td>
                      <Link href={`/templates/${t.id}`} className="font-medium text-sky-800 hover:underline">
                        {t.name}
                      </Link>
                    </td>
                    <td className="text-right text-muted">{t._count.campaigns || ""}</td>
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
