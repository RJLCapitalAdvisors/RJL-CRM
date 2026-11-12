import { test } from "node:test";
import assert from "node:assert/strict";
import Anthropic from "@anthropic-ai/sdk";
import { costUsd, hasPrice } from "../src/lib/claude-pricing";
import { failure } from "../src/lib/claude";
import { usagePeriods } from "../src/lib/claude-usage";
import { fmtUsd } from "../src/lib/format";

// Nov 12, 2026 (Jonathan): every Claude call is logged with its cost at Anthropic's prices, "today" and "this month"
// are New York days, and an out-of-credits error is told apart from every other failure.
const none = { input: 0, output: 0, cacheWrite5m: 0, cacheWrite1h: 0, cacheRead: 0 };
const M = 1_000_000;
const near = (got: number, want: number) => assert.ok(Math.abs(got - want) < 1e-9, `${got} is not ${want}`);

test("a call costs its tokens at the model's list price, cache writes and reads at their own rates", () => {
  near(costUsd("claude-opus-5", { ...none, input: M, output: M }), 5 + 25);
  near(costUsd("claude-sonnet-5", { ...none, input: 12_000, output: 800 }), 0.024 + 0.008);
  near(costUsd("claude-opus-5", { ...none, cacheWrite5m: M }), 6.25);
  near(costUsd("claude-opus-5", { ...none, cacheWrite1h: M }), 10);
  near(costUsd("claude-opus-5", { ...none, cacheRead: M }), 0.5);
  near(costUsd("claude-sonnet-5", { ...none, cacheRead: M }), 0.2);
  near(costUsd("claude-opus-5-5", { ...none, input: M, output: M, cacheRead: M }), 4 + 20 + 0.2);
});

test("a dated snapshot is priced as its model; a model with no price costs nothing and says so", () => {
  near(costUsd("claude-haiku-4-5-20251001", { ...none, input: M, output: M }), 1 + 5);
  assert.equal(hasPrice("claude-haiku-4-5-20251001"), true);
  assert.equal(costUsd("claude-next-9", { ...none, input: M }), 0);
  assert.equal(hasPrice("claude-next-9"), false);
});

test("Claude Haiku 5.5 pays the higher price once the whole prompt passes 100,000 tokens", () => {
  near(costUsd("claude-haiku-5-5", { ...none, input: 100_000, output: M }), 0.01 + 0.5);
  near(costUsd("claude-haiku-5-5", { ...none, input: 60_000, cacheRead: 60_000, output: M }), 0.03 + 0.003 + 2.5);
});

test("today, the last 7 days and this month begin at midnight in New York, across the clock change", () => {
  // 10:00 am in New York on Nov 12, 2026 (standard time); Nov 1 began on daylight time, four hours behind UTC
  const p = usagePeriods(new Date("2026-11-12T15:00:00Z"));
  assert.equal(p.today.toISOString(), "2026-11-12T05:00:00.000Z");
  assert.equal(p.week.toISOString(), "2026-11-06T05:00:00.000Z");
  assert.equal(p.month.toISOString(), "2026-11-01T04:00:00.000Z");
  assert.equal(p.chart.toISOString(), "2026-10-30T04:00:00.000Z");
  assert.equal(p.days.length, 14);
  assert.deepEqual([p.days[0], p.days[13], p.todayKey, p.monthKey], ["2026-10-30", "2026-11-12", "2026-11-12", "2026-11"]);
  // 10:30 at night in New York is already tomorrow in UTC; it is still today here
  const late = usagePeriods(new Date("2026-11-13T03:30:00Z"));
  assert.equal(late.todayKey, "2026-11-12");
  assert.equal(late.today.toISOString(), "2026-11-12T05:00:00.000Z");
});

test("only an empty balance counts as out of credits", () => {
  const api = (status: number, type: string, message: string) => Anthropic.APIError.generate(status, { type: "error", error: { type, message } }, undefined, new Headers());
  assert.equal(failure(api(400, "invalid_request_error", "Your credit balance is too low to access the Anthropic API. Please go to Plans & Billing to upgrade or purchase credits.")).outOfCredits, true);
  assert.equal(failure(api(402, "billing_error", "Billing problem")).outOfCredits, true);
  assert.equal(failure(api(429, "rate_limit_error", "Too many requests")).outOfCredits, false);
  assert.equal(failure(api(400, "invalid_request_error", "max_tokens: field required")).outOfCredits, false);
  assert.deepEqual(failure(new Error("socket hang up")), { error: "socket hang up", outOfCredits: false });
});

test("dollars read plainly", () => {
  assert.deepEqual([fmtUsd(0), fmtUsd(0.004), fmtUsd(0.005), fmtUsd(1204.5)], ["$0.00", "under $0.01", "$0.01", "$1,204.50"]);
});
