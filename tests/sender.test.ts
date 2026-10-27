import { test } from "node:test";
import assert from "node:assert/strict";
import { ccFor, elementEnd } from "../src/lib/sender";

// Jonathan, Oct 27, 2026: Aviel sent a deal from his mailbox with Jonathan's signature and copied himself
test("a deal email copies the other principal and never the sender", () => {
  assert.deepEqual(ccFor("aviel@rjlcapadvisors.com", ["aviel@rjlcapadvisors.com"]), ["jonathan@rjlcapadvisors.com"]);
  assert.deepEqual(ccFor("jonathan@rjlcapadvisors.com", []), ["aviel@rjlcapadvisors.com"]);
  assert.deepEqual(ccFor("Jonathan@RJLcapadvisors.com", ["esther@rjlcapadvisors.com", "jonathan@rjlcapadvisors.com"]), ["esther@rjlcapadvisors.com", "aviel@rjlcapadvisors.com"]);
});

test("elementEnd finds the close of a nested block and leaves what follows", () => {
  const html = `<div style="x"><p>Hi</p><div data-signature="1"><div><p><b>Jonathan Livi</b></p><br><img src="a"></div></div></div>`;
  const start = html.indexOf(`<div data-signature="1">`);
  const end = elementEnd(html, start);
  assert.equal(html.slice(end), "</div>");
  assert.equal(html.slice(start, end), `<div data-signature="1"><div><p><b>Jonathan Livi</b></p><br><img src="a"></div></div>`);
});
