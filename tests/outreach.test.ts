import { test } from "node:test";
import assert from "node:assert/strict";
import { BROCHURE_PART_BYTES, isOutreach, MAX_OUTREACH, maxOutreach, OUTREACH_STAGE } from "../src/lib/outreach";
import { STAGE_ORDER } from "../src/lib/taxonomy";

// Oct 28, 2026: Investor search > Reach out sends the brochure through the deal send machinery on a record in the stage "Outreach"
test("a reach out is never a deal stage, so no board, reader or sweep lists it", () => {
  assert.equal(STAGE_ORDER.includes(OUTREACH_STAGE), false);
  assert.equal(isOutreach({ stage: OUTREACH_STAGE }), true);
  assert.equal(isOutreach({ stage: "Deal Taken To Market" }), false);
  assert.equal(MAX_OUTREACH, 30);
  // Nov 11, 2026: a sponsor reach out takes up to 100 firms; an investor one stays at 30
  assert.equal(maxOutreach("investor"), 30);
  assert.equal(maxOutreach("sponsor"), 100);
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

test("a colleague asked off our emails is found and matched to the firm's contact (Nov 12, 2026)", async () => {
  const { colleaguesAskedOff, contactsNamed, asksToUnsubscribe } = await import("../src/lib/outreach");
  const firm = [
    { id: "k1", firstName: "Dana", lastName: "Reyes", email: "dreyes.old@example.com" },
    { id: "k2", firstName: "Dana", lastName: "Reyes", email: "dreyes@example.com" },
    { id: "a", firstName: "Sam", lastName: "Ortiz", email: "sortiz@example.com" },
  ];
  const nov12 = "Again, please remove Dana from all emails from your office. Thanks, Pat";
  const oct28 = "Please direct all future emails to my attention and no need to copy Dana. Appreciate the opportunity.";
  assert.deepEqual(colleaguesAskedOff(nov12), ["Dana"]);
  assert.deepEqual(colleaguesAskedOff(oct28), ["Dana"]);
  assert.deepEqual(contactsNamed(["Dana"], firm).map((p) => p.id), ["k1", "k2"]); // both addresses of the one person
  assert.deepEqual(colleaguesAskedOff("Please don't cc Sarah Lee going forward"), ["Sarah Lee"]);
  assert.equal(asksToUnsubscribe(nov12), false, "the writer asked about a colleague, not themselves");
  // the writer's own request, and ordinary sentences, name no colleague
  for (const s of ["Please remove me from your list", "Take us off this distribution", "No need to copy me on the next one", "We will remove the pref from the structure", "Happy to jump on a call"]) assert.deepEqual(colleaguesAskedOff(s), [], s);
  // a first name two different people share is not enough to pick one
  assert.deepEqual(contactsNamed(["Dana"], [...firm, { id: "x", firstName: "Dana", lastName: "Other", email: "dother@example.com" }]), []);
});
