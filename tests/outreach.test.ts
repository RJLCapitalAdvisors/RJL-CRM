import { test } from "node:test";
import assert from "node:assert/strict";
import { BROCHURE_PART_BYTES, isOutreach, MAX_OUTREACH, OUTREACH_STAGE } from "../src/lib/outreach";
import { STAGE_ORDER } from "../src/lib/taxonomy";

// Oct 28, 2026: Investor search > Reach out sends the brochure through the deal send machinery on a record in the stage "Outreach"
test("a reach out is never a deal stage, so no board, reader or sweep lists it", () => {
  assert.equal(STAGE_ORDER.includes(OUTREACH_STAGE), false);
  assert.equal(isOutreach({ stage: OUTREACH_STAGE }), true);
  assert.equal(isOutreach({ stage: "Deal Taken To Market" }), false);
  assert.equal(MAX_OUTREACH, 30);
});

test("brochure parts suit Graph (320 KiB multiples) and Vercel (under 4.5 MB a request)", () => {
  assert.equal(BROCHURE_PART_BYTES % 327_680, 0);
  assert.ok(BROCHURE_PART_BYTES < 4.5 * 1024 * 1024);
});
