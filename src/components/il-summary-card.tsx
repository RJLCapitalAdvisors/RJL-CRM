import Link from "next/link";
import type { SummaryEmail } from "@/lib/israel-summary";

/**
 * The middle window under the floorplan: what the summary email reads like with the data on the ticket right
 * now. A blank field is simply not mentioned, so a thin email means a thin ticket. Send opens the send flow.
 */
export function IlSummaryCard({ email, sendHref, notes }: { email: SummaryEmail; sendHref: string; notes: { id: string; body: string; createdAt: Date }[] }) {
  return (
    <div className="card flex flex-col">
      <div className="flex shrink-0 items-center justify-between border-b border-line px-4 py-3">
        <div>
          <div className="text-sm font-semibold">Summary email</div>
          <div className="text-[11px] text-muted">How the send-out reads with what the ticket holds today. Fill a field on the left and it shows up here.</div>
        </div>
        <Link href={sendHref} className="btn-primary px-3 py-1.5 text-xs">
          Send
        </Link>
      </div>
      <div className="min-h-0 flex-1 overflow-auto px-4 py-3">
        <div className="mb-2 text-xs text-muted">
          Subject: <span className="text-ink">{email.subject}</span>
        </div>
        <div className="rounded-md border border-line bg-white px-4 py-3 text-sm" dangerouslySetInnerHTML={{ __html: email.html }} />
      </div>
      {notes.length > 0 && (
        <details className="border-t border-line px-4 py-2 text-xs text-muted">
          <summary className="cursor-pointer">Notes ({notes.length})</summary>
          <ul className="mt-1 space-y-1">
            {notes.map((n) => (
              <li key={n.id}>
                <span className="text-muted">{n.createdAt.toLocaleDateString("en-US", { month: "short", day: "numeric" })}</span> {n.body}
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}
