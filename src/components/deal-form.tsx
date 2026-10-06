"use client";

import { useMemo, useState } from "react";
import { AMORTIZATIONS, ASSET_CLASSES, DEAL_HOLD_PERIODS, LENDER_TYPES, LOAN_TERMS, SELLER_PROFILES, SOURCING_OPTIONS, UNIT_MIXES, US_STATES } from "@/lib/taxonomy";
import { assetProfile, perCountWord, ratio } from "@/lib/asset-profile";
import { NumberInput } from "./number-input";
import { SponsorPicker } from "./sponsor-picker";
import { SelectField } from "@/components/select-field";
import { AutoSaveForm } from "./autosave-form";
import { isPref, prefMetrics } from "@/lib/pref";
import { ASSUMPTION, RATE_INDEX_OPTIONS, indicativeRate, interestRateNumber, type IndexTable } from "@/lib/rates";

export const EXECUTION_TYPES = ["Senior Debt", "Mezz Debt", "Preferred Equity", "JV Equity", "Co-GP Equity", "LP Equity", "Fund Investment"] as const;

type DealLike = {
  name: string;
  stage: string;
  sponsorName: string | null;
  sponsorCompanyId?: string | null;
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
  rateIndex?: string | null;
  rateSpreadBps?: number | null;
  loanTerm: string | null;
  amortization?: string | null;
  lenderType: string | null;
  equityMultiple: number | null;
  irr: number | null;
  holdPeriod: string | null;
  yieldOnCost: number | null;
  projectedSellout: number | null;
  selloutPerUnit: number | null;
  selloutPerFoot: number | null;
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
  // land entitlement (Jonathan, Oct 6, 2026)
  entitledFor?: string | null;
  entitlementPhase?: string | null;
  entitlementOutstanding?: string | null;
  entitlementRisks?: string | null;
  landValueCurrent?: number | null;
  landValueEntitled?: number | null;
  entitlementBudget?: number | null;
  breakGroundDate?: string | null;
  verticalCost?: number | null;
  verticalDebt?: number | null;
  verticalDebtTerms?: string | null;
  verticalHold?: string | null;
  deliveryDate?: string | null;
  unlevered?: boolean | null;
} | null;

function parseDetailsSafe(raw: string | undefined): Record<string, string | null> {
  try {
    return JSON.parse(raw || "{}");
  } catch {
    return {};
  }
}
const pctOf = (a: number | null, b: number | null) => (a != null && b ? `${((a / b) * 100).toFixed(2)}%` : "—");
const money = (n: number | null) => (n == null ? "—" : n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }));
const times = (a: number | null, b: number | null) => (a != null && b ? `${(a / b).toFixed(2)}x` : "—");
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
  const [inner, setInner] = useState(value);
  const list = value && !options.includes(value) ? [value, ...options] : options;
  return (
    <select name={name} value={onChange ? value : inner} onChange={(e) => (onChange ? onChange(e.target.value) : setInner(e.target.value))} className="input">
      <option value="">{blank}</option>
      {list.map((o) => (
        <option key={o} value={o}>
          {o}
        </option>
      ))}
    </select>
  );
}

export function DealForm({ deal, users, action, submitLabel = "Save", autosave = false, indexRates = {} }: { deal: DealLike; users: { id: string; name: string }[]; action: (fd: FormData) => void | Promise<void>; submitLabel?: string; autosave?: boolean; indexRates?: IndexTable }) {
  const d = deal;
  // debt pricing: fixed, or a spread over an index priced off the day's reading (Jonathan, Sep 28, 2026)
  const [rateIndex, setRateIndex] = useState<string>(d?.rateIndex ?? "");
  const [spreadBps, setSpreadBps] = useState<number | null>(d?.rateSpreadBps ?? null);
  const [assumedRate, setAssumedRate] = useState<number | null>(interestRateNumber(d?.interestRate));
  const assumed = rateIndex === ASSUMPTION;
  const idxNow = rateIndex && !assumed ? indexRates[rateIndex] : null;
  const indicative = assumed ? assumedRate : indicativeRate({ rateIndex, rateSpreadBps: spreadBps }, indexRates);
  const details = parseDetailsSafe(d?.details);
  const [assetClass, setAssetClass] = useState(d?.assetClass ?? "");
  const [execType, setExecType] = useState(d?.executionType ?? "");
  const [strategy, setStrategy] = useState(d?.strategy ?? "");
  const [entitledFor, setEntitledFor] = useState(d?.entitledFor ?? "");
  const isDev = strategy === "Development";
  const isCondo = assetClass === "Condo"; // sellout instead of NOI (Jonathan, Sep 23, 2026)
  const isLand = assetClass === "Land"; // land being entitled: the land budget is the capitalization, the build is its own group (Jonathan, Oct 6, 2026)
  const seniorDebt = execType === "Senior Debt"; // the debt terms are the request, not a description (Jonathan, Oct 6, 2026)
  const [sellout, setSellout] = useState<number | null>(d?.projectedSellout ?? null);
  // the per-unit and per-foot figures follow the sellout (Jonathan, Sep 23, 2026) until typed over
  const [perUnitTyped, setPerUnitTyped] = useState<boolean>(d?.selloutPerUnit != null && (!d?.projectedSellout || !d?.units || Math.abs(d.selloutPerUnit - d.projectedSellout / d.units) > 1));
  const [perFootTyped, setPerFootTyped] = useState<boolean>(d?.selloutPerFoot != null && (!d?.projectedSellout || !d?.squareFeet || Math.abs(d.selloutPerFoot - d.projectedSellout / d.squareFeet) > 0.5));
  const [ask, setAsk] = useState<number | null>(d?.requestedAmount ?? null);
  const [t12, setT12] = useState<number | null>(d?.capRateT12 ?? null);
  const [yoc, setYoc] = useState<number | null>(d?.yieldOnCost ?? null);
  const [price, setPrice] = useState<number | null>(d?.purchasePrice ?? null);
  const [capTyped, setCap] = useState<number | null>(d?.totalCapitalization ?? null);
  const [debt, setDebt] = useState<number | null>(d?.totalDebt ?? null);
  const [count, setCount] = useState<number | null>(d?.units ?? null);
  const [sf, setSf] = useState<number | null>(d?.squareFeet ?? null);
  const [landNow, setLandNow] = useState<number | null>(d?.landValueCurrent ?? null);
  const [landEntitled, setLandEntitled] = useState<number | null>(d?.landValueEntitled ?? null);
  const [entBudget, setEntBudget] = useState<number | null>(d?.entitlementBudget ?? null);
  const [vCost, setVCost] = useState<number | null>(d?.verticalCost ?? null);
  const [vDebt, setVDebt] = useState<number | null>(d?.verticalDebt ?? null);
  // on land the capitalization is the total entitlement budget, which includes the land (Jonathan, Oct 6, 2026)
  const landBudget = entBudget ?? price;
  const cap = isLand ? landBudget : capTyped;
  const noDebt = debt === 0; // total debt typed as 0: the debt terms fold away (no Unlevered tick; Jonathan, Oct 6, 2026)
  const derivedPerUnit = sellout && count ? Math.round(sellout / count) : null;
  const derivedPerFoot = sellout && sf ? Math.round((sellout / sf) * 100) / 100 : null;
  const [acres, setAcres] = useState<number | null>(num(details.acres));
  const p = useMemo(() => assetProfile(assetClass), [assetClass]);
  const vp = useMemo(() => assetProfile(entitledFor || null), [entitledFor]); // the vertical build's own profile: a hotel per key
  const per = perCountWord(p.countLabel);
  const vPer = perCountWord(vp.countLabel);
  const equity = cap != null && debt != null ? cap - debt : null;
  const lost = d?.stage === "Deal Lost";
  const pref = isPref(execType);
  const pm = prefMetrics({ totalDebt: debt, requestedAmount: ask, totalCapitalization: cap, purchasePrice: price, capRateT12: t12, yieldOnCost: yoc, units: count, squareFeet: sf, assetClass, projectedSellout: sellout, strategy, landValueCurrent: landNow, landValueEntitled: landEntitled });
  const pct = (v: number | null) => (v == null ? "—" : `${v.toFixed(2)}%`);
  const useWord = entitledFor === "Hospitality" ? "hotel" : entitledFor ? entitledFor.toLowerCase() : "build";

  const Wrapper = autosave ? AutoSaveForm : (props: { action: (fd: FormData) => void | Promise<void>; children: React.ReactNode }) => <form id="deal-form" action={props.action}>{props.children}</form>;
  return (
    <Wrapper action={action}>
      {/* Stage is set by dragging on the board; carried along unchanged here. */}
      <input type="hidden" name="stage" value={d?.stage ?? "Deal Received"} />

      <Group title="Deal">
        <Row label="Sponsor" hint="A company on file: type and pick, so the ticket links to the firm and its people.">
          <SponsorPicker name={d?.sponsorName} companyId={d?.sponsorCompanyId ?? null} />
        </Row>
        <Row label="Property / deal name">
          <Text name="propertyName" value={d?.propertyName} placeholder="Everett Mall Plaza" />
        </Row>
        <Row label="Asset class" hint="Sets which fields appear below">
          <Select name="assetClass" value={assetClass} options={ASSET_CLASSES} onChange={setAssetClass} />
        </Row>
        {isLand && (
          <Row label="Entitled for which asset class" hint="The use the land is being entitled for; the vertical construction group below presents it the way that asset is always presented.">
            <Select name="entitledFor" value={entitledFor} options={ASSET_CLASSES.filter((a) => a !== "Land")} onChange={setEntitledFor} />
          </Row>
        )}
        <Row label="Acquisition or development" hint={isLand ? "Land being entitled is usually a development." : undefined}>
          <Select name="strategy" value={strategy} options={["Acquisitions", "Development"]} onChange={setStrategy} />
        </Row>
        {lost && (
          <Row label="Why it died">
            <Text name="closedLostReason" value={d?.closedLostReason} />
          </Row>
        )}
        <Row label="Owner">
          <SelectField name="ownerId" defaultValue={d?.ownerId ?? ""} className="input">
            <option value="">Unassigned</option>
            {users.map((u) => (
              <option key={u.id} value={u.id}>
                {u.name}
              </option>
            ))}
          </SelectField>
        </Row>
        <Row label="Critical dates: expected close" hint="e.g. November 2026 or Q1 2027; LOI, PSA and hard money dates go in the notes">
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
          <Select name="detail.sourcing" value={details.sourcing ?? (d?.onMarket == null ? "" : d.onMarket ? "on-market" : "completely off-market")} options={SOURCING_OPTIONS} />
        </Row>
        <Row label="Seller profile">
          <Select name="detail.sellerProfile" value={details.sellerProfile ?? ""} options={SELLER_PROFILES} />
        </Row>
        {!isLand && p.countLabel && (
          <Row label={p.countLabel}>
            <NumberInput name="units" defaultValue={d?.units} decimals={false} onValue={setCount} />
          </Row>
        )}
        {!isLand && (p.perFoot || p.countLabel) && (
          <Row label="Square feet">
            <NumberInput name="squareFeet" defaultValue={d?.squareFeet} decimals={false} onValue={setSf} />
          </Row>
        )}
        <Row label="Total acres">
          <NumberInput name="detail.acres" defaultValue={acres} onValue={setAcres} />
        </Row>
        {p.showOccupancy && !isDev && (
          <Row label="Occupancy %">
            <NumberInput name="occupancy" defaultValue={d?.occupancy} />
          </Row>
        )}
        {p.showYearBuilt && !isDev && (
          <Row label="Year built">
            <Text name="yearBuilt" value={d?.yearBuilt} />
          </Row>
        )}
        {p.showUnitMix && (
          <Row label="Unit mix">
            <Select name="unitMix" value={d?.unitMix ?? ""} options={UNIT_MIXES} />
          </Row>
        )}
        {!isLand && p.countLabel && p.perFoot && <Calc label={`Average ${per} size`} value={ratio(sf, count) ? `${Math.round(ratio(sf, count)!).toLocaleString()} SF` : "—"} />}
      </Group>

      {isLand && (
        <Group title="Entitlement and land budget">
          <Row label="Current entitlement phase and outstanding items" hint="Where the approvals stand today: pre-application, filed, hearings, approved, permits.">
            <Text name="entitlementPhase" value={d?.entitlementPhase} placeholder="Site plan filed, first hearing in January" />
          </Row>
          <Row label="Outstanding entitlement items" hint="Approvals, hearings, permits and studies still needed.">
            <textarea name="entitlementOutstanding" rows={3} defaultValue={d?.entitlementOutstanding ?? ""} className="input" />
          </Row>
          <Row label="Entitlement risks as of today" hint="Opposition, zoning, environmental, infrastructure, timing.">
            <textarea name="entitlementRisks" rows={3} defaultValue={d?.entitlementRisks ?? ""} className="input" />
          </Row>
          <Row label="Land price (or basis if already owned)" hint="What the land costs; part of the total entitlement budget below.">
            <NumberInput name="purchasePrice" defaultValue={d?.purchasePrice} decimals={false} onValue={setPrice} prefix="$" />
          </Row>
          <Calc label="Land price per acre" value={money(ratio(price, acres))} hint="land price ÷ total acres" />
          <Row label="Total entitlement budget (including the land)" hint="Land plus consultants, legal, fees, studies and carry, whole dollars: the total capitalization of the land deal.">
            <NumberInput name="entitlementBudget" defaultValue={d?.entitlementBudget} decimals={false} onValue={setEntBudget} prefix="$" />
          </Row>
          <Calc label="Entitlement costs excluding the land" value={money(entBudget != null && price != null ? entBudget - price : null)} hint="total entitlement budget minus land price" />
          <Row label="Current value of the unentitled land" hint="As-is, whole dollars: appraisal, broker opinion or the price being paid.">
            <NumberInput name="landValueCurrent" defaultValue={d?.landValueCurrent} decimals={false} prefix="$" onValue={setLandNow} />
          </Row>
          <Calc label="Current value per acre" value={money(ratio(landNow, acres))} hint="current value ÷ total acres" />
          <Row label="Value of the land once entitled" hint="Whole dollars, with the basis for the number in the notes.">
            <NumberInput name="landValueEntitled" defaultValue={d?.landValueEntitled} decimals={false} prefix="$" onValue={setLandEntitled} />
          </Row>
          <Calc label="Entitled value per acre" value={money(ratio(landEntitled, acres))} hint="entitled value ÷ total acres" />
          <Calc label="Value uplift from entitlement" value={times(landEntitled, landNow)} hint="entitled value ÷ current value" />
          <Calc label="Entitled value over the entitlement budget" value={times(landEntitled, landBudget)} hint="entitled value ÷ total entitlement budget" />
        </Group>
      )}

      <Group title="Capital request">
        <Row label="Position in the capital stack" hint={pref ? "Pref / mezz: returns below switch to last-dollar metrics" : seniorDebt ? "Senior debt: the debt terms below are the loan being requested" : undefined}>
          <Select name="executionType" value={execType} options={EXECUTION_TYPES} onChange={setExecType} />
        </Row>
        <Row label={pref ? "Requested pref / mezz amount" : seniorDebt ? "Requested loan amount" : "Requested amount"}>
          <NumberInput name="requestedAmount" defaultValue={d?.requestedAmount} decimals={false} onValue={setAsk} prefix="$" />
        </Row>
        {!isLand && (
          <>
            <Row label={isDev ? "Land purchase price" : "Purchase price"}>
              <NumberInput name="purchasePrice" defaultValue={d?.purchasePrice} decimals={false} onValue={setPrice} prefix="$" />
            </Row>
            {p.perCount && !isDev && <Calc label={`Purchase price per ${per}`} value={money(ratio(price, count))} />}
            {p.perFoot && !isDev && <Calc label="Purchase price per SF" value={money(ratio(price, sf))} />}
            {p.perAcre && <Calc label="Purchase price per acre" value={money(ratio(price, acres))} />}
            <Row label="Total capitalization" hint="From sources and uses">
              <NumberInput name="totalCapitalization" defaultValue={d?.totalCapitalization} decimals={false} onValue={setCap} prefix="$" />
            </Row>
            {p.perCount && <Calc label={`Total capitalization per ${per}`} value={money(ratio(cap, count))} />}
            {p.perFoot && <Calc label="Total capitalization per SF" value={money(ratio(cap, sf))} />}
            {p.perAcre && <Calc label="Total capitalization per acre" value={money(ratio(cap, acres))} />}
          </>
        )}
        {isLand && (
          <>
            <input type="hidden" name="totalCapitalization" value={landBudget ?? ""} />
            <Calc label="Total capitalization" value={money(landBudget)} hint="the total entitlement budget (land included), from the group above" />
            <Calc label="Total capitalization per acre" value={money(ratio(landBudget, acres))} />
          </>
        )}
        <Row label={seniorDebt ? "Total debt (the loan requested)" : "Total debt"} hint={isLand ? "Debt on the land itself today; 0 when there is none (the debt terms fold away). The construction loan goes under Vertical construction." : noDebt ? "0: no senior debt, the debt terms fold away." : undefined}>
          <NumberInput name="totalDebt" defaultValue={d?.totalDebt} decimals={false} onValue={setDebt} prefix="$" />
        </Row>
        <Calc label="Total equity" value={money(equity)} hint="total capitalization minus total debt" />
      </Group>

      <Group title={seniorDebt ? "Debt request" : "Debt terms"}>
        {noDebt ? (
          <div className="py-2 text-[11px] text-muted">No senior debt: total debt is 0. Type a debt amount above and the terms come back.</div>
        ) : (
          <>
            {seniorDebt && <div className="py-2 text-[11px] text-muted">The loan being requested: these are the terms the sponsor is asking a lender for, not a loan already in place.</div>}
            {isLand ? <Calc label="LTV % on current land value" value={pctOf(debt, landNow ?? price)} hint="total debt ÷ current value of the land" /> : !isDev && <Calc label="LTV %" value={pctOf(debt, price)} hint="total debt ÷ purchase price" />}
            {isLand && <Calc label="LTV % on entitled value" value={pctOf(debt, landEntitled)} hint="total debt ÷ value once entitled" />}
            <Calc label="LTC %" value={pctOf(debt, cap)} hint={isLand ? "total debt ÷ total entitlement budget" : "total debt ÷ total capitalization"} />
            <Row label="Index" hint="SOFR, Prime, or the 2, 5, 7 or 10 year treasury the loan is priced over (read daily). Assumption: no index, the rate is typed.">
              <Select name="rateIndex" value={rateIndex} options={RATE_INDEX_OPTIONS} onChange={setRateIndex} />
            </Row>
            {assumed ? (
              <Row label="Rate %" hint="The assumed all-in rate; numbers only, the % is added.">
                <NumberInput name="interestRate" defaultValue={interestRateNumber(d?.interestRate)} placeholder="6.75" onValue={setAssumedRate} />
              </Row>
            ) : (
              <Row label="Spread (bps)" hint="Basis points above the index: 300 for SOFR + 3%.">
                <NumberInput name="rateSpreadBps" defaultValue={d?.rateSpreadBps} decimals={false} placeholder="300" onValue={setSpreadBps} />
              </Row>
            )}
            <Calc
              label="Indicative rate %"
              value={indicative != null ? `${indicative.toFixed(2)}%` : interestRateNumber(d?.interestRate) != null ? `${interestRateNumber(d?.interestRate)}%` : "—"}
              hint={assumed ? "the assumed rate as typed" : indicative != null && idxNow ? `${rateIndex} ${idxNow.value.toFixed(2)}% as of ${idxNow.asOf} + ${spreadBps ?? 0} bps` : rateIndex ? (idxNow ? "add the spread" : "the index has no reading yet") : interestRateNumber(d?.interestRate) != null ? "the rate as the sponsor stated it; pick an index and spread to price it live, or Assumption to keep it" : "index + spread"}
            />
            <Row label="Loan term">
              <Select name="loanTerm" value={d?.loanTerm ?? ""} options={LOAN_TERMS} />
            </Row>
            <Row label="I/O and amortization">
              <Select name="amortization" value={d?.amortization ?? ""} options={AMORTIZATIONS} />
            </Row>
            <Row label="Lender type">
              <Select name="lenderType" value={d?.lenderType ?? ""} options={LENDER_TYPES} />
            </Row>
          </>
        )}
      </Group>

      <Group title={pref ? "Pref / mezz position" : "Returns"}>
        {!isDev && !isLand && (
          <>
            <Row label="T12 cap rate %">
              <NumberInput name="capRateT12" defaultValue={d?.capRateT12} onValue={setT12} />
            </Row>
            <Row label="Year 1 cap rate %">
              <NumberInput name="capRateY1" defaultValue={d?.capRateY1} />
            </Row>
          </>
        )}
        {isCondo ? (
          <>
            <Row label="Projected sellout ($)" hint="Gross sellout of every unit, whole dollars. A condo has no NOI, so no yield on cost or cash on cash.">
              <NumberInput name="projectedSellout" defaultValue={d?.projectedSellout} decimals={false} onValue={setSellout} />
            </Row>
            <Row label="Average sellout per unit ($)" hint={perUnitTyped ? "Typed by hand; clear it to go back to sellout ÷ units." : "Filled from sellout ÷ units; type to override."}>
              <NumberInput name="selloutPerUnit" defaultValue={d?.selloutPerUnit} value={perUnitTyped ? undefined : derivedPerUnit} decimals={false} onValue={(v) => setPerUnitTyped(v != null)} />
            </Row>
            <Row label="Sellout price per foot ($)" hint={perFootTyped ? "Typed by hand; clear it to go back to sellout ÷ square feet." : "Filled from sellout ÷ sellable square feet; type to override."}>
              <NumberInput name="selloutPerFoot" defaultValue={d?.selloutPerFoot} value={perFootTyped ? undefined : derivedPerFoot} onValue={(v) => setPerFootTyped(v != null)} />
            </Row>
          </>
        ) : isLand ? (
          <div className="py-2 text-[11px] text-muted">The land has no income: every exposure figure here runs on the total entitlement budget and the land&apos;s values, nothing per unit, per foot or on NOI. The {useWord}&apos;s own numbers sit under Vertical construction below.</div>
        ) : (
          <Row label="Yield on cost at stabilization %">
            <NumberInput name="yieldOnCost" defaultValue={d?.yieldOnCost} onValue={setYoc} />
          </Row>
        )}
        {pref ? (
          <>
            <Calc label="Last dollar exposure" value={money(pm.lastDollar)} hint="requested pref / mezz amount + total debt" />
            <Calc label={isLand ? "Pref LTC on the entitlement budget" : "Pref LTC"} value={pct(pm.prefLtc)} hint={isLand ? "(total debt + pref amount) ÷ total entitlement budget (land included)" : "(total debt + pref amount) ÷ total capitalization"} />
            <Calc label={isLand ? "Pref LTV on current land value" : isCondo ? "Pref LTV on gross sellout" : "Pref LTV"} value={pct(pm.prefLtv)} hint={isLand ? "(total debt + pref amount) ÷ current value of the unentitled land" : isCondo ? "(total debt + pref amount) ÷ projected gross sellout, the condo's terminal value" : "(total debt + pref amount) ÷ purchase price"} />
            {isLand && <Calc label="Pref LTV on entitled value" value={pct(pm.prefLtvEntitled)} hint="(total debt + pref amount) ÷ value of the land once entitled" />}
            {isLand && <Calc label="Entitled value cover" value={pm.entitledCover != null ? `${pm.entitledCover.toFixed(2)}x` : "—"} hint="value once entitled ÷ last dollar" />}
            {!isDev && !isCondo && !isLand && <Calc label="Going-in yield on last dollar" value={pct(pm.goingInYieldLD)} hint="T12 NOI ÷ last dollar (T12 NOI = T12 cap rate × purchase price)" />}
            {!isCondo && !isLand && <Calc label="Stabilized yield on last dollar" value={pct(pm.stabilizedYieldLD)} hint="stabilized NOI ÷ last dollar (stabilized NOI = yield on cost × total capitalization)" />}
            {!isLand && <Calc label={`Stabilized basis on last pref dollar per ${pm.basisUnit}`} value={money(pm.basisLD)} hint={`last dollar ÷ ${pm.basisUnit === "SF" ? "square feet" : pm.basisUnit + "s"}`} />}
            {!isLand && pm.basisUnit === "SF" && <Calc label="Stabilized basis on last pref dollar per unit" value={money(pm.basisPerUnitLD)} hint="last dollar ÷ number of units" />}
          </>
        ) : (
          <>
            {!isLand && (
              <>
                <Row label="IRR %">
                  <NumberInput name="irr" defaultValue={d?.irr} />
                </Row>
                <Row label="Equity multiple (x)">
                  <NumberInput name="equityMultiple" defaultValue={d?.equityMultiple} />
                </Row>
              </>
            )}
            {!isCondo && !isLand && (
              <Row label="Stabilized cash-on-cash %">
                <NumberInput name="cashOnCash" defaultValue={d?.cashOnCash} />
              </Row>
            )}
          </>
        )}
        <Row label={pref ? "Pref / mezz term" : seniorDebt ? "Loan hold" : isLand ? "Hold of the land position" : "Hold period"}>
          <Select name="holdPeriod" value={d?.holdPeriod ?? ""} options={DEAL_HOLD_PERIODS} />
        </Row>
      </Group>

      {isLand && (
        <Group title={`Vertical construction: the ${useWord}`}>
          <div className="py-2 text-[11px] text-muted">The {useWord} that gets built once the land is entitled, presented the way a {useWord} deal is always presented{vp.countLabel ? ` (per ${vPer})` : ""}. These lines make the &quot;{entitledFor === "Hospitality" ? "Hotel" : entitledFor || "Deal"} Metrics&quot; of the email.</div>
          <Row label="Break ground date" hint="When construction starts once entitled; the first line of the metrics.">
            <Text name="breakGroundDate" value={d?.breakGroundDate} placeholder="Q3 2027" />
          </Row>
          <Row label="Expected delivery" hint={`When the ${useWord} opens.`}>
            <Text name="deliveryDate" value={d?.deliveryDate} placeholder="Q4 2029" />
          </Row>
          {vp.countLabel && (
            <Row label={vp.countLabel}>
              <NumberInput name="units" defaultValue={d?.units} decimals={false} onValue={setCount} />
            </Row>
          )}
          <Row label="Square feet" hint="Gross building area of what gets built.">
            <NumberInput name="squareFeet" defaultValue={d?.squareFeet} decimals={false} onValue={setSf} />
          </Row>
          {vp.showUnitMix && (
            <Row label="Unit mix">
              <Select name="unitMix" value={d?.unitMix ?? ""} options={UNIT_MIXES} />
            </Row>
          )}
          <Row label="Total development cost" hint={`The all-in cost to build the ${useWord}: the vertical's total capitalization.`}>
            <NumberInput name="verticalCost" defaultValue={d?.verticalCost} decimals={false} onValue={setVCost} prefix="$" />
          </Row>
          {vp.perCount && <Calc label={`Development cost per ${vPer}`} value={money(ratio(vCost, count))} />}
          <Calc label="Development cost per SF" value={money(ratio(vCost, sf))} />
          <Row label="Construction loan" hint="The loan the build is underwritten with.">
            <NumberInput name="verticalDebt" defaultValue={d?.verticalDebt} decimals={false} onValue={setVDebt} prefix="$" />
          </Row>
          <Calc label="Construction LTC %" value={pctOf(vDebt, vCost)} hint="construction loan ÷ total development cost" />
          <Calc label="Equity in the build" value={money(vCost != null && vDebt != null ? vCost - vDebt : null)} hint="total development cost minus the construction loan" />
          <Row label="Construction loan terms" hint="Rate, term, amortization, in one line.">
            <Text name="verticalDebtTerms" value={d?.verticalDebtTerms} placeholder="SOFR + 350, 4 year term, interest only" />
          </Row>
          <Row label="Yield on cost at stabilization %">
            <NumberInput name="yieldOnCost" defaultValue={d?.yieldOnCost} onValue={setYoc} />
          </Row>
          <Row label="IRR %">
            <NumberInput name="irr" defaultValue={d?.irr} />
          </Row>
          <Row label="Equity multiple (x)">
            <NumberInput name="equityMultiple" defaultValue={d?.equityMultiple} />
          </Row>
          <Row label="Hold period of the built asset">
            <Select name="verticalHold" value={d?.verticalHold ?? ""} options={DEAL_HOLD_PERIODS} />
          </Row>
        </Group>
      )}

      <Group title="Narrative">
        <Row label="Sponsor bio">
          <textarea name="sponsorExperience" rows={4} defaultValue={d?.sponsorExperience ?? ""} className="input" />
        </Row>
        <Row label="Business plan / deal summary" hint="Used in the email template">
          <textarea name="summary" rows={4} defaultValue={d?.summary ?? ""} className="input" />
        </Row>
      </Group>

      {!autosave && (
        <div className="sticky bottom-0 mt-4 flex justify-end border-t border-line bg-paper/95 py-3">
          <button className="btn-primary" type="submit">
            {submitLabel}
          </button>
        </div>
      )}
    </Wrapper>
  );
}
