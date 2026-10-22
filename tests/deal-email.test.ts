import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "fs";
import { debtTermsLine, intro, metrics, multiple, sellerSentence, shortSourcing } from "../src/lib/deal-copy";
import { renderTemplate, type MergeContext } from "../src/lib/merge";
import { bioProblems, cleanBusinessPlan, cleanSponsorBio, planSentences } from "../src/lib/style";
import { closeMonthKey, parseForwardCurve, rateTextAtClose, setForwardCurve, setIndexTable } from "../src/lib/rates";
import { leadsWithPlace } from "../src/lib/enrich-narratives";
import { tidyWordBlocks } from "../src/lib/followup";

/**
 * Regression tests for the deal email (Jonathan, Oct 19, 2026), run against the three deals as they stood that day:
 * Rocky Hill North (the broken example) and Project Barclays and Aurea at Highland Park (the working ones).
 * Run with: npm test
 */
type Deal = Record<string, unknown> & { details: string | null; expectedClose: string | null };
const fixtures = JSON.parse(readFileSync(new URL("./fixtures/deals.json", import.meta.url), "utf8")) as Record<string, Deal>;
const { rockyHillNorth, projectBarclays, aurea } = fixtures;
const asDeal = (d: Deal) => d as unknown as Parameters<typeof intro>[0];
const ctx = (d: Deal): MergeContext => ({ deal: d as Record<string, unknown>, contact: { firstName: "Nate", lastName: "", email: "", id: "" }, company: null, sender: { name: "Jonathan Livi" } } as unknown as MergeContext);
const plain = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();

// today's SOFR and a curve for the tests: January 2027 sits above today's reading
setIndexTable({ SOFR: { value: 3.89, asOf: "2026-10-16" } });
setForwardCurve(parseForwardCurve("January 2027 3.42\nDecember 2026 3.55"));

test("1. seller sentence: no seller on the ticket, no sentence; the sourcing notes never stand in", () => {
  assert.equal(sellerSentence(asDeal(rockyHillNorth), "land"), "");
  assert.equal(sellerSentence(asDeal(rockyHillNorth), "asset"), "");
  const sourcing = JSON.parse(rockyHillNorth.details ?? "{}").sourcing as string;
  assert.ok(sourcing.includes("JLL"), "the fixture still carries the internal sourcing notes");
  assert.equal(shortSourcing(sourcing), null);
});

test("1. seller sentence: a seller on the ticket renders as before", () => {
  assert.equal(sellerSentence(asDeal(projectBarclays), "land"), "The land was purchased from a mom n' pop owner.");
  assert.equal(sellerSentence(asDeal(projectBarclays), "asset"), "The sponsor is buying the asset from a mom n' pop owner.");
  assert.equal(shortSourcing("on-market"), "on-market");
  assert.equal(shortSourcing("Off market"), "off-market");
  assert.equal(sellerSentence({ details: JSON.stringify({ sellerProfile: "an institutional owner", sourcing: "off market" }) }, "asset"), "The sponsor is buying the asset off-market from an institutional owner.");
  // a site the sponsor already owns has no seller
  assert.equal(sellerSentence(asDeal(aurea), "land"), "");
});

test("1. and 4. the template sentences render clean and nothing internal leaks", () => {
  const body = `<p>Intro. {{deal.landSellerSentence}} {{deal.assetSellerSentence}}</p><ul><li>{{deal.debtTerms}}</li></ul><p>{{deal.details.sourcing}} {{deal.details.debtTerms}} {{deal.details.gcContract}} {{deal.details.sellerStory}} {{deal.trackerThemes}} {{deal.trackerItemsNote}}</p>`;
  for (const d of [rockyHillNorth, projectBarclays, aurea]) {
    const out = plain(renderTemplate(body, ctx(d)));
    assert.ok(!/JLL|Liberty Bank|outstanding for some time|GMP|lump sum|INTERNAL|from \./.test(out), `${d.name}: ${out}`);
    assert.ok(!/from\s*\./.test(out), `${d.name} has a dangling "from ."`);
  }
  assert.ok(plain(renderTemplate("{{deal.details.sourcing}}", ctx(aurea))) === "already owned by the sponsor");
  assert.equal(plain(renderTemplate("{{deal.details.sourcing}}", ctx(rockyHillNorth))), "");
});

test("1. the intro paragraph on Rocky Hill North carries no sourcing commentary", () => {
  const text = plain(intro(asDeal(rockyHillNorth)));
  assert.ok(!/JLL|marketed|under contract/i.test(text), text);
  assert.ok(text.startsWith("RJL Capital Advisors is pleased to be working with Dale Development"), text);
});

test("2. a sentence cut at a decimal or an abbreviation never leaves a fragment", () => {
  const brooklyn = "The site sits at the seam of Boerum Hill, Park Slope and Gowanus in Brooklyn. Downtown Brooklyn drew $2.0 billion of investment and was rezoned in 2021, drawing families. The building is all electric.";
  assert.equal(cleanBusinessPlan(brooklyn), "The site sits at the seam of Boerum Hill, Park Slope and Gowanus in Brooklyn. The building is all electric.");
  assert.deepEqual(planSentences("Onyx Partners Ltd. is a retail platform based in Needham. It owns centers across New England."), ["Onyx Partners Ltd. is a retail platform based in Needham.", "It owns centers across New England."]);
  assert.deepEqual(planSentences("Rents sit near a record low 2.5 percent vacancy. Demand is deep."), ["Rents sit near a record low 2.5 percent vacancy.", "Demand is deep."]);
  assert.equal(cleanBusinessPlan(projectBarclays.summary as string)?.includes("0 billion"), false);
});

test("3. and 6. the debt line: amount | LTC @ rate - amortization on a n-year term - (lender)", () => {
  // with the closing month on the curve, the rate is that month's
  assert.equal(debtTermsLine(asDeal(rockyHillNorth)), "$77,282,717 | 64.98% LTC @ 225 bps over SOFR (5.67% at January 2027 closing) - full term I/O on a 4-year term - (Bank Execution)");
  // without a curve value for the month, today's reading: the line Jonathan asked for
  setForwardCurve({});
  assert.equal(debtTermsLine(asDeal(rockyHillNorth)), "$77,282,717 | 64.98% LTC @ 225 bps over SOFR (6.14% today) - full term I/O on a 4-year term - (Bank Execution)");
  assert.equal(rateTextAtClose({ rateIndex: "SOFR", rateSpreadBps: 225 }, "January 2027"), "225 bps over SOFR (6.14% today)");
  setForwardCurve(parseForwardCurve("January 2027 3.42"));
  assert.equal(closeMonthKey("January 2027"), "2027-01");
  assert.equal(closeMonthKey("Q4 2026 (land closing)"), "2026-12");
  assert.equal(closeMonthKey("Early December 2026"), "2026-12");
  assert.equal(closeMonthKey("12/2026"), "2026-12");
  assert.equal(closeMonthKey("soon"), null);
});

test("3. and 6. the working deals' debt lines keep their figures, with the new punctuation", () => {
  assert.equal(debtTermsLine(asDeal(aurea)), "$92,011,402 | 60.61% LTC @ 7.15% - 40 year amortization (HUD) on a Construction to permanent");
  assert.equal(debtTermsLine(asDeal(projectBarclays)), "$13,991,713 | 70.00% LTC @ 375 bps over SOFR (7.17% at January 2027 closing) - on a 3-year term");
});

test("an empty bullet, an unknown acreage and a missing cash-on-cash leave no fragment", () => {
  const noAcres = { ...rockyHillNorth, details: JSON.stringify({ ...JSON.parse(rockyHillNorth.details ?? "{}"), acres: undefined }), cashOnCash: null, capRateY1: null };
  const out = renderTemplate("<p>spans 1,000 square feet{{deal.acresClause}}. {{deal.cashOnCashSentence}}</p><ul><li><b>Year 1 Cap Rate:</b> {{deal.capRateY1}}</li><li><b>IRR:</b> {{deal.irr}}</li></ul>", ctx(noAcres));
  assert.ok(!/acres of land|cash on cash|Year 1 Cap Rate/.test(out), out);
  assert.ok(/IRR:/.test(out), out);
  assert.equal(plain(renderTemplate("{{deal.acresClause}}", ctx({ ...rockyHillNorth, details: JSON.stringify({ acres: 2.3 }) }))), ", and will sit on 2.3 acres of land");
  assert.equal(sellerSentence({ details: JSON.stringify({ sellerProfile: "from a very distressed seller", sourcing: "off-market through a broker relationship" }) }, "asset"), "The sponsor is buying the asset off-market through a broker relationship from a very distressed seller.");
});

test("a Word-style signature in an email body sends tight", () => {
  const word = `<p style="margin:0 0 10pt 0;">Body line.</p><p class="MsoNormal" style="margin-bottom:0in;line-height:normal;mso-pagination:\nwidow-orphan lines-together"><a name="_MailAutoSig"><b><span style="font-size:9.0pt">Aviel Livian</span></b></a><span>&nbsp;<o:p></o:p></span></p><p class="MsoNormal" style="margin-bottom:0in;line-height:normal;mso-pagination:widow-orphan"><span style="font-size:9.0pt;mso-fareast-font-family:Calibri">RJL Capital Advisors&nbsp;<o:p></o:p></span></p>`;
  const out = tidyWordBlocks(word);
  assert.ok(!/MsoNormal|<o:p>|mso-|_MailAutoSig|&nbsp;/.test(out), out);
  assert.ok(out.includes('<p style="margin:0 0 10pt 0;">Body line.</p>'), "a body paragraph is left alone");
  assert.equal((out.match(/<p style="margin:0;line-height:normal;">/g) ?? []).length, 2, out);
  assert.equal(tidyWordBlocks("<p>plain</p>"), "<p>plain</p>");
});

test("5. the equity multiple reads with two decimals and a lowercase x", () => {
  assert.equal(multiple(2.1), "2.10x");
  assert.equal(multiple(1.84), "1.84x");
  assert.equal(plain(renderTemplate("{{deal.equityMultiple}}", ctx(rockyHillNorth))), "2.10x");
  const returns = metrics(asDeal(rockyHillNorth)).find((l) => l.startsWith("Expected Returns:"));
  assert.equal(returns, "Expected Returns: 26.12% IRR and a 2.10x EM on a 4 year hold.");
  assert.equal(metrics(asDeal(aurea)).find((l) => l.startsWith("Expected Returns:"))?.includes("2.24x EM"), true);
});

test("5. IRR, yield on cost and LTC keep their two-decimal form", () => {
  const m = metrics(asDeal(rockyHillNorth));
  assert.ok(m.some((l) => l === "Yield on Cost at Stabilization: 7.16%"), m.join("\n"));
  assert.ok(m.some((l) => l.includes("64.98% LTC")), m.join("\n"));
  assert.ok(m.some((l) => l.includes("26.12% IRR")), m.join("\n"));
});

test("7. the business plan leads with the place", () => {
  const deal = { city: "Amesbury", state: "MA", propertyName: "Rocky Hill North", name: "Dale Development | Rocky Hill North" };
  assert.equal(leadsWithPlace(rockyHillNorth.summary as string, deal), false, "the Oct 19 plan opened with the sponsor");
  assert.equal(leadsWithPlace("Rocky Hill North sits in Amesbury, Massachusetts, on the Merrimack River north of Boston. The sponsor is building townhomes.", deal), true);
  assert.equal(leadsWithPlace(aurea.summary as string, { city: "Miami", state: "FL", propertyName: "Aurea at Highland Park", name: "" }), true);
  assert.equal(leadsWithPlace(projectBarclays.summary as string, { city: "Brooklyn", state: "NY", propertyName: "Project Barclays", name: "" }), true);
});

test("8. a principal by family relation is flagged in a bio", () => {
  assert.equal(bioProblems("The firm was founded by Brendan Dale's father, who began his career at Toll Brothers.").length, 1);
  assert.equal(bioProblems("The firm's founder began his career at Toll Brothers.").length, 0);
});

test("8. the sponsor bio stays firm-level", () => {
  const bio = rockyHillNorth.sponsorExperience as string;
  assert.ok(/JLL|zoning|grant/i.test(bio), "the Oct 19 bio carried the deal-specific sentence");
  const cleaned = cleanSponsorBio(bio) ?? "";
  assert.ok(!/JLL|zoning|grant funding|environmental approval/i.test(cleaned), cleaned);
  assert.ok(cleaned.startsWith("Dale Development is a family run"), cleaned);
  assert.equal(cleanSponsorBio(aurea.sponsorExperience as string), aurea.sponsorExperience);
  assert.equal(cleanSponsorBio(projectBarclays.sponsorExperience as string), projectBarclays.sponsorExperience);
});
