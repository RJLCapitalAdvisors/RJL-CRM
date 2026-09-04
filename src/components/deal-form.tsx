"use client";

import { useMemo, useState } from "react";
import { AMORTIZATIONS, ASSET_CLASSES, LENDER_TYPES, LOAN_TERMS, SELLER_PROFILES, SOURCING_OPTIONS, UNIT_MIXES, US_STATES } from "@/lib/taxonomy";
import { assetProfile, perCountWord, ratio } from "@/lib/asset-profile";
import { NumberInput } from "./number-input";
import { isPref, prefMetrics } from "@/lib/pref";

export const EXECUTION_TYPES = ["Senior Debt", "Mezz Debt", "Preferred Equity", "JV Equity", "Co-GP Equity", "LP Equity", "Fund Investment"] as const;

type DealLike = {
  name: string;
  stage: string;
  sponsorName: string | null;
  propertyName: string | null;
  propertyAddress: string | null;
  city: string | null;
  state: string | null;
  assetClass: string | null;
  strategy: string | null;
  onMarket: boolean | null;
  requestType: string | null;
  executionType: string | null;
  requestedAmount: number | null;
  totalEquity: number | null;
  totalDebt: number | null;
  totalCapitalization: number | null;
  purchasePrice: number | null;
  ltv: number | null;
  ltc: number | null;
  interestRate: string | null;
  loanTerm: string | null;
  amortization?: string | null;
  lenderType: string | null;
  equityMultiple: number | null;
  irr: number | null;
  holdPeriod: string | null;
  yieldOnCost: number | null;
  capRateY1: number | null;
  capRateT12: number | null;
  cashOnCash: number | null;
  occupancy: number | null;
  units: number | null;
  squareFeet: number | null;
  yearBuilt: string | null;
  unitMix: string | null;
  expectedClose: string | null;
  closedLostReason: string | null;
  closedWonReason: string | null;
  sponsorExperience: string | null;
  summary: string | null;
  ownerId: string | null;
  details?: string;
} | null;

function parseDetailsSafe(raw: string | undefined): Record<string, string | null> {
  try {
    return JSON.parse(raw || "{}");
  } catch {
    return {};
  }
}
const money = (n: number | null) => (n == null ? "—" : n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }));
const num = (v: unknown) => {
  if (v == null) return null;
  const t = String(v).replace(/[^0-9.-]/g, "");
  if (!t) return null;
  const n = Number(t);
  return isNaN(n) ? null : n;
};

/** One row: label on the left, control on the right. Everything stacks in a single straight column. */
function Row({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="border-b border-line py-2.5 last:border-0">
      <div className="mb-1 text-xs text-muted">{label}</div>
      {children}
      {hint && <div className="mt-1 text-[11px] text-muted">{hint}</div>}
    </div>
  );
}
function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h3 className="mb-1 mt-5 text-[11px] font-semibold uppercase tracking-wide text-sky-600 first:mt-0">{title}</h3>
      <div>{children}</div>
    </section>
  );
}
function Calc({ label, value, hint = "calculated" }: { label: string; value: string; hint?: string }) {
  return (
    <Row label={label} hint={hint}>
      <div className="rounded-md bg-cream px-3 py-2 text-sm font-medium tabular-nums">{value}</div>
    </Row>
  );
}
function Text({ name, value, placeholder }: { name: string; value?: string | number | null; placeholder?: string }) {
  return <input name={name} defaultValue={value ?? ""} placeholder={placeholder} className="input" />;
}
/** Dropdown that keeps a stored value visible even if it is not in the standard list. */
function Select({ name, value, options, blank = "—", onChange }: { name: string; value: string; options: readonly string[]; blank?: string; onChange?: (v: string) => void }) {
  const list = value && !options.includes(value) ? [value, ...options] : options;
  return (
    <select name={name} defaultValue={onChange ? undefined : value} value={onChange ? value : undefined} onChange={onChange ? (e) => onChange(e.target.value) : undefined} className="input">
      <option value="">{blank}</option>
      {list.map((o) => (
        <option key={o} value={o}>
          {o}
        </option>
      ))}
    </select>
  );
}

export function DealForm({ deal, users, action, submitLabel = "Save" }: { deal: DealLike; users: { id: string; name: string }[]; action: (fd: FormData) => void | Promise<void>; submitLabel?: string }) {
  const d = deal;
  const details = parseDetailsSafe(d?.details);
  const [assetClass, setAssetClass] = useState(d?.assetClass ?? "");
  const [execType, setExecType] = useState(d?.executionType ?? "");
  const [ask, setAsk] = useState<number | null>(d?.requestedAmount ?? null);
  const [t12, setT12] = useState<number | null>(d?.capRateT12 ?? null);
  const [yoc, setYoc] = useState<number | null>(d?.yieldOnCost ?? null);
  const [price, setPrice] = useState<number | null>(d?.purchasePrice ?? null);
  const [cap, setCap] = useState<number | null>(d?.totalCapitalization ?? null);
  const [debt, setDebt] = useState<number | null>(d?.totalDebt ?? null);
  const [count, setCount] = useState<number | null>(d?.units ?? null);
  const [sf, setSf] = useState<number | null>(d?.squareFeet ?? null);
  const [acres, setAcres] = useState<number | null>(num(details.acres));
  const p = useMemo(() => assetProfile(assetClass), [assetClass]);
  const per = perCountWord(p.countLabel);
  const equity = cap != null && debt != null ? cap - debt : cap != null && debt == null ? null : null;
  const lost = d?.stage === "Deal Lost";
  const pref = isPref(execType);
  const pm = prefMetrics({ totalDebt: debt, requestedAmount: ask, totalCapitalization: cap, purchasePrice: price, capRateT12: t12, yieldOnCost: yoc, units: count, squareFeet: sf, assetClass });
  const pct = (v: number | null) => (v == null ? "—" : `${v.toFixed(2)}%`);

  return (
    <form id="deal-form" action={action}>
      {/* Stage is set by dragging on the board; carried along unchanged here. */}
      <input type="hidden" name="stage" value={d?.stage ?? "Deal Received"} />

      <Group title="Deal">
        <Row label="Sponsor">
          <Text name="sponsorName" value={d?.sponsorName} placeholder="Citivest Commercial" />
        </Row>
        <Row label="Property / deal name">
          <Text name="propertyName" value={d?.propertyName} placeholder="Everett Mall Plaza" />
        </Row>
        <Row label="Asset class" hint="Sets which fields appear below">
          <Select name="assetClass" value={assetClass} options={ASSET_CLASSES} onChange={setAssetClass} />
        </Row>
        <Row label="Acquisition or development">
          <Select name="strategy" value={d?.strategy ?? ""} options={["Acquisitions", "Development"]} />
        </Row>
        {lost && (
          <Row label="Why it died">
            <Text name="closedLostReason" value={d?.closedLostReason} />
          </Row>
        )}
        <Row label="Owner">
          <select name="ownerId" defaultValue={d?.ownerId ?? ""} className="input">
            <option value="">Unassigned</option>
            {users.map((u) => (
              <option key={u.id} value={u.id}>
                {u.name}
              </option>
            ))}
          </select>
        </Row>
        <Row label="Expected close" hint="e.g. November 2026 or Q1 2027">
          <Text name="expectedClose" value={d?.expectedClose} />
        </Row>
      </Group>

      <Group title="Property">
        <Row label="Address">
          <Text name="propertyAddress" value={d?.propertyAddress} />
        </Row>
        <Row label="City">
          <Text name="city" value={d?.city} />
        </Row>
        <Row label="State">
          <Select name="state" value={d?.state ?? ""} options={Object.keys(US_STATES)} />
        </Row>
        <Row label="How the deal was sourced">
          <Select name="detail.sourcing" value={details.sourcing ?? (d?.onMarket == null ? "" : d.onMarket ? "On-market, full marketing process" : "Completely off-market, direct with seller")} options={SOURCING_OPTIONS} />
        </Row>
        <Row label="Seller profile">
          <Select name="detail.sellerProfile" value={details.sellerProfile ?? ""} options={SELLER_PROFILES} />
        </Row>
        {p.countLabel && (
          <Row label={p.countLabel}>
            <NumberInput name="units" defaultValue={d?.units} decimals={false} onValue={setCount} />
          </Row>
        )}
        {(p.perFoot || p.countLabel) && (
          <Row label="Square feet">
            <NumberInput name="squareFeet" defaultValue={d?.squareFeet} decimals={false} onValue={setSf} />
          </Row>
        )}
        {p.perAcre && (
          <Row label="Acres">
            <NumberInput name="detail.acres" defaultValue={acres} onValue={setAcres} />
          </Row>
        )}
        {p.showOccupancy && (
          <Row label="Occupancy %">
            <NumberInput name="occupancy" defaultValue={d?.occupancy} />
          </Row>
        )}
        {p.showYearBuilt && (
          <Row label="Year built">
            <Text name="yearBuilt" value={d?.yearBuilt} />
          </Row>
        )}
        {p.showUnitMix && (
          <Row label="Unit mix">
            <Select name="unitMix" value={d?.unitMix ?? ""} options={UNIT_MIXES} />
          </Row>
        )}
        {p.countLabel && p.perFoot && <Calc label={`Average ${per} size`} value={ratio(sf, count) ? `${Math.round(ratio(sf, count)!).toLocaleString()} SF` : "—"} />}
      </Group>

      <Group title="Capital request">
        <Row label="Type of investment" hint={pref ? "Pref / mezz: returns below switch to last-dollar metrics" : undefined}>
          <Select name="executionType" value={execType} options={EXECUTION_TYPES} onChange={setExecType} />
        </Row>
        <Row label={pref ? "Requested pref / mezz amount ($)" : "Requested amount ($)"}>
          <NumberInput name="requestedAmount" defaultValue={d?.requestedAmount} decimals={false} onValue={setAsk} />
        </Row>
        <Row label="Purchase price ($)" hint={d?.strategy === "Development" ? "Land price for developments" : undefined}>
          <NumberInput name="purchasePrice" defaultValue={d?.purchasePrice} decimals={false} onValue={setPrice} />
        </Row>
        {p.perCount && <Calc label={`Purchase price per ${per}`} value={money(ratio(price, count))} />}
        {p.perFoot && <Calc label="Purchase price per SF" value={money(ratio(price, sf))} />}
        {p.perAcre && <Calc label="Purchase price per acre" value={money(ratio(price, acres))} />}
        <Row label="Total capitalization ($)" hint="From sources and uses">
          <NumberInput name="totalCapitalization" defaultValue={d?.totalCapitalization} decimals={false} onValue={setCap} />
        </Row>
        {p.perCount && <Calc label={`Total capitalization per ${per}`} value={money(ratio(cap, count))} />}
        {p.perFoot && <Calc label="Total capitalization per SF" value={money(ratio(cap, sf))} />}
        {p.perAcre && <Calc label="Total capitalization per acre" value={money(ratio(cap, acres))} />}
        <Row label="Total debt ($)">
          <NumberInput name="totalDebt" defaultValue={d?.totalDebt} decimals={false} onValue={setDebt} />
        </Row>
        <Calc label="Total equity" value={money(equity)} hint="total capitalization minus total debt" />
      </Group>

      <Group title="Debt terms">
        <Row label="LTV %">
          <NumberInput name="ltv" defaultValue={d?.ltv} />
        </Row>
        <Row label="LTC %">
          <NumberInput name="ltc" defaultValue={d?.ltc} />
        </Row>
        <Row label="Interest rate">
          <Text name="interestRate" value={d?.interestRate} placeholder="6.75% fixed or SOFR + 300" />
        </Row>
        <Row label="Loan term">
          <Select name="loanTerm" value={d?.loanTerm ?? ""} options={LOAN_TERMS} />
        </Row>
        <Row label="I/O and amortization">
          <Select name="amortization" value={d?.amortization ?? ""} options={AMORTIZATIONS} />
        </Row>
        <Row label="Lender type">
          <Select name="lenderType" value={d?.lenderType ?? ""} options={LENDER_TYPES} />
        </Row>
      </Group>

      <Group title={pref ? "Pref / mezz position" : "Returns"}>
        <Row label="T12 cap rate %">
          <NumberInput name="capRateT12" defaultValue={d?.capRateT12} onValue={setT12} />
        </Row>
        <Row label="Year 1 cap rate %">
          <NumberInput name="capRateY1" defaultValue={d?.capRateY1} />
        </Row>
        <Row label="Yield on cost at stabilization %">
          <NumberInput name="yieldOnCost" defaultValue={d?.yieldOnCost} onValue={setYoc} />
        </Row>
        {pref ? (
          <>
            <Calc label="Last dollar exposure" value={money(pm.lastDollar)} hint="requested pref / mezz amount + total debt" />
            <Calc label="Pref LTC" value={pct(pm.prefLtc)} hint="(total debt + pref amount) ÷ total capitalization" />
            <Calc label="Pref LTV" value={pct(pm.prefLtv)} hint="(total debt + pref amount) ÷ purchase price" />
            <Calc label="Going-in yield on last dollar" value={pct(pm.goingInYieldLD)} hint="T12 NOI ÷ last dollar (T12 NOI = T12 cap rate × purchase price)" />
            <Calc label="Stabilized yield on last dollar" value={pct(pm.stabilizedYieldLD)} hint="stabilized NOI ÷ last dollar (stabilized NOI = yield on cost × total capitalization)" />
            <Calc label={`Stabilized basis on last pref dollar per ${pm.basisUnit}`} value={money(pm.basisLD)} hint={`last dollar ÷ ${pm.basisUnit === "SF" ? "square feet" : pm.basisUnit + "s"}`} />
          </>
        ) : (
          <>
            <Row label="IRR %">
              <NumberInput name="irr" defaultValue={d?.irr} />
            </Row>
            <Row label="Equity multiple (x)">
              <NumberInput name="equityMultiple" defaultValue={d?.equityMultiple} />
            </Row>
            <Row label="Stabilized cash-on-cash %">
              <NumberInput name="cashOnCash" defaultValue={d?.cashOnCash} />
            </Row>
          </>
        )}
        <Row label={pref ? "Pref / mezz term" : "Hold period"}>
          <Select name="holdPeriod" value={d?.holdPeriod ?? ""} options={["1 year", "2 year", "3 year", "4 year", "5 year", "6 year", "7 year", "8 year", "10 year"]} />
        </Row>
      </Group>

      <Group title="Narrative">
        <Row label="Sponsor bio">
          <textarea name="sponsorExperience" rows={4} defaultValue={d?.sponsorExperience ?? ""} className="input" />
        </Row>
        <Row label="Business plan / deal summary" hint="Used in the email template">
          <textarea name="summary" rows={4} defaultValue={d?.summary ?? ""} className="input" />
        </Row>
      </Group>

      <div className="sticky bottom-0 mt-4 flex justify-end border-t border-line bg-paper/95 py-3">
        <button className="btn-primary" type="submit">
          {submitLabel}
        </button>
      </div>
    </form>
  );
}
