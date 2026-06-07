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

check("seam.06 WA route maintenance notice is force:true (bypasses outbound chokepoint)", () => {
  const src = read("app/api/whatsapp/route.ts");
  // The notice has to use { force: true } to NOT be silently swallowed by lib/whatsapp.ts gate
  if (!/maintenance_notice_/.test(src)) return "no dedupe key for the maintenance notice";
  if (!/force:\s*true/.test(src)) return "notice does not pass {force:true}";
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
