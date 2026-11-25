import { test } from "node:test";
import assert from "node:assert/strict";
import { aheadOf, campaignLine, gapForBytes, LAUNCH_GAP_MS } from "../src/lib/launch-queue";

// Nov 25, 2026: a mailbox sends one campaign at a time; a second one started meanwhile waits for the first to finish
const at = (s: number) => new Date(Date.UTC(2026, 10, 25, 12, 0, s));
const row = (dealId: string, s: number, kind = "SEND", bytes = 0, notBefore: Date | null = null) => ({ dealId, kind, createdAt: at(s), bytes, notBefore });

test("campaigns go in the order their oldest waiting email was queued, each one whole", () => {
  // two launches queued in the same minute: their emails interleave by time, the campaigns do not
  const line = campaignLine([row("b", 2), row("a", 1), row("b", 4), row("a", 3), row("a", 5)]);
  assert.deepEqual(line.map((c) => [c.key, c.rows.length]), [["a:SEND", 3], ["b:SEND", 2]]);
});

test("a deal's send and its follow-ups are separate campaigns", () => {
  const line = campaignLine([row("a", 1, "SEND"), row("a", 2, "FOLLOWUP"), row("a", 3, "SEND")]);
  assert.deepEqual(line.map((c) => c.key), ["a:SEND", "a:FOLLOWUP"]);
});

test("the second campaign sees the first one's waiting emails ahead of it, and the time they take", () => {
  const waiting = [row("a", 1, "SEND", 6_600_000), row("a", 2, "SEND", 6_600_000), row("b", 3), row("b", 4)];
  const b = aheadOf(waiting, { dealId: "b", kind: "SEND" });
  assert.equal(b.campaigns, 1);
  assert.deepEqual(b.first, { dealId: "a", kind: "SEND" });
  assert.equal(b.rows.length, 2);
  assert.equal(b.gapsMs, 2 * gapForBytes(6_600_000));
  assert.ok(b.gapsMs > 2 * LAUNCH_GAP_MS); // a brochure paces slower than a bare email
  // the campaign at the head has nothing ahead of it
  const a = aheadOf(waiting, { dealId: "a", kind: "SEND" });
  assert.equal(a.campaigns, 0);
  assert.equal(a.first, null);
  assert.equal(a.gapsMs, 0);
});

test("an email of the first campaign sitting out a retry still holds the second one back", () => {
  const hold = at(600);
  const b = aheadOf([row("a", 1, "SEND", 0, hold), row("b", 2)], { dealId: "b", kind: "SEND" });
  assert.equal(b.rows.length, 1);
  assert.equal(b.holdUntil, hold.getTime());
});

test("a campaign with nothing waiting has nothing ahead of it", () => {
  assert.equal(aheadOf([row("a", 1)], { dealId: "z", kind: "SEND" }).campaigns, 0);
});
