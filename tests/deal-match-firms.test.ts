import { test } from "node:test";
import assert from "node:assert/strict";
import { dealPhrases, firmNamesFrom, subjectHasDealPhrase } from "../src/lib/deal-match";

// Oct 28, 2026: "W Companies | Marble, TX" (a HubSpot record named for Marble Capital, an LP) filed every "Intro - Marble | Insignis" email
const firms = firmNamesFrom(["Marble Capital", "W Companies", "Clairmont Capital Group", "Insignis Partners"]);
const marble = { name: "W Companies | Marble, TX", propertyName: "Marble, TX", sponsorName: "W Companies" };

test("a deal named for a firm has no phrase to catch that firm's mail", () => {
  assert.deepEqual(dealPhrases(marble), ["Marble"]);
  assert.deepEqual(dealPhrases(marble, firms), []);
  assert.equal(subjectHasDealPhrase("Intro - Marble | Insignis", marble, firms), false);
  assert.equal(subjectHasDealPhrase("Re: Intro - TCII | Marble", marble, firms), false);
});

test("a property name that is not a firm still matches", () => {
  const d = { name: "Four Corners Development Group | The Waters at Millerville", propertyName: "The Waters at Millerville", sponsorName: "Four Corners Development Group" };
  assert.equal(subjectHasDealPhrase("RE: The Waters at Millerville | 12MM of JV Equity", d, firms), true);
  const upton = { name: "Street Corner Ventures | Upton / Marble Hill Neighborhood Redevelopment", propertyName: "Upton / Marble Hill Neighborhood Redevelopment", sponsorName: "Street Corner Ventures" };
  assert.equal(dealPhrases(upton, firms).length, 1);
});
