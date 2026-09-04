import Link from "next/link";
import { prisma } from "@/lib/db";
import { PageHeader } from "@/components/ui";
import { fmtDate } from "@/lib/format";
import { claudeConfigured } from "@/lib/intake";
import { labelFor } from "@/lib/checklist";
import { submitPastedEmail } from "./actions";

export const dynamic = "force-dynamic";

export default async function IntakePage() {
  const intakes = await prisma.dealIntake.findMany({ orderBy: { createdAt: "desc" }, take: 100 });
  const pending = intakes.filter((i) => i.status === "PENDING");
  const done = intakes.filter((i) => i.status !== "PENDING");
  const mailboxLive = Boolean(process.env.RESEND_WEBHOOK_SECRET && process.env.RESEND_API_KEY);

  return (
    <>
      <PageHeader title="Deal inbox" subtitle="Deals you forward to deals@intake.rjlcapadvisors.com land here, already read and checked against the checklist. Review, then create the deal." />
      <div className="px-8 py-6">
        {!mailboxLive && (
          <div className="mb-6 rounded-md border border-sky bg-sky-50 px-4 py-3 text-sm">
            The forward-to mailbox goes live once the app is hosted and the Resend webhook is added. Until then, you can paste an email on the right to get the same result.
          </div>
        )}
        <div className="grid grid-cols-3 gap-6">
          <section className="col-span-2 space-y-6">
            <div className="card">
              <div className="border-b border-line px-5 py-3">
                <h2 className="font-semibold">Awaiting review ({pending.length})</h2>
              </div>
              {pending.length === 0 ? (
                <div className="px-5 py-8 text-center text-sm text-muted">Nothing waiting. Forwarded deals appear here automatically.</div>
              ) : (
                <ul className="divide-y divide-line">
                  {pending.map((i) => {
                    const missing = JSON.parse(i.missing) as string[];
                    const ex = JSON.parse(i.extracted) as Record<string, unknown>;
                    return (
                      <li key={i.id} className="flex items-start justify-between gap-4 px-5 py-3">
                        <div className="min-w-0">
                          <Link href={`/intake/${i.id}`} className="block truncate font-medium hover:underline">
                            {(ex.propertyName as string) ?? i.subject ?? "(no subject)"}
                          </Link>
                          <div className="text-xs text-muted">
                            {(ex.sponsorName as string) ?? "Sponsor unknown"} · from {i.fromName ?? i.fromEmail ?? "paste"} · {fmtDate(i.createdAt)}
                          </div>
                          {missing.length > 0 && (
                            <div className="mt-1 truncate text-xs text-amber-700">
                              Missing: {missing.slice(0, 6).map((k) => labelFor(k, ex.strategy as string | null)).join(", ")}
                              {missing.length > 6 ? ` +${missing.length - 6}` : ""}
                            </div>
                          )}
                        </div>
                        <span className={`chip shrink-0 ${missing.length === 0 ? "bg-emerald-100 text-emerald-900" : "bg-amber-100 text-amber-900"}`}>{missing.length === 0 ? "Complete" : `${missing.length} missing`}</span>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
            {done.length > 0 && (
              <div className="card">
                <div className="border-b border-line px-5 py-3">
                  <h2 className="font-semibold">Processed</h2>
                </div>
                <ul className="divide-y divide-line">
                  {done.map((i) => (
                    <li key={i.id} className="flex items-center justify-between px-5 py-2 text-sm">
                      <Link href={i.dealId ? `/deals/${i.dealId}` : `/intake/${i.id}`} className="truncate hover:underline">
                        {i.subject ?? "(no subject)"}
                      </Link>
                      <span className="text-xs text-muted">
                        {i.status} · {fmtDate(i.createdAt)}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </section>

          <details className="card self-start" open={!mailboxLive && pending.length === 0}>
            <summary className="cursor-pointer px-5 py-3 font-semibold">Paste an email manually</summary>
            <div className="border-t border-line p-5">
              <p className="mb-4 text-xs text-muted">{claudeConfigured() ? "Claude reads it and fills in the deal fields." : "Basic pattern parsing is active. Add ANTHROPIC_API_KEY to .env for full extraction."}</p>
              <form action={submitPastedEmail} className="space-y-3">
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
                  <textarea id="rawText" name="rawText" rows={12} required className="input font-mono text-[12px]" placeholder="Paste the full forwarded email here…" />
                </div>
                <div>
                  <label className="label" htmlFor="attachments">
                    Attachment file names (optional, comma separated)
                  </label>
                  <input id="attachments" name="attachments" className="input" placeholder="Proforma.xlsx, Rent Roll.pdf, OM.pdf" />
                </div>
                <div className="flex justify-end">
                  <button className="btn-primary" type="submit">
                    Parse deal
                  </button>
                </div>
              </form>
            </div>
          </details>
        </div>
      </div>
    </>
  );
}
