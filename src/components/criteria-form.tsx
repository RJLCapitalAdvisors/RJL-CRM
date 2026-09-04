import { ASSET_CLASSES, CHECK_SIZES, CLOSING_TIMEFRAMES, HOLD_PERIODS, RETURN_PROFILES, STRATEGIES, VINTAGES, parseList } from "@/lib/taxonomy";
import { MultiSelect } from "./multi-select";
import { Field } from "./record-layout";

export type CriteriaLike = {
  assetClasses: string;
  checkSizes: string;
  geographyNotes: string | null;
  returnProfile: string;
  strategy: string | null;
  holdPeriods: string;
  vintages: string;
  ozInterest: boolean | null;
  closingTimeframe: string | null;
  openToMinority: boolean | null;
  otherInfo: string | null;
} | null;

const yn = (v: boolean | null | undefined) => (v == null ? "" : v ? "yes" : "no");

/** Investor criteria, one straight column. */
export function CriteriaForm({ criteria, action }: { criteria: CriteriaLike; action: (fd: FormData) => void | Promise<void> }) {
  const c = criteria;
  return (
    <form action={action}>
      <Field label="Asset classes">
        <MultiSelect name="assetClasses" options={ASSET_CLASSES} selected={parseList(c?.assetClasses)} />
      </Field>
      <Field label="Check sizes">
        <MultiSelect name="checkSizes" options={CHECK_SIZES} selected={parseList(c?.checkSizes)} />
      </Field>
      <Field label="Deal locations" htmlFor="geographyNotes">
        <input id="geographyNotes" name="geographyNotes" defaultValue={c?.geographyNotes ?? ""} className="input" placeholder="Sunbelt, Texas, Florida. No NY or CA." />
      </Field>
      <Field label="Return profile">
        <MultiSelect name="returnProfile" options={RETURN_PROFILES} selected={parseList(c?.returnProfile)} />
      </Field>
      <Field label="Development, acquisitions, or both" htmlFor="strategy">
        <select id="strategy" name="strategy" defaultValue={c?.strategy ?? ""} className="input">
          <option value="">—</option>
          {STRATEGIES.map((o) => (
            <option key={o}>{o}</option>
          ))}
        </select>
      </Field>
      <Field label="Hold period">
        <MultiSelect name="holdPeriods" options={HOLD_PERIODS} selected={parseList(c?.holdPeriods)} />
      </Field>
      <Field label="Vintages considered">
        <MultiSelect name="vintages" options={VINTAGES} selected={parseList(c?.vintages)} />
      </Field>
      <Field label="Opportunity Zone interest" htmlFor="ozInterest">
        <select id="ozInterest" name="ozInterest" defaultValue={yn(c?.ozInterest)} className="input">
          <option value="">—</option>
          <option value="yes">Yes</option>
          <option value="no">No</option>
        </select>
      </Field>
      <Field label="Closing time frame" htmlFor="closingTimeframe">
        <select id="closingTimeframe" name="closingTimeframe" defaultValue={c?.closingTimeframe ?? ""} className="input">
          <option value="">—</option>
          {CLOSING_TIMEFRAMES.map((o) => (
            <option key={o}>{o}</option>
          ))}
        </select>
      </Field>
      <Field label="Open to minority position" htmlFor="openToMinority">
        <select id="openToMinority" name="openToMinority" defaultValue={yn(c?.openToMinority)} className="input">
          <option value="">—</option>
          <option value="yes">Yes</option>
          <option value="no">No</option>
        </select>
      </Field>
      <Field label="Other information" htmlFor="otherInfo">
        <textarea id="otherInfo" name="otherInfo" rows={3} defaultValue={c?.otherInfo ?? ""} className="input" />
      </Field>
      <div className="flex justify-end py-3">
        <button className="btn-primary" type="submit">
          Save criteria
        </button>
      </div>
    </form>
  );
}

/** Sponsors only need their asset classes. */
export function SponsorFocusForm({ criteria, action }: { criteria: CriteriaLike; action: (fd: FormData) => void | Promise<void> }) {
  return (
    <form action={action}>
      <Field label="Asset classes they work in">
        <MultiSelect name="assetClasses" options={ASSET_CLASSES} selected={parseList(criteria?.assetClasses)} />
      </Field>
      <div className="flex justify-end py-3">
        <button className="btn-primary" type="submit">
          Save
        </button>
      </div>
    </form>
  );
}
