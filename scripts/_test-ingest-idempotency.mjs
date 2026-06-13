// Max-1-retry guard verify. On 2026-06-12 the T4 meeting-bot worker called
// back /api/ingest three times within 55 minutes for the same Zomato event,
// shipping three "did the call happen?" probes to Jensen.
//
// FIX: isTerminalOutcome() at lib/meeting-outcome.ts gates /api/ingest at
// the top. If events.outcome is already 'happened' / 'empty' /
// 'resolved_by_email', the route short-circuits with mode='already-acked'
// and no WhatsApp send happens.
//
// This script tests the pure guard logic in isolation, no DB / no Claude.
// Pass: exit 0. Fail: exit 1.

import { isTerminalOutcome } from "../lib/meeting-outcome.ts";

let pass = 0;
let fail = 0;
const fails = [];

function check(name, cond, detail) {
  if (cond) { pass++; process.stdout.write(`[PASS] ${name}\n`); }
  else { fail++; fails.push({ name, detail }); process.stdout.write(`[FAIL] ${name}${detail ? " — " + detail : ""}\n`); }
}

// ─────────────────────────────────────────────────────────────────────
// TERMINAL outcomes — guard MUST short-circuit on these (the bug shape
// from 2026-06-12 17:00 Zomato: second/third callbacks for an event
// already acked.)
// ─────────────────────────────────────────────────────────────────────
check("terminal: 'happened' gates the route", isTerminalOutcome("happened") === true);
check("terminal: 'empty' gates the route (Zomato shape)", isTerminalOutcome("empty") === true);
check("terminal: 'resolved_by_email' gates the route", isTerminalOutcome("resolved_by_email") === true);

// ─────────────────────────────────────────────────────────────────────
// NON-TERMINAL outcomes — guard MUST let the route proceed. A fresh
// capture for an event waiting on Jensen's verdict should still ship.
// ─────────────────────────────────────────────────────────────────────
check("non-terminal: null = first callback, must proceed", isTerminalOutcome(null) === false);
check("non-terminal: undefined = first callback, must proceed", isTerminalOutcome(undefined) === false);
check("non-terminal: empty string treated as null", isTerminalOutcome("") === false);
check(
  "non-terminal: 'awaiting_human_verdict' lets retry through",
  isTerminalOutcome("awaiting_human_verdict") === false,
  "this state means we asked, no answer; a fresh capture should not be blocked",
);

// ─────────────────────────────────────────────────────────────────────
// EDGE CASES — defensively reject anything outside the known set so a
// future schema drift doesn't silently let the guard misfire.
// ─────────────────────────────────────────────────────────────────────
check("edge: unknown string is non-terminal (fail-open)", isTerminalOutcome("foo") === false);
check("edge: numeric coerced shape is non-terminal", isTerminalOutcome(0) === false);

// ─────────────────────────────────────────────────────────────────────
process.stdout.write(`\n${pass} passed, ${fail} failed.\n`);
if (fail > 0) {
  process.stdout.write("\nFailures:\n");
  for (const f of fails) process.stdout.write(`  - ${f.name}\n    ${f.detail || ""}\n`);
  process.exit(1);
}
process.stdout.write("ALL GREEN. Max-1-retry guard verified.\n");
process.exit(0);
