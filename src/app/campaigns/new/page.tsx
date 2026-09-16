import Link from "next/link";
import { prisma } from "@/lib/db";
import { ASSET_CLASSES } from "@/lib/taxonomy";
import { PageHeader, Empty } from "@/components/ui";
import { fmtDate } from "@/lib/format";
import { BlastForm } from "./blast-form";
import { currentUser } from "@/lib/current-user";
import { createTemplateAndOpen, deleteTemplateInline, duplicateTemplate } from "@/app/templates/actions";

export const metadata = { title: "New email blast" };
export const dynamic = "force-dynamic";

/**
 * New blast, in two steps: first pick the blast template (the list of blast templates lives here, not under
 * Templates, which is for the one-at-a-time deal emails), then the blast maker opens with that email in it.
 */
export default async function NewCampaignPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const templateId = Array.isArray(sp.templateId) ? sp.templateId[0] : sp.templateId;
  const [templates, me] = await Promise.all([
    prisma.emailTemplate.findMany({ where: { kind: "BLAST", workspace: "CA", NOT: { name: { startsWith: "(archived)" } } }, orderBy: { name: "asc" }, select: { id: true, name: true, subject: true, bodyHtml: true, updatedAt: true, _count: { select: { campaigns: true } } } }),
    currentUser(),
  ]);
  const chosen = templates.find((t) => t.id === templateId);
  if (chosen) {
    const from = process.env.MAIL_FROM ?? "RJL Capital Advisors";
    return (
      <>
        <PageHeader
          title="New email blast"
          subtitle={`Starting from "${chosen.name}". Write the email, pick who gets it and when.`}
          actions={
            <>
              <Link href="/campaigns/new" className="btn-secondary">
                Pick a different template
              </Link>
              <Link href="/campaigns?list=1" className="btn-secondary">
                Past blasts
              </Link>
            </>
          }
        />
        <div className="px-8 py-6">
          <BlastForm templates={templates.map((t) => ({ id: t.id, name: t.name, subject: t.subject, bodyHtml: t.bodyHtml }))} initialTemplateId={chosen.id} assetClasses={[...ASSET_CLASSES]} defaultFrom={me ? `${me.name} (${me.email})` : from} me={me?.email ?? null} />
        </div>
      </>
    );
  }
  return (
    <>
      <PageHeader
        title="New email blast"
        subtitle="Step one: which template. Pick one and the blast maker opens with that email in it. Deal emails to LPs go through Send deal on the deal ticket."
        actions={
          <>
            <form action={createTemplateAndOpen.bind(null, "CA", "BLAST")}>
              <button type="submit" className="btn-secondary">
                New blast template
              </button>
            </form>
            <Link href="/campaigns?list=1" className="btn-secondary">
              Past blasts
            </Link>
          </>
        }
      />
      <div className="px-8 py-6">
        {templates.length === 0 ? (
          <Empty>No blast templates yet. New blast template opens a blank one to write.</Empty>
        ) : (
          <div className="overflow-hidden rounded-lg border border-line bg-paper">
            <table className="table w-full">
              <thead>
                <tr>
                  <th>Blast template</th>
                  <th>Subject</th>
                  <th className="text-right">Sends</th>
                  <th>Modified</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {templates.map((t) => (
                  <tr key={t.id}>
                    <td>
                      <Link href={`/campaigns/new?templateId=${t.id}`} className="font-medium text-sky-800 hover:underline">
                        {t.name}
                      </Link>
                    </td>
                    <td className="max-w-[360px] truncate text-xs text-muted">{t.subject}</td>
                    <td className="text-right text-muted">{t._count.campaigns || ""}</td>
                    <td className="whitespace-nowrap text-muted">{fmtDate(t.updatedAt)}</td>
                    <td className="text-right">
                      <div className="flex justify-end gap-1">
                        <Link href={`/campaigns/new?templateId=${t.id}`} className="btn-primary px-2 py-1 text-xs">
                          Use
                        </Link>
                        <Link href={`/templates/${t.id}`} className="btn-ghost px-2 py-1 text-xs">
                          Edit
                        </Link>
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
