import { test } from "node:test";
import assert from "node:assert/strict";
import { ownListGroups, lineMatchesGroup } from "../src/lib/engagement-reply";

// ZMR Capital | Smart Living Allen Genoa: the 33 proposed groups and Zamir Kazi's reply of Oct 26, 2026
const groups = ["Corebridge Financial", "Cohen & Steers", "JDI Realty", "Nelnet", "Marble Capital", "Abod Capital", "Midloch LLC", "ReCap - RGA (Reinsurance Group of America)", "Brasa Capital Management", "Calibogue Capital", "SilverCap Partners", "Hamilton Lane", "Triangle Capital Group", "BIG Equity", "Humphreys Capital", "Monocle Group", "JW Capital", "Blue Vista", "Lakerock", "Aureon Partners (formerly Quilvest)", "Tramview Capital Management", "Atlantic Creek", "Equity Resource Investments", "Eastham Capital", "CIM Group", "Dome Equities", "Arc Capital Partners LLC", "NCA Realty Partners", "Corten Real Estate Partners", "Eagle Realty Group", "Peak Rock Capital", "Viking Partners", "Pennybacker Capital"].map((name) => ({ name, companyId: name, domain: name === "Viking Partners" ? "vikingprt.com" : null }));

const reply = `<div><p>Jonathan:</p><p>These are the groups we don't know and haven't received the package:</p><p>Abod Capital · Aureon/Quilvest · Calibogue · Corten · JW Capital · Lakerock · Monocle · NCA Realty · ReCap–RGA · Triangle Capital · Vikingprt</p><p>On Thu, Oct 22, 2026 at 6:00 PM Jonathan Livi wrote:</p><p>Corebridge Financial</p></div>`;

test("a list written on one line with dots is read name by name", () => {
  const found = ownListGroups(groups, reply).map((g) => g.name).sort();
  assert.deepEqual(found, ["Abod Capital", "Aureon Partners (formerly Quilvest)", "Calibogue Capital", "Corten Real Estate Partners", "JW Capital", "Lakerock", "Monocle Group", "NCA Realty Partners", "ReCap - RGA (Reinsurance Group of America)", "Triangle Capital Group", "Viking Partners"]);
});

test("a name written two ways with a slash matches on either half", () => {
  assert.ok(lineMatchesGroup("Aureon/Quilvest", { name: "Aureon Partners (formerly Quilvest)", companyId: "x" }));
  assert.ok(!lineMatchesGroup("Aureon/Quilvest", { name: "Corebridge Financial", companyId: "y" }));
});
