import Link from "next/link";
import { prisma } from "@/lib/db";
import { ASSET_CLASSES } from "@/lib/taxonomy";
import { PageHeader } from "@/components/ui";
import { BlastForm } from "./blast-form";
import { currentUser } from "@/lib/current-user";

export const metadata = { title: "New email blast" };

export const dynamic = "force-dynamic";

/** New blast: segment, template, schedule, follow-ups. Deal emails go through Send deal on the ticket, not here. */
export default async function NewCampaignPage() {
  const templates = await prisma.emailTemplate.findMany({ where: { kind: "BLAST", workspace: "CA" }, orderBy: { updatedAt: "desc" }, select: { id: true, name: true, subject: true, bodyHtml: true } });
  const me = await currentUser();
  const from = process.env.MAIL_FROM ?? "RJL Capital Advisors";
  return (
    <>
      <PageHeader
        title="New email blast"
        subtitle="Write the email, pick who gets it and when. Deal emails to LPs go through Send deal on the deal ticket."
        actions={
          <Link href="/campaigns?list=1" className="btn-secondary">
            Past blasts
          </Link>
        }
      />
      <div className="px-8 py-6">
        {templates.length === 0 ? (
          <div className="card p-6 text-sm text-muted">No blast templates yet. Add one under Templates with kind &quot;blast&quot;.</div>
        ) : (
          <BlastForm templates={templates} assetClasses={[...ASSET_CLASSES]} defaultFrom={me ? `${me.name} (${me.email})` : from} me={me?.email ?? null} />
        )}
      </div>
    </>
  );
}
