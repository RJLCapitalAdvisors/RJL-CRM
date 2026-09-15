import { prisma } from "@/lib/db";
import { PageHeader } from "@/components/ui";
import { currentUser } from "@/lib/current-user";
import { saveSignature } from "../todo-actions";
import { SignatureEditor } from "./signature-editor";
import { OnboardingChecklist } from "./onboarding-checklist";
import Link from "next/link";
import { ADMIN_STEPS, YOUR_STEPS } from "@/lib/onboarding";

export const metadata = { title: "Settings" };

export const dynamic = "force-dynamic";

/** Per-person settings: the Outlook connection on this computer (with a self-check) and email signatures. */
export default async function SettingsPage() {
  const [users, me] = await Promise.all([prisma.user.findMany({ where: { active: true, email: { not: null } }, orderBy: { name: "asc" } }), currentUser()]);
  return (
    <>
      <PageHeader title="Settings" subtitle="Outlook on this computer, and the email signatures the CRM puts under what it drafts for you" />
      <div className="mx-auto max-w-3xl space-y-4 px-8 py-6">
        <div id="outlook" className="card">
          <div className="flex items-center justify-between border-b border-line bg-cream px-5 py-3">
            <div className="font-semibold">Outlook on this computer</div>
            <div className="text-sm text-muted">{me ? `Signed in as ${me.name} (${me.email})` : "Not signed in with Microsoft"}</div>
          </div>
          <div className="space-y-4 px-5 py-4 text-sm">
            <p className="text-ink-soft">
              Handle and Open in Outlook prepare the draft in <b>your</b> mailbox, then hand it to desktop Outlook through a small per-computer link. Each computer you use needs that link once. Without it the draft still exists (Outlook web, Drafts folder), but no window pops up.
            </p>
            <ol className="list-decimal space-y-2 pl-5">
              <li>
                {me ? (
                  <>You are signed in with Microsoft as {me.email}. Good.</>
                ) : (
                  <>Sign in with Microsoft first (bottom of the sidebar). Drafts are created in the mailbox you sign in with.</>
                )}
              </li>
              <li>
                Download and run{" "}
                <a href="/outlook-bridge/Connect%20RJL%20CRM%20to%20Outlook.bat" className="font-medium text-sky-700 hover:underline" download>
                  Connect RJL CRM to Outlook.bat
                </a>
                . If Windows shows &quot;Windows protected your PC&quot;, click <i>More info</i>, then <i>Run anyway</i>. No admin rights are needed; it only registers a link type for your Windows user.
              </li>
              <li>
                Then check it:{" "}
                <a href="rjlcrm:test" className="btn-secondary inline-flex py-1">
                  Test the Outlook link
                </a>{" "}
                <span className="text-muted">A small confirmation box should pop up. If the browser asks whether to open &quot;RJL CRM&quot;, tick &quot;always allow&quot; and confirm.</span>
              </li>
            </ol>
            <div className="rounded-md border border-line bg-cream-50 px-4 py-3 text-xs text-ink-soft">
              <div className="mb-1 font-semibold">If Handle still does not open Outlook</div>
              <ul className="list-disc space-y-1 pl-4">
                <li>The reason shows in red under the button when the draft could not be prepared at all (for example, not signed in).</li>
                <li>If the draft was prepared but no window opened, the link on this computer is the problem: rerun the .bat above, then Test again.</li>
                <li>
                  Every attempt is logged on this computer at <code>%LOCALAPPDATA%\RJL CRM\last.log</code> (paste that path into File Explorer). Send that file to Jonathan and he can see exactly where it stopped.
                </li>
                <li>Meanwhile the draft is in your Outlook Drafts folder and behind the &quot;open in Outlook web&quot; link under the button.</li>
              </ul>
            </div>
          </div>
        </div>

        <div id="onboarding" className="card">
          <div className="flex items-center justify-between border-b border-line bg-cream px-5 py-3">
            <div className="font-semibold">New to the CRM? Setup checklist</div>
            <div className="text-sm text-muted">Ticks are remembered on this browser</div>
          </div>
          <OnboardingChecklist steps={YOUR_STEPS} storageKey={`rjl-onboarding:${me?.email ?? "anon"}`} />
        </div>
        {me?.canEditCriteria && (
          <div id="onboarding-admin" className="card">
            <div className="flex items-center justify-between border-b border-line bg-cream px-5 py-3">
              <div className="font-semibold">Bringing someone new on: what Jonathan does</div>
              <div className="text-sm text-muted">Also in docs/ONBOARDING.md</div>
            </div>
            <OnboardingChecklist steps={ADMIN_STEPS} storageKey="rjl-onboarding-admin" />
          </div>
        )}

        {me?.canEditCriteria && (
          <div id="access" className="card px-5 py-4 text-sm">
            <span className="font-semibold">Users.</span> Who opens the CRM, invitations and access live under{" "}
            <Link href="/settings/users" className="font-medium text-sky-700 hover:underline">
              Settings &gt; Users
            </Link>
            .
          </div>
        )}

        <h2 className="pt-2 text-base font-semibold">Email signatures</h2>
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
