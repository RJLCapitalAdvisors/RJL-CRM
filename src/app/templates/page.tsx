import { prisma } from "@/lib/db";
import { PageHeader } from "@/components/ui";
import { TemplateWindows } from "@/components/template-windows";

export const metadata = { title: "Email templates" };
export const dynamic = "force-dynamic";

/**
 * Templates > Email templates: every template as a window, shown the way the email goes out, merge fields in
 * light blue. Type in place and it saves; x deletes; the plus square starts a new one. Send deal picks from these.
 */
export default async function TemplatesPage() {
  const templates = await prisma.emailTemplate.findMany({ where: { workspace: "CA" }, orderBy: [{ kind: "asc" }, { updatedAt: "desc" }], select: { id: true, name: true, kind: true, subject: true, bodyHtml: true } });
  return (
    <>
      <PageHeader title="Email templates" subtitle="Each window is one template, shown the way the email goes out. The light blue fields fill in from the deal and the person when it is sent. Changes save as you type." />
      <div className="px-8 py-5">
        <TemplateWindows templates={templates} />
      </div>
    </>
  );
}
