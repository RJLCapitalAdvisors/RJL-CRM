import { ASSET_CLASSES, DEAL_STAGES, US_STATES } from "@/lib/taxonomy";

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
} | null;

function In({ id, label, defaultValue, placeholder, type = "text", span = 1 }: { id: string; label: string; defaultValue?: string | number | null; placeholder?: string; type?: string; span?: number }) {
  return (
    <div className={span === 2 ? "col-span-2" : span === 3 ? "col-span-3" : span === 4 ? "col-span-4" : ""}>
      <label className="label" htmlFor={id}>
        {label}
      </label>
      <input id={id} name={id} type={type} defaultValue={defaultValue ?? ""} placeholder={placeholder} className="input" />
    </div>
  );
}

function Sel({ id, label, value, options, blank = "—" }: { id: string; label: string; value: string; options: readonly string[] | { v: string; l: string }[]; blank?: string }) {
  return (
    <div>
      <label className="label" htmlFor={id}>
        {label}
      </label>
      <select id={id} name={id} defaultValue={value} className="input">
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
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="border-t border-line pt-4">
      <div className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted">{title}</div>
      {children}
    </div>
  );
}

export function DealForm({ deal, users, action, submitLabel = "Save" }: { deal: DealLike; users: { id: string; name: string }[]; action: (fd: FormData) => void | Promise<void>; submitLabel?: string }) {
  const d = deal;
  const closed = d?.stage === "Deal Closed" || d?.stage === "Deal Lost";
  return (
    <form action={action} className="space-y-5">
      <div className="grid grid-cols-3 gap-4">
        <In id="sponsorName" label="Sponsor" defaultValue={d?.sponsorName} placeholder="Citivest Commercial" />
        <In id="propertyName" label="Property / deal name" defaultValue={d?.propertyName} placeholder="Everett Mall Plaza" span={2} />
      </div>
      <div className="grid grid-cols-4 gap-4">
        <Sel id="stage" label="Stage" value={d?.stage ?? "Deal Received"} options={DEAL_STAGES} blank="" />
        <Sel id="ownerId" label="Owner" value={d?.ownerId ?? ""} options={users.map((u) => ({ v: u.id, l: u.name }))} blank="Unassigned" />
        <In id="expectedClose" label="Expected close (text)" defaultValue={d?.expectedClose} placeholder="Q4 2026" />
        <In id="closeDate" label="Close date" type="date" defaultValue={d?.closeDate ? d.closeDate.toISOString().slice(0, 10) : ""} />
      </div>
      {closed && (
        <div className="grid grid-cols-2 gap-4">
          <In id="closedLostReason" label="Closed lost reason" defaultValue={d?.closedLostReason} />
          <In id="closedWonReason" label="Closed won reason" defaultValue={d?.closedWonReason} />
        </div>
      )}

      <Section title="Property">
        <div className="grid grid-cols-4 gap-4">
          <In id="propertyAddress" label="Address" defaultValue={d?.propertyAddress} span={2} />
          <In id="city" label="City" defaultValue={d?.city} />
          <Sel id="state" label="State" value={d?.state ?? ""} options={Object.keys(US_STATES)} />
        </div>
        <div className="mt-4 grid grid-cols-4 gap-4">
          <Sel id="assetClass" label="Asset class" value={d?.assetClass ?? ""} options={ASSET_CLASSES} />
          <Sel id="strategy" label="Strategy" value={d?.strategy ?? ""} options={["Acquisitions", "Development"]} />
          <Sel id="onMarket" label="On / off market" value={d?.onMarket == null ? "" : d.onMarket ? "on" : "off"} options={[{ v: "on", l: "On market" }, { v: "off", l: "Off market" }]} />
          <In id="occupancy" label="Occupancy %" defaultValue={d?.occupancy} />
        </div>
        <div className="mt-4 grid grid-cols-4 gap-4">
          <In id="units" label="Units" defaultValue={d?.units} />
          <In id="squareFeet" label="Square feet" defaultValue={d?.squareFeet} />
          <In id="yearBuilt" label="Year built" defaultValue={d?.yearBuilt} />
          <In id="unitMix" label="Unit mix" defaultValue={d?.unitMix} />
        </div>
      </Section>

      <Section title="Capital request">
        <div className="grid grid-cols-4 gap-4">
          <Sel id="requestType" label="Request type" value={d?.requestType ?? ""} options={["Equity", "Debt", "Both"]} />
          <Sel id="executionType" label="Execution type" value={d?.executionType ?? ""} options={EXECUTION_TYPES} />
          <In id="requestedAmount" label="Requested amount ($)" defaultValue={d?.requestedAmount} />
          <In id="purchasePrice" label="Purchase price ($)" defaultValue={d?.purchasePrice} />
        </div>
        <div className="mt-4 grid grid-cols-4 gap-4">
          <In id="totalCapitalization" label="Total capitalization ($)" defaultValue={d?.totalCapitalization} />
          <In id="totalEquity" label="Total equity ($)" defaultValue={d?.totalEquity} />
          <In id="totalDebt" label="Total debt ($)" defaultValue={d?.totalDebt} />
          <In id="holdPeriod" label="Hold period" defaultValue={d?.holdPeriod} placeholder="5 year" />
        </div>
      </Section>

      <Section title="Debt">
        <div className="grid grid-cols-4 gap-4">
          <In id="ltv" label="LTV %" defaultValue={d?.ltv} />
          <In id="ltc" label="LTC %" defaultValue={d?.ltc} />
          <In id="interestRate" label="Interest rate" defaultValue={d?.interestRate} placeholder="SOFR + 300" />
          <In id="lenderType" label="Lender type" defaultValue={d?.lenderType} placeholder="Agency, Bank, Debt fund" />
        </div>
        <div className="mt-4 grid grid-cols-4 gap-4">
          <In id="loanTerm" label="Loan term / I-O" defaultValue={d?.loanTerm} span={2} />
        </div>
      </Section>

      <Section title="Returns">
        <div className="grid grid-cols-4 gap-4">
          <In id="equityMultiple" label="Equity multiple" defaultValue={d?.equityMultiple} />
          <In id="irr" label="IRR %" defaultValue={d?.irr} />
          <In id="yieldOnCost" label="Yield on cost %" defaultValue={d?.yieldOnCost} />
          <In id="cashOnCash" label="Stabilized cash-on-cash %" defaultValue={d?.cashOnCash} />
        </div>
        <div className="mt-4 grid grid-cols-4 gap-4">
          <In id="capRateY1" label="Year 1 cap rate %" defaultValue={d?.capRateY1} />
          <In id="capRateT12" label="T12 cap rate %" defaultValue={d?.capRateT12} />
          <In id="projectedReturns" label="Projected returns (text)" defaultValue={d?.projectedReturns} span={2} />
        </div>
      </Section>

      <Section title="Narrative">
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="label" htmlFor="sponsorExperience">
              Sponsor bio / experience
            </label>
            <textarea id="sponsorExperience" name="sponsorExperience" rows={5} defaultValue={d?.sponsorExperience ?? ""} className="input" />
          </div>
          <div>
            <label className="label" htmlFor="summary">
              Business plan / deal summary (used in mail merge)
            </label>
            <textarea id="summary" name="summary" rows={5} defaultValue={d?.summary ?? ""} className="input" />
          </div>
        </div>
      </Section>

      <div className="flex justify-end">
        <button className="btn-primary" type="submit">
          {submitLabel}
        </button>
      </div>
    </form>
  );
}
