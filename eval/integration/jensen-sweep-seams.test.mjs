#!/usr/bin/env node
// Jensen sweep seam-eval. Pure static-code assertions on the architectural
// promises this sweep depends on. No Anthropic spend, no DB hit, no network.
// Modelled after nisria-techops eval/integration/seam-9-message-battery.test.mjs.
//
// Each check returns { name, ok, reason }. The runner prints a table and exits
// non-zero on any failure. This is the eval that gates Phase 3 — write failing
// tests first (HOW-TO-SWEEP step 3, KT #126), only commit fixes when this
// passes. Then promote to prod-harness for behavioural verification.

import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const read = (rel) => readFileSync(resolve(ROOT, rel), "utf8");

const tests = [];
function check(name, fn) { tests.push({ name, fn }); }

// ============================================================================
// LOCKDOWN SEAMS (Phase 0 surface)
// ============================================================================

check("seam.01 middleware.ts has MAINTENANCE_MODE gate", () => {
  const src = read("middleware.ts");
  if (!/MAINTENANCE_MODE/.test(src)) return "no MAINTENANCE_MODE reference";
  if (!/MAINTENANCE_ADMIN_TOKEN/.test(src)) return "no MAINTENANCE_ADMIN_TOKEN reference";
  if (!/maintenance_admin/.test(src)) return "no maintenance_admin cookie";
  if (!/\/maintenance/.test(src)) return "no /maintenance redirect target";
  return null;
});

check("seam.02 middleware.ts URL grant ?admin=<token> sets cookie", () => {
  const src = read("middleware.ts");
  if (!/searchParams\.get\(['"]admin['"]\)/.test(src)) return "no ?admin search-param read";
  if (!/res\.cookies\.set\(["']maintenance_admin["']/.test(src)) return "URL grant does not set cookie";
  return null;
});

check("seam.03 /login is walled during maintenance (not in pre-maintenance public)", () => {
  const src = read("middleware.ts");
  // AUTH_PUBLIC must be defined AND must be consulted AFTER the maintenance gate
  const maintIdx = src.indexOf("MAINTENANCE_MODE");
  const authPublicIdx = src.indexOf("AUTH_PUBLIC");
  if (authPublicIdx === -1) return "AUTH_PUBLIC constant missing";
  if (maintIdx === -1) return "MAINTENANCE_MODE missing";
  // AUTH_PUBLIC must be used after the maintenance block — meaning the bypass
  // happens AFTER the maintenance gate, so /login still hits maintenance first.
  const authPublicUse = src.lastIndexOf("AUTH_PUBLIC.some");
  if (authPublicUse < maintIdx) return "AUTH_PUBLIC bypass runs before MAINTENANCE gate (login leaks)";
  return null;
});

check("seam.04 lib/whatsapp.ts:sendWhatsApp has JENSEN_MODE chokepoint", () => {
  const src = read("lib/whatsapp.ts");
  if (!/JENSEN_MODE/.test(src)) return "no JENSEN_MODE reference";
  if (!/TRAINING/.test(src)) return "no TRAINING value reference";
  if (!/MAINTENANCE_ALLOWLIST/.test(src)) return "no allowlist reference";
  if (!/force/.test(src)) return "no force-bypass parameter (one-shot notice would loop)";
  // The gate must run BEFORE the actual fetch
  const gateIdx = src.indexOf("JENSEN_MODE");
  const fetchIdx = src.indexOf("graph.facebook.com");
  if (gateIdx === -1 || fetchIdx === -1) return "structure unexpected";
  if (gateIdx > fetchIdx) return "gate runs AFTER fetch (would send and then check)";
  return null;
});

check("seam.05 WA route POST has maintenance gate after seen() and before isOwner()", () => {
  const src = read("app/api/whatsapp/route.ts");
  const seenIdx = src.indexOf("if (await seen(");
  const maintIdx = src.indexOf("JENSEN_MODE");
  const ownerIdx = src.indexOf("if (!isOwner(");
  if (seenIdx === -1) return "seen() dedupe not present at top of POST";
  if (maintIdx === -1) return "no JENSEN_MODE check in WA route";
  if (ownerIdx === -1) return "isOwner gate not present";
  if (maintIdx < seenIdx) return "maintenance gate runs before seen() (would notify on every retry)";
  if (maintIdx > ownerIdx) return "maintenance gate runs after isOwner (would leak 'private line' notice)";
  return null;
});

check("seam.06 WA route silent-drops non-allowlisted in TRAINING (no notice to Jensen)", () => {
  const src = read("app/api/whatsapp/route.ts");
  // Per Taona directive (2026-06-09): Jensen must NOT receive a "training in progress"
  // notice. The TRAINING gate must silent-drop everyone not on MAINTENANCE_ALLOWLIST.
  const idx = src.indexOf('JENSEN_MODE === "TRAINING"');
  if (idx === -1) return "TRAINING gate block not found";
  // Slice only the TRAINING if-block. ~345 chars to the outer close, +60 buffer
  // for the comment before the next sendWhatsApp call (so we never read it).
  const block = src.slice(idx, idx + 400);
  if (/sendWhatsApp\(/.test(block)) return "TRAINING gate still calls sendWhatsApp (would leak to Jensen)";
  if (/maintenance_notice_/.test(block)) return "TRAINING gate still references old per-day notice key";
  if (!/return NextResponse\.json\(\{\s*ok:\s*true\s*\}\)/.test(block)) return "TRAINING gate does not early-return ok";
  return null;
});

// ============================================================================
// DEDUP SEAMS — FM-02 (the "Memorae's worst bug" comment must remain)
// ============================================================================

check("seam.07 ops.createTask soft-dedupes on title + done=false", () => {
  const src = read("lib/concierge/ops.ts");
  const createTaskBlock = src.slice(src.indexOf("export async function createTask"));
  if (!/title=eq\./.test(createTaskBlock.slice(0, 1500))) return "no title equality filter in createTask";
  if (!/done=is\.false/.test(createTaskBlock.slice(0, 1500))) return "no done=false filter in createTask dedup";
  if (!/deduped:\s*true/.test(createTaskBlock.slice(0, 1500))) return "createTask does not return deduped:true";
  return null;
});

check("seam.08 ops.createEvent soft-dedupes on title + date", () => {
  const src = read("lib/concierge/ops.ts");
  const block = src.slice(src.indexOf("export async function createEvent"));
  if (!/title=eq\./.test(block.slice(0, 1500))) return "no title eq in createEvent dedup";
  if (!/date=eq\./.test(block.slice(0, 1500))) return "no date eq in createEvent dedup";
  if (!/deduped:\s*true/.test(block.slice(0, 1500))) return "createEvent does not return deduped:true";
  return null;
});

// ============================================================================
// BRAIN SEAMS
// ============================================================================

check("seam.09 brain.recall uses RRF fusion across vector + lexical arms", () => {
  const src = read("lib/concierge/brain.ts");
  if (!/rrf/.test(src)) return "no rrf helper used in brain.ts";
  if (!/match_brain_facts/.test(src)) return "no pgvector RPC call for facts";
  if (!/ilike/.test(src)) return "no ILIKE lexical arm for facts (RRF needs both arms)";
  if (!/match_doc_chunks/.test(src)) return "no pgvector RPC for docs";
  return null;
});

check("seam.10 brain.captureSalience exported AND wired into runConcierge", () => {
  const brainSrc = read("lib/concierge/brain.ts");
  if (!/export async function captureSalience/.test(brainSrc)) return "captureSalience not exported";
  const loopSrc = read("lib/concierge/loop.ts");
  if (!/captureSalience/.test(loopSrc)) return "captureSalience not referenced in loop.ts";
  return null;
});

check("seam.11 standing directives injected into system prompt", () => {
  const src = read("lib/concierge/loop.ts");
  if (!/listDirectives/.test(src)) return "loop does not load directives";
  if (!/STANDING INSTRUCTIONS/.test(src)) return "directives marker absent from system prompt";
  return null;
});

// ============================================================================
// VERIFIER SEAM — FM-01, FM-06 (anti-fake-done)
// ============================================================================

check("seam.12 verify.verifyReply exported and called in runConcierge", () => {
  const verifySrc = read("lib/concierge/verify.ts");
  if (!/export async function verifyReply/.test(verifySrc)) return "verifyReply not exported";
  const loopSrc = read("lib/concierge/loop.ts");
  if (!/verifyReply/.test(loopSrc)) return "verifyReply not called in loop";
  return null;
});

check("seam.13 verifier uses COMPLETION_TOOLS set, not heuristic", () => {
  const src = read("lib/concierge/verify.ts");
  if (!/COMPLETION_TOOLS/.test(src)) return "verifier doesn't reference COMPLETION_TOOLS";
  const toolsSrc = read("lib/concierge/tools.ts");
  if (!/COMPLETION_TOOLS/.test(toolsSrc)) return "COMPLETION_TOOLS not exported from tools.ts";
  return null;
});

// ============================================================================
// DISPATCH SEAM — every TOOL has a runner
// ============================================================================

check("seam.14 every named tool in tools.ts has a dispatch case in dispatch.ts", () => {
  const toolsSrc = read("lib/concierge/tools.ts");
  const dispatchSrc = read("lib/concierge/dispatch.ts");
  const toolNames = [...toolsSrc.matchAll(/name:\s*"([a-z_]+)"/g)].map((m) => m[1]);
  if (!toolNames.length) return "no tool names parsed from tools.ts";
  const missing = toolNames.filter((n) => !new RegExp(`["'\\s]${n}["'\\s]`).test(dispatchSrc));
  if (missing.length) return `tools missing dispatch case: ${missing.slice(0, 8).join(", ")}${missing.length > 8 ? "…" : ""}`;
  return null;
});

// ============================================================================
// PERSONA SEAM — FM-08 (warm answer), tone tree
// ============================================================================

check("seam.15 system prompt establishes Rencontre persona in first person", () => {
  const src = read("lib/concierge/loop.ts");
  if (!/Rencontre/.test(src)) return "persona name 'Rencontre' missing";
  if (!/first person/i.test(src)) return "first person discipline missing";
  if (!/Jensen/.test(src)) return "user name Jensen missing from prompt";
  return null;
});

check("seam.16 NO_DASHES discipline appended (JENSEN-DOCTRINE Law 5)", () => {
  const anthropicSrc = read("lib/anthropic.ts");
  if (!/NO_DASHES/.test(anthropicSrc)) return "NO_DASHES constant missing";
  const loopSrc = read("lib/concierge/loop.ts");
  if (!/NO_DASHES/.test(loopSrc)) return "NO_DASHES not referenced in system prompt";
  return null;
});

// ============================================================================
// TASK LIST ORDERING — FM-05 (drift between user-pasted list and rendered)
// ============================================================================

check("seam.17 listTasks order is deterministic (created_at descending)", () => {
  const src = read("lib/concierge/ops.ts");
  const block = src.slice(src.indexOf("export async function listTasks"));
  if (!/order=/.test(block.slice(0, 600))) return "listTasks has no order clause (output drifts between calls)";
  return null;
});

check("seam.18 WA route has deterministic DONE-resolution before runConcierge", () => {
  const src = read("app/api/whatsapp/route.ts");
  if (!/DETERMINISTIC DONE-RESOLUTION/.test(src)) return "no DONE-resolution comment marker";
  // The regex match for bare 'done' must run BEFORE the runConcierge call
  const doneIdx = src.indexOf("done|done\\.|did it|yes done");
  const conciergeIdx = src.indexOf("runConcierge({");
  // Both indexes must exist and DONE must come first (it shortcircuits)
  if (doneIdx === -1) return "no bare-done regex";
  // There are multiple runConcierge calls (media path uses one); find the LAST plain-text one
  const plainTextConcierge = src.lastIndexOf("runConcierge({ messages: [...history, { role: \"user\", content: text }]");
  if (plainTextConcierge === -1) return "could not locate plain-text runConcierge dispatch";
  if (doneIdx > plainTextConcierge) return "DONE-resolution runs AFTER runConcierge (would never short-circuit)";
  return null;
});

check("seam.19 system prompt injects RECENT OPEN TASKS with ids", () => {
  const src = read("lib/concierge/loop.ts");
  if (!/RECENT OPEN TASKS/.test(src)) return "no RECENT OPEN TASKS section in system prompt";
  if (!/listTasks\(\{ done: false \}\)/.test(src)) return "open tasks not loaded with done:false filter";
  return null;
});

check("seam.20 system prompt uses peer-counsel framing (persona tree)", () => {
  const src = read("lib/concierge/loop.ts");
  if (!/strategic counsel|trusted partner/i.test(src)) return "persona not peer-counsel (still concierge-butler framing)";
  if (!/Upaya/.test(src)) return "Upaya Festival context missing from persona";
  if (!/Mauritian|Vatel/.test(src)) return "Jensen's background context missing";
  return null;
});

check("seam.21bis WA route persists inbound to chat_messages BEFORE runConcierge (NO-CHAT-LOST)", () => {
  const src = read("app/api/whatsapp/route.ts");
  if (!/NO-CHAT-LOST/.test(src)) return "no NO-CHAT-LOST marker";
  // The chatAppend for inbound must run BEFORE runConcierge in plain-text path
  const inboundChat = src.indexOf('chatAppend("user", text');
  const conciergeIdx = src.indexOf('runConcierge({ messages: [...history, { role: "user", content: text }]');
  if (inboundChat === -1) return "no pre-brain chatAppend for inbound text";
  if (conciergeIdx === -1) return "could not locate plain-text runConcierge";
  if (inboundChat > conciergeIdx) return "inbound persistence runs AFTER runConcierge (would lose message on brain error)";
  return null;
});

check("seam.21ter onboarding prompt is probing + capture-everything (Taona directive)", () => {
  const src = read("lib/concierge/loop.ts");
  if (!/DRAW HIM OUT/.test(src)) return "no DRAW HIM OUT instruction";
  if (!/CAPTURE-EVERYTHING/.test(src)) return "no CAPTURE-EVERYTHING discipline";
  if (!/WHAT YOU ARE PROBING FOR/.test(src)) return "no probing checklist";
  if (!/never re-ask/i.test(src)) return "no anti-re-ask discipline";
  return null;
});

check("seam.21quater captureSalience accepts onboarding option for liberal capture", () => {
  const src = read("lib/concierge/brain.ts");
  if (!/SALIENCE_ONBOARDING_SYS/.test(src)) return "no onboarding-specific salience prompt";
  if (!/onboarding_fact/.test(src)) return "onboarding kind label missing on rememberFact call";
  if (!/opts\?: \{ onboarding/.test(src)) return "captureSalience signature missing onboarding option";
  const loopSrc = read("lib/concierge/loop.ts");
  if (!/captureSalience\(lastUser, reply, \{ onboarding \}\)/.test(loopSrc)) return "loop does not pass onboarding flag to captureSalience";
  return null;
});

check("seam.21 DONE-resolution route is owner-only post-unlock, sweep-permitted in TRAINING", () => {
  const src = read("app/api/whatsapp/route.ts");
  const doneIdx = src.indexOf("DETERMINISTIC DONE-RESOLUTION");
  if (doneIdx === -1) return "DONE-resolution marker missing";
  const conditional = src.slice(doneIdx, doneIdx + 1000);
  if (!/sender\.role === ["']owner["']/.test(conditional)) {
    return "DONE-resolution does not gate on owner tier — admin 'Done' would corrupt Jensen's board post-unlock";
  }
  if (!/JENSEN_MODE === ["']TRAINING["']/.test(conditional)) {
    return "no JENSEN_MODE=TRAINING override — harness from Taona's admin number cannot exercise this path";
  }
  return null;
});

// ============================================================================
// DOCTRINE LAW 8 SEAM — destructive-tool confirmation gate
// ============================================================================

check("seam.22 dispatch.ts has destructiveGate intercepting before switch", () => {
  const src = read("lib/concierge/dispatch.ts");
  if (!/destructiveGate\(/.test(src)) return "destructiveGate function not present";
  if (!/const DESTRUCTIVE = new Set\(/.test(src)) return "DESTRUCTIVE set not defined";
  // Gate must be called BEFORE the switch in runAction
  const gateCallIdx = src.indexOf("destructiveGate(name");
  const switchIdx = src.indexOf("switch (name)");
  if (gateCallIdx === -1) return "destructiveGate not called in runAction";
  if (switchIdx === -1) return "switch(name) not found in runAction";
  if (gateCallIdx > switchIdx) return "destructiveGate called AFTER switch (action would execute before refusal)";
  return null;
});

check("seam.23 DESTRUCTIVE set covers all delete_*, reply_email, call_owner, forget_memory", () => {
  const src = read("lib/concierge/dispatch.ts");
  const required = ["delete_entity", "delete_task", "delete_event", "delete_finance",
                    "delete_document", "delete_contact", "delete_note", "forget_memory",
                    "reply_email", "call_owner"];
  const destSet = src.match(/const DESTRUCTIVE = new Set\(\[([\s\S]*?)\]\)/);
  if (!destSet) return "DESTRUCTIVE set not parseable";
  const block = destSet[1];
  const missing = required.filter((name) => !new RegExp(`["']${name}["']`).test(block));
  if (missing.length) return `DESTRUCTIVE set missing: ${missing.join(", ")}`;
  return null;
});

check("seam.24 dispatch destructiveGate honors confirm:true bypass", () => {
  const src = read("lib/concierge/dispatch.ts");
  const fnMatch = src.match(/function destructiveGate\([^)]*\)[\s\S]*?\n\}/);
  if (!fnMatch) return "destructiveGate function body not parseable";
  const body = fnMatch[0];
  if (!/input\?\.confirm\s*===\s*true/.test(body)) return "no confirm:true bypass — model can never execute confirmed deletes";
  return null;
});

check("seam.25 outbound chokepoint strips em/en dashes (Law 5 hard enforcement)", () => {
  const src = read("lib/whatsapp.ts");
  if (!/export function stripDashes/.test(src)) return "stripDashes not exported";
  if (!/replace\(\/.*[—–].*\//.test(src)) return "stripDashes does not actually strip em-/en-dashes";
  if (!/stripDashes\(body\)/.test(src)) return "sendWhatsApp does not call stripDashes on outbound body";
  const loopSrc = read("lib/concierge/loop.ts");
  if (!/stripDashes\(reply\)/.test(loopSrc)) return "concierge loop does not strip reply before persist (DB will diverge from delivery)";
  return null;
});

// ============================================================================
// OPERATOR MIRROR SEAM — silent live-tail to MIRROR_TO
// ============================================================================

check("seam.26 mirrorToOperator exists with loop-guard + delegates through sendWhatsApp", () => {
  const src = read("lib/whatsapp.ts");
  if (!/async function mirrorToOperator/.test(src)) return "mirrorToOperator not defined";
  const fn = src.slice(src.indexOf("async function mirrorToOperator"));
  const body = fn.slice(0, fn.indexOf("\n}\n") + 2);
  if (!/MIRROR_TO/.test(body)) return "no MIRROR_TO env reference";
  if (!/fromDigits === op \|\| toDigits === op/.test(body)) return "no loop guard on operator number";
  if (!/sendWhatsApp\(op,/.test(body)) return "mirror does not delegate through sendWhatsApp (would bypass chokepoints)";
  if (!/force:\s*true/.test(body)) return "mirror does not pass force:true (would be silently swallowed by TRAINING gate)";
  return null;
});

check("seam.27 sendWhatsApp fires mirror after successful outbound", () => {
  const src = read("lib/whatsapp.ts");
  const fn = src.slice(src.indexOf("export async function sendWhatsApp"));
  const body = fn.slice(0, fn.indexOf("\n}\n") + 2);
  if (!/mirrorToOperator\(/.test(body)) return "sendWhatsApp does not call mirrorToOperator";
  // mirror call must come AFTER the graph fetch (otherwise we mirror unsent text)
  const fetchIdx = body.indexOf("graph.facebook.com");
  const mirrorIdx = body.indexOf("mirrorToOperator");
  if (mirrorIdx < fetchIdx) return "mirror call runs BEFORE the actual outbound fetch";
  return null;
});

check("seam.28 WA route fires mirror on non-admin inbound", () => {
  const src = read("app/api/whatsapp/route.ts");
  if (!/mirrorInbound\(/.test(src)) return "WA route does not call mirrorInbound";
  if (!/sender\.role !== ["']admin["']/.test(src)) return "mirror not gated to non-admin senders (would mirror operator's own messages)";
  return null;
});

// ============================================================================
// REPORT
// ============================================================================

let pass = 0, fail = 0;
const results = [];
for (const t of tests) {
  let reason = null;
  try { reason = t.fn(); } catch (e) { reason = `threw: ${e?.message || e}`; }
  if (reason === null) { pass++; results.push({ name: t.name, ok: true }); }
  else { fail++; results.push({ name: t.name, ok: false, reason }); }
}

const W = Math.max(...results.map((r) => r.name.length)) + 2;
console.log("");
console.log("Jensen sweep seam eval — " + new Date().toISOString());
console.log("=".repeat(W + 14));
for (const r of results) {
  const mark = r.ok ? "✓ PASS" : "✗ FAIL";
  console.log(`${mark}  ${r.name.padEnd(W)} ${r.ok ? "" : "  → " + r.reason}`);
}
console.log("=".repeat(W + 14));
console.log(`${pass}/${tests.length} pass${fail ? `, ${fail} fail` : ""}`);
process.exit(fail ? 1 : 0);
