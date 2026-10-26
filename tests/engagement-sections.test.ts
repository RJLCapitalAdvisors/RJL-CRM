import { test } from "node:test";
import assert from "node:assert/strict";
import { listSections, sectionsNamed, ownListGroups } from "../src/lib/engagement-reply";

// Jonathan's Oct 23, 2026 email to Kyle Corrigan (Citivest, Hedges Greene pref) and Kyle's reply of Oct 24
const groups = ["BIG Equity", "Calibogue Capital", "Midloch LLC", "Abod Capital", "Amzak Capital Management", "Arc Capital Partners LLC", "ARCTRUST", "Archway Capital", "Ardent", "ArrowMark Partners", "Artisan Capital", "BattleCreek Capital", "BOLOUR", "Calmwater Asset Management LLC", "CenterSquare Investment Management LLC", "International Capital LLC", "Jack Lingo Asset Management", "Kairos Investment Management", "Keystone Equities,", "Leste USA LLC", "Machine Investment Group", "Morrison Street Capital LLC", "NLA Capital Partners", "Peaceable Street", "Peachtree Group", "PIMCO", "RCP Investments", "Siguler Guff", "Sound Mark Partners", "Triangle Capital Group", "Wellings Capital", "Tryperion Partners", "Red Starr Investments"].map((name) => ({ name, companyId: name }));

const proposal = `Hi Kyle,
Following up on going wider for pref on Hedges Greene. Below is the proposed outreach list.
Tier 1 - Already approached on this deal (revisiting for pref)
- BIG Equity – passed but I’ll ask them about pref
- Calibogue Capital – will ask them about pref if they pass
- Midloch LLC – already asking them about pref
Tier 2 - New groups for pref
- Abod Capital
- Amzak Capital Management
- Arc Capital Partners LLC
- ARCTRUST
- Archway Capital
- Ardent
- ArrowMark Partners
- Artisan Capital
- BattleCreek Capital
- BOLOUR
- Calmwater Asset Management LLC
- CenterSquare Investment Management LLC
- International Capital LLC
- Jack Lingo Asset Management
- Kairos Investment Management
- Keystone Equities
- Leste USA LLC
- Machine Investment Group
- Morrison Street Capital LLC
- NLA Capital Partners
- Peaceable Street
- Peachtree Group
- PIMCO
- RCP Investments
- Siguler Guff
- Sound Mark Partners
- Stonehill
- Triangle Capital Group
- Wellings Capital
As mentioned, I'd expect pref to price around 14%-15% with 1% in and 1% out.
Thanks,
Jonathan Livi`;

const replyHtml = `<div><p>Revised list for Tier 2 below.</p><p><b>Tier 2 - New groups for pref</b></p><p>- Abod Capital</p><p>- ARCTRUST</p><p>- Artisan Capital</p><p>- BattleCreek Capital</p><p>- Calmwater Asset Management LL</p><p>- International Capital LLC</p><p>- Leste USA LLC</p><p>- Machine Investment Group</p><p>- Morrison Street Capital LLC</p><p>- NLA Capital Partners</p><p>- Peachtree Group</p><p>- Siguler Guff</p><p>- Sound Mark Partners</p><p>- Stonehill</p><p>- Triangle Capital Group</p><p>- Wellings Capital</p><p>Kyle Corrigan</p><p>From: Jonathan Livi</p><p>Tier 1 - Already approached</p><p>- BIG Equity</p></div>`;

test("the proposal splits into its tiers", () => {
  const sections = listSections(proposal, groups);
  assert.deepEqual(sections.map((s) => [s.heading.split(" - ")[0], s.groups.length]), [["Tier 1", 3], ["Tier 2", 28]]);
  assert.ok(sections[0].groups.some((g) => g.name === "BIG Equity"));
  assert.ok(!sections[1].groups.some((g) => g.name === "Tryperion Partners"), "a group never proposed is in no section");
});

test("a reply that names Tier 2 speaks for Tier 2 only", () => {
  const sections = listSections(proposal, groups);
  const named = sectionsNamed("Revised list for Tier 2 below.", sections);
  assert.equal(named.length, 1);
  assert.equal(named[0].heading.split(" - ")[0], "Tier 2");
  const kept = ownListGroups(groups, replyHtml);
  assert.equal(kept.length, 15, "fifteen of Kyle's sixteen names are ticket groups (Stonehill has none)");
  const leftOut = named[0].groups.filter((g) => !kept.includes(g)).map((g) => g.name);
  assert.ok(!leftOut.includes("BIG Equity") && !leftOut.includes("Calibogue Capital") && !leftOut.includes("Midloch LLC"), "Tier 1 stays");
  assert.ok(leftOut.includes("PIMCO") && leftOut.includes("Amzak Capital Management") && leftOut.includes("Ardent"));
  assert.equal(leftOut.length, 13);
});

test("a reply that names no section speaks for the whole proposal", () => {
  const sections = listSections(proposal, groups);
  assert.equal(sectionsNamed("Here is the list we are good with.", sections).length, 0);
});
