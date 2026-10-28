"use client";

import { Suspense, use, useEffect, useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { DraftButton } from "@/app/draft-button";
import { createEngagementLetter, createInvestorListDraft, startOutreach } from "./actions";
import { ASSET_CLASSES, CLOSING_TIMEFRAMES, HOLD_PERIODS, INVESTMENT_TYPES, RETURN_PROFILES, VINTAGES } from "@/lib/taxonomy";
import { CHECK_MAX, CHECK_STOPS, labelFor, rangeLabel } from "@/lib/ranges";
import { CompanyLogo } from "@/components/company-logo";
import { MultiSelect } from "@/components/multi-select";

export type InvestorRow = {
  id: string;
  name: string;
  domain: string | null;
  city: string | null; // where the firm sits (the company card), for "investors near this deal" (Jonathan, Sep 24, 2026)
  state: string | null;
  crit: {
    assetClasses: string[];
    checkSizes: string[];
    checkMin: number | null; // $MM
    checkMax: number | null; // $MM, 100 = $100MM+
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
  assetClass: string[];
  checkMM: number | null; // the exact check being requested, in $MM
  checkMissing: boolean; // only firms with no check size on file (Jonathan, Oct 28, 2026), to go fill them in
  investmentType: string[];
  strategy: string[];
  returnProfile: string[];
  holdPeriod: string[];
  vintage: string[];
  oz: string[];
  closing: string[];
  minority: string[];
  state: string[]; // the firm's own location: state codes
  city: string; // the firm's own location: city, contains
};

const MAX_REACH = 30; // the most firms in one reach out (Jonathan, Oct 28, 2026); outreach.ts MAX_OUTREACH enforces it on the server
const EMPTY: Spec = { assetClass: [], checkMM: null, checkMissing: false, investmentType: [], strategy: [], returnProfile: [], holdPeriod: [], vintage: [], oz: [], closing: [], minority: [], state: [], city: "" };
const any = (have: string[], want: string[]) => want.some((w) => have.includes(w));


/** A firm passes when, for every spec with something checked, its criteria contain at least one of the checked values. Empty specs are ignored. */
function passes(c: InvestorRow["crit"], s: Spec, where: { city: string | null; state: string | null } = { city: null, state: null }): boolean {
  // the firm's own location (its company card), so a deal's neighbourhood can be worked: state codes, a city by name
  if (s.state.length && !(where.state && s.state.includes(where.state))) return false;
  if (s.city.trim() && !(where.city && where.city.toLowerCase().includes(s.city.trim().toLowerCase()))) return false;
  if (s.assetClass.length && !(c && any(c.assetClasses, s.assetClass))) return false;
  // exact check: the firm's range must cover it (an open top end, $100MM+, covers anything above)
  if (s.checkMissing && c && c.checkMin != null) return false;
  if (s.checkMM != null && !(c && c.checkMin != null && c.checkMax != null && s.checkMM >= c.checkMin && (c.checkMax >= CHECK_MAX || s.checkMM <= c.checkMax))) return false;
  if (s.investmentType.length && !(c && any(c.investmentTypes, s.investmentType))) return false;
  if (s.strategy.length && !(c && c.strategy && (s.strategy.includes(c.strategy) || c.strategy === "Both"))) return false;
  if (s.returnProfile.length && !(c && any(c.returnProfile, s.returnProfile))) return false;
  if (s.holdPeriod.length && !(c && any(c.holdPeriods, s.holdPeriod))) return false;
  if (s.vintage.length && !(c && any(c.vintages, s.vintage))) return false;
  if (s.oz.length && !(c && c.ozInterest != null && s.oz.includes(c.ozInterest ? "Yes" : "No"))) return false;
  if (s.closing.length && !(c && c.closingTimeframe && s.closing.includes(c.closingTimeframe))) return false;
  if (s.minority.length && !(c && c.openToMinority != null && s.minority.includes(c.openToMinority ? "Yes" : "No"))) return false;
  return true;
}

export type Suggestion = { companyId: string; name: string; reason: string };

/** The suggested groups, read from the page's promise so the rest of the page never waits for them. */
function SuggestedGroups({ source, picked, toggle }: { source: Suggestion[] | Promise<Suggestion[]>; picked: Set<string>; toggle: (id: string) => void }) {
  const suggestions = Array.isArray(source) ? source : use(source);
  return (
    <>
      {suggestions.length === 0 && <span className="text-xs text-muted">Nothing yet for this deal.</span>}
      {suggestions.map((sg) => (
        <label key={sg.companyId} className={`flex cursor-pointer items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs ${picked.has(sg.companyId) ? "border-sky-600 bg-sky text-ink" : "border-line bg-paper hover:bg-cream"}`} title={sg.reason}>
          <input type="checkbox" className="accent-ink" checked={picked.has(sg.companyId)} onChange={() => toggle(sg.companyId)} />
          {sg.name}
        </label>
      ))}
      {suggestions.length > 0 && (
        <details className="text-xs text-muted">
          <summary className="cursor-pointer hover:underline">why</summary>
          <ul className="mt-1 max-h-40 space-y-0.5 overflow-auto">
            {suggestions.map((sg) => (
              <li key={sg.companyId}>
                <span className="font-medium text-ink">{sg.name}:</span> {sg.reason}
              </li>
            ))}
          </ul>
        </details>
      )}
    </>
  );
}

export function InvestorSearch({ rows, preset, presetDealName, presetPlace = null, deals, mode = "search", dealId = null, suggestions = [], onReport = [], outreaches = [] }: { rows: InvestorRow[]; outreaches?: { id: string; name: string; firms: number; sent: number }[]; preset: Partial<Spec> | null; presetDealName: string | null; presetPlace?: { city: string | null; state: string | null } | null; onReport?: string[]; deals: { id: string; name: string }[]; mode?: "search" | "engagement"; dealId?: string | null; suggestions?: Suggestion[] | Promise<Suggestion[]> }) {
  const PAGE = 100;
  const router = useRouter();
  const engagement = mode === "engagement" && Boolean(dealId);
  // the ticks survive leaving the page (Jonathan, Sep 24, 2026): kept in the browser per deal until Done; groups already on
  // the report start ticked, so a second pass only adds
  const storeKey = engagement && dealId ? `engagement-picks:${dealId}` : null;
  // Make list (search mode): tick firms, open them as a list in a blank email; the ticks are this visit's only (Jonathan, Oct 28, 2026)
  // Reach out: tick up to MAX_REACH firms, and the Send page sends them the brochure at the deal pace (same day)
  const [pick, setPick] = useState<"" | "list" | "reach">("");
  const picking = engagement || pick !== "";
  const [starting, startNow] = useTransition();
  const [reachError, setReachError] = useState<string | null>(null);
  const [picked, setPicked] = useState<Set<string>>(() => {
    const base = new Set(engagement ? onReport : []);
    if (storeKey && typeof window !== "undefined") {
      try {
        for (const id of JSON.parse(window.localStorage.getItem(storeKey) ?? "[]") as string[]) base.add(id);
      } catch {
        /* nothing remembered */
      }
    }
    return base;
  });
  const onReportSet = useMemo(() => new Set(onReport), [onReport]);
  useEffect(() => {
    if (!storeKey) return;
    try {
      const extra = [...picked].filter((id) => !onReportSet.has(id));
      if (extra.length) window.localStorage.setItem(storeKey, JSON.stringify(extra));
      else window.localStorage.removeItem(storeKey);
    } catch {
      /* private window */
    }
  }, [picked, storeKey, onReportSet]);
  const togglePick = (id: string) => setPicked((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const forget = () => { try { if (storeKey) window.localStorage.removeItem(storeKey); } catch { /* nothing to forget */ } };
  const [spec, setSpec] = useState<Spec>({ ...EMPTY, ...(preset ?? {}) });
  const [page, setPage] = useState(1);
  const set = (k: Exclude<keyof Spec, "checkMM" | "city" | "checkMissing">, v: string[]) => {
    setSpec((s) => ({ ...s, [k]: v }));
    setPage(1);
  };
  const setCheck = (v: number | null) => {
    setSpec((s) => ({ ...s, checkMM: v }));
    setPage(1);
  };
  const active = Object.values(spec).filter((v) => (Array.isArray(v) ? v.length > 0 : typeof v === "string" ? v.trim() !== "" : typeof v === "boolean" ? v : v != null)).length;
  // the Check size column sorts: firms with no check size first (to fill them in), or the biggest checks first
  const [sort, setSort] = useState<"" | "missing" | "check">("");
  const out = useMemo(() => {
    const list = rows.filter((r) => passes(r.crit, spec, { city: r.city, state: r.state }));
    const lo = (r: InvestorRow) => r.crit?.checkMin ?? null, hi = (r: InvestorRow) => r.crit?.checkMax ?? null;
    if (sort === "missing") return [...list].sort((a, b) => Number(lo(a) != null) - Number(lo(b) != null) || a.name.localeCompare(b.name));
    if (sort === "check") return [...list].sort((a, b) => (hi(b) ?? -1) - (hi(a) ?? -1) || (lo(b) ?? -1) - (lo(a) ?? -1) || a.name.localeCompare(b.name));
    return list;
  }, [rows, spec, sort]);
  const missingCount = useMemo(() => rows.filter((r) => r.crit?.checkMin == null).length, [rows]);
  const stateOptions = useMemo(() => [...new Set(rows.map((r) => r.state).filter((x): x is string => Boolean(x)))].sort(), [rows]);
  const pages = Math.max(1, Math.ceil(out.length / PAGE));
  const pageRows = out.slice((page - 1) * PAGE, page * PAGE);

  const sel = (k: Exclude<keyof Spec, "checkMM" | "city" | "checkMissing">, label: string, options: readonly string[]) => (
    <div key={k} className="mb-2.5 text-xs text-muted">
      {label}
      <div className="mt-1">
        <MultiSelect options={options} value={spec[k]} onChange={(v) => set(k, v)} placeholder="Any" />
      </div>
    </div>
  );

  return (
    <div className="grid grid-cols-[300px_1fr] gap-6 px-8 py-6">
      {engagement && dealId && (
        <div className="col-span-2 -mb-3 flex items-center justify-between rounded-lg border border-line bg-cream px-4 py-1.5">
          <div className="flex items-baseline gap-3">
            <span className="font-semibold">Engagement letter{presetDealName ? ` for ${presetDealName}` : ""}</span>
            <span className="text-xs text-muted">Tick the groups to carve out; Done drafts the letter in your Outlook and seeds the progress report.</span>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-sm text-muted">{picked.size} group{picked.size === 1 ? "" : "s"}{onReport.length ? ` · ${onReport.length} already on the report` : ""}{picked.size > onReport.length ? ` · ${picked.size - onReport.length} new` : ""}</span>
            {picked.size > onReport.length && (
              <button type="button" className="text-xs text-muted hover:underline" onClick={() => { setPicked(new Set(onReport)); forget(); }} title="Drop the ticks made since the last letter">
                Clear new ticks
              </button>
            )}
            <DraftButton label="Done" readyLabel="Open letter in Outlook" action={async () => { if (!picked.size) return { ok: false as const, reason: "Tick the groups to carve out first: the suggested groups above the list, or the boxes on the left of each row." }; const r = await createEngagementLetter(dealId, [...picked]); if (r.ok) forget(); return r; }} title="Drafts the engagement letter with the ticked groups" />
          </div>
        </div>
      )}
      <aside className="card self-start p-4">
        {!engagement && (
          <div className="mb-3 space-y-1.5">
            <button type="button" className={`w-full ${pick === "list" ? "btn-primary" : "btn-secondary"}`} title="Tick firms in the list on the right, then open them as a list in a blank email" onClick={() => { setPicked(new Set()); setPick(pick === "list" ? "" : "list"); }}>
              {pick === "list" ? "Stop making the list" : "Make list"}
            </button>
            <button type="button" className={`w-full ${pick === "reach" ? "btn-primary" : "btn-secondary"}`} title={`Tick up to ${MAX_REACH} firms, then write one email and send them the brochure one at a time, like a deal send`} onClick={() => { setPicked(new Set()); setReachError(null); setPick(pick === "reach" ? "" : "reach"); }}>
              {pick === "reach" ? "Stop the reach out" : "Reach out"}
            </button>
            {outreaches.length > 0 && (
              <div className="text-[11px] text-muted">
                {outreaches.map((o) => (
                  <Link key={o.id} href={`/investors/reach/${o.id}/send`} className="block truncate hover:underline" title={`${o.firms} firms, ${o.sent} sent: open the Send page`}>
                    {o.name.replace(/^Reach out · /, "")} · {o.sent}/{o.firms} sent
                  </Link>
                ))}
              </div>
            )}
          </div>
        )}
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
        <div className="mb-2.5 text-xs text-muted">
          <div className="flex items-center justify-between">
            <span>Company location</span>
            {presetPlace && (presetPlace.city || presetPlace.state) && (
              <button type="button" className="text-sky-600 hover:underline" title="Firms whose office is in this deal's state" onClick={() => setSpec((s) => ({ ...s, state: presetPlace.state ? [presetPlace.state] : s.state, city: "" }))}>
                Near {presetPlace.city ? `${presetPlace.city}, ` : ""}{presetPlace.state}
              </button>
            )}
          </div>
          <div className="mt-1">
            <MultiSelect options={stateOptions} value={spec.state} onChange={(v) => set("state", v)} placeholder="Any state" />
          </div>
          <input value={spec.city} onChange={(e) => setSpec((s) => ({ ...s, city: e.target.value }))} placeholder="City" className="input mt-1 py-1 text-xs" />
        </div>
        {sel("assetClass", "Asset class", ASSET_CLASSES)}
        <div className="mb-2.5 text-xs text-muted">
          <div className="flex items-center justify-between">
            <span>Check size</span>
            <label className="flex cursor-pointer items-center gap-1" title="Firms whose criteria have no check size yet, so you can fill them in">
              <input type="checkbox" className="accent-ink" checked={spec.checkMissing} onChange={(e) => { setSpec((s) => ({ ...s, checkMissing: e.target.checked, checkMM: e.target.checked ? null : s.checkMM })); setPage(1); }} />
              none on file ({missingCount.toLocaleString()})
            </label>
            {spec.checkMM != null && (
              <button type="button" className="text-sky-600 hover:underline" onClick={() => setCheck(null)}>
                Clear
              </button>
            )}
          </div>
          <div className="mt-1 text-sm font-medium text-ink">{spec.checkMM != null ? labelFor(CHECK_STOPS, spec.checkMM) : <span className="font-normal text-muted">Any</span>}</div>
          <input type="range" min={1} max={CHECK_MAX} step={1} value={spec.checkMM ?? 1} onChange={(e) => setCheck(Number(e.target.value))} className="range-thumb range-single mt-1 w-full" aria-label="Check size in $MM" />
          <div className="flex justify-between text-[10px]">
            <span>$1MM</span>
            <span>$100MM+</span>
          </div>
        </div>
        {sel("investmentType", "Position in the capital stacks", INVESTMENT_TYPES)}
        {sel("strategy", "Acquisition or development", ["Acquisitions", "Development", "Both"])}
        {sel("returnProfile", "Return profile", RETURN_PROFILES)}
        {sel("holdPeriod", "Hold period", HOLD_PERIODS)}
        {sel("vintage", "Year built", VINTAGES)}
        {sel("oz", "Opportunity Zone", ["Yes", "No"])}
        {sel("closing", "Closing time frame", CLOSING_TIMEFRAMES)}
        {sel("minority", "Open to minority position", ["Yes", "No"])}
      </aside>

      <section className="card flex h-[calc(100vh-140px)] min-h-[480px] flex-col overflow-hidden">
        {engagement && (
          <div className="border-b border-line bg-cream-50 px-4 py-2">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
              <span className="text-xs font-semibold text-sky-600">Suggested by the CRM</span>
              <Suspense fallback={<span className="text-xs text-muted">Finding groups for this deal…</span>}>
                <SuggestedGroups source={suggestions} picked={picked} toggle={togglePick} />
              </Suspense>
              <Link href={`/investors?dealId=${dealId}&mode=engagement&refresh=1`} className="ml-auto text-xs text-muted hover:underline" title="Re-read criteria, tracker history and emails for this deal">
                refresh
              </Link>
            </div>
          </div>
        )}
        {pick === "reach" && (
          <div className="flex flex-wrap items-center gap-3 border-b border-line bg-cream-50 px-4 py-2">
            <span className="text-xs font-semibold text-sky-600">Reach out</span>
            <span className="text-sm text-muted">{picked.size} of {MAX_REACH} firms ticked</span>
            {picked.size >= MAX_REACH && <span className="text-xs text-amber-700">{MAX_REACH} is the most for one reach out</span>}
            <button type="button" className="text-xs text-muted hover:underline" title={`Tick the first ${MAX_REACH} firms the specs match`} onClick={() => setPicked((s) => { const n = new Set(s); for (const r of out) { if (n.size >= MAX_REACH) break; n.add(r.id); } return n; })}>
              tick the first {Math.min(MAX_REACH, out.length)} matching
            </button>
            {picked.size > 0 && (
              <button type="button" className="text-xs text-muted hover:underline" onClick={() => setPicked(new Set())}>
                untick all
              </button>
            )}
            <span className="text-xs text-muted">Next comes the Send page: write the email, add the brochure, launch; one email at a time, as a deal goes out.</span>
            <div className="ml-auto flex flex-col items-end gap-1">
              <button type="button" className="btn-primary" disabled={!picked.size || starting} onClick={() => { setReachError(null); startNow(async () => { const r = await startOutreach([...picked]); if (r.ok) router.push(`/investors/reach/${r.id}/send`); else setReachError(r.reason); }); }}>
                {starting ? "Setting up…" : "Next: write the email"}
              </button>
              {reachError && <span className="max-w-[320px] text-right text-xs text-red-700">{reachError}</span>}
            </div>
          </div>
        )}
        {pick === "list" && (
          <div className="flex flex-wrap items-center gap-3 border-b border-line bg-cream-50 px-4 py-2">
            <span className="text-xs font-semibold text-sky-600">Making a list</span>
            <span className="text-sm text-muted">{picked.size} firm{picked.size === 1 ? "" : "s"} ticked</span>
            <button type="button" className="text-xs text-muted hover:underline" title="Tick every firm the specs match" onClick={() => setPicked((s) => { const n = new Set(s); for (const r of out) n.add(r.id); return n; })}>
              tick all {out.length.toLocaleString()} matching
            </button>
            {picked.size > 0 && (
              <button type="button" className="text-xs text-muted hover:underline" onClick={() => setPicked(new Set())}>
                untick all
              </button>
            )}
            <div className="ml-auto">
              <DraftButton label="Open list in a blank email" readyLabel="Open in Outlook" action={async () => createInvestorListDraft([...picked])} title="Drafts a blank email in your Outlook with the ticked firms listed in the body" />
            </div>
          </div>
        )}
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
                {picking && <th className="w-8"></th>}
                <th className="w-[240px]">Company name</th>
                <th className="w-[130px]">Based in</th>
                <th className="w-[260px]">Deal locations</th>
                <th className="w-[170px]">
                  <button type="button" className="hover:underline" title="Sort: firms with no check size first, then biggest checks first, then as before" onClick={() => { setSort((x) => (x === "" ? "missing" : x === "missing" ? "check" : "")); setPage(1); }}>
                    Check size{sort === "missing" ? " · none first" : sort === "check" ? " · biggest first" : ""}
                  </button>
                </th>
                <th className="w-[230px]">Asset classes</th>
                <th className="w-[180px]">Position in the capital stack</th>
                <th className="w-[110px]">Acq / Dev</th>
                <th className="w-[160px]">Return profile</th>
                <th>Hold period</th>
              </tr>
            </thead>
            <tbody>
              {pageRows.map((r) => (
                <tr key={r.id} className={picking && picked.has(r.id) ? "bg-cream" : ""}>
                  {picking && (
                    <td>
                      <input type="checkbox" className="accent-ink" checked={picked.has(r.id)} disabled={pick === "reach" && !picked.has(r.id) && picked.size >= MAX_REACH} onChange={() => togglePick(r.id)} aria-label={`Pick ${r.name}`} />
                    </td>
                  )}
                  <td>
                    <Link href={`/companies/${r.id}`} className="flex items-center gap-2 font-medium hover:underline">
                      <CompanyLogo domain={r.domain} name={r.name} />
                      <span className="truncate">{r.name}</span>
                    </Link>
                  </td>
                  <td className="whitespace-nowrap text-xs">{[r.city, r.state].filter(Boolean).join(", ") || <span className="text-muted">—</span>}</td>
                  <Cell text={r.crit?.geographyNotes} />
                  <td className="whitespace-nowrap">{r.crit && r.crit.checkMin != null ? rangeLabel(CHECK_STOPS, r.crit.checkMin, r.crit.checkMax) : <span className="text-muted">—</span>}</td>
                  <Cell items={r.crit?.assetClasses} />
                  <Cell items={r.crit?.investmentTypes} />
                  <Cell text={r.crit?.strategy} />
                  <Cell items={r.crit?.returnProfile} />
                  <Cell items={r.crit?.holdPeriods} />
                </tr>
              ))}
              {pageRows.length === 0 && (
                <tr>
                  <td colSpan={9} className="py-10 text-center text-muted">
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

const STACK = ["Senior Debt", "Mezz Debt", "Preferred Equity", "JV Equity", "Co-GP Equity"];
const ordered = (items: string[]) => [...items].sort((a, b) => (STACK.indexOf(a) === -1 ? 99 : STACK.indexOf(a)) - (STACK.indexOf(b) === -1 ? 99 : STACK.indexOf(b)));
function Cell({ items, text }: { items?: string[]; text?: string | null }) {
  const t = text ?? (items && items.length ? ordered(items).join(", ") : "");
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
