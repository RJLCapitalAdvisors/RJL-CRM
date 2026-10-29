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

// Oct 29, 2026: Russell at Aceana answered the reach out "not for us, please unsubscribe" and stayed a quiet purple token, a follow-up away
test("a reply to a reach out is read: unsubscribe, pass, answer, or an auto-reply to ignore", async () => {
  const { readReply, sameSubject, asksToUnsubscribe } = await import("../src/lib/outreach");
  assert.equal(readReply("RE: Introduction - RJL Capital Advisors | JV Opportunities", "Not for us-please unsubscribe to all\n\nRussell Deakin\nCIO & Managing Partner"), "unsubscribe");
  assert.equal(readReply("RE: Introduction: RJL Capital Advisors", "Thanks Jonathan, not a fit for us at the moment.\n\nBest,\nAmy"), "pass");
  assert.equal(readReply("RE: Introduction: RJL Capital Advisors", "Thanks for reaching out. Happy to chat next week, send me a few times.\n\nBest,\nAmy"), "answer");
  assert.equal(readReply("Automatic reply: Introduction: RJL Capital Advisors", "I am out of the office until Nov 3."), "auto");
  assert.equal(readReply("RE: Introduction: RJL Capital Advisors", "I am currently out of the office with limited access to email."), "auto");
  // a pass buried in a quoted thread is not a pass: only what they wrote counts
  assert.equal(readReply("RE: Introduction: RJL Capital Advisors", "Sounds good, let us talk.\n" + "x".repeat(400) + " not for us"), "answer");
  assert.equal(asksToUnsubscribe("Please remove us from your list"), true);
  assert.equal(asksToUnsubscribe("We subscribe to that view"), false);
  assert.equal(sameSubject("Introduction: RJL Capital Advisors", "RE: Introduction: RJL Capital Advisors"), true);
  assert.equal(sameSubject("Introduction: RJL Capital Advisors", "Re: FW: introduction: RJL  Capital Advisors"), true);
  assert.equal(sameSubject("Introduction: RJL Capital Advisors", "RE: Retreat at Meadowview"), false);
  assert.equal(sameSubject("", "RE: "), false);
});

test("a row's note is the first line they wrote, past the greeting and the pleasantries", async () => {
  const { firstLineWritten } = await import("../src/lib/outreach");
  assert.equal(firstLineWritten("Hi Jonathan,\n\n \n\nVery nice to meet you, thanks for reaching out.\n\n \n\nI think we are covered from an ARC / Monument standpoint.  But with that said, I have a friend.\n\nThanks,\nDave"), "I think we are covered from an ARC / Monument standpoint. But with that said, I have a friend");
  assert.equal(firstLineWritten("Not for us-please unsubscribe to all\n\nRussell Deakin"), "Not for us-please unsubscribe to all");
  assert.equal(firstLineWritten("Hi there"), "Hi there");
  assert.equal(firstLineWritten("Hello,\n" + "word ".repeat(60)).length <= 160, true);
});
