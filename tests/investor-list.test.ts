import { test } from "node:test";
import assert from "node:assert/strict";
import { investorListHtml } from "../src/lib/investor-list";

// Oct 28, 2026: Investor search > Make list opens the ticked firms as a list in a blank email
test("the list is the firms sorted, one per line, then the signature", () => {
  const html = investorListHtml(["MLG Capital", "Ares & Co", "CBRE Investment Management"], "<div data-signature=\"1\">Jonathan</div>");
  assert.equal(html.indexOf("Ares &amp; Co") < html.indexOf("CBRE Investment Management"), true);
  assert.equal(html.indexOf("CBRE Investment Management") < html.indexOf("MLG Capital"), true);
  assert.equal(html.endsWith("<div data-signature=\"1\">Jonathan</div>"), true);
  assert.equal((html.match(/<div>[^<]+<\/div>/g) ?? []).filter((x) => !x.includes("&nbsp;")).length, 3);
});
