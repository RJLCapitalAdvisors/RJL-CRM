import Link from "next/link";
import { prisma } from "@/lib/db";
import { PageHeader } from "@/components/ui";
import { currentUser } from "@/lib/current-user";
import { IL_ROLES } from "@/lib/israel";
import { IL_STARTER } from "@/lib/il-blasts";
import { IlBlastForm } from "./blast-form";

export const metadata = { title: "New email blast" };
export const dynamic = "force-dynamic";

/** New RJL Israel blast: who gets it, the email (from an RJL Israel blast template or the starter), then a draft to send. */
export default async function NewIlCampaignPage() {
  const [templates, me] = await Promise.all([prisma.emailTemplate.findMany({ where: { kind: "BLAST", workspace: "IL" }, orderBy: { updatedAt: "desc" }, select: { id: true, name: true, subject: true, bodyHtml: true } }), currentUser()]);
  const from = process.env.IL_MAIL_FROM || process.env.MAIL_FROM || "RJL Israel";
  return (
    <>
      <PageHeader
        title="New email blast"
        subtitle="Pick who gets it and write the email. It is saved as a draft; you send it from the next screen after a test."
        actions={
          <Link href="/israel/campaigns" className="btn-secondary">
            Past blasts
          </Link>
        }
      />
      <div className="px-8 py-6">
        <IlBlastForm templates={[...templates, { id: "", name: "Blank starter", subject: IL_STARTER.subject, bodyHtml: IL_STARTER.bodyHtml }]} roles={[...IL_ROLES]} from={from} me={me?.accounts.IL ?? me?.israelEmail ?? me?.email ?? null} />
      </div>
    </>
  );
}
