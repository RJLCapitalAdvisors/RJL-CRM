import { PageHeader } from "@/components/ui";
import { AutoSaveForm } from "@/components/autosave-form";
import { prisma } from "@/lib/db";
import { CURVE_SETTING_KEY, ensureIndexRates } from "@/lib/index-rates";
import { parseForwardCurve } from "@/lib/rates";
import { saveForwardCurve } from "./actions";

export const metadata = { title: "Rate curve" };
export const dynamic = "force-dynamic";

/**
 * Settings > Rate curve (Jonathan, Oct 19, 2026): the SOFR forward curve, one month per line, so a floating loan that
 * closes in a future month is priced off that month rather than today's reading. Today's indices sit beside it.
 */
export default async function RateCurvePage() {
  const [row, table] = await Promise.all([prisma.setting.findUnique({ where: { key: CURVE_SETTING_KEY } }).catch(() => null), ensureIndexRates()]);
  const text = row?.value ?? "";
  const parsed = parseForwardCurve(text);
  const months = Object.keys(parsed).sort();
  return (
    <>
      <PageHeader title="Rate curve" subtitle="The SOFR forward curve, one month per line. A deal email prices a floating loan off the month it is expected to close; without that month here it uses today's SOFR and says so." />
      <div className="mx-auto max-w-4xl space-y-6 px-8 py-6">
        <div className="card">
          <div className="flex items-center justify-between border-b border-line bg-cream px-4 py-2">
            <div className="text-sm font-semibold">SOFR forward curve</div>
            <div className="text-[11px] text-muted">{months.length ? `${months.length} months read, ${months[0]} to ${months[months.length - 1]}` : "Nothing read yet"}</div>
          </div>
          <AutoSaveForm action={saveForwardCurve} className="p-4">
            <textarea name="text" defaultValue={text} spellCheck={false} className="input min-h-[360px] w-full resize-y font-mono text-[13px] leading-6" placeholder={"January 2027 3.42\nFebruary 2027 3.38\n2027-03 3.35"} />
            <div className="mt-2 text-xs text-muted">One month per line, the month then the rate in percent: &quot;January 2027 3.42&quot;, &quot;Jan 2027 3.42%&quot; or &quot;2027-01 3.42&quot;. Paste the published curve (Chatham, Pensford) and replace it when it moves. It saves as you type.</div>
          </AutoSaveForm>
        </div>
        <div className="card">
          <div className="border-b border-line bg-cream px-4 py-2 text-sm font-semibold">Today&apos;s indices (FRED, refreshed daily)</div>
          <table className="table w-full">
            <tbody>
              {Object.entries(table).map(([k, v]) => (
                <tr key={k}>
                  <td>{k}</td>
                  <td className="text-right tabular-nums">{v.value.toFixed(2)}%</td>
                  <td className="text-muted">as of {v.asOf}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}
