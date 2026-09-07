import { ASSET_CLASSES, CLOSING_TIMEFRAMES, INVESTMENT_TYPES, RETURN_PROFILES, ROLES, STRATEGIES, parseList } from "@/lib/taxonomy";
import { MultiSelect } from "./multi-select";
import { RangeSlider } from "./range-slider";
import { CHECK_STOPS, HOLD_STOPS, VINTAGE_STOPS, checkRangeFrom, holdRangeFrom, vintageRangeFrom } from "@/lib/ranges";
import { Field } from "./record-layout";
import { AutoSaveForm } from "./autosave-form";

export type CriteriaLike = {
  assetClasses: string;
  investmentTypes?: string;
  checkSizes: string;
  geographyNotes: string | null;
  returnProfile: string;
  strategy: string | null;
  holdPeriods: string;
  vintages: string;
  checkMinMM?: number | null;
  checkMaxMM?: number | null;
  holdMinYears?: number | null;
  holdMaxYears?: number | null;
  vintageMin?: number | null;
  vintageMax?: number | null;
  ozInterest: boolean | null;
  closingTimeframe: string | null;
  openToMinority: boolean | null;
  otherInfo: string | null;
} | null;

const yn = (v: boolean | null | undefined) => (v == null ? "" : v ? "yes" : "no");

/** Investor criteria, one straight column. */
export function CriteriaForm({ criteria, roles, action }: { criteria: CriteriaLike; roles: string[]; action: (fd: FormData) => void | Promise<void> }) {
  const c = criteria;
  // ranges on file, else implied by the legacy buckets (HubSpot data)
  const check = c?.checkMinMM != null && c?.checkMaxMM != null ? [c.checkMinMM, c.checkMaxMM] : checkRangeFrom(parseList(c?.checkSizes));
  const hold = c?.holdMinYears != null && c?.holdMaxYears != null ? [c.holdMinYears, c.holdMaxYears] : holdRangeFrom(parseList(c?.holdPeriods));
  const vint = c?.vintageMin != null && c?.vintageMax != null ? [c.vintageMin, c.vintageMax] : vintageRangeFrom(parseList(c?.vintages));
  return (
    <AutoSaveForm action={action}>
      <Field label="Investor, Sponsor, Lender or Broker">
        <MultiSelect name="roles" options={ROLES} selected={roles} placeholder="Pick at least one" />
      </Field>
      <Field label="Asset classes">
        <MultiSelect name="assetClasses" options={ASSET_CLASSES} selected={parseList(c?.assetClasses)} />
      </Field>
      <Field label="Position in the capital stack">
        <MultiSelect name="investmentTypes" options={INVESTMENT_TYPES} selected={parseList(c?.investmentTypes)} />
      </Field>
      <Field label="Check size">
        <RangeSlider name="check" stops={CHECK_STOPS} min={check?.[0]} max={check?.[1]} />
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
        <RangeSlider name="hold" stops={HOLD_STOPS} min={hold?.[0]} max={hold?.[1]} />
      </Field>
      <Field label="Vintages considered">
        <RangeSlider name="vintage" stops={VINTAGE_STOPS} min={vint?.[0]} max={vint?.[1]} />
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
    </AutoSaveForm>
  );
}

/** Sponsors only need their asset classes. */
export function SponsorFocusForm({ criteria, roles, action }: { criteria: CriteriaLike; roles: string[]; action: (fd: FormData) => void | Promise<void> }) {
  return (
    <AutoSaveForm action={action}>
      <Field label="Investor, Sponsor, Lender or Broker">
        <MultiSelect name="roles" options={ROLES} selected={roles} placeholder="Pick at least one" />
      </Field>
      <Field label="Asset classes they work in">
        <MultiSelect name="assetClasses" options={ASSET_CLASSES} selected={parseList(criteria?.assetClasses)} />
      </Field>
    </AutoSaveForm>
  );
}
