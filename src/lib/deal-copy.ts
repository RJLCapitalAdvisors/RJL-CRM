import { assetProfile, perCountWord, ratio } from "@/lib/asset-profile";
import { parseDetails } from "@/lib/checklist";
import { US_STATES } from "@/lib/taxonomy";
import { isCondo, isPref, prefMetrics } from "@/lib/pref";

/**
 * Generates the pieces of RJL's deal email exactly in the house style of the sent emails
 * (subject line, intro paragraph, Deal Metrics bullets), adapting to asset class and
 * acquisition vs development, and leaving out anything that is blank.
 */
type D = Record<string, unknown>;
const n = (v: unknown) => (typeof v === "number" && !isNaN(v) ? v : typeof v === "string" && v.trim() && !isNaN(Number(v.replace(/[^0-9.-]/g, ""))) ? Number(v.replace(/[^0-9.-]/g, "")) : null);
const s = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);
export const usd = (v: number) => `$${Math.round(v).toLocaleString("en-US")}`;
/** Rounded money for headlines: $5.6MM, $12MM, $850k. */
export const usdShort = (v: number) => (v >= 1_000_000 ? `$${(v / 1_000_000).toFixed(1).replace(/\.0$/, "")}MM` : v >= 1_000 ? `$${Math.round(v / 1_000)}k` : usd(v));
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
type Child = Record<string, unknown> & { propertyName: string | null; name: string; city: string | null; state: string | null };
const childrenOf = (d: D): Child[] => (Array.isArray(d.children) ? (d.children as Child[]) : []);
const joinAnd = (xs: string[]) => (xs.length <= 1 ? xs[0] ?? "" : `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}`);
const portfolioLoc = (kids: Child[]) => joinAnd([...new Set(kids.map((c) => [s(c.city), s(c.state)].filter(Boolean).join(", ")).filter(Boolean))]);

export function subjectLine(d: D): string {
  const kids = childrenOf(d);
  const parts = [s(d.assetClass), kids.length ? "Portfolio" : null, d.strategy === "Development" ? "Development" : d.strategy === "Acquisitions" ? "Acquisition" : null, "Opportunity"].filter(Boolean).join(" ");
  const loc = kids.length ? portfolioLoc(kids) : location(d);
  const ask = n(d.requestedAmount);
  const exec = s(d.executionType) ?? (s(d.requestType) === "Debt" ? "Debt" : s(d.requestType) ? "Equity" : null);
  return `${parts}${loc ? ` in ${loc}` : ""}${ask ? ` | ${usdShort(ask)}${exec ? ` of ${exec}` : ""}` : ""}`;
}

/** The opening paragraph after the greeting. */
export function intro(d: D): string {
  const kids = childrenOf(d);
  if (kids.length) return portfolioIntro(d, kids);
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
  const fifth = ask ? `<b>They are seeking ${usdShort(ask)} of ${exec} on this opportunity.</b>` : "";
  return [first, second, third, fourth, fifth].filter(Boolean).join(" ");
}

/** The opening paragraph for a portfolio: the properties by name and market, then the totals, then the ask. */
function portfolioIntro(d: D, kids: Child[]): string {
  const dev = d.strategy === "Development";
  const sponsor = s(d.sponsorName) ?? "the sponsor";
  const exec = s(d.executionType) ?? "capital";
  const p = assetProfile(s(d.assetClass));
  const named = joinAnd(kids.map((c) => `${s(c.propertyName) ?? c.name}${[s(c.city), s(c.state)].filter(Boolean).length ? ` in ${[s(c.city), s(c.state)].filter(Boolean).join(", ")}` : ""}`));
  const first = dev
    ? `RJL Capital Advisors is pleased to be working with ${sponsor} as they source ${exec} to develop a ${kids.length} property ${s(d.assetClass) ?? ""} portfolio: ${named}.`.replace(/\s+/g, " ")
    : `RJL Capital Advisors is pleased to be representing ${sponsor} as they raise ${exec} for the purchase of a ${kids.length} property ${s(d.assetClass) ?? ""} portfolio: ${named}.`.replace(/\s+/g, " ");
  const count = n(d.units);
  const sf = n(d.squareFeet);
  const year = s(d.yearBuilt);
  const facts = [count && p.countLabel ? `${count.toLocaleString("en-US")} ${p.countLabel.toLowerCase()}` : null, sf ? `${sf.toLocaleString("en-US")} square feet` : null].filter(Boolean) as string[];
  const second = facts.length ? `Together the properties ${dev ? "will total" : "total"} ${joinAnd(facts)}${year ? `, ${/to/.test(year) ? "built between" : "built in"} ${year.replace(" to ", " and ")}` : ""}.` : "";
  const ask = n(d.requestedAmount);
  const fifth = ask ? `<b>They are seeking ${usdShort(ask)} of ${exec} across the portfolio.</b>` : "";
  return [first, second, fifth].filter(Boolean).join(" ");
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
  // a condo sells out (Jonathan, Sep 23, 2026): the sellout stands where yield on cost and cash on cash would
  const condo = isCondo(d.assetClass);
  const sellout = n(d.projectedSellout);
  if (condo && sellout) {
    const perUnit = n(d.selloutPerUnit) ?? (count ? sellout / count : null);
    const perFoot = n(d.selloutPerFoot) ?? (sf ? sellout / sf : null);
    const bits = [perFoot ? `${usdCents(perFoot)} per foot` : null, perUnit ? `${usd(perUnit)} per unit` : null].filter(Boolean);
    out.push(`Projected Sellout: ${usd(sellout)}${bits.length ? ` (${bits.join(" | ")})` : ""}`);
  }
  // an operating asset always shows where it stands today; the deals@ checklist chases the number when it is missing
  const occ = n((d as { occupancy?: number | null }).occupancy);
  if (!dev && occ != null) out.push(`Current Occupancy: ${pct(occ)}`);
  const debt = n(d.totalDebt);
  const ltc = n(d.ltc);
  const ltv = n(d.ltv);
  const rate = s(d.interestRate);
  const term = s(d.loanTerm);
  const amort = s(d.amortization);
  const lender = s(d.lenderType)?.replace(/^\((.*)\)$/, "$1") ?? null; // the list stores "(Debt Fund)"; the line adds its own parentheses
  // a condo's senior LTV is on the gross sellout, like the pref's; an LTV above 100% (a loan measured against the land alone) says nothing to an investor and stays off the line
  const ltvShown = condo && sellout && debt ? { v: Math.round((debt / sellout) * 10000) / 100, base: " on gross sellout" } : ltv && ltv <= 100 ? { v: ltv, base: "" } : null;
  if (debt || ltc || ltvShown || rate) {
    const lev = ltc ? `${pct(ltc)} LTC${ltvShown ? ` (${pct(ltvShown.v)} LTV${ltvShown.base})` : ""}` : ltvShown ? `${pct(ltvShown.v)} LTV${ltvShown.base}` : "";
    const structure = amort && term ? ` - ${amort} on a ${term}` : amort ? ` - ${amort}` : term ? ` - ${term}` : "";
    out.push(`Total Debt and Terms: ${[debt ? usd(debt) : null, [lev, rate ? `@ ${rate}` : null].filter(Boolean).join(" ")].filter(Boolean).join(" | ")}${structure}${lender ? ` - (${lender})` : ""}`);
  }
  const eq = n(d.totalEquity);
  if (eq) out.push(`Total Equity: ${usd(eq)}`);
  if (isPref(d.executionType)) {
    const pm = prefMetrics(d);
    if (pm.lastDollar) out.push(`Last Dollar Exposure: ${usd(pm.lastDollar)}${pm.prefLtc != null ? ` | ${pm.prefLtc.toFixed(2)}% LTC` : ""}${pm.prefLtv != null ? ` (${pm.prefLtv.toFixed(2)}% LTV${pm.prefLtvBase === "sellout" ? " on gross sellout" : ""})` : ""}`);
    if (pm.goingInYieldLD != null) out.push(`Going-In Yield on Last Dollar: ${pm.goingInYieldLD.toFixed(2)}%`);
    if (pm.stabilizedYieldLD != null) out.push(`Stabilized Yield on Last Dollar: ${pm.stabilizedYieldLD.toFixed(2)}%`);
    if (pm.basisLD != null) out.push(`Stabilized Basis on Last Pref Dollar: ${usd(pm.basisLD)} per ${pm.basisUnit}${pm.basisPerUnitLD ? ` | ${usd(pm.basisPerUnitLD)} per unit` : ""}`);
  }
  const t12 = n(d.capRateT12);
  const y1 = n(d.capRateY1);
  if (!dev && t12) out.push(`T12 Cap Rate: ${pct(t12)}`);
  if (!dev && y1) out.push(`Year 1 Cap Rate: ${pct(y1)}`);
  const yoc = condo ? null : n(d.yieldOnCost);
  if (yoc) out.push(`Yield on Cost at Stabilization: ${pct(yoc)}`);
  else if (!dev && t12 && n(d.purchasePrice) && n(d.totalCapitalization)) {
    // no yield on cost stated: in-place NOI over all-in cost, from the going-in cap rate and the purchase price
    const goingIn = (t12 * (n(d.purchasePrice) as number)) / (n(d.totalCapitalization) as number);
    if (goingIn > 0 && goingIn < 30) out.push(`Going-In Yield on Cost: ${pct(Math.round(goingIn * 100) / 100)}`);
  }
  const irr = n(d.irr);
  const em = n(d.equityMultiple);
  const hold = s(d.holdPeriod);
  const coc = n(d.cashOnCash);
  if ((irr || em) && !isPref(d.executionType)) {
    const ret = [irr ? `${pct(irr)} IRR` : null, em ? `${irr ? "a " : ""}${em}x EM` : null].filter(Boolean).join(" and ");
    out.push(`Expected Returns: ${ret}${hold ? ` on a ${hold.replace(/\s*hold$/i, "")} hold` : ""}.${coc && !dev && !condo ? ` Stabilized cash on cash of ${pct(coc)}` : ""}`);
  }
  const close = s(d.expectedClose);
  if (close) out.push(`Closing Date: ${close}`);
  return out;
}

export function metricsHtml(d: D): string {
  // heading underlined, every bullet's lead-in bold, a gap after the list before Business Plan
  const li = (x: string) => { const i = x.indexOf(": "); return i > 0 ? `<li><b>${x.slice(0, i)}:</b>${x.slice(i + 1)}</li>` : `<li>${x}</li>`; };
  const kids = childrenOf(d);
  if (kids.length) {
    // a portfolio: one block per property, in order, each under its own heading
    return kids
      .map((c) => {
        const m = metrics({ ...c, strategy: c.strategy ?? d.strategy, executionType: c.executionType ?? d.executionType, assetClass: c.assetClass ?? d.assetClass });
        return m.length ? `<p><b><u>Deal Metrics: ${s(c.propertyName) ?? c.name}${[s(c.city), s(c.state)].filter(Boolean).length ? ` (${[s(c.city), s(c.state)].filter(Boolean).join(", ")})` : ""}</u></b></p><ul style="margin:0 0 12pt 18pt;list-style-type:disc;">${m.map(li).join("")}</ul>` : "";
      })
      .join("");
  }
  const m = metrics(d);
  return m.length ? `<p><b><u>Deal Metrics</u></b></p><ul style="margin:0 0 12pt 18pt;list-style-type:disc;">${m.map(li).join("")}</ul>` : "";
}
export function metricsText(d: D): string {
  const kids = childrenOf(d);
  if (kids.length) return kids.map((c) => { const m = metrics({ ...c, strategy: c.strategy ?? d.strategy, executionType: c.executionType ?? d.executionType, assetClass: c.assetClass ?? d.assetClass }); return m.length ? `Deal Metrics: ${s(c.propertyName) ?? c.name}\n${m.map((x) => `• ${x}`).join("\n")}` : ""; }).filter(Boolean).join("\n\n");
  const m = metrics(d);
  return m.length ? `Deal Metrics\n${m.map((x) => `• ${x}`).join("\n")}` : "";
}
export { stateName };
