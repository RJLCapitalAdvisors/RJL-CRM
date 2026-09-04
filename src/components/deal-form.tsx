"use client";

import { useMemo, useState } from "react";
import { ASSET_CLASSES, DEAL_STAGES, US_STATES } from "@/lib/taxonomy";
import { assetProfile, perCountWord, ratio } from "@/lib/asset-profile";

export const EXECUTION_TYPES = ["JV Equity", "LP Equity", "Co-GP Equity", "Preferred Equity", "Senior Debt", "Mezz Debt", "Fund Investment"] as const;

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
  lenderType: string | null;
  equityMultiple: number | null;
  irr: number | null;
  holdPeriod: string | null;
  yieldOnCost: number | null;
  capRateY1: number | null;
  capRateT12: number | null;
  cashOnCash: number | null;
  projectedReturns: string | null;
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
  closeDate: Date | null;
  ownerId: string | null;
  details?: string;
} | null;

const money = (n: number | null) => (n == null ? "—" : n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }));
const num = (v: string) => {
  const t = v.replace(/[^0-9.-]/g, "");
  if (!t) return null;
  const n = Number(t);
  return isNaN(n) ? null : n;
};

/** One row: label on the left, control on the right. Everything stacks in a single straight column. */
function Row({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[220px_1fr] items-center gap-4 border-b border-line py-2.5 last:border-0">
      <div>
        <div className="text-sm font-medium">{label}</div>
        {hint && <div className="text-[11px] text-muted">{hint}</div>}
      </div>
      <div>{children}</div>
    </div>
  );
}
function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h3 className="mb-1 mt-6 text-[11px] font-semibold uppercase tracking-wide text-sky-600 first:mt-0">{title}</h3>
      <div>{children}</div>
    </section>
  );
}
function Calc({ label, value }: { label: string; value: string }) {
  return (
    <Row label={label} hint="calculated">
      <div className="rounded-md bg-cream px-3 py-2 text-sm font-medium tabular-nums">{value}</div>
    </Row>
  );
}
function Text({ name, value, placeholder, inputMode }: { name: string; value?: string | number | null; placeholder?: string; inputMode?: "decimal" | "numeric" }) {
  return <input name={name} defaultValue={value ?? ""} placeholder={placeholder} inputMode={inputMode} className="input max-w-md" />;
}
function Select({ name, value, options, blank = "—" }: { name: string; value: string; options: readonly string[] | { v: string; l: string }[]; blank?: string }) {
  return (
    <select name={name} defaultValue={value} className="input max-w-md">
      <option value="">{blank}</option>
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
  );
}

export function DealForm({ deal, users, action, submitLabel = "Save" }: { deal: DealLike; users: { id: string; name: string }[]; action: (fd: FormData) => void | Promise<void>; submitLabel?: string }) {
  const d = deal;
  const [assetClass, setAssetClass] = useState(d?.assetClass ?? "");
  const [stage, setStage] = useState(d?.stage ?? "Deal Received");
  const [price, setPrice] = useState<number | null>(d?.purchasePrice ?? null);
  const [cap, setCap] = useState<number | null>(d?.totalCapitalization ?? null);
  const [count, setCount] = useState<number | null>(d?.units ?? null);
  const [sf, setSf] = useState<number | null>(d?.squareFeet ?? null);
  const [acres, setAcres] = useState<number | null>(num(JSON.parse(d?.details || "{}").acres ?? ""));
  const p = useMemo(() => assetProfile(assetClass), [assetClass]);
  const per = perCountWord(p.countLabel);
  const closed = stage === "Deal Closed" || stage === "Deal Lost";

  return (
    <form action={action} className="max-w-3xl">
      <Group title="Deal">
        <Row label="Sponsor">
          <Text name="sponsorName" value={d?.sponsorName} placeholder="Citivest Commercial" />
        </Row>
        <Row label="Property / deal name">
          <Text name="propertyName" value={d?.propertyName} placeholder="Everett Mall Plaza" />
        </Row>
        <Row label="Asset class" hint="Sets which fields appear below">
          <select name="assetClass" value={assetClass} onChange={(e) => setAssetClass(e.target.value)} className="input max-w-md">
            <option value="">—</option>
            {ASSET_CLASSES.map((s) => (
              <option key={s}>{s}</option>
            ))}
          </select>
        </Row>
        <Row label="Acquisition or development">
          <Select name="strategy" value={d?.strategy ?? ""} options={["Acquisitions", "Development"]} />
        </Row>
        <Row label="Stage">
          <select name="stage" value={stage} onChange={(e) => setStage(e.target.value)} className="input max-w-md">
            {DEAL_STAGES.map((s) => (
              <option key={s}>{s}</option>
            ))}
          </select>
        </Row>
        {closed && (
          <Row label={stage === "Deal Lost" ? "Why it died" : "Closed won notes"}>
            <Text name={stage === "Deal Lost" ? "closedLostReason" : "closedWonReason"} value={stage === "Deal Lost" ? d?.closedLostReason : d?.closedWonReason} />
          </Row>
        )}
        <Row label="Owner">
          <Select name="ownerId" value={d?.ownerId ?? ""} options={users.map((u) => ({ v: u.id, l: u.name }))} blank="Unassigned" />
        </Row>
        <Row label="Expected close" hint="Free text, e.g. Q4 2026">
          <Text name="expectedClose" value={d?.expectedClose} />
        </Row>
        <Row label="Close date">
          <input type="date" name="closeDate" defaultValue={d?.closeDate ? d.closeDate.toISOString().slice(0, 10) : ""} className="input max-w-md" />
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
        <Row label="On or off market">
          <Select name="onMarket" value={d?.onMarket == null ? "" : d.onMarket ? "on" : "off"} options={[{ v: "on", l: "On market" }, { v: "off", l: "Off market" }]} />
        </Row>
        {p.countLabel && (
          <Row label={p.countLabel}>
            <input name="units" defaultValue={d?.units ?? ""} inputMode="numeric" onChange={(e) => setCount(num(e.target.value))} className="input max-w-md" />
          </Row>
        )}
        {(p.perFoot || p.countLabel) && (
          <Row label="Square feet">
            <input name="squareFeet" defaultValue={d?.squareFeet ?? ""} inputMode="numeric" onChange={(e) => setSf(num(e.target.value))} className="input max-w-md" />
          </Row>
        )}
        {p.perAcre && (
          <Row label="Acres">
            <input name="detail.acres" defaultValue={acres ?? ""} inputMode="decimal" onChange={(e) => setAcres(num(e.target.value))} className="input max-w-md" />
          </Row>
        )}
        {p.showOccupancy && (
          <Row label="Occupancy %">
            <Text name="occupancy" value={d?.occupancy} inputMode="decimal" />
          </Row>
        )}
        {p.showYearBuilt && (
          <Row label="Year built">
            <Text name="yearBuilt" value={d?.yearBuilt} />
          </Row>
        )}
        {p.showUnitMix && (
          <Row label="Unit mix">
            <Text name="unitMix" value={d?.unitMix} placeholder="studios, one-bed, two-bed" />
          </Row>
        )}
        {p.countLabel && p.perFoot && <Calc label={`Average ${per} size`} value={ratio(sf, count) ? `${Math.round(ratio(sf, count)!).toLocaleString()} SF` : "—"} />}
      </Group>

      <Group title="Capital request">
        <Row label="Equity or debt">
          <Select name="requestType" value={d?.requestType ?? ""} options={["Equity", "Debt", "Both"]} />
        </Row>
        <Row label="Execution type">
          <Select name="executionType" value={d?.executionType ?? ""} options={EXECUTION_TYPES} />
        </Row>
        <Row label="Requested amount ($)">
          <Text name="requestedAmount" value={d?.requestedAmount} inputMode="numeric" />
        </Row>
        <Row label="Purchase price ($)" hint={d?.strategy === "Development" ? "Land price for developments" : undefined}>
          <input name="purchasePrice" defaultValue={d?.purchasePrice ?? ""} inputMode="numeric" onChange={(e) => setPrice(num(e.target.value))} className="input max-w-md" />
        </Row>
        {p.perCount && <Calc label={`Purchase price per ${per}`} value={money(ratio(price, count))} />}
        {p.perFoot && <Calc label="Purchase price per SF" value={money(ratio(price, sf))} />}
        {p.perAcre && <Calc label="Purchase price per acre" value={money(ratio(price, acres))} />}
        <Row label="Total capitalization ($)" hint="From sources and uses">
          <input name="totalCapitalization" defaultValue={d?.totalCapitalization ?? ""} inputMode="numeric" onChange={(e) => setCap(num(e.target.value))} className="input max-w-md" />
        </Row>
        {p.perCount && <Calc label={`Total capitalization per ${per}`} value={money(ratio(cap, count))} />}
        {p.perFoot && <Calc label="Total capitalization per SF" value={money(ratio(cap, sf))} />}
        {p.perAcre && <Calc label="Total capitalization per acre" value={money(ratio(cap, acres))} />}
        <Row label="Total equity ($)">
          <Text name="totalEquity" value={d?.totalEquity} inputMode="numeric" />
        </Row>
        <Row label="Total debt ($)">
          <Text name="totalDebt" value={d?.totalDebt} inputMode="numeric" />
        </Row>
      </Group>

      <Group title="Debt terms">
        <Row label="LTV %">
          <Text name="ltv" value={d?.ltv} inputMode="decimal" />
        </Row>
        <Row label="LTC %">
          <Text name="ltc" value={d?.ltc} inputMode="decimal" />
        </Row>
        <Row label="Interest rate">
          <Text name="interestRate" value={d?.interestRate} placeholder="SOFR + 300" />
        </Row>
        <Row label="Loan term and I/O">
          <Text name="loanTerm" value={d?.loanTerm} placeholder="5 year term, 2 years I/O" />
        </Row>
        <Row label="Lender type">
          <Text name="lenderType" value={d?.lenderType} placeholder="Agency, bank, debt fund" />
        </Row>
      </Group>

      <Group title="Returns">
        <Row label="T12 cap rate %">
          <Text name="capRateT12" value={d?.capRateT12} inputMode="decimal" />
        </Row>
        <Row label="Year 1 cap rate %">
          <Text name="capRateY1" value={d?.capRateY1} inputMode="decimal" />
        </Row>
        <Row label="IRR %">
          <Text name="irr" value={d?.irr} inputMode="decimal" />
        </Row>
        <Row label="Equity multiple (x)">
          <Text name="equityMultiple" value={d?.equityMultiple} inputMode="decimal" />
        </Row>
        <Row label="Yield on cost at stabilization %">
          <Text name="yieldOnCost" value={d?.yieldOnCost} inputMode="decimal" />
        </Row>
        <Row label="Stabilized cash-on-cash %">
          <Text name="cashOnCash" value={d?.cashOnCash} inputMode="decimal" />
        </Row>
        <Row label="Hold period">
          <Text name="holdPeriod" value={d?.holdPeriod} placeholder="5 year" />
        </Row>
        <Row label="Projected returns (as written)">
          <Text name="projectedReturns" value={d?.projectedReturns} />
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

      <div className="sticky bottom-0 mt-6 flex justify-end border-t border-line bg-paper/95 py-3">
        <button className="btn-primary" type="submit">
          {submitLabel}
        </button>
      </div>
    </form>
  );
}
