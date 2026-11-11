import { test } from "node:test";
import assert from "node:assert/strict";
import { BLANK_LINE, outlookBlankLines } from "../src/lib/email-html";
import { tidyWordBlocks } from "../src/lib/followup";

// Nov 11, 2026 (Jonathan, from Aviel's OZ reach out): one real empty line between paragraphs in Outlook, as if Enter was
// pressed twice, never "space after paragraph", and every gap the same.
const SIG = `<div data-signature="1"><p style="margin:0;line-height:normal;"><b>Aviel Livian</b></p><p style="margin:0;line-height:normal;">RJL Capital Advisors</p></div>`;
const count = (s: string, sub: string) => s.split(sub).length - 1;

test("one empty line between paragraphs, the list and the signature; typed blank lines collapse", () => {
  const html =
    `<div style="font-family:Calibri,Arial,sans-serif;font-size:11pt;">` +
    `<p style="margin:0 0 10pt 0;">Hi - hope you are well.</p>` +
    `<p class="MsoNormal"><span>We are working with an OZ investor.</span></p>` +
    `<p class="MsoNormal"><span><br></span></p><p><br></p>` +
    `<p class="MsoNormal"><span>Here is their mandate:</span></p>` +
    `<ul style="margin-top:0in"><li class="MsoNormal">Investment Type</li><li class="MsoNormal">Check Size</li></ul>` +
    `<p>Are you working on anything?</p><p>&nbsp;</p><p><br></p>` +
    SIG +
    `</div>`;
  const out = outlookBlankLines(tidyWordBlocks(html));
  // 4 paragraphs, a list and the signature: 5 gaps, one empty line each
  assert.equal(count(out, BLANK_LINE), 5);
  assert.ok(!/margin:0 0 10pt|margin-top:0in/.test(out.slice(0, out.indexOf("data-signature"))), "no paragraph spacing left in the body");
  assert.ok(!/<li[^>]*>[^<]*<\/li>\s*<p[^>]*>&nbsp;<\/p>\s*<li/.test(out), "list items stay tight");
  assert.ok(out.includes(`</ul>${BLANK_LINE}<p`), "an empty line after the list");
  assert.ok(out.includes(`${BLANK_LINE}<div data-signature="1">`), "an empty line before the signature");
  assert.ok(out.endsWith(`${SIG}</div>`), "the signature is untouched");
  assert.equal(outlookBlankLines(out), out, "running it twice changes nothing");
});

test("Word font declarations with quoted names come out whole", () => {
  const out = tidyWordBlocks(`<p class="MsoNormal"><span style="font-size:11.0pt;mso-fareast-font-family:&quot;Times New Roman&quot;">x</span></p>`);
  assert.ok(!out.includes("Times New Roman"), out);
});

test("a pref deal on a property value: Property Value, no purchase wording, no empty units, one % each", async () => {
  const { renderTemplate } = await import("../src/lib/merge");
  const tpl =
    `<div>They source {{deal.executionType}} for the purchase of {{deal.propertyName}}.</div><ul>` +
    `<li><strong>Total Capitalization: </strong>{{deal.totalCapitalization}} ({{deal.capPerFoot}} per foot)</li>` +
    `<li><strong>Purchase Price: </strong>{{deal.purchasePrice}}</li>` +
    `<li><strong>Last Dollar Exposure: </strong>{{deal.lastDollar}} | {{deal.prefLtc}}% LTC ({{deal.prefLtv}}% LTV)</li></ul>`;
  const deal = { executionType: "Preferred Equity", propertyName: "Glenwillow", purchasePrice: 63_100_000, totalDebt: 46_476_473, requestedAmount: 8_000_000, details: JSON.stringify({ priceBasis: "Property value" }) };
  const ctx = { contact: { firstName: "A", lastName: null, email: null }, company: null, deal, sender: { name: "J" }, unsubscribeUrl: "", openingLine: null };
  for (const mark of [false, true]) {
    const text = renderTemplate(tpl, ctx as never, { mark }).replace(/<\/?(?:span|strong)[^>]*>/g, "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
    assert.ok(text.includes("source Preferred Equity for Glenwillow."), text);
    assert.ok(text.includes("Property Value: $63,100,000"), text);
    assert.ok(!/Purchase|Total Capitalization|per foot\)|%%|% LTC/.test(text), text);
    assert.ok(text.includes("Last Dollar Exposure: $54,476,473 (86.33% LTV)"), text);
  }
});
