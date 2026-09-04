import type { Report } from "@/lib/tracker-report";
import { investorLabel, statusOf } from "@/lib/tracker";

/**
 * Read-only rendering of the progress report in the legacy Drive style.
 * Used for the sponsor share page; the in-app tracker adds editing on top of the same layout.
 */
export function ReportView({ report, showEmails = false, showActions = false }: { report: Report; showEmails?: boolean; showActions?: boolean }) {
  const { deal, name, rows, lastUpdated, itemsNeeded, chips } = report;
  const openActions = deal.actions.filter((a) => !a.done);
  const items = [...itemsNeeded, ...(deal.trackerItemsNote ? deal.trackerItemsNote.split(/\n+/).map((x) => x.trim()).filter(Boolean) : [])];
  return (
    <div className="report mx-auto max-w-[900px] overflow-hidden rounded-xl border border-line bg-paper shadow-sm print:rounded-none print:border-0 print:shadow-none">
      <div className="bg-[#111827] px-8 pb-6 pt-7 text-white">
        <div className="mb-4 flex items-center justify-between">
          <div className="rounded-md bg-white px-3 py-1.5">
            <img src="/logo.png" alt="RJL Capital Advisors" className="h-7" />
          </div>
          <div className="text-right">
            <div className="text-[9px] uppercase tracking-[0.15em] text-[#60A5FA]">Last updated</div>
            <div className="text-xs text-white/60">{lastUpdated.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}</div>
          </div>
        </div>
        <div className="text-xl font-semibold">{name} — Progress Report</div>
        <div className="mt-1 mb-4 space-y-0.5 text-xs text-white/60">
          {deal.propertyAddress && <div>Deal address: {[deal.propertyAddress, deal.city, deal.state].filter(Boolean).join(", ")}</div>}
          {deal.trackerPreparedFor && <div>Prepared for: {deal.trackerPreparedFor}</div>}
        </div>
        <div className="flex flex-wrap gap-2">
          {chips.map((c) => (
            <div key={c.label} className="rounded-md border border-[#60A5FA]/30 bg-white/5 px-3.5 py-1.5">
              <div className="text-[8.5px] uppercase tracking-[0.12em] text-[#60A5FA]">{c.label}</div>
              <div className="text-xs text-white/70">{c.value}</div>
            </div>
          ))}
        </div>
      </div>
      <div className="h-0.5 bg-[#60A5FA]" />
      <div className="bg-[#1a2332] px-8 py-2 text-[11px] text-white/40">
        Please email <a href="mailto:jonathan@rjlcapadvisors.com" className="text-[#60A5FA]">jonathan@rjlcapadvisors.com</a> or <a href="mailto:aviel@rjlcapadvisors.com" className="text-[#60A5FA]">aviel@rjlcapadvisors.com</a> with any questions
      </div>

      <div className="grid gap-4 p-5 md:grid-cols-2">
        <section className="rounded-lg border border-line">
          <div className="bg-[#111827] px-4 py-2 text-[9.5px] font-semibold uppercase tracking-[0.14em] text-[#60A5FA]">Notable feedback themes</div>
          <div className="whitespace-pre-wrap px-4 py-3 text-sm leading-relaxed">{deal.trackerThemes || <span className="italic text-muted">No themes noted yet.</span>}</div>
        </section>
        <section className="rounded-lg border border-line">
          <div className="bg-[#111827] px-4 py-2 text-[9.5px] font-semibold uppercase tracking-[0.14em] text-[#60A5FA]">Items needed from sponsor</div>
          {items.length ? (
            <ol className="list-decimal space-y-0.5 px-4 py-3 pl-8 text-sm">
              {items.map((it, i) => (
                <li key={i}>{it}</li>
              ))}
            </ol>
          ) : (
            <div className="px-4 py-3 text-sm italic text-muted">Nothing outstanding.</div>
          )}
        </section>
      </div>

      {showActions && openActions.length > 0 && (
        <section className="mx-5 mb-4 rounded-lg border border-line">
          <div className="bg-[#111827] px-4 py-2 text-[9.5px] font-semibold uppercase tracking-[0.14em] text-[#60A5FA]">Action items</div>
          <ul className="px-4 py-2 text-sm">
            {openActions.map((a) => (
              <li key={a.id} className="border-b border-line py-1.5 last:border-0">
                • {a.text}
              </li>
            ))}
          </ul>
        </section>
      )}

      <div className="grid grid-cols-[220px_200px_1fr] bg-[#111827] px-5 py-2.5 text-[9.5px] font-semibold uppercase tracking-[0.14em] text-[#60A5FA]">
        <div>Investor</div>
        <div>Status</div>
        <div>Notes</div>
      </div>
      {rows.length === 0 && <div className="px-5 py-8 text-center text-sm text-muted">No investors yet.</div>}
      {rows.map((r, i) => {
        const st = statusOf(r.status);
        return (
          <div key={r.id} className={`grid grid-cols-[220px_200px_1fr] items-start border-b border-line px-5 py-3 ${i % 2 ? "bg-[#FAFAFA]" : ""}`}>
            <div className="text-[13.5px] font-medium">
              {investorLabel(r.contact)}
              {showEmails && r.contact.email && <div className="text-[11px] text-muted">{r.contact.email}</div>}
            </div>
            <div>
              <span className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-1 text-[11px] font-medium" style={{ background: st.bg, color: st.c }}>
                <span className="inline-block h-1.5 w-1.5 rounded-full" style={{ background: st.d }} />
                {st.label}
              </span>
            </div>
            <div className="pr-2">
              {r.note ? (
                <>
                  <span className="text-xs italic leading-relaxed text-[#4B5563]">{r.note}</span>
                  {r.noteDate && <div className="text-[10px] text-muted">Updated {report.fmt(r.noteDate)}</div>}
                </>
              ) : (
                <span className="text-[11px] text-muted">—</span>
              )}
            </div>
          </div>
        );
      })}
      <div className="h-0.5 bg-[#60A5FA]" />
      <div className="flex items-center justify-between bg-[#111827] px-8 py-3 text-[10px] text-white/25">
        <span>RJL Capital Advisors · 9 Park Place, 3rd Floor, Great Neck, NY 11021 · 516.220.0477</span>
        <span className="italic">Confidential — For Authorized Recipients Only</span>
      </div>
    </div>
  );
}
