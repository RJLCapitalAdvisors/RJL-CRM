import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { PageHeader } from "@/components/ui";
import { TemplateWindow } from "@/components/template-windows";
import { ilTokens } from "@/lib/template-tokens";
import { deleteTemplateInline, duplicateTemplate } from "@/app/templates/actions";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const t = await prisma.emailTemplate.findUnique({ where: { id }, select: { name: true } }).catch(() => null);
  return { title: t?.name ?? "Template" };
}
export const dynamic = "force-dynamic";

/** One RJL Israel template: the email box with the tokens for its kind of ticket. Lives on the Israel side; an RJL CA template is sent to its own side. */
export default async function IlTemplatePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const t = await prisma.emailTemplate.findUnique({ where: { id } });
  if (!t) notFound();
  if (t.workspace !== "IL") redirect(`/templates/${t.id}`);
  const kind = (["projects", "apartments", "houses"].includes(t.kind) ? t.kind : "apartments") as "projects" | "apartments" | "houses";
  const back = `/israel/templates?kind=${kind}`;
  return (
    <>
      <PageHeader
        title={t.name}
        subtitle={`${kind === "projects" ? "Project" : kind === "houses" ? "House" : "Apartment"} template. Tokens fill in from the ticket; the person's name per recipient.`}
        actions={
          <>
            <Link href={back} className="btn-secondary">
              All templates
            </Link>
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
        <TemplateWindow t={{ id: t.id, name: t.name, kind: t.kind, subject: t.subject, bodyHtml: t.bodyHtml }} tokens={ilTokens(kind)} tall />
      </div>
    </>
  );
}
