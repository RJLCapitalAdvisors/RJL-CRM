import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { PageHeader } from "@/components/ui";
import { TemplateWindow } from "@/components/template-windows";
import { findUnknownFields } from "@/lib/merge";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const t = await prisma.emailTemplate.findUnique({ where: { id }, select: { name: true } }).catch(() => null);
  return { title: t?.name ?? "Template" };
}
export const dynamic = "force-dynamic";

/** One template on its own, the same window as on the templates page, for links that land on a template. */
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
          <Link href="/templates" className="btn-secondary">
            All templates
          </Link>
        }
      />
      <div className="mx-auto max-w-3xl px-8 py-6">
        <TemplateWindow t={{ id: t.id, name: t.name, kind: t.kind, subject: t.subject, bodyHtml: t.bodyHtml }} tall />
        {t.campaigns.length > 0 && (
          <div className="mt-8">
            <h2 className="mb-2 font-semibold">Recent sends using this template</h2>
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
