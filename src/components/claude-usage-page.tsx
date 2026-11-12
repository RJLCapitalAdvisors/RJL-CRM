import Link from "next/link";
import { PageHeader } from "@/components/ui";
import type { Workspace } from "@/lib/access";
import { hasPrice } from "@/lib/claude-pricing";
import { FEATURE_LABELS, USAGE_ZONE, usagePeriods, usageReport, type UsageRange, type UsageReport } from "@/lib/claude-usage";
import { fmtUsd } from "@/lib/format";

const BASE: Record<Workspace, string> = { CA: "/settings/claude-usage", IL: "/israel/settings/claude-usage", AQ: "/acquisitions/settings/claude-usage" };
const RANGES: { key: UsageRange; label: string; lower: string }[] = [
  { key: "today", label: "Today", lower: "today" },
  { key: "week", label: "Last 7 days", lower: "the last 7 days" },
  { key: "month", label: "This month", lower: "this month" },
];

/**
 * Settings > Claude usage, the same page on all three sides (Nov 12, 2026): what the CRM's Claude calls cost. Three
 * totals, the last fourteen days as bars, and what used the money. The totals are links: the one picked is the
 * period the table underneath covers. Every number comes from the ClaudeCall log (src/lib/claude.ts), and the whole
 * account is counted, not one side.
 */
export async function ClaudeUsagePage({ workspace, range }: { workspace: Workspace; range?: string }) {
  const picked = RANGES.find((r) => r.key === range) ?? RANGES[2];
  // a database that does not have the log table yet (a deployment whose database was not updated) gets a plain message, not an error page
  const report = await usageReport(picked.key).catch(() => null);
  if (!report)
    return (
      <>
        <PageHeader title="Claude usage" />
        <div className="mx-auto max-w-4xl px-8 py-6">
          <div className="card px-5 py-4 text-sm text-ink-soft">The usage log could not be read. If this is a new deployment, its database needs the ClaudeCall table: run &quot;npx prisma db push&quot; against it once.</div>
        </div>
      </>
    );
  const started = report.firstCall && report.firstCall > usagePeriods().chart ? report.firstCall : null;
  return (
    <>
      <PageHeader title="Claude usage" subtitle="What the CRM spends on Claude, by day and by what used it. Days and months are New York time." />
      <div className="mx-auto max-w-4xl space-y-4 px-8 py-6">
        <div className="grid grid-cols-3 gap-4">
          {RANGES.map((r) => {
            const on = r.key === picked.key;
            return (
              <Link key={r.key} href={`${BASE[workspace]}?range=${r.key}`} scroll={false} aria-current={on ? "true" : undefined} title={`Show what used the money ${r.lower}`} className={`card block px-5 py-4 transition ${on ? "border-sky-600 ring-2 ring-sky/50" : "hover:border-sky-600"}`}>
                <div className="text-xs font-semibold uppercase tracking-wide text-muted">{r.label}</div>
                <div className="mt-1 text-2xl font-semibold tracking-tight">{fmtUsd(report.totals[r.key].cost)}</div>
                <div className="text-xs text-muted">{calls(report.totals[r.key].calls)}</div>
              </Link>
            );
          })}
        </div>

        <div className="card">
          <div className="border-b border-line bg-cream px-4 py-2 text-sm font-semibold">Cost per day, last 14 days</div>
          <DayBars days={report.days} todayKey={report.todayKey} />
        </div>

        <div className="card overflow-hidden">
          <div className="flex items-center justify-between border-b border-line bg-cream px-4 py-2">
            <div className="text-sm font-semibold">What used the money {picked.lower}</div>
            <div className="text-[11px] text-muted">Dearest first</div>
          </div>
          {report.rows.length === 0 ? (
            <div className="px-4 py-6 text-sm text-muted">No Claude calls {picked.lower}.</div>
          ) : (
            <table className="table w-full">
              <thead>
                <tr>
                  <th>Feature</th>
                  <th>Model</th>
                  <th className="!text-right">Calls</th>
                  <th className="!text-right">Cost</th>
                </tr>
              </thead>
              <tbody>
                {report.rows.map((r) => (
                  <tr key={`${r.feature}|${r.model}`}>
                    <td>
                      <div>{FEATURE_LABELS[r.feature] ?? r.feature}</div>
                      {FEATURE_LABELS[r.feature] && <div className="font-mono text-[11px] text-muted">{r.feature}</div>}
                    </td>
                    <td className="whitespace-nowrap">{r.model}</td>
                    <td className="text-right tabular-nums">
                      {r.calls.toLocaleString("en-US")}
                      {r.failed > 0 && <div className="text-[11px] text-red-700">{r.failed.toLocaleString("en-US")} failed</div>}
                    </td>
                    <td className="text-right tabular-nums">{!hasPrice(r.model) && r.calls > r.failed ? <span className="text-muted">no price on file</span> : fmtUsd(r.cost)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        <p className="text-xs text-muted">
          Each call is priced from its token counts at Anthropic&apos;s list prices, so this follows the bill closely; the bill itself is in the Anthropic Console under Billing. A failed call costs nothing.
          {started && <> Counting began {started.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: USAGE_ZONE })}; calls before that are not here.</>} A button marked <span className="text-sky-600">✦</span> uses Claude when you click it.
        </p>
      </div>
    </>
  );
}

const calls = (n: number) => `${n.toLocaleString("en-US")} ${n === 1 ? "call" : "calls"}`;

/** A round number at or just above the tallest day, so the axis reads $0, half, top. */
function axisTop(max: number): number {
  if (max <= 0) return 1;
  const pow = 10 ** Math.floor(Math.log10(max));
  const lead = max / pow;
  return (lead <= 1 ? 1 : lead <= 2 ? 2 : lead <= 5 ? 5 : 10) * pow;
}

/**
 * One bar per day, one color (there is a single thing measured, so no legend). Hover or tab to a day for its exact
 * cost and call count; the tallest day and today carry their value on the bar; the same numbers sit in a table
 * under the chart for anyone who would rather read them.
 */
function DayBars({ days, todayKey }: { days: UsageReport["days"]; todayKey: string }) {
  const max = Math.max(...days.map((d) => d.cost));
  const top = axisTop(max);
  // as many decimals as the half-way tick needs ($5 and $2.50, $0.02 and $0.01), the same on every tick
  const digits = [0, 1, 2, 3, 4].find((d) => Number.isInteger(Math.round((top / 2) * 10 ** d * 1e6) / 1e6)) ?? 4;
  const tick = (n: number) => (n === 0 ? "$0" : "$" + n.toLocaleString("en-US", { minimumFractionDigits: digits === 1 ? 2 : digits, maximumFractionDigits: digits === 1 ? 2 : digits }));
  const date = (key: string, long = false) => new Date(`${key}T12:00:00Z`).toLocaleDateString("en-US", long ? { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" } : { month: "numeric", day: "numeric", timeZone: "UTC" });
  const tallest = max > 0 ? days.find((d) => d.cost === max)?.day : null;
  return (
    <div className="px-4 pb-3 pt-5">
      <div className="flex">
        <div className="relative h-44 w-12 shrink-0 text-[11px] text-muted">
          {[1, 0.5, 0].map((f) => (
            <div key={f} className="absolute right-2 -translate-y-1/2 tabular-nums" style={{ top: `${(1 - f) * 100}%` }}>
              {tick(top * f)}
            </div>
          ))}
        </div>
        <div className="relative h-44 flex-1">
          {[1, 0.5, 0].map((f) => (
            <div key={f} className={`absolute inset-x-0 border-t ${f === 0 ? "border-ink-soft/40" : "border-line"}`} style={{ top: `${(1 - f) * 100}%` }} />
          ))}
          <div className="absolute inset-0 flex">
            {days.map((d) => {
              const share = d.cost / top;
              const labeled = d.cost > 0 && (d.day === tallest || d.day === todayKey);
              return (
                <div key={d.day} tabIndex={0} aria-label={`${date(d.day, true)}: ${fmtUsd(d.cost)}, ${calls(d.calls)}`} className="group relative flex flex-1 flex-col items-center justify-end outline-none">
                  {labeled && <div className="mb-0.5 whitespace-nowrap text-[11px] tabular-nums text-ink-soft">{fmtUsd(d.cost)}</div>}
                  <div className="w-6 max-w-[70%] rounded-t-[4px] bg-sky-600 group-hover:bg-ink group-focus-visible:bg-ink" style={{ height: `${share * 100}%`, minHeight: d.cost > 0 ? 2 : 0 }} />
                  <div className="pointer-events-none absolute bottom-full left-1/2 z-20 mb-1 hidden -translate-x-1/2 whitespace-nowrap rounded-md border border-line bg-paper px-2.5 py-1.5 text-xs shadow-md group-hover:block group-focus-visible:block">
                    <div className="font-semibold tabular-nums">{fmtUsd(d.cost)}</div>
                    <div className="text-muted">
                      {date(d.day, true)} · {calls(d.calls)}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
      <div className="ml-12 flex pt-1 text-[11px] text-muted">
        {days.map((d) => (
          <div key={d.day} className={`flex-1 text-center tabular-nums ${d.day === todayKey ? "font-semibold text-ink" : ""}`}>
            {d.day === todayKey ? "Today" : date(d.day)}
          </div>
        ))}
      </div>
      <details className="ml-12 mt-2 text-xs">
        <summary className="cursor-pointer text-muted hover:text-ink">The same 14 days as a table</summary>
        <table className="mt-2 w-full max-w-sm">
          <tbody>
            {[...days].reverse().map((d) => (
              <tr key={d.day} className="border-b border-line">
                <td className="py-1">{date(d.day, true)}</td>
                <td className="py-1 text-right tabular-nums text-muted">{calls(d.calls)}</td>
                <td className="py-1 text-right tabular-nums">{fmtUsd(d.cost)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </div>
  );
}
