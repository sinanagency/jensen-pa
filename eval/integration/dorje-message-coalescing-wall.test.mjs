#!/usr/bin/env node
// Dorje (jensen-pa) per-sender message COALESCING wall — 2026-06-20.
// Ported from Sasa's proven fix (KT #327). See DORJE-COALESCING-HANDOFF.md.
//
// COST PAID (live bug, same as Sasa): a sender fires two quick WhatsApp messages
// ("you're cool" then "thanks") and Dorje replies TWICE — two independent brain
// runs, one per inbound. The unit of work must be the conversational TURN (a
// burst), not the single message. brain-core's shouldProcess lock is an IN-MEMORY
// Map (PROCESSING_LOCKS = new Map()) that does NOT survive across Vercel
// serverless invocations, so it cannot coalesce. The fix is a DURABLE Postgres
// claim (wa_turn_claim), keyed by the sender phone (jensen-pa has no contact_id),
// with a brief in-request settle, then ONE assembled reply.
//
// jensen-pa specifics vs Sasa: INLINE (app/api/whatsapp/route.ts, no job queue);
// chat store is chat_messages(role,content,party,ts) with NO direction/status
// column, so the burst is bounded by "all role='user' messages since the last
// role='assistant'" (runConcierge persists the assistant reply, loop.ts:297).
//
// Seams (source-string, pure local — no DB, no Anthropic, no network):
//  S1  the brain reply no longer fires unconditionally per message: a per-sender
//      coalesce gate sits before runConcierge, and the loser returns without send.
//  S2  the claim is DURABLE (wa_turn_claim table, not an in-memory Map).
//  S3  turn assembly: reads role='user' since the last role='assistant', concatenated.
//  S4  FAIL-OPEN: the coalesce path degrades to the single-message reply on error,
//      never silent (prove with inject-return -> RED -> revert -> GREEN).
//  S5  exactly-once: the loser no-ops without sending; the route gates on proceed.
//  MIGRATION: an idempotent migration creates wa_turn_claim.

import { readFileSync, existsSync, readdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const read = (rel) => readFileSync(resolve(ROOT, rel), "utf8");
const exists = (rel) => existsSync(resolve(ROOT, rel));
const codeOnly = (src) => src.split("\n").filter((l) => !/^\s*\/\//.test(l)).join("\n");
const callIdx = (src) => { const m = src.match(/\bawait\s+coalesceTurn\s*\(/); return m ? m.index : -1; };

const tests = [];
function check(name, fn) { tests.push({ name, fn }); }

const ROUTE = "app/api/whatsapp/route.ts";
const COALESCE = "lib/whatsapp-coalesce.ts";

// ─── S1: a per-sender coalesce gate sits before the brain reply ──────────────
check("S1: route imports the coalesce gate", () => {
  const src = read(ROUTE);
  if (!/coalesceTurn|whatsapp-coalesce/.test(src)) return "route does not import the coalesce gate";
  return null;
});

check("S1: the coalesce gate is invoked before runConcierge", () => {
  const src = read(ROUTE);
  const c = src.search(/coalesceTurn\s*\(/);
  // Anchor on the BRAIN-path dispatch specifically (content: turnInput), not the
  // audio/media branch's runConcierge which sits earlier in the file.
  const brain = src.search(/content:\s*turnInput/);
  if (c < 0) return "coalesceTurn(...) is never called";
  if (brain < 0) return "the coalesced brain dispatch (content: turnInput) not found (sanity)";
  if (c > brain) return "coalesce gate runs AFTER the brain — it must gate it, not follow it";
  return null;
});

check("S1: a loser outcome short-circuits with a return BEFORE sendWhatsApp", () => {
  const src = read(ROUTE);
  const idx = callIdx(src);
  if (idx < 0) return "coalesce call site not found";
  const after = src.slice(idx, idx + 800);
  if (!/!\s*\w+\.proceed[\s\S]{0,260}return/.test(after))
    return "no `if (!co.proceed) ... return` after the gate — a loser would fall through and double-reply";
  return null;
});

// ─── S2: the claim is DURABLE (a DB table, not an in-memory Map) ─────────────
check("S2: coalesce module exists", () => {
  if (!exists(COALESCE)) return `${COALESCE} missing`;
  return null;
});

check("S2: claim is a durable Postgres row (kv table, no DDL needed), inserted via .from(...).insert", () => {
  const src = read(COALESCE);
  // The claim lives in the EXISTING kv table keyed by `coalesce:<sender>` — no new
  // table / no DDL, since Jensen's Supabase is on an account we can't run DDL on.
  if (!/\.from\(\s*["'`]kv["'`]\s*\)/.test(src)) return "claim not stored in the durable kv table";
  if (!/coalesce:/.test(src)) return "claim key is not the per-sender coalesce: namespace";
  if (!/\.insert\(/.test(src)) return "claim is never INSERTed (the durable acquire)";
  return null;
});

check("S2: acquire relies on a unique violation, NOT an in-memory Map", () => {
  const code = codeOnly(read(COALESCE));
  if (/new Map\s*\(/.test(code)) return "coalesce module uses an in-memory Map — the exact bug (dies across invocations)";
  if (!/duplicate key|unique|23505/i.test(code)) return "acquire does not detect the unique-violation loser path";
  return null;
});

check("S2: the claim is keyed by the SENDER (jensen-pa has no contact_id)", () => {
  const src = read(COALESCE);
  if (!/sender/.test(src)) return "claim not keyed by sender";
  return null;
});

// ─── S3: turn assembly — role='user' since the last role='assistant' ─────────
check("S3: coalescer reads inbound user messages (turn assembly, not the single msg)", () => {
  const src = read(COALESCE);
  if (!/chat_messages/.test(src)) return "does not read chat_messages for the burst";
  if (!/user/.test(src)) return "does not read role='user' inbound";
  return null;
});

check("S3: coalescer bounds the window by the last assistant reply", () => {
  const src = read(COALESCE);
  if (!/assistant/.test(src)) return "does not reference the assistant reply to bound the turn";
  if (!/ts\b/.test(src)) return "no ts bound — would re-coalesce old history";
  return null;
});

check("S3: coalescer concatenates the burst (multiple bodies into one turn)", () => {
  const src = read(COALESCE);
  if (!/join\(|\+=|concat|map\(/.test(src)) return "does not assemble multiple message bodies into one turn input";
  return null;
});

// ─── S4: FAIL-OPEN — coalesce error falls back to the single reply ───────────
check("S4: the coalesce call in the route is wrapped in try/catch", () => {
  const src = read(ROUTE);
  const idx = callIdx(src);
  if (idx < 0) return "coalesceTurn not called";
  const before = src.slice(Math.max(0, idx - 300), idx);
  if (!/try\s*\{/.test(before)) return "no `try {` precedes the coalesce call — an error would crash, not fall open";
  return null;
});

check("S4: on coalesce error the route still replies (catch does not return-silent)", () => {
  const src = read(ROUTE);
  const idx = callIdx(src);
  const after = src.slice(idx);
  const cm = after.match(/catch\s*\([^)]*\)\s*\{/);
  if (!cm) return "no catch after the coalesce call";
  let i = cm.index + cm[0].length, depth = 1; const start = i;
  while (i < after.length && depth > 0) { const ch = after[i]; if (ch === "{") depth++; else if (ch === "}") depth--; i++; }
  const flow = after.slice(start, i - 1).split("\n").filter((l) => !/^\s*\/\//.test(l)).join("\n");
  if (/\breturn\b/.test(flow)) return "catch returns — a coalescer fault would skip the reply (SILENT) instead of failing open";
  // the catch must set a proceed=true fail-open outcome so the brain still runs
  if (!/proceed\s*:\s*true|failOpen\s*:\s*true/.test(flow)) return "catch does not set a fail-open proceed outcome";
  return null;
});

check("S4: module wraps its DB work so a missing table degrades, not throws", () => {
  const src = read(COALESCE);
  if (!/try\s*\{/.test(src) || !/catch/.test(src)) return "coalesce module has no try/catch — table-missing would propagate";
  if (!/failOpen/.test(src)) return "module never returns a failOpen signal";
  return null;
});

// ─── S5: exactly-one-reply — the loser no-ops without sending ────────────────
check("S5: coalesce outcome distinguishes winner vs loser", () => {
  const src = read(COALESCE);
  if (!/winner/.test(src) || !/proceed/.test(src)) return "no winner/proceed outcome distinction returned";
  return null;
});

check("S5: the module never calls sendWhatsApp/sendTextAndLog itself (the route owns sends)", () => {
  const src = read(COALESCE);
  if (/sendWhatsApp\s*\(|sendTextAndLog\s*\(/.test(src)) return "coalesce module sends directly — risks bypassing the single-reply guard";
  return null;
});

check("S5: only the winner releases the claim via finishTurn", () => {
  const src = read(ROUTE);
  if (!/finishTurn\s*\(/.test(src)) return "route never calls finishTurn (claim would leak until TTL on every turn)";
  const idx = src.search(/finishTurn\s*\(/);
  const around = src.slice(Math.max(0, idx - 120), idx + 40);
  if (!/winner/.test(around)) return "finishTurn is not guarded by the winner flag";
  return null;
});

// ─── NO MIGRATION: the claim rides the existing kv table, so coalescing needs
// no DDL and no Supabase-account access to switch on (KT #336). ───────────────
check("NO-DDL: the claim uses the existing kv table + carries an expires_at TTL self-heal", () => {
  const src = read(COALESCE);
  if (/wa_turn_claim/.test(codeOnly(src))) return "still references the uncreatable wa_turn_claim table in code";
  if (!/expires_at/.test(src)) return "no expires_at TTL carried on the claim (a crashed winner would wedge the sender)";
  if (!/CLAIM_TTL_MS/.test(src)) return "no claim TTL constant";
  return null;
});

// ─── runner ──────────────────────────────────────────────────────────────────
let failed = 0;
for (const t of tests) {
  let res = null;
  try { res = t.fn(); } catch (e) { res = String(e?.message || e); }
  if (res) { failed++; console.error(`RED  ${t.name}: ${res}`); }
  else { console.log(`ok   ${t.name}`); }
}
console.log(`\n${tests.length - failed}/${tests.length} pass`);
if (failed) { console.log("WALL RED"); process.exitCode = 1; }
else { console.log("WALL GREEN"); }
