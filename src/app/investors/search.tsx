"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { ASSET_CLASSES, CLOSING_TIMEFRAMES, HOLD_PERIODS, RETURN_PROFILES, US_STATES } from "@/lib/taxonomy";
import { matchDeal } from "@/lib/matching";

export type InvestorRow = {
  id: string; // company id
  name: string; // firm
  location: string;
  retail: boolean;
  contactCount: number;
  bestContact: { id: string; name: string; email: string } | null;
  lastActivity: string | null;
  crit: {
    assetClasses: string[];
    checkSizes: string[];
    geographies: string[];
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
  state: string;
  amount: string;
  requestType: string;
  strategy: string;
  returnProfile: string;
  holdPeriod: string;
  yearBuilt: string;
  oz: string;
  closing: string;
  minority: string;
  text: string;
  fullOnly: boolean;
  includeRetail: boolean;
};

const EMPTY: Spec = { assetClass: "", state: "", amount: "", requestType: "", strategy: "", returnProfile: "", holdPeriod: "", yearBuilt: "", oz: "", closing: "", minority: "", text: "", fullOnly: false, includeRetail: false };

function vintageBucket(yearBuilt: string): string | null {
  const y = Number((yearBuilt.match(/\d{4}/) ?? [])[0]);
  if (!y) return /new|construction|2026|2025/i.test(yearBuilt) ? "New Construction" : null;
  if (y >= 2024) return "New Construction";
  if (y < 1960) return "Older than 1960";
  return `${Math.floor(y / 10) * 10}s`;
}

function fmtInput(v: string) {
  const digits = v.replace(/[^0-9]/g, "");
  return digits ? Number(digits).toLocaleString("en-US") : "";
}

export function InvestorSearch({ rows, preset, presetDealName, deals }: { rows: InvestorRow[]; preset: Partial<Spec> | null; presetDealName: string | null; deals: { id: string; name: string }[] }) {
  const [spec, setSpec] = useState<Spec>({ ...EMPTY, ...(preset ?? {}), amount: preset?.amount ? fmtInput(preset.amount) : "" });
  const [shown, setShown] = useState(200);
  const set = (k: keyof Spec, v: string | boolean) => {
    setSpec((s) => ({ ...s, [k]: v }));
    setShown(200);
  };

  const results = useMemo(() => {
    const amount = spec.amount ? Number(spec.amount.replace(/[^0-9.]/g, "")) : null;
    const dealLike = { assetClass: spec.assetClass || null, state: spec.state || null, requestedAmount: amount, requestType: spec.requestType || null, strategy: spec.strategy || null };
    const vb = spec.yearBuilt ? vintageBucket(spec.yearBuilt) : null;
    const q = spec.text.trim().toLowerCase();
    const extraDims = [spec.returnProfile, spec.holdPeriod, vb, spec.oz, spec.closing, spec.minority].filter(Boolean).length;

    const out = rows
      .filter((r) => (spec.includeRetail ? true : !r.retail))
      .filter((r) => !q || r.name.toLowerCase().includes(q) || r.location.toLowerCase().includes(q) || (r.bestContact?.name ?? "").toLowerCase().includes(q) || (r.bestContact?.email ?? "").toLowerCase().includes(q) || (r.crit?.geographyNotes ?? "").toLowerCase().includes(q))
      .map((r) => {
        const c = r.crit;
        const base = matchDeal(c ? { assetClasses: JSON.stringify(c.assetClasses), checkSizes: JSON.stringify(c.checkSizes), investmentTypes: JSON.stringify(c.investmentTypes), geographies: JSON.stringify(c.geographies), strategy: c.strategy } : null, dealLike);
        const reasons = [...base.reasons];
        const misses = [...base.misses.filter((m) => m !== "No criteria on record")];
        let score = base.score;
        let possible = base.possible;
        const check = (label: string, ok: boolean | null) => {
          if (ok === null) return;
          possible++;
          if (ok) {
            score++;
            reasons.push(label);
          } else misses.push(label.toLowerCase());
        };
        if (spec.returnProfile) check(`Return: ${spec.returnProfile}`, c?.returnProfile.length ? c.returnProfile.includes(spec.returnProfile) : false);
        if (spec.holdPeriod) check(`Hold: ${spec.holdPeriod}`, c?.holdPeriods.length ? c.holdPeriods.includes(spec.holdPeriod) : false);
        if (vb) check(`Vintage: ${vb}`, c?.vintages.length ? c.vintages.includes(vb) : false);
        if (spec.oz) check("OZ", c?.ozInterest == null ? false : c.ozInterest === (spec.oz === "yes"));
        if (spec.closing) check(`Closing: ${spec.closing}`, c?.closingTimeframe ? c.closingTimeframe === spec.closing : false);
        if (spec.minority) check("Minority OK", c?.openToMinority == null ? false : c.openToMinority === (spec.minority === "yes"));
        return { r, score, possible, reasons, misses, noCriteria: !c };
      })
      .filter((x) => (spec.fullOnly ? x.possible > 0 && x.score === x.possible : true))
      .sort((a, b) => b.score - a.score || (b.score - b.possible) - (a.score - a.possible) || a.r.name.localeCompare(b.r.name));
    return { out, dims: base(dealLike) + extraDims };
    function base(d: typeof dealLike) {
      return [d.assetClass, d.state, d.requestedAmount, d.requestType, d.strategy].filter(Boolean).length;
    }
  }, [rows, spec]);

  const full = results.out.filter((x) => x.possible > 0 && x.score === x.possible).length;
  const anySpec = results.dims > 0;

  return (
    <div className="grid grid-cols-[320px_1fr] gap-6 px-8 py-6">
      {/* Specs, one straight column */}
      <aside className="card self-start p-4">
        <div className="mb-3 text-sm font-semibold">Deal specs</div>
        {deals.length > 0 && (
          <label className="mb-3 block text-xs text-muted">
            Fill from a deal
            <select
              className="input mt-1"
              defaultValue=""
              onChange={(e) => {
                if (e.target.value) window.location.href = `/investors?dealId=${e.target.value}`;
              }}
            >
              <option value="">{presetDealName ? `Using: ${presetDealName}` : "Choose a deal…"}</option>
              {deals.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </select>
          </label>
        )}
        <Row label="Asset class">
          <select value={spec.assetClass} onChange={(e) => set("assetClass", e.target.value)} className="input">
            <option value="">Any</option>
            {ASSET_CLASSES.map((a) => (
              <option key={a}>{a}</option>
            ))}
          </select>
        </Row>
        <Row label="State">
          <select value={spec.state} onChange={(e) => set("state", e.target.value)} className="input">
            <option value="">Any</option>
            {Object.entries(US_STATES).map(([c, n]) => (
              <option key={c} value={c}>
                {c} · {n}
              </option>
            ))}
          </select>
        </Row>
        <Row label="Check size needed ($)">
          <input value={spec.amount} onChange={(e) => set("amount", fmtInput(e.target.value))} inputMode="numeric" placeholder="12,000,000" className="input tabular-nums" />
        </Row>
        <Row label="Equity or debt">
          <select value={spec.requestType} onChange={(e) => set("requestType", e.target.value)} className="input">
            <option value="">Any</option>
            <option>Equity</option>
            <option>Debt</option>
            <option>Both</option>
          </select>
        </Row>
        <Row label="Acquisition or development">
          <select value={spec.strategy} onChange={(e) => set("strategy", e.target.value)} className="input">
            <option value="">Any</option>
            <option>Acquisitions</option>
            <option>Development</option>
          </select>
        </Row>
        <Row label="Return profile">
          <select value={spec.returnProfile} onChange={(e) => set("returnProfile", e.target.value)} className="input">
            <option value="">Any</option>
            {RETURN_PROFILES.map((a) => (
              <option key={a}>{a}</option>
            ))}
          </select>
        </Row>
        <Row label="Hold period">
          <select value={spec.holdPeriod} onChange={(e) => set("holdPeriod", e.target.value)} className="input">
            <option value="">Any</option>
            {HOLD_PERIODS.map((a) => (
              <option key={a}>{a}</option>
            ))}
          </select>
        </Row>
        <Row label="Year built">
          <input value={spec.yearBuilt} onChange={(e) => set("yearBuilt", e.target.value)} placeholder="1985 or New Construction" className="input" />
        </Row>
        <Row label="Opportunity Zone deal">
          <select value={spec.oz} onChange={(e) => set("oz", e.target.value)} className="input">
            <option value="">Not relevant</option>
            <option value="yes">Yes, needs OZ interest</option>
          </select>
        </Row>
        <Row label="Closing speed">
          <select value={spec.closing} onChange={(e) => set("closing", e.target.value)} className="input">
            <option value="">Any</option>
            {CLOSING_TIMEFRAMES.map((a) => (
              <option key={a}>{a}</option>
            ))}
          </select>
        </Row>
        <Row label="Minority position">
          <select value={spec.minority} onChange={(e) => set("minority", e.target.value)} className="input">
            <option value="">Not relevant</option>
            <option value="yes">Must be open to minority</option>
          </select>
        </Row>
        <Row label="Name, firm, or location text">
          <input value={spec.text} onChange={(e) => set("text", e.target.value)} placeholder="Sunbelt, Ardent, mlgcapital…" className="input" />
        </Row>
        <label className="mt-3 flex items-center gap-2 text-sm">
          <input type="checkbox" checked={spec.fullOnly} onChange={(e) => set("fullOnly", e.target.checked)} className="accent-ink" /> Only full matches
        </label>
        <label className="mt-1 flex items-center gap-2 text-sm">
          <input type="checkbox" checked={spec.includeRetail} onChange={(e) => set("includeRetail", e.target.checked)} className="accent-ink" /> Include retail investors
        </label>
        <button type="button" className="btn-ghost mt-3 w-full" onClick={() => setSpec(EMPTY)}>
          Clear specs
        </button>
      </aside>

      {/* Results */}
      <section className="card">
        <div className="flex items-center justify-between border-b border-line px-4 py-3 text-sm">
          <div>
            <span className="font-semibold">{results.out.length.toLocaleString()}</span> investor firms{anySpec && <span className="text-muted"> · {full.toLocaleString()} match every spec you set</span>}
          </div>
          <div className="text-xs text-muted">Sorted best fit first. Click a firm to open it.</div>
        </div>
        <div className="max-h-[78vh] overflow-auto">
          <table className="table w-full min-w-[960px]">
            <thead>
              <tr>
                <th className="w-[240px]">Firm</th>
                <th>Best contact</th>
                {anySpec && <th className="text-center">Fit</th>}
                <th>Why</th>
                <th>Gaps</th>
              </tr>
            </thead>
            <tbody>
              {results.out.slice(0, shown).map(({ r, score, possible, reasons, misses, noCriteria }) => (
                <tr key={r.id} className={anySpec && possible > 0 && score === 0 ? "opacity-60" : ""}>
                  <td>
                    <Link href={`/companies/${r.id}`} className="font-medium hover:underline">
                      {r.name}
                    </Link>
                    <div className="text-xs text-muted">
                      {r.location || "—"}
                      {r.contactCount ? ` · ${r.contactCount} contact${r.contactCount === 1 ? "" : "s"}` : " · no contacts with email"}
                    </div>
                    {noCriteria && <div className="text-[11px] text-amber-700">no criteria on file</div>}
                  </td>
                  <td>
                    {r.bestContact ? (
                      <>
                        <Link href={`/contacts/${r.bestContact.id}`} className="hover:underline">
                          {r.bestContact.name}
                        </Link>
                        <div className="text-xs text-muted">{r.bestContact.email}</div>
                      </>
                    ) : (
                      <span className="text-muted">—</span>
                    )}
                  </td>
                  {anySpec && (
                    <td className="text-center">
                      <span className={`chip ${possible > 0 && score === possible ? "bg-emerald-100 text-emerald-900" : score > 0 ? "bg-sky text-ink" : "bg-stone-100 text-muted"}`}>
                        {score}/{possible}
                      </span>
                    </td>
                  )}
                  <td className="text-xs">
                    <div className="flex flex-wrap gap-1">
                      {reasons.map((x) => (
                        <span key={x} className="chip bg-emerald-50 text-emerald-900">
                          {x}
                        </span>
                      ))}
                    </div>
                  </td>
                  <td className="text-xs text-muted">{misses.join(", ")}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {results.out.length > shown && (
            <div className="border-t border-line p-3 text-center">
              <button type="button" className="btn-secondary" onClick={() => setShown((n) => n + 300)}>
                Show more ({(results.out.length - shown).toLocaleString()} left)
              </button>
            </div>
          )}
        </div>
      </section>
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="mb-2.5 block text-xs text-muted">
      {label}
      <div className="mt-1">{children}</div>
    </label>
  );
}
