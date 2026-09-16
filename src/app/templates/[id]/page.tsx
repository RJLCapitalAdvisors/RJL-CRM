import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { PageHeader } from "@/components/ui";
import { TemplateWindow } from "@/components/template-windows";
import { caTokens, ilTokens } from "@/lib/template-tokens";
import { loadChecklist } from "@/lib/required-items";
import { deleteTemplateInline, duplicateTemplate } from "../actions";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const t = await prisma.emailTemplate.findUnique({ where: { id }, select: { name: true } }).catch(() => null);
  return { title: t?.name ?? "Template" };
}
export const dynamic = "force-dynamic";

/** One template: the email box, as on the Send deal page, with the tokens for this kind of email. Saves as you type. */
export default async function TemplatePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  await loadChecklist();
  const t = await prisma.emailTemplate.findUnique({ where: { id }, include: { campaigns: { orderBy: { createdAt: "desc" }, take: 10, include: { deal: true } } } });
  if (!t) notFound();
  if (t.workspace === "IL") redirect(`/israel/templates/${t.id}`); // the Israel side has its own page; the two never show each other's
  const il = false;
  const tokens = il ? ilTokens((["projects", "apartments", "houses"].includes(t.kind) ? t.kind : "apartments") as "projects" | "apartments" | "houses") : caTokens();
  const back = il ? `/israel/templates?kind=${t.kind}` : t.kind === "BLAST" ? "/campaigns/new" : "/templates";
  return (
    <>
      <PageHeader
        title={t.name}
        subtitle={il ? `${t.kind === "projects" ? "Project" : t.kind === "houses" ? "House" : "Apartment"} template. Tokens fill in from the ticket; the person's name per recipient.` : t.kind === "BLAST" ? "Email blast template" : "Deal email template. Tokens fill in from the deal ticket and the person it goes to."}
        actions={
          <>
            <Link href={back} className="btn-secondary">
              {t.kind === "BLAST" ? "Blast templates" : "All templates"}
            </Link>
            {t.kind === "BLAST" && (
              <Link href={`/campaigns/new?templateId=${t.id}`} className="btn-primary">
                Start a blast with it
              </Link>
            )}
            <form action={duplicateTemplate.bind(null, t.id)}>
              <button type="submit" className="btn-secondary">
                Duplicate
              </button>
            </form>
            <form action={deleteTemplateInline.bind(null, t.id, back)}>
              <button type="submit" className="btn-ghost text-red-700">
                Delete
              </button>
            </form>
          </>
        }
      />
      <div className="mx-auto max-w-4xl px-8 py-6">
        <TemplateWindow t={{ id: t.id, name: t.name, kind: t.kind, subject: t.subject, bodyHtml: t.bodyHtml }} tokens={tokens} tall />
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
