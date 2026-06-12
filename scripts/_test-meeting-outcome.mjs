// KT #234 verify. Replays the 2026-06-12 Zomato 17:00 incident shape
// deterministically: the meeting-bot dispatched and recorded, but Jatin
// never spoke. The ingest endpoint then said "I finished Zomato call
// (retry) and I have the notes for you" with a hallucinated summary.
//
// FIX: classifyOutcome() at app/api/ingest/route.ts evaluates the
// transcript/durationSec/notesSummary before the extractor runs. If
// 'empty', ship a single ask-once message and mark events.outcome.
//
// This script tests classifyOutcome + buildEmptyOutcomeMessage in
// isolation, no DB / no Claude. Pass: exit 0. Fail: exit 1.

import { classifyOutcome } from "../lib/meeting-outcome.ts";

let pass = 0;
let fail = 0;
const fails = [];

function check(name, cond, detail) {
  if (cond) { pass++; process.stdout.write(`[PASS] ${name}\n`); }
  else { fail++; fails.push({ name, detail }); process.stdout.write(`[FAIL] ${name}${detail ? " — " + detail : ""}\n`); }
}

// ─────────────────────────────────────────────────────────────────────
// EMPTY-OUTCOME FIXTURES (the bug shape from 2026-06-12 17:00 Zomato).
// The Sasa-of-Jensen later said it "only caught the first few seconds of
// Jatins voice and then silence." That's a sub-30s capture with a tiny
// transcript. Must classify as 'empty' so the canned "I finished + notes"
// line never ships.
// ─────────────────────────────────────────────────────────────────────
check(
  "empty: Zomato shape — few seconds of audio, near-empty transcript",
  classifyOutcome({ transcript: "hello, hi Jensen", durationSec: 12, notesSummary: "" }) === "empty",
  "expected 'empty' for ~12s audio with no real transcript",
);

check(
  "empty: completely silent recording (durationSec=0)",
  classifyOutcome({ transcript: "", durationSec: 0 }) === "empty",
  "expected 'empty' for zero duration",
);

check(
  "empty: short audio under 60s with short transcript",
  classifyOutcome({ transcript: "hi there. yeah.", durationSec: 30, notesSummary: "brief exchange" }) === "empty",
  "expected 'empty' for 30s audio + thin transcript",
);

check(
  "empty: thin transcript regardless of duration (background noise transcribed)",
  classifyOutcome({ transcript: "uh ok yeah right hello", durationSec: 600, notesSummary: "" }) === "empty",
  "expected 'empty' for thin transcript even at 10min duration",
);

check(
  "empty: medium transcript but empty notes summary (no substance extracted)",
  // < 500 chars AND notes summary < 60 chars triggers the third empty branch
  classifyOutcome({ transcript: "Hello, hi. Yeah. Okay. Are you there? Can you hear me? I think we lost connection.", durationSec: 180, notesSummary: "" }) === "empty",
  "expected 'empty' for 80-char transcript with no notes summary",
);

// ─────────────────────────────────────────────────────────────────────
// HAPPENED-OUTCOME FIXTURES — a real substantive meeting must classify as
// 'happened' so the existing extractor + WhatsApp summary path fires.
// ─────────────────────────────────────────────────────────────────────
const SUBSTANTIVE_TRANSCRIPT = "Jensen, thanks for joining. We wanted to walk through the Zomato District integration proposal. So the way we see it, we'd like to offer La Rencontre and Upaya curated experiences a featured slot in our app for the next quarter. The commercial structure would be revenue share at fifteen percent on bookings driven through District, with a guaranteed minimum of fifty thousand dirhams per month. We'd handle the marketing push across our channels, you'd handle the operational delivery and the venue experience. Are you open to discussing the contract structure?";

check(
  "happened: substantive transcript with real content",
  classifyOutcome({ transcript: SUBSTANTIVE_TRANSCRIPT, durationSec: 1800, notesSummary: "Zomato proposed revenue share deal for La Rencontre featured slot in District app." }) === "happened",
  "expected 'happened' for substantive 30min transcript",
);

check(
  "happened: short meeting but substance present",
  classifyOutcome({ transcript: "We confirmed the catering pricing at AED 280 per head for the Tuesday event. Twenty-five covers, standard menu with the seafood swap for the Buddhist guests. We'll send the contract by end of day for sign-off.", durationSec: 240, notesSummary: "Catering confirmed at AED 280 per head, 25 covers, Buddhist swap. Contract by EOD." }) === "happened",
  "expected 'happened' for substantive 4min transcript",
);

check(
  "happened: long transcript with real content and notes",
  classifyOutcome({
    transcript: "x".repeat(2000),
    durationSec: 3600,
    notesSummary: "Long discussion about Q4 strategy and partnership pipeline.",
  }) === "happened",
  "expected 'happened' for 2000-char transcript regardless of x content",
);

// ─────────────────────────────────────────────────────────────────────
// EDGE CASES — boundary conditions that probe classifier robustness.
// ─────────────────────────────────────────────────────────────────────
check(
  "edge: 199 chars + 59s = empty (just under both thresholds)",
  classifyOutcome({ transcript: "x".repeat(199), durationSec: 59, notesSummary: "" }) === "empty",
  "expected 'empty' at boundary",
);

check(
  "edge: missing durationSec falls through to transcript-length check",
  classifyOutcome({ transcript: "x".repeat(150), notesSummary: "" }) === "empty",
  "expected 'empty' when durationSec missing but transcript thin",
);

check(
  "edge: notesSummary present saves a medium transcript",
  classifyOutcome({
    transcript: "x".repeat(400),
    durationSec: 300,
    notesSummary: "x".repeat(80),
  }) === "happened",
  "expected 'happened' when transcript medium AND notes substantive",
);

// ─────────────────────────────────────────────────────────────────────
process.stdout.write(`\n${pass} passed, ${fail} failed.\n`);
if (fail > 0) {
  process.stdout.write("\nFailures:\n");
  for (const f of fails) process.stdout.write(`  - ${f.name}\n    ${f.detail || ""}\n`);
  process.exit(1);
}
process.stdout.write("ALL GREEN. KT #234 ingest classifier verified.\n");
process.exit(0);
