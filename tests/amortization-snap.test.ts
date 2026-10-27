import { test } from "node:test";
import assert from "node:assert/strict";
import { snapAmortization, snapTo } from "../src/lib/intake";
import { LOAN_TERMS, DEAL_HOLD_PERIODS } from "../src/lib/taxonomy";

// Smart Living Allen Genoa (Oct 27, 2026): the model reads "I/O (in months) 24, Amortization (after I/O) 30 years" and the ticket said full term I/O
test("24 months of I/O then 30 year amortization is the 2-year option, never full term", () => {
  assert.equal(snapAmortization("24 months I/O, then 30 year amortization"), "2 years of I/O followed by 30 year amortization");
  assert.equal(snapAmortization("I/O (in months): 24; Amortization (after I/O): 30 years"), "2 years of I/O followed by 30 year amortization");
  assert.equal(snapAmortization("24-month interest only period"), "2 years of I/O followed by 30 year amortization");
});

test("full term I/O only when the loan is interest only for its whole term", () => {
  assert.equal(snapAmortization("Interest only for the full term"), "full term I/O");
  assert.equal(snapAmortization("full term I/O"), "full term I/O");
  assert.notEqual(snapAmortization("3 years I/O, 30 year amortization thereafter"), "full term I/O");
});

test("the I/O years and the amortization both count", () => {
  assert.equal(snapAmortization("3 years of interest only followed by 35 year amortization"), "3 year I/O followed by 35 year amortization");
  assert.equal(snapAmortization("2 years I/O, 25 year amortization"), "2 years I/O followed by 25 year amortization");
  assert.equal(snapAmortization("30 year amortization"), "30 year amortization");
});

test("snapTo splits on spaces and reads the number (it used to split on the letter s)", () => {
  assert.equal(snapTo(LOAN_TERMS, "5 years"), "5 year term");
  assert.equal(snapTo(LOAN_TERMS, "seven year loan, 7 years"), "7 year term");
  assert.equal(snapTo(DEAL_HOLD_PERIODS, "5-year hold"), "5 year");
});
