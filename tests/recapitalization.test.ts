import { test } from "node:test";
import assert from "node:assert/strict";
import { DEAL_STRATEGIES, STRATEGIES, normalizeStrategy, strategyKind, strategyLabel, transactionWord } from "../src/lib/taxonomy";
import { applicableItems } from "../src/lib/checklist";
import { subjectLine } from "../src/lib/deal-copy";
import { findUnknownFields, renderTemplate } from "../src/lib/merge";

// Nov 25, 2026: a deal can be a Recapitalization (third option under "Acquisition or development"), and "Acquisitions" reads "Acquisition" on the page
const ctx = (deal: Record<string, unknown>) => ({ contact: {}, sender: { name: "Sample Sender" }, unsubscribeUrl: "", deal });

test("the page says Acquisition, the stored value stays Acquisitions", () => {
  assert.equal(strategyLabel("Acquisitions"), "Acquisition");
  assert.equal(strategyLabel("Development"), "Development");
  assert.equal(strategyLabel("Recapitalization"), "Recapitalization");
  assert.equal(strategyLabel(null), "");
  assert.ok(DEAL_STRATEGIES.includes("Acquisitions"));
});

test("a deal has three options; an investor's criteria keep Development, Acquisitions, Both", () => {
  assert.deepEqual([...DEAL_STRATEGIES], ["Acquisitions", "Development", "Recapitalization"]);
  assert.deepEqual([...STRATEGIES], ["Development", "Acquisitions", "Both"]);
  assert.equal(normalizeStrategy("recap"), "Recapitalization");
  assert.equal(normalizeStrategy("Acquisition"), "Acquisitions");
});

test("a recapitalization is an existing building: the acquisitions checklist and the acquisitions investors", () => {
  assert.equal(strategyKind("Recapitalization"), "Acquisitions");
  assert.equal(strategyKind("Acquisitions"), "Acquisitions");
  assert.equal(strategyKind("Development"), "Development");
  assert.equal(strategyKind(null), null);
  const keys = (s: string) => applicableItems(s, "Multifamily").map((it) => it.key);
  assert.deepEqual(keys("Recapitalization"), keys("Acquisitions"));
  assert.notDeepEqual(keys("Recapitalization"), keys("Development"));
});

test("the subject line and the intro sentence say recapitalization", () => {
  const deal = { assetClass: "Multifamily", strategy: "Recapitalization", city: "Tampa", state: "FL", requestedAmount: 8_000_000, executionType: "Preferred Equity", propertyName: "Sample Commons" };
  assert.match(subjectLine(deal), /^Multifamily Recapitalization Opportunity in Tampa, FL/);
  assert.match(subjectLine({ ...deal, strategy: "Acquisitions" }), /^Multifamily Acquisition Opportunity in Tampa, FL/);
  // the templates' own subject: {{deal.assetClass}} {{deal.strategy}} Opportunity
  assert.equal(renderTemplate("{{deal.assetClass}} {{deal.strategy}} Opportunity", ctx(deal)), "Multifamily Recapitalization Opportunity");
  assert.equal(renderTemplate("{{deal.assetClass}} {{deal.strategy}} Opportunity", ctx({ ...deal, strategy: "Acquisitions" })), "Multifamily Acquisition Opportunity");
  const sentence = "as they source {{deal.executionType}} for the {{deal.transaction}} of {{deal.propertyName}}";
  assert.deepEqual(findUnknownFields(sentence), []);
  assert.equal(renderTemplate(sentence, ctx(deal)), "as they source Preferred Equity for the recapitalization of Sample Commons");
  assert.equal(renderTemplate(sentence, ctx({ ...deal, strategy: "Acquisitions" })), "as they source Preferred Equity for the purchase of Sample Commons");
  assert.equal(renderTemplate(sentence, ctx({ ...deal, strategy: null })), "as they source Preferred Equity for the purchase of Sample Commons");
  assert.equal(transactionWord("Development"), "development");
});
