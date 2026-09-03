import { ASSET_CLASSES, DEAL_STAGES, US_STATES } from "@/lib/taxonomy";

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
  requestedAmount: number | null;
  totalEquity: number | null;
  purchasePrice: number | null;
  ltv: number | null;
  loanTerm: string | null;
  equityMultiple: number | null;
  occupancy: number | null;
  sponsorExperience: string | null;
  summary: string | null;
  closeDate: Date | null;
  ownerId: string | null;
} | null;

function In({ id, label, defaultValue, placeholder, type = "text", span = 1 }: { id: string; label: string; defaultValue?: string | number | null; placeholder?: string; type?: string; span?: number }) {
  return (
    <div className={span === 2 ? "col-span-2" : span === 3 ? "col-span-3" : ""}>
      <label className="label" htmlFor={id}>
        {label}
      </label>
      <input id={id} name={id} type={type} defaultValue={defaultValue ?? ""} placeholder={placeholder} className="input" />
    </div>
  );
}

export function DealForm({ deal, users, action, submitLabel = "Save" }: { deal: DealLike; users: { id: string; name: string }[]; action: (fd: FormData) => void | Promise<void>; submitLabel?: string }) {
  const d = deal;
  return (
    <form action={action} className="space-y-5">
      <div className="grid grid-cols-3 gap-4">
        <In id="sponsorName" label="Sponsor" defaultValue={d?.sponsorName} placeholder="Citivest Commercial" />
        <In id="propertyName" label="Property / deal name" defaultValue={d?.propertyName} placeholder="Everett Mall Plaza" span={2} />
      </div>
      <div className="grid grid-cols-3 gap-4">
        <div>
          <label className="label" htmlFor="stage">
            Stage
          </label>
          <select id="stage" name="stage" defaultValue={d?.stage ?? "Deal Received"} className="input">
            {DEAL_STAGES.map((s) => (
              <option key={s}>{s}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="label" htmlFor="ownerId">
            Owner
          </label>
          <select id="ownerId" name="ownerId" defaultValue={d?.ownerId ?? ""} className="input">
            <option value="">Unassigned</option>
            {users.map((u) => (
              <option key={u.id} value={u.id}>
                {u.name}
              </option>
            ))}
          </select>
        </div>
        <In id="closeDate" label="Target close" type="date" defaultValue={d?.closeDate ? d.closeDate.toISOString().slice(0, 10) : ""} />
      </div>

      <div className="border-t border-line pt-4">
        <div className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted">Property</div>
        <div className="grid grid-cols-4 gap-4">
          <In id="propertyAddress" label="Address" defaultValue={d?.propertyAddress} span={2} />
          <In id="city" label="City" defaultValue={d?.city} />
          <div>
            <label className="label" htmlFor="state">
              State
            </label>
            <select id="state" name="state" defaultValue={d?.state ?? ""} className="input">
              <option value="">—</option>
              {Object.keys(US_STATES).map((s) => (
                <option key={s}>{s}</option>
              ))}
            </select>
          </div>
        </div>
        <div className="mt-4 grid grid-cols-4 gap-4">
          <div>
            <label className="label" htmlFor="assetClass">
              Asset class
            </label>
            <select id="assetClass" name="assetClass" defaultValue={d?.assetClass ?? ""} className="input">
              <option value="">—</option>
              {ASSET_CLASSES.map((s) => (
                <option key={s}>{s}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="label" htmlFor="strategy">
              Strategy
            </label>
            <select id="strategy" name="strategy" defaultValue={d?.strategy ?? ""} className="input">
              <option value="">—</option>
              <option>Acquisitions</option>
              <option>Development</option>
            </select>
          </div>
          <div>
            <label className="label" htmlFor="onMarket">
              On / off market
            </label>
            <select id="onMarket" name="onMarket" defaultValue={d?.onMarket == null ? "" : d.onMarket ? "on" : "off"} className="input">
              <option value="">—</option>
              <option value="on">On market</option>
              <option value="off">Off market</option>
            </select>
          </div>
          <In id="occupancy" label="Occupancy %" defaultValue={d?.occupancy} />
        </div>
      </div>

      <div className="border-t border-line pt-4">
        <div className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted">Capital request</div>
        <div className="grid grid-cols-4 gap-4">
          <div>
            <label className="label" htmlFor="requestType">
              Request type
            </label>
            <select id="requestType" name="requestType" defaultValue={d?.requestType ?? ""} className="input">
              <option value="">—</option>
              <option>Equity</option>
              <option>Debt</option>
              <option>Both</option>
            </select>
          </div>
          <In id="requestedAmount" label="Requested amount ($)" defaultValue={d?.requestedAmount} />
          <In id="totalEquity" label="Total equity ($)" defaultValue={d?.totalEquity} />
          <In id="purchasePrice" label="Purchase price ($)" defaultValue={d?.purchasePrice} />
        </div>
        <div className="mt-4 grid grid-cols-4 gap-4">
          <In id="ltv" label="Debt LTV %" defaultValue={d?.ltv} />
          <In id="loanTerm" label="Loan term" defaultValue={d?.loanTerm} />
          <In id="equityMultiple" label="Equity multiple" defaultValue={d?.equityMultiple} />
        </div>
      </div>

      <div className="border-t border-line pt-4">
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="label" htmlFor="sponsorExperience">
              Sponsor experience
            </label>
            <textarea id="sponsorExperience" name="sponsorExperience" rows={4} defaultValue={d?.sponsorExperience ?? ""} className="input" />
          </div>
          <div>
            <label className="label" htmlFor="summary">
              Deal summary (used in mail merge)
            </label>
            <textarea id="summary" name="summary" rows={4} defaultValue={d?.summary ?? ""} className="input" />
          </div>
        </div>
      </div>

      <div className="flex justify-end">
        <button className="btn-primary" type="submit">
          {submitLabel}
        </button>
      </div>
    </form>
  );
}
