// Wall: Digital Jensen wrap-up = multi-bubble summary + task PROPOSAL, no
// auto-populate (KT #206574). Operator contract: "provide the summary in
// multiple bubbles then propose tasks that jensen should accept and dont auto
// populate them". These checks assert the human-visible bubbles and the
// deterministic selection logic accept_meeting_tasks runs.

import { test } from "node:test";
import assert from "node:assert/strict";
import { orderProposedTasks, buildMeetingBubbles, selectProposedTasks } from "../../lib/concierge/meeting-proposal.mjs";

const TASKS = [
  { title: "Send Sotiris the partnership deck", quadrant: 2 },
  { title: "Call the venue about the date hold", quadrant: 1 },
  { title: "Ask Revathy for the clothing proposal", quadrant: 3 },
  { title: "Confirm catering headcount", quadrant: 1 },
];

test("summary and decisions and proposal arrive as SEPARATE bubbles", () => {
  const bubbles = buildMeetingBubbles({
    title: "Meeting with Sotiris",
    summary: "We aligned on a Q3 co-marketing pilot. Sotiris wants a deck by Friday.",
    decisions: ["Pilot scope is one event", "La Rencontre leads on venue"],
    orderedTasks: orderProposedTasks(TASKS),
  });
  assert.ok(bubbles.length >= 3, `expected 3+ bubbles, got ${bubbles.length}`);
  assert.match(bubbles[0], /^I finished Meeting with Sotiris/);
  assert.match(bubbles[0], /Q3 co-marketing pilot/);
  assert.ok(bubbles.some((b) => /Decisions I noted:/.test(b)), "a decisions bubble exists");
  const proposal = bubbles[bubbles.length - 1];
  assert.match(proposal, /Nothing goes on your board until you say so/);
  assert.match(proposal, /add all/);
});

test("proposal is numbered, ordered by quadrant, and creates NOTHING", () => {
  const ordered = orderProposedTasks(TASKS);
  // Q1 items first.
  assert.equal(ordered[0].quadrant, 1);
  assert.equal(ordered[1].quadrant, 1);
  const proposal = buildMeetingBubbles({ title: "M", summary: "", decisions: [], orderedTasks: ordered }).pop();
  assert.match(proposal, /1\. Call the venue about the date hold _\(Do first\)_/);
  assert.match(proposal, /2\. Confirm catering headcount _\(Do first\)_/);
  // The builder returns strings only, it has no DB handle; "creates nothing" is
  // structural: there is no task id anywhere in the output.
  assert.ok(!/id:/.test(proposal));
});

test("selectProposedTasks: add all", () => {
  const ordered = orderProposedTasks(TASKS);
  assert.equal(selectProposedTasks(ordered, "all").length, 4);
  assert.equal(selectProposedTasks(ordered, undefined).length, 4);
});

test("selectProposedTasks: pick by number, in display order", () => {
  const ordered = orderProposedTasks(TASKS);
  const picked = selectProposedTasks(ordered, [1, 3]);
  assert.equal(picked.length, 2);
  assert.equal(picked[0].title, "Call the venue about the date hold"); // #1
  assert.equal(picked[1].title, "Send Sotiris the partnership deck");  // #3 after reorder
});

test("selectProposedTasks: out-of-range and duplicate indices are ignored, never throw", () => {
  const ordered = orderProposedTasks(TASKS);
  assert.equal(selectProposedTasks(ordered, [9, 9, 2]).length, 1); // only 2 is valid
  // Explicit empty pick = none (the dispatch layer maps empty numbers -> "all"
  // BEFORE calling this; the pure function honors exactly what it is given).
  assert.equal(selectProposedTasks(ordered, []).length, 0);
});

test("empty proposal yields a graceful no-items bubble and an empty selection", () => {
  const bubbles = buildMeetingBubbles({ title: "Quick sync", summary: "Brief catch up.", decisions: [], orderedTasks: [] });
  assert.ok(bubbles.some((b) => /No action items came out of this one/.test(b)));
  assert.equal(selectProposedTasks([], "all").length, 0);
});

test("no em-dashes leak into any bubble", () => {
  const bubbles = buildMeetingBubbles({
    title: "X",
    summary: "Alpha, then beta.",
    decisions: ["Ship it"],
    orderedTasks: orderProposedTasks(TASKS),
  });
  for (const b of bubbles) assert.ok(!/[—–]/.test(b));
});
