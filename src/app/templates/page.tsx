import Link from "next/link";
import { prisma } from "@/lib/db";
import { PageHeader, Empty } from "@/components/ui";
import { fmtDate } from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function TemplatesPage() {
  const templates = await prisma.emailTemplate.findMany({ orderBy: { updatedAt: "desc" }, include: { _count: { select: { campaigns: true } } } });
  return (
    <>
      <PageHeader
        title="Email templates"
        subtitle="Reusable emails with deal and contact merge fields"
        actions={
          <Link href="/templates/new" className="btn-primary">
            New template
          </Link>
        }
      />
      <div className="px-8 py-6">
        {templates.length === 0 ? (
          <Empty>No templates yet. Create one to start a deal campaign.</Empty>
        ) : (
          <div className="overflow-hidden rounded-lg border border-line bg-paper">
            <table className="table w-full">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Subject</th>
                  <th className="text-right">Campaigns</th>
                  <th>Updated</th>
                </tr>
              </thead>
              <tbody>
                {templates.map((t) => (
                  <tr key={t.id}>
                    <td>
                      <Link href={`/templates/${t.id}`} className="font-medium hover:underline">
                        {t.name}
                      </Link>
                    </td>
                    <td className="text-muted">{t.subject}</td>
                    <td className="text-right">{t._count.campaigns}</td>
                    <td className="whitespace-nowrap text-muted">{fmtDate(t.updatedAt)}</td>
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
