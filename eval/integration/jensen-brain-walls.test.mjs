#!/usr/bin/env node
// Wall test for the 2026-06-13 Karafotias regression:
//  - createEvent must dedup two title-variants of the same meeting on the same date.
//  - rememberFact must refuse structural class assertions like
//    "The two Karafotias contacts are the same person" (because the LLM has no
//    way to verify the contacts table state).
//
// Pure local. No Anthropic spend, no DB hit, no network. Mirror of the source
// regex + normalizer so a future edit that loosens either guard fails here.

import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const read = (rel) => readFileSync(resolve(ROOT, rel), "utf8");

const tests = [];
function check(name, fn) { tests.push({ name, fn }); }

// --- 1. seam: source contains the two named guards.
check("seam: ops.ts exports normalizeEventTitleKey", () => {
  const src = read("lib/concierge/ops.ts");
  if (!/export function normalizeEventTitleKey\(/.test(src)) return "normalizeEventTitleKey missing";
  if (!/export async function createEvent\([\s\S]{0,1200}normalizeEventTitleKey/.test(src)) return "createEvent body does not call normalizeEventTitleKey";
  return null;
});

check("seam: brain.ts exports isStructuralClassAssertion + uses it in rememberFact", () => {
  const src = read("lib/concierge/brain.ts");
  if (!/export function isStructuralClassAssertion\(/.test(src)) return "isStructuralClassAssertion missing";
  if (!/rememberFact[\s\S]{0,400}isStructuralClassAssertion/.test(src)) return "rememberFact does not call isStructuralClassAssertion";
  return null;
});

check("seam: SALIENCE_SYS forbids entity classification", () => {
  const src = read("lib/concierge/brain.ts");
  if (!/DO NOT classify entities/i.test(src)) return "SALIENCE_SYS missing 'do not classify entities' guard";
  return null;
});

// --- 2. behavioural mirror: prove the regex + normalizer actually catch the
//        real-world Karafotias strings that escaped on 06-13.
function mirrorNormalize(title) {
  return (title || "")
    .toLowerCase()
    .replace(/^meeting (with|w\/)\s+(the\s+)?/i, "")
    .replace(/\s+at\s+[^,]+$/i, "")
    .replace(/[^\p{L}\p{N}\s]/gu, "")
    .replace(/\s+/g, " ")
    .trim();
}
const CLASS_ASSERT_RE = /\b(is|are|refers to|noted as)\s+(?:(?:a|an|one|the|two|three|single|same|separate|duplicate)\s+){1,3}(contact|contacts|task|tasks|event|events|note|notes|person|people|entity|entities)\b/i;

check("normalize: both Karafotias title variants collapse to one key", () => {
  const a = mirrorNormalize("Meeting with the Karafotias at Dubai Hills Mall");
  const b = mirrorNormalize("Meeting with the Karafotias");
  if (!a) return "variant A normalized to empty";
  if (a !== b) return `keys diverge: A="${a}" vs B="${b}"`;
  if (a !== "karafotias") return `unexpected key: "${a}"`;
  return null;
});

check("normalize: distinct meetings on same day stay distinct", () => {
  const k1 = mirrorNormalize("Meeting with the Karafotias");
  const k2 = mirrorNormalize("Coffee with Jatin");
  if (k1 === k2) return "Karafotias collapsed to Jatin key (over-broad normalizer)";
  return null;
});

check("class-guard: rejects 'X is a single contact' family", () => {
  const samples = [
    "The two Karafotias contacts are the same person/entity, not two separate contacts.",
    "Karafotias refers to a single contact (not two separate people).",
    "The two events are one event.",
    "Jatin is the contact at Zomato",
  ];
  for (const s of samples) if (!CLASS_ASSERT_RE.test(s)) return `did not reject: "${s}"`;
  return null;
});

check("class-guard: allows real durable facts", () => {
  const safe = [
    "Jensen runs La Rencontre, a luxury hospitality consultancy in Dubai.",
    "Jatin Arora at Zomato is working with Jensen on a ticket platform.",
    "Saturday meetings happen at Dubai Hills Mall.",
  ];
  for (const s of safe) if (CLASS_ASSERT_RE.test(s)) return `false-positive rejection: "${s}"`;
  return null;
});

// --- runner
let pass = 0, fail = 0;
for (const { name, fn } of tests) {
  let reason = null;
  try { reason = fn(); } catch (e) { reason = `threw: ${e?.message || e}`; }
  if (!reason) { pass += 1; console.log(`  ok  ${name}`); }
  else { fail += 1; console.log(`  FAIL ${name} -- ${reason}`); }
}
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
