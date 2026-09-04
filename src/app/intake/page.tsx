import Link from "next/link";
import { PageHeader } from "@/components/ui";
import { claudeConfigured } from "@/lib/intake";
import { submitPastedEmail } from "./actions";

export const dynamic = "force-dynamic";

/**
 * Fallback for the forward-to mailbox: paste a deal email and it becomes a deal in Deal Received,
 * exactly as a forwarded email will once the mailbox is live.
 */
export default function PasteDealPage() {
  const mailboxLive = Boolean(process.env.RESEND_WEBHOOK_SECRET && process.env.RESEND_API_KEY);
  return (
    <>
      <PageHeader
        title="Deal from an email"
        subtitle={mailboxLive ? "Forward deals to deals@intake.rjlcapadvisors.com and they appear on the board automatically. Use this page only for emails you can't forward." : "Until the forward-to mailbox is live, paste the deal email here. It becomes a deal in Deal Received, with the checklist gaps noted, the same way a forwarded email will."}
        actions={
          <Link href="/deals" className="btn-secondary">
            Back to board
          </Link>
        }
      />
      <div className="mx-auto max-w-3xl px-8 py-6">
        <form action={submitPastedEmail} className="card space-y-4 p-6">
          <div>
            <label className="label" htmlFor="subject">
              Subject
            </label>
            <input id="subject" name="subject" className="input" placeholder="Fwd: Everett Mall Plaza – JV equity" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label" htmlFor="fromName">
                From name
              </label>
              <input id="fromName" name="fromName" className="input" />
            </div>
            <div>
              <label className="label" htmlFor="fromEmail">
                From email
              </label>
              <input id="fromEmail" name="fromEmail" type="email" className="input" />
            </div>
          </div>
          <div>
            <label className="label" htmlFor="rawText">
              Email body
            </label>
            <textarea id="rawText" name="rawText" rows={16} required className="input font-mono text-[12px]" placeholder="Paste the full email here, including any forwarded content…" />
          </div>
          <div>
            <label className="label" htmlFor="attachments">
              Attachment file names (optional, comma separated)
            </label>
            <input id="attachments" name="attachments" className="input" placeholder="Proforma.xlsx, Rent Roll.pdf, OM.pdf" />
          </div>
          <div className="flex items-center justify-between">
            <span className="text-xs text-muted">{claudeConfigured() ? "Claude reads the email and fills the deal in about 20 seconds." : "Basic pattern parsing is active. Add ANTHROPIC_API_KEY to .env for full extraction."}</span>
            <button className="btn-primary" type="submit">
              Create deal
            </button>
          </div>
        </form>
      </div>
    </>
  );
}
