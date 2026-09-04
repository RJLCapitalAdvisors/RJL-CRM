"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ASSET_CLASSES, CHECK_SIZES, CLOSING_TIMEFRAMES, HOLD_PERIODS, RETURN_PROFILES, VINTAGES } from "@/lib/taxonomy";
import { CompanyLogo } from "@/components/company-logo";

export type InvestorRow = {
  id: string;
  name: string;
  domain: string | null;
  crit: {
    assetClasses: string[];
    checkSizes: string[];
    geographyNotes: string | null;
    investmentTypes: string[];
    strategy: string | null;
    returnProfile: string[];
    holdPeriods: string[];
    vintages: string[];
    ozInterest: boolean | null;
    closingTimeframe: string | null;
    openToMinority: boolean | null;
  } | null;
};

export type Spec = {
  assetClass: string;
  checkSize: string;
  requestType: string;
  strategy: string;
  returnProfile: string;
  holdPeriod: string;
  vintage: string;
  oz: string;
  closing: string;
  minority: string;
};

const EMPTY: Spec = { assetClass: "", checkSize: "", requestType: "", strategy: "", returnProfile: "", holdPeriod: "", vintage: "", oz: "", closing: "", minority: "" };
const EQUITY = ["JV Equity", "Co-GP Equity", "Preferred Equity", "LP Equity"];
const DEBT = ["Senior Debt", "Mezz Debt"];

/** Dollar amount -> the check-size bucket it falls in. */
export function bucketForAmount(amount: number | null | undefined): string {
  if (!amount) return "";
  const mm = amount / 1_000_000;
  for (const b of CHECK_SIZES) {
    const m = b.match(/^\$(\d+)(?:-(\d+))?MM(\+)?$/);
    if (!m) continue;
    const lo = Number(m[1]);
    const hi = m[3] ? Infinity : Number(m[2]);
    if (mm >= lo && mm <= hi) return b;
  }
  return "";
}

/** Year built -> vintage bucket. */
export function vintageForYear(yearBuilt: string | null | undefined): string {
  if (!yearBuilt) return "";
  const y = Number((yearBuilt.match(/\d{4}/) ?? [])[0]);
  if (!y) return /new|construction/i.test(yearBuilt) ? "New Construction" : "";
  if (y >= 2024) return "New Construction";
  if (y < 1960) return "Older than 1960";
  return `${Math.floor(y / 10) * 10}s`;
}

/** A firm passes when every selected spec is satisfied by its criteria. Blank specs are ignored. */
function passes(c: InvestorRow["crit"], s: Spec): boolean {
  if (s.assetClass && !(c && (c.assetClasses.includes(s.assetClass) || c.assetClasses.includes("Asset Class Agnostic")))) return false;
  if (s.checkSize && !(c && c.checkSizes.includes(s.checkSize))) return false;
  if (s.requestType) {
    const want = s.requestType === "Equity" ? EQUITY : s.requestType === "Debt" ? DEBT : [...EQUITY, ...DEBT];
    if (!(c && c.investmentTypes.some((t) => want.includes(t)))) return false;
  }
  if (s.strategy && !(c && (c.strategy === s.strategy || c.strategy === "Both"))) return false;
  if (s.returnProfile && !(c && c.returnProfile.includes(s.returnProfile))) return false;
  if (s.holdPeriod && !(c && c.holdPeriods.includes(s.holdPeriod))) return false;
  if (s.vintage && !(c && c.vintages.includes(s.vintage))) return false;
  if (s.oz && !(c && c.ozInterest === (s.oz === "yes"))) return false;
  if (s.closing && !(c && c.closingTimeframe === s.closing)) return false;
  if (s.minority && !(c && c.openToMinority === (s.minority === "yes"))) return false;
  return true;
}

type Opt = string | { v: string; l: string };

export function InvestorSearch({ rows, preset, presetDealName, deals }: { rows: InvestorRow[]; preset: Partial<Spec> | null; presetDealName: string | null; deals: { id: string; name: string }[] }) {
  const PAGE = 100;
  const router = useRouter();
  const [spec, setSpec] = useState<Spec>({ ...EMPTY, ...(preset ?? {}) });
  const [page, setPage] = useState(1);
  const set = (k: keyof Spec, v: string) => {
    setSpec((s) => ({ ...s, [k]: v }));
    setPage(1);
  };
  const active = Object.values(spec).filter(Boolean).length;
  const out = useMemo(() => rows.filter((r) => passes(r.crit, spec)), [rows, spec]);
  const pages = Math.max(1, Math.ceil(out.length / PAGE));
  const pageRows = out.slice((page - 1) * PAGE, page * PAGE);

  const sel = (k: keyof Spec, label: string, options: readonly Opt[]) => (
    <label key={k} className="mb-2.5 block text-xs text-muted">
      {label}
      <select value={spec[k]} onChange={(e) => set(k, e.target.value)} className="input mt-1">
        <option value="">Any</option>
        {options.map((o) => {
          const v = typeof o === "string" ? o : o.v;
          const l = typeof o === "string" ? o : o.l;
          return (
            <option key={v} value={v}>
              {l}
            </option>
          );
        })}
      </select>
    </label>
  );

  return (
    <div className="grid grid-cols-[300px_1fr] gap-6 px-8 py-6">
      <aside className="card self-start p-4">
        <div className="mb-3 flex items-center justify-between">
          <span className="text-sm font-semibold">Deal specs</span>
          {active > 0 && (
            <button type="button" className="text-xs text-sky-600 hover:underline" onClick={() => setSpec(EMPTY)}>
              Clear
            </button>
          )}
        </div>
        {deals.length > 0 && (
          <label className="mb-3 block text-xs text-muted">
            Choose from a deal
            <select className="input mt-1" defaultValue="" onChange={(e) => e.target.value && router.push(`/investors?dealId=${e.target.value}`)}>
              <option value="">{presetDealName ? `Using: ${presetDealName}` : "Pick a deal…"}</option>
              {deals.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </select>
          </label>
        )}
        {sel("assetClass", "Asset class", ASSET_CLASSES)}
        {sel("checkSize", "Check size", CHECK_SIZES)}
        {sel("requestType", "Equity or debt", ["Equity", "Debt", "Both"])}
        {sel("strategy", "Acquisition or development", ["Acquisitions", "Development", "Both"])}
        {sel("returnProfile", "Return profile", RETURN_PROFILES)}
        {sel("holdPeriod", "Hold period", HOLD_PERIODS)}
        {sel("vintage", "Year built", VINTAGES)}
        {sel("oz", "Opportunity Zone", [{ v: "yes", l: "Yes" }, { v: "no", l: "No" }])}
        {sel("closing", "Closing time frame", CLOSING_TIMEFRAMES)}
        {sel("minority", "Open to minority position", [{ v: "yes", l: "Yes" }, { v: "no", l: "No" }])}
      </aside>

      <section className="card flex h-[calc(100vh-140px)] min-h-[480px] flex-col overflow-hidden">
        <div className="flex items-center justify-between border-b border-line px-4 py-2 text-sm">
          <div>
            <span className="font-semibold">{out.length.toLocaleString()}</span> investor firms
            {active > 0 && (
              <span className="text-muted">
                {" "}
                matching {active} spec{active === 1 ? "" : "s"}
              </span>
            )}
          </div>
          <span className="text-xs text-muted">
            {out.length ? (page - 1) * PAGE + 1 : 0}–{Math.min(page * PAGE, out.length)} of {out.length.toLocaleString()}
          </span>
        </div>
        <div className="min-h-0 flex-1 overflow-auto">
          <table className="table dense w-full table-fixed min-w-[1400px]">
            <thead>
              <tr>
                <th className="w-[240px]">Company name</th>
                <th className="w-[260px]">Deal locations</th>
                <th className="w-[220px]">Check sizes</th>
                <th className="w-[230px]">Asset classes</th>
                <th className="w-[180px]">Type of investment</th>
                <th className="w-[110px]">Acq / Dev</th>
                <th className="w-[160px]">Return profile</th>
                <th>Hold period</th>
              </tr>
            </thead>
            <tbody>
              {pageRows.map((r) => (
                <tr key={r.id}>
                  <td>
                    <Link href={`/companies/${r.id}`} className="flex items-center gap-2 font-medium hover:underline">
                      <CompanyLogo domain={r.domain} name={r.name} />
                      <span className="truncate">{r.name}</span>
                    </Link>
                  </td>
                  <Cell text={r.crit?.geographyNotes} />
                  <Cell items={r.crit?.checkSizes} />
                  <Cell items={r.crit?.assetClasses} />
                  <Cell items={r.crit?.investmentTypes} />
                  <Cell text={r.crit?.strategy} />
                  <Cell items={r.crit?.returnProfile} />
                  <Cell items={r.crit?.holdPeriods} />
                </tr>
              ))}
              {pageRows.length === 0 && (
                <tr>
                  <td colSpan={8} className="py-10 text-center text-muted">
                    No firms match all of these specs.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <div className="flex items-center justify-center border-t border-line px-4 py-2">
          <Pager page={page} pages={pages} onPage={setPage} />
        </div>
      </section>
    </div>
  );
}

function Cell({ items, text }: { items?: string[]; text?: string | null }) {
  const t = text ?? (items && items.length ? items.join(", ") : "");
  if (!t) return <td className="text-muted">—</td>;
  return (
    <td className="truncate" title={t}>
      {t}
    </td>
  );
}

function Pager({ page, pages, onPage }: { page: number; pages: number; onPage: (p: number) => void }) {
  if (pages <= 1) return <span className="text-xs text-muted">Page 1 of 1</span>;
  const lo = Math.max(1, Math.min(page - 3, pages - 6));
  const nums = Array.from({ length: Math.min(7, pages) }, (_, i) => lo + i);
  const btn = "min-w-[30px] rounded-md px-2 py-1 text-sm hover:bg-cream disabled:opacity-40";
  return (
    <div className="flex items-center gap-1">
      <button type="button" className={btn} disabled={page <= 1} onClick={() => onPage(page - 1)}>
        ‹ Prev
      </button>
      {nums.map((n) => (
        <button key={n} type="button" className={`${btn} ${n === page ? "border border-ink font-semibold" : ""}`} onClick={() => onPage(n)}>
          {n}
        </button>
      ))}
      <button type="button" className={btn} disabled={page >= pages} onClick={() => onPage(page + 1)}>
        Next ›
      </button>
    </div>
  );
}
