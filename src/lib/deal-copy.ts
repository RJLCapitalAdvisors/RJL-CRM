import { assetProfile, perCountWord, ratio } from "@/lib/asset-profile";
import { parseDetails } from "@/lib/checklist";
import { US_STATES } from "@/lib/taxonomy";
import { isPref, prefMetrics } from "@/lib/pref";

/**
 * Generates the pieces of RJL's deal email exactly in the house style of the sent emails
 * (subject line, intro paragraph, Deal Metrics bullets), adapting to asset class and
 * acquisition vs development, and leaving out anything that is blank.
 */
type D = Record<string, unknown>;
const n = (v: unknown) => (typeof v === "number" && !isNaN(v) ? v : typeof v === "string" && v.trim() && !isNaN(Number(v.replace(/[^0-9.-]/g, ""))) ? Number(v.replace(/[^0-9.-]/g, "")) : null);
const s = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);
export const usd = (v: number) => `$${Math.round(v).toLocaleString("en-US")}`;
const usdCents = (v: number) => `$${v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const pct = (v: number) => `${Number.isInteger(v) ? v.toFixed(2) : String(v).includes(".") && String(v).split(".")[1].length === 1 ? v.toFixed(2) : v}%`;

function location(d: D) {
  return [s(d.city), s(d.state)].filter(Boolean).join(", ");
}
function stateName(d: D) {
  const c = s(d.state);
  return c ? US_STATES[c] ?? c : null;
}

/** "Multifamily Acquisition Opportunity in Pensacola, FL | $23,000,000 of JV Equity" */
export function subjectLine(d: D): string {
  const parts = [s(d.assetClass), d.strategy === "Development" ? "Development" : d.strategy === "Acquisitions" ? "Acquisition" : null, "Opportunity"].filter(Boolean).join(" ");
  const loc = location(d);
  const ask = n(d.requestedAmount);
  const exec = s(d.executionType) ?? (s(d.requestType) === "Debt" ? "Debt" : s(d.requestType) ? "Equity" : null);
  return `${parts}${loc ? ` in ${loc}` : ""}${ask ? ` | ${usd(ask)}${exec ? ` of ${exec}` : ""}` : ""}`;
}

/** The opening paragraph after the greeting. */
export function intro(d: D): string {
  const dev = d.strategy === "Development";
  const sponsor = s(d.sponsorName) ?? "the sponsor";
  const exec = s(d.executionType) ?? "capital";
  const prop = s(d.propertyName) ?? "the property";
  const loc = location(d);
  const p = assetProfile(s(d.assetClass));
  const sf = n(d.squareFeet);
  const count = n(d.units);
  const acres = n(parseDetails(d.details).acres);
  const year = s(d.yearBuilt);
  const mix = s(d.unitMix);
  const avg = ratio(sf, count);
  const ask = n(d.requestedAmount);
  const sourcing = s(parseDetails(d.details).sourcing);
  const per = perCountWord(p.countLabel);

  const first = dev
    ? `RJL Capital Advisors is pleased to be working with ${sponsor} as they source ${exec} to develop ${prop}${loc ? `, in ${loc}` : ""}.`
    : `RJL Capital Advisors is pleased to be representing ${sponsor} as they raise ${exec} for the purchase of ${prop}${loc ? `, in ${loc}` : ""}.`;

  // Physical description, built from whatever exists.
  const facts: string[] = [];
  if (sf) facts.push(`${dev ? "will span" : "spans"} ${sf.toLocaleString("en-US")} square feet`);
  if (count && p.countLabel) facts.push(`${dev ? "will consist of" : "consists of"} ${count.toLocaleString("en-US")} ${count === 1 ? per : p.countLabel.toLowerCase()}`);
  if (acres) facts.push(`${dev ? "will sit" : "sits"} on ${acres} acres of land`);
  let second = "";
  if (facts.length) {
    const subject = dev ? `The ${[s(d.assetClass), "Development"].filter(Boolean).join(" ")}` : "The asset";
    const joined = facts.length === 1 ? facts[0] : facts.slice(0, -1).join(", ") + (facts.length > 2 ? "," : "") + " and " + facts[facts.length - 1];
    second = !dev && year ? `${subject} was built in ${year}, ${joined}.` : `${subject} ${joined}.`;
  }
  let third = "";
  if (p.countLabel && (mix || avg)) {
    const bits = [mix ? `has a mix of ${mix} ${p.countLabel.toLowerCase()}` : null, avg ? `${mix ? "with " : "has "}an average ${per} size of ${Math.round(avg).toLocaleString("en-US")} SF` : null].filter(Boolean);
    third = `${!second && year ? `Built in ${year}, the` : "The"} property ${bits.join(" ")}.`;
  }
  const fourth = sourcing && !dev ? `The sponsor is buying the asset ${/^(on|off)/i.test(sourcing) ? sourcing.charAt(0).toLowerCase() + sourcing.slice(1) : sourcing}${/[.!?]$/.test(sourcing) ? "" : "."}` : "";
  const fifth = ask ? `They are seeking ${usd(ask)} of ${exec} on this opportunity.` : "";
  return [first, second, third, fourth, fifth].filter(Boolean).join(" ");
}

/** Deal Metrics bullets, one per line, only for values that exist. */
export function metrics(d: D): string[] {
  const dev = d.strategy === "Development";
  const p = assetProfile(s(d.assetClass));
  const per = perCountWord(p.countLabel);
  const count = n(d.units);
  const sf = n(d.squareFeet);
  const acres = n(parseDetails(d.details).acres);
  const perBits = (amount: number) => {
    const bits: string[] = [];
    if (p.perFoot && sf) bits.push(`${usdCents(amount / sf)} per foot`);
    if (p.perCount && count) bits.push(`${usd(amount / count)} per ${per}`);
    if (p.perAcre && acres) bits.push(`${usd(amount / acres)} per acre`);
    return bits.length ? ` (${bits.join(" | ")})` : "";
  };
  const out: string[] = [];
  const addr = s(d.propertyAddress);
  if (addr) out.push(`Address: ${[addr, location(d)].filter(Boolean).join(", ")}${/\d{5}$/.test(addr) ? "" : ""}`);
  const cap = n(d.totalCapitalization);
  if (cap) out.push(`Total Capitalization: ${usd(cap)}${perBits(cap)}`);
  const price = n(d.purchasePrice);
  if (price && !dev) out.push(`Purchase Price: ${usd(price)}${perBits(price)}`);
  if (price && dev) out.push(`Land Price: ${usd(price)}${perBits(price)}`);
  const debt = n(d.totalDebt);
  const ltc = n(d.ltc);
  const ltv = n(d.ltv);
  const rate = s(d.interestRate);
  const term = s(d.loanTerm);
  const amort = s(d.amortization);
  const lender = s(d.lenderType);
  if (debt || ltc || ltv || rate) {
    const lev = ltc ? `${pct(ltc)} LTC${ltv ? ` (${pct(ltv)} LTV)` : ""}` : ltv ? `${pct(ltv)} LTV` : "";
    const structure = amort && term ? ` - ${amort} on a ${term}` : amort ? ` - ${amort}` : term ? ` - ${term}` : "";
    out.push(`Total Debt and Terms: ${[debt ? usd(debt) : null, [lev, rate ? `@ ${rate}` : null].filter(Boolean).join(" ")].filter(Boolean).join(" | ")}${structure}${lender ? ` - (${lender})` : ""}`);
  }
  const eq = n(d.totalEquity);
  if (eq) out.push(`Total Equity: ${usd(eq)}`);
  if (isPref(d.executionType)) {
    const pm = prefMetrics(d);
    if (pm.lastDollar) out.push(`Last Dollar Exposure: ${usd(pm.lastDollar)}${pm.prefLtc != null ? ` | ${pm.prefLtc.toFixed(2)}% LTC` : ""}${pm.prefLtv != null ? ` (${pm.prefLtv.toFixed(2)}% LTV)` : ""}`);
    if (pm.goingInYieldLD != null) out.push(`Going-In Yield on Last Dollar: ${pm.goingInYieldLD.toFixed(2)}%`);
    if (pm.stabilizedYieldLD != null) out.push(`Stabilized Yield on Last Dollar: ${pm.stabilizedYieldLD.toFixed(2)}%`);
    if (pm.basisLD != null) out.push(`Stabilized Basis on Last Pref Dollar: ${usd(pm.basisLD)} per ${pm.basisUnit}`);
  }
  const t12 = n(d.capRateT12);
  const y1 = n(d.capRateY1);
  if (!dev && t12) out.push(`T12 Cap Rate: ${pct(t12)}`);
  if (!dev && y1) out.push(`Year 1 Cap Rate: ${pct(y1)}`);
  const yoc = n(d.yieldOnCost);
  if (yoc) out.push(`Yield on Cost at Stabilization: ${pct(yoc)}`);
  const irr = n(d.irr);
  const em = n(d.equityMultiple);
  const hold = s(d.holdPeriod);
  const coc = n(d.cashOnCash);
  if ((irr || em) && !isPref(d.executionType)) {
    const ret = [irr ? `${pct(irr)} IRR` : null, em ? `${irr ? "a " : ""}${em}x EM` : null].filter(Boolean).join(" and ");
    out.push(`Expected Returns: ${ret}${hold ? ` on a ${hold.replace(/\s*hold$/i, "")} hold` : ""}.${coc && !dev ? ` Stabilized cash on cash of ${pct(coc)}` : ""}`);
  }
  const close = s(d.expectedClose);
  if (close) out.push(`Closing Date: ${close}`);
  return out;
}

export function metricsHtml(d: D): string {
  const m = metrics(d);
  return m.length ? `<p><b>Deal Metrics</b></p><ul>${m.map((x) => `<li>${x}</li>`).join("")}</ul>` : "";
}
export function metricsText(d: D): string {
  const m = metrics(d);
  return m.length ? `Deal Metrics\n${m.map((x) => `• ${x}`).join("\n")}` : "";
}
export { stateName };
