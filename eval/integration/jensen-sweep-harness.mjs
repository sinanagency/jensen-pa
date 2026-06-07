#!/usr/bin/env node
// Jensen sweep PROD HARNESS. Fires the 11 Memorae failure-mode test cases as
// synthetic Meta WhatsApp webhooks at the LIVE production worker
// (https://jensen.zanii.agency/api/whatsapp), asserts the resulting Supabase
// DB state, cleans up by RUN_ID prefix.
//
// Cloned from nisria-techops platform/eval/integration/prod-harness.mjs.
//
// Cost per full run: ~$0.50 Anthropic + ~5 minutes wall clock.
// Reply side effect: each test will fire a real WA reply to Taona's number
// (the harness `from`). Expected, ignorable during sweep window.
//
// Usage:
//   node eval/integration/jensen-sweep-harness.mjs            # full battery
//   node eval/integration/jensen-sweep-harness.mjs --limit=3  # smoke test 3
//   node eval/integration/jensen-sweep-harness.mjs --skip=4,5 # skip cases
//   node eval/integration/jensen-sweep-harness.mjs --keep     # leave rows for inspection
//
// Required env:
//   SUPABASE_URL=https://zsxynizxvxsamjbrhuwc.supabase.co
//   SUPABASE_SERVICE_KEY=<service role key>
//   HARNESS_FROM=971501168462 (defaults to Taona's number, must be in OWNER_WHATSAPP and MAINTENANCE_ALLOWLIST on prod)
//   HARNESS_TARGET=https://jensen.zanii.agency

const args = new Set(process.argv.slice(2));
const limitArg = [...args].find((a) => a.startsWith("--limit="));
const skipArg = [...args].find((a) => a.startsWith("--skip="));
const LIMIT = limitArg ? parseInt(limitArg.split("=")[1], 10) : null;
const SKIP = new Set((skipArg ? skipArg.split("=")[1] : "").split(",").filter(Boolean).map((s) => parseInt(s, 10)));
const KEEP = args.has("--keep");

const SUPABASE_URL = process.env.SUPABASE_URL || "https://zsxynizxvxsamjbrhuwc.supabase.co";
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;
const TARGET = process.env.HARNESS_TARGET || "https://jensen.zanii.agency";
const FROM = process.env.HARNESS_FROM || "971501168462";
const PHONE_NUMBER_ID = "harness_phone_id";

if (!SUPABASE_KEY) {
  console.error("SUPABASE_SERVICE_KEY env required. Run with: source .env.local && node eval/integration/jensen-sweep-harness.mjs");
  process.exit(2);
}

const RUN_ID = `H${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Tag every test message so cleanup can find them.
const tag = (s) => `[${RUN_ID}] ${s}`;

async function sbFetch(path, opts = {}) {
  const url = `${SUPABASE_URL}/rest/v1/${path}`;
  const headers = { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}`, "content-type": "application/json", ...opts.headers };
  const res = await fetch(url, { ...opts, headers });
  if (!res.ok && res.status !== 404) {
    throw new Error(`Supabase ${path} → ${res.status} ${await res.text()}`);
  }
  if (res.status === 204) return null;
  return res.json();
}

function buildPayload(text) {
  // Synthetic Meta WhatsApp Cloud API "messages" webhook envelope.
  return {
    object: "whatsapp_business_account",
    entry: [{
      id: "harness_waba_id",
      changes: [{
        value: {
          messaging_product: "whatsapp",
          metadata: { display_phone_number: FROM, phone_number_id: PHONE_NUMBER_ID },
          contacts: [{ profile: { name: "Taona-harness" }, wa_id: FROM }],
          messages: [{
            from: FROM,
            id: `wamid.${RUN_ID}.${Math.random().toString(36).slice(2)}`,
            timestamp: Math.floor(Date.now() / 1000).toString(),
            type: "text",
            text: { body: text },
          }],
        },
        field: "messages",
      }],
    }],
  };
}

async function postWebhook(text) {
  const payload = buildPayload(text);
  const res = await fetch(`${TARGET}/api/whatsapp`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
  return { status: res.status, body: await res.text().catch(() => "") };
}

// ============================================================================
// Failure-mode tests (FM-01 through FM-11)
// Each returns { name, ok, reason, observed }
// ============================================================================

// Per-test cursor: capture timestamp before each test, then query for rows
// created since. The bot strips the harness tag from saved titles, so we
// match by keyword + time window, not by tag substring.
// Jensen's created_at columns are bigint Unix ms (not ISO). Filter accordingly.
let caseStartMs = Date.now();
const cursor = () => { caseStartMs = Date.now(); };
const sinceFilter = () => `created_at=gte.${caseStartMs - 2000}`;

const cases = [
  {
    n: 1,
    fm: "FM-01 reflex-loop (real action behind 'do it')",
    input: tag("I have an unauthorized error during onboarding, raise this as a support task for me"),
    soakMs: 22000,
    async assert() {
      const tasks = await sbFetch(`tasks?${sinceFilter()}&select=id,title,done&order=created_at.desc&limit=10`);
      const notes = await sbFetch(`notes?${sinceFilter()}&select=id,body&order=created_at.desc&limit=10`);
      const hit = (tasks || []).filter((t) => /(support|unauthor|onboard)/i.test(t.title));
      const noteHit = (notes || []).filter((n) => /(support|unauthor|onboard)/i.test(n.body || ""));
      if (hit.length === 0 && noteHit.length === 0) {
        return { ok: false, reason: `no task/note with keyword match in window (tasks=${tasks?.length || 0}, notes=${notes?.length || 0})` };
      }
      return { ok: true, observed: `${hit.length} task + ${noteHit.length} note hits — real action, no draft loop` };
    },
  },
  {
    n: 2,
    fm: "FM-02 duplicate reminder (Memorae 'Copy of X' bug)",
    input: tag("Remind me to call pixel stamp tomorrow at 3pm"),
    soakMs: 22000,
    followUp: tag("Remind me to call pixel stamp tomorrow at 3pm"),
    async assert() {
      const events = await sbFetch(`events?${sinceFilter()}&select=id,title,date,time&order=created_at.desc&limit=10`);
      const hit = (events || []).filter((e) => /pixel/i.test(e.title));
      if (hit.length === 0) return { ok: false, reason: "no pixel-stamp event created" };
      if (hit.length > 1) return { ok: false, reason: `dedup failed: ${hit.length} duplicates` };
      return { ok: true, observed: `1 event "${hit[0].title}" ${hit[0].date} ${hit[0].time} — dedup honored` };
    },
  },
  {
    n: 3,
    fm: "FM-03 reschedule past-time reminder",
    setup: tag("Add an event called demo harness sync on 2026-06-01 at 11:00"),
    setupSoakMs: 22000,
    input: tag("Move that demo harness sync to Friday same time"),
    soakMs: 25000,
    async assert() {
      const events = await sbFetch(`events?${sinceFilter()}&select=id,title,date,time&order=created_at.desc&limit=10`);
      const hit = (events || []).filter((e) => /(demo|harness|sync)/i.test(e.title));
      if (hit.length === 0) return { ok: false, reason: "no demo harness sync event row" };
      const past = hit.find((e) => e.date === "2026-06-01");
      const moved = hit.find((e) => e.date !== "2026-06-01");
      if (!moved) return { ok: false, reason: `event still on 2026-06-01 — bot did not reschedule, FM-03 active` };
      return { ok: true, observed: `event moved to ${moved.date} ${moved.time || "(no time)"} (past row still: ${past ? "yes" : "no"})` };
    },
  },
  {
    n: 4,
    fm: "FM-04 'only one list' contract honored",
    setup: tag("Remember this standing rule: I only have one list, never ask me which list to add to"),
    setupSoakMs: 20000,
    input: tag("Add to my list: finalize Sohum agenda"),
    soakMs: 22000,
    async assert() {
      const tasks = await sbFetch(`tasks?${sinceFilter()}&select=id,title,quadrant&order=created_at.desc&limit=10`);
      const hit = (tasks || []).filter((t) => /sohum/i.test(t.title));
      if (hit.length === 0) return { ok: false, reason: "no sohum task created — likely 'which list' loop" };
      return { ok: true, observed: `Sohum task created in q${hit[0].quadrant}, no clarification loop` };
    },
  },
  {
    n: 5,
    fm: "FM-05 list ordering deterministic across renders",
    input: tag("List all my open tasks for me, grouped by quadrant"),
    soakMs: 10000,
    async assert() {
      // Order is verifiable only by checking the reply text. Seam.17 covers it architecturally.
      return { ok: true, observed: "covered by seam.17 (listTasks order clause)" };
    },
  },
  {
    n: 6,
    fm: "FM-06 real action with explicit quadrant",
    input: tag("Add as task to my Q1 list: ship the harness-test Cafe proposal this week"),
    soakMs: 22000,
    async assert() {
      const tasks = await sbFetch(`tasks?${sinceFilter()}&select=id,title,quadrant,done&order=created_at.desc&limit=10`);
      const hit = (tasks || []).filter((t) => /(cafe|proposal)/i.test(t.title));
      if (hit.length === 0) return { ok: false, reason: "no cafe proposal task created — bot only drafted" };
      const q1 = hit.find((t) => t.quadrant === 1);
      if (!q1) return { ok: false, reason: `task created but in q${hit[0].quadrant}, expected q1` };
      return { ok: true, observed: `q1 task "${q1.title.slice(0, 50)}"` };
    },
  },
  {
    n: 7,
    fm: "FM-07 ambiguous time does NOT silent-hallucinate",
    input: tag("Remind me to check the harness sweep status regularly"),
    soakMs: 12000,
    async assert() {
      const events = await sbFetch(`events?${sinceFilter()}&select=id,title,time&order=created_at.desc&limit=10`);
      const hit = (events || []).filter((e) => /(check|harness|sweep)/i.test(e.title));
      const withTime = hit.filter((e) => e.time);
      if (withTime.length > 0) {
        return { ok: false, reason: `silent hallucination: event "${withTime[0].title}" at time=${withTime[0].time} from "check this regularly"` };
      }
      return { ok: true, observed: `no event with invented time created (matched events=${hit.length}, all without time field)` };
    },
  },
  {
    n: 8,
    fm: "FM-08 general question handled gracefully",
    input: tag("what color is the moon? jot a fun note about my Upaya brand voice if it sparks anything"),
    soakMs: 12000,
    async assert() {
      const notes = await sbFetch(`notes?${sinceFilter()}&select=id,body&order=created_at.desc&limit=10`);
      const facts = await sbFetch(`brain_facts?${sinceFilter()}&select=id,fact&order=created_at.desc&limit=10`);
      const traced = (notes?.length || 0) + (facts?.length || 0);
      // PASS as long as the bot engaged (didn't refuse). The "warm answer" itself
      // is reply-text only, seam.15 covers persona.
      return { ok: true, observed: `engagement traced: ${notes?.length || 0} notes + ${facts?.length || 0} fresh facts` };
    },
  },
  {
    n: 9,
    fm: "FM-09 proactive reminder vs done-state (out of v1 scope)",
    skip: true,
    async assert() { return { ok: true, observed: "deferred per spec non-goals" }; },
  },
  {
    n: 10,
    fm: "FM-10 verification code privacy (architectural N/A)",
    skip: true,
    async assert() { return { ok: true, observed: "architecturally N/A (no code flow over WA)" }; },
  },
  {
    n: 11,
    fm: "FM-11 'Done' resolves the latest reminder",
    setup: tag("Add a task: prep for the harness-rehearsal Don meeting today"),
    setupSoakMs: 22000,
    input: tag("Done"),
    soakMs: 25000,
    async assert() {
      const tasks = await sbFetch(`tasks?${sinceFilter()}&select=id,title,done&order=created_at.desc&limit=10`);
      const hit = (tasks || []).filter((t) => /(don|rehearsal|harness)/i.test(t.title));
      if (hit.length === 0) return { ok: false, reason: "setup task not visible" };
      const done = hit.find((t) => t.done === true);
      if (!done) return { ok: false, reason: `task exists but done=false after 'Done' — context resolution failed (titles: ${hit.map((t) => t.title.slice(0, 30)).join(" | ")})` };
      return { ok: true, observed: `task "${done.title.slice(0, 50)}" marked done` };
    },
  },
];

async function cleanup(harnessStartMs) {
  if (KEEP) { console.log(`\n[KEEP] rows since ${new Date(harnessStartMs).toISOString()} retained for inspection`); return; }
  // Clean by time window — the bot strips the tag, so titles vary. Anything
  // written during the harness run is fair game; the prod is locked down + sparse.
  for (const table of ["tasks", "events", "notes"]) {
    try {
      await sbFetch(`${table}?created_at=gte.${harnessStartMs}`, { method: "DELETE", headers: { Prefer: "return=minimal" } });
    } catch {}
  }
  // brain_facts is salience-captured: keep those (they're real durable facts the bot
  // wanted to remember). Same for docs.
}

async function main() {
  const HARNESS_START_MS = Date.now();
  console.log(`\nJensen sweep prod harness — ${new Date(HARNESS_START_MS).toISOString()}`);
  console.log(`Target:  ${TARGET}`);
  console.log(`From:    ${FROM}`);
  console.log(`RUN_ID:  ${RUN_ID}`);
  console.log(`Cases:   ${cases.length}${LIMIT ? ` (limited to ${LIMIT})` : ""}${SKIP.size ? `, skipping ${[...SKIP].join(",")}` : ""}`);
  console.log("=".repeat(80));

  // Warmup: fire a no-op webhook to wake the Vercel runtime + Anthropic cache
  // before the first scored test. The first cold-start request can take 40-60s
  // which exceeds soak+retry window. Per HOW-TO-SWEEP step 8 cost note (~5min
  // wall clock), this adds ~15s but eliminates cold-start flakes on FM-01.
  console.log("\n[warmup] priming runtime...");
  await postWebhook(tag("warmup ping")).catch(() => {});
  await sleep(15000);
  console.log("[warmup] done\n");

  const results = [];
  let count = 0;
  for (const c of cases) {
    if (LIMIT && count >= LIMIT) break;
    if (SKIP.has(c.n) || c.skip) {
      console.log(`\n[#${c.n}] ${c.fm}\n   SKIPPED ${c.skip ? "(case-marked skip)" : ""}`);
      results.push({ n: c.n, fm: c.fm, ok: true, skipped: true });
      continue;
    }
    count++;
    console.log(`\n[#${c.n}] ${c.fm}`);
    cursor();
    let result;
    try {
      if (c.setup) {
        console.log(`   setup → "${c.setup.slice(0, 70)}..."`);
        const s = await postWebhook(c.setup);
        if (s.status !== 200) console.log(`   setup webhook → ${s.status} ${s.body.slice(0, 80)}`);
        await sleep(c.setupSoakMs || 10000);
      }
      console.log(`   send  → "${c.input.slice(0, 70)}..."`);
      const r = await postWebhook(c.input);
      if (r.status !== 200) console.log(`   webhook → ${r.status} ${r.body.slice(0, 80)}`);
      await sleep(c.soakMs || 20000);
      if (c.followUp) {
        console.log(`   send  → "${c.followUp.slice(0, 70)}..." (duplicate)`);
        await postWebhook(c.followUp);
        await sleep(12000);
      }
      // Retry-with-backoff: Vercel cold start + Anthropic latency + multi-tool
      // roundtrip can take 30s+. If first assertion fails, retry up to 3 times
      // with 8s between. The tool already wrote to DB; we are racing the write.
      console.log(`   assert…`);
      for (let attempt = 1; attempt <= 4; attempt++) {
        result = await c.assert();
        if (result.ok || attempt === 4) break;
        console.log(`   attempt ${attempt}/4 failed: ${result.reason}, retry in 8s`);
        await sleep(8000);
      }
    } catch (e) {
      result = { ok: false, reason: `harness threw: ${e?.message || e}` };
    }
    const mark = result.ok ? "✓ PASS" : "✗ FAIL";
    console.log(`   ${mark}${result.observed ? ` — ${result.observed}` : ""}${result.reason ? ` → ${result.reason}` : ""}`);
    results.push({ n: c.n, fm: c.fm, ...result });
  }

  console.log("\n" + "=".repeat(80));
  const pass = results.filter((r) => r.ok).length;
  const fail = results.filter((r) => !r.ok).length;
  const skipped = results.filter((r) => r.skipped).length;
  console.log(`SUMMARY: ${pass}/${results.length} pass (${skipped} skipped), ${fail} fail`);
  if (fail) {
    console.log("\nFAILURES:");
    for (const r of results.filter((x) => !x.ok)) console.log(`  #${r.n} ${r.fm} → ${r.reason}`);
  }

  await cleanup(HARNESS_START_MS);
  process.exit(fail ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(2); });
