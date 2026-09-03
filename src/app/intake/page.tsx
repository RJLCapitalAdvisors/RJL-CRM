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
  return (
    <>
      <PageHeader title="Deal intake" subtitle="Forwarded deal emails, parsed into deal fields and checked against what we usually ask for" />
      <div className="grid grid-cols-3 gap-6 px-8 py-6">
        <section className="card p-5">
          <h2 className="mb-1 font-semibold">Paste a deal email</h2>
          <p className="mb-4 text-xs text-muted">
            {claudeConfigured() ? "Claude reads the email and fills in the deal fields." : "Basic pattern parsing is active. Add ANTHROPIC_API_KEY to .env for full extraction."}{" "}
            Once the intake mailbox is connected, forwarded emails land here automatically.
          </p>
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
              <textarea id="rawText" name="rawText" rows={14} required className="input font-mono text-[12px]" placeholder="Paste the full forwarded email here…" />
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
        </section>

        <section className="col-span-2 space-y-6">
          <div className="card">
            <div className="border-b border-line px-5 py-3">
              <h2 className="font-semibold">Awaiting review ({pending.length})</h2>
            </div>
            {pending.length === 0 ? (
              <div className="px-5 py-8 text-center text-sm text-muted">Nothing waiting. Paste an email to try it.</div>
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
                        {missing.length > 0 && <div className="mt-1 truncate text-xs text-amber-700">Missing: {missing.slice(0, 6).map((k) => labelFor(k, ex.strategy as string | null)).join(", ")}{missing.length > 6 ? ` +${missing.length - 6}` : ""}</div>}
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
      </div>
    </>
  );
}
