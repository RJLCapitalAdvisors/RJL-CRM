import { prisma } from "@/lib/db";
import { PageHeader } from "@/components/ui";
import { saveSignature } from "../todo-actions";
import { SignatureEditor } from "./signature-editor";

export const dynamic = "force-dynamic";

/** Per-person settings. For now: the email signature the CRM puts under follow-ups it drafts. */
export default async function SettingsPage() {
  const users = await prisma.user.findMany({ where: { active: true, email: { not: null } }, orderBy: { name: "asc" } });
  return (
    <>
      <PageHeader title="Settings" subtitle="Email signatures used under the follow-ups the CRM drafts for you" />
      <div className="mx-auto max-w-3xl space-y-4 px-8 py-6">
        {users.map((u) => (
          <div key={u.id} className="card">
            <div className="flex items-center justify-between border-b border-line bg-cream px-5 py-3">
              <div className="font-semibold">{u.name}</div>
              <div className="text-sm text-muted">{u.email}</div>
            </div>
            <div className="px-5 py-4">
              <SignatureEditor userId={u.id} initialHtml={u.signatureHtml ?? ""} action={saveSignature.bind(null, u.id)} />
            </div>
          </div>
        ))}
        <p className="text-sm text-muted">Tip: in Outlook open a new email, select your signature, copy it, and paste it into the box above. Formatting and the logo come along. If a box is empty, the CRM picks the signature up from one of your recent sent emails the first time it drafts a follow-up.</p>
      </div>
    </>
  );
}
