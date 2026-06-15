// agent-clock vendor + dubaiClockBlock() smoke test.
//
// Pure local, no Anthropic spend, no DB hit, no network. Asserts:
//   1. Vendored ClockInjector renders a sane block for Asia/Dubai.
//   2. dubaiClockBlock() in lib/time.ts produces the identical shape.
//   3. No undefined/NaN leaks in the rendered block.
//
// Why this test exists: the 06-09 Sasa Tuesday/Wednesday drift was the
// shape we want to never fire for Jensen. Productised ClockInjector
// replaces the old en-GB one-liner with a structured trusted block.

import { test } from "node:test";
import { strict as assert } from "node:assert";

import { ClockInjector } from "../lib/_vendor/agent-clock/index.js";
import { dubaiClockBlock } from "../lib/time.js";

const TZ = "Asia/Dubai";
const injector = new ClockInjector({ timezone: TZ });

const WEEKDAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

test("ClockInjector.block() contains the canonical header", () => {
  const block = injector.block();
  assert.ok(block.includes("Current trusted datetime:"), "missing header");
});

test("ClockInjector.block() contains a weekday word", () => {
  const block = injector.block();
  const hit = WEEKDAYS.some((w) => block.includes(w));
  assert.ok(hit, `block missing weekday name: ${block}`);
});

test("ClockInjector.block() contains the current year", () => {
  const block = injector.block();
  const year = new Date().getUTCFullYear();
  // Allow year +/- 1 day boundary in case of UTC vs Dubai crossover at year change.
  const hit = block.includes(String(year)) || block.includes(String(year - 1)) || block.includes(String(year + 1));
  assert.ok(hit, `block missing current year: ${block}`);
});

test("ClockInjector.block() names the Asia/Dubai timezone", () => {
  const block = injector.block();
  assert.ok(block.includes("Asia/Dubai"), `block missing IANA tz: ${block}`);
});

test("ClockInjector.block() includes a UTC Offset line", () => {
  const block = injector.block();
  assert.ok(block.includes("UTC Offset:"), `block missing UTC Offset line: ${block}`);
  // Dubai is fixed +04:00 (no DST).
  assert.ok(block.includes("+04:00"), `block missing +04:00 offset: ${block}`);
});

test("ClockInjector.block() does not leak undefined or NaN", () => {
  const block = injector.block();
  assert.ok(!block.includes("undefined"), `block contains 'undefined': ${block}`);
  assert.ok(!block.includes("NaN"), `block contains 'NaN': ${block}`);
});

test("dubaiClockBlock() shape matches direct ClockInjector usage", () => {
  // Both render the same moment-ish within a few ms; structural equality is
  // the contract, not byte equality on the live time string. Strip the time
  // line (line index 2, "HH:MM <abbrev>") and compare the rest.
  const direct = injector.block().split("\n");
  const wrapped = dubaiClockBlock().split("\n");
  assert.equal(wrapped.length, direct.length, "different line counts");
  // Header
  assert.equal(wrapped[0], direct[0]);
  // Date line: weekday + month + day + year, same shape (rare cross-minute year flips fine)
  assert.equal(wrapped[1], direct[1]);
  // Time line: same format "HH:MM <abbrev>"
  assert.match(wrapped[2], /^\d{2}:\d{2} /, "time line not HH:MM <abbrev>");
  assert.match(direct[2], /^\d{2}:\d{2} /, "direct time line not HH:MM <abbrev>");
  // Timezone + UTC Offset lines must match exactly.
  assert.equal(wrapped[3], direct[3]);
  assert.equal(wrapped[4], direct[4]);
});
