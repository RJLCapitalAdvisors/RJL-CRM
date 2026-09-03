import { ASSET_CLASSES, CHECK_SIZES, DEAL_SIZES, INVESTMENT_TYPES, STRATEGIES, VINTAGES, REGIONS, parseList } from "@/lib/taxonomy";

type Criteria = {
  assetClasses: string;
  checkSizes: string;
  dealSizes: string;
  investmentTypes: string;
  strategy: string | null;
  geographies: string;
  geographyNotes: string | null;
  vintages: string;
  openToFunds: boolean | null;
  lenderPricing: string | null;
  aum: string | null;
  unitsManaged: string | null;
} | null;

function CheckGroup({ name, options, selected }: { name: string; options: readonly string[]; selected: string[] }) {
  return (
    <div className="flex flex-wrap gap-x-4 gap-y-1.5">
      {options.map((o) => (
        <label key={o} className="flex items-center gap-1.5 text-sm">
          <input type="checkbox" name={name} value={o} defaultChecked={selected.includes(o)} className="accent-ink" />
          {o}
        </label>
      ))}
    </div>
  );
}

export function CriteriaForm({ criteria, action, showLenderFields = true }: { criteria: Criteria; action: (fd: FormData) => void | Promise<void>; showLenderFields?: boolean }) {
  const c = criteria;
  const geos = parseList(c?.geographies);
  return (
    <form action={action} className="space-y-5">
      <div>
        <div className="label">Asset classes</div>
        <CheckGroup name="assetClasses" options={ASSET_CLASSES} selected={parseList(c?.assetClasses)} />
      </div>
      <div className="grid grid-cols-2 gap-5">
        <div>
          <div className="label">Check sizes</div>
          <CheckGroup name="checkSizes" options={CHECK_SIZES} selected={parseList(c?.checkSizes)} />
        </div>
        <div>
          <div className="label">Deal sizes</div>
          <CheckGroup name="dealSizes" options={DEAL_SIZES} selected={parseList(c?.dealSizes)} />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-5">
        <div>
          <div className="label">Investment types</div>
          <CheckGroup name="investmentTypes" options={INVESTMENT_TYPES} selected={parseList(c?.investmentTypes)} />
        </div>
        <div>
          <div className="label">Strategy</div>
          <select name="strategy" defaultValue={c?.strategy ?? ""} className="input w-48">
            <option value="">—</option>
            {STRATEGIES.map((o) => (
              <option key={o}>{o}</option>
            ))}
          </select>
        </div>
      </div>
      <div>
        <div className="label">Vintages considered</div>
        <CheckGroup name="vintages" options={VINTAGES} selected={parseList(c?.vintages)} />
      </div>
      <div className="grid grid-cols-2 gap-5">
        <div>
          <label className="label" htmlFor="geographies">
            Geographies (tags, comma separated)
          </label>
          <input id="geographies" name="geographies" defaultValue={geos.join(", ")} className="input" list="region-list" placeholder="Sunbelt, Texas, Florida" />
          <datalist id="region-list">
            {REGIONS.map((r) => (
              <option key={r} value={r} />
            ))}
          </datalist>
        </div>
        <div>
          <label className="label" htmlFor="geographyNotes">
            Geography notes (free text)
          </label>
          <input id="geographyNotes" name="geographyNotes" defaultValue={c?.geographyNotes ?? ""} className="input" placeholder="Nationwide, avoids NY and CA" />
        </div>
      </div>
      <div className="grid grid-cols-4 gap-5">
        <div>
          <div className="label">Open to funds?</div>
          <select name="openToFunds" defaultValue={c?.openToFunds == null ? "" : c.openToFunds ? "yes" : "no"} className="input">
            <option value="">—</option>
            <option value="yes">Yes</option>
            <option value="no">No</option>
          </select>
        </div>
        {showLenderFields && (
          <>
            <div>
              <label className="label" htmlFor="lenderPricing">
                Lender pricing
              </label>
              <input id="lenderPricing" name="lenderPricing" defaultValue={c?.lenderPricing ?? ""} className="input" placeholder="SOFR + 300" />
            </div>
            <div>
              <label className="label" htmlFor="aum">
                AUM
              </label>
              <input id="aum" name="aum" defaultValue={c?.aum ?? ""} className="input" />
            </div>
            <div>
              <label className="label" htmlFor="unitsManaged">
                Units managed
              </label>
              <input id="unitsManaged" name="unitsManaged" defaultValue={c?.unitsManaged ?? ""} className="input" />
            </div>
          </>
        )}
      </div>
      <div className="flex justify-end">
        <button className="btn-primary" type="submit">
          Save criteria
        </button>
      </div>
    </form>
  );
}
