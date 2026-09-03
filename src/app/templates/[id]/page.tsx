import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { PageHeader } from "@/components/ui";
import { TemplateForm } from "@/components/template-form";
import { findUnknownFields } from "@/lib/merge";
import { deleteTemplate, duplicateTemplate, updateTemplate } from "../actions";

export const dynamic = "force-dynamic";

export default async function TemplatePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const t = await prisma.emailTemplate.findUnique({ where: { id }, include: { campaigns: { orderBy: { createdAt: "desc" }, take: 10, include: { deal: true } } } });
  if (!t) notFound();
  const unknown = findUnknownFields(`${t.subject}\n${t.bodyHtml}`);
  return (
    <>
      <PageHeader
        title={t.name}
        subtitle={unknown.length ? <span className="text-amber-700">Unknown merge fields: {unknown.join(", ")}</span> : "Template"}
        actions={
          <>
            <form action={duplicateTemplate.bind(null, t.id)}>
              <button className="btn-secondary" type="submit">
                Duplicate
              </button>
            </form>
            <form action={deleteTemplate.bind(null, t.id)}>
              <button className="btn-ghost" type="submit">
                Delete
              </button>
            </form>
            <Link href={`/campaigns/new?templateId=${t.id}`} className="btn-primary">
              Start campaign
            </Link>
          </>
        }
      />
      <div className="px-8 py-6">
        <TemplateForm template={t} action={updateTemplate.bind(null, t.id)} />
        {t.campaigns.length > 0 && (
          <div className="mt-8">
            <h2 className="mb-2 font-semibold">Recent campaigns using this template</h2>
            <ul className="divide-y divide-line rounded-lg border border-line bg-paper">
              {t.campaigns.map((c) => (
                <li key={c.id} className="flex items-center justify-between px-4 py-2 text-sm">
                  <Link href={`/campaigns/${c.id}`} className="hover:underline">
                    {c.name}
                  </Link>
                  <span className="text-muted">{c.deal?.name}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </>
  );
}
