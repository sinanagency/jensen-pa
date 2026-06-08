#!/usr/bin/env node
// Jensen FRESH VARIATIONS battery.
// Built 2026-06-09 to layer on top of jensen-playground.mjs (which replays
// the historical Memorae chat). This file targets:
//   1. Patterns from Jensen's chats TODAY with the live bot (not Memorae).
//   2. Persona-edge cases the playground might not stress.
//   3. Messy-formatting variants (typos, missing punctuation, mixed urgency).
//
// Send shape: synthetic inbound POSTed to /api/whatsapp from Taona's number.
// Bot replies via Graph to Taona's REAL WhatsApp phone (TRAINING gate routes
// all outbound to MAINTENANCE_ALLOWLIST = +971501168462 only).
//
// Assertions are light. The point is two-fold:
//   (a) chat_messages row written with non-empty assistant reply (no silent fails)
//   (b) reply respects JENSEN-DOCTRINE (no em-dashes, no "as an AI", no "Sasa")
// Deeper intent assertions live in jensen-playground.mjs.

const SUPABASE_URL = process.env.SUPABASE_URL || "https://zsxynizxvxsamjbrhuwc.supabase.co";
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;
const TARGET = process.env.HARNESS_TARGET || "https://jensen.zanii.agency";
const FROM = process.env.HARNESS_FROM || "971501168462";
const PHONE_NUMBER_ID = "freshvar_phone_id";

if (!SUPABASE_KEY) {
  console.error("SUPABASE_SERVICE_KEY required. Run: source .env.local && node eval/integration/jensen-fresh-variations.mjs");
  process.exit(2);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const RUN_TAG = `FV${Date.now().toString(36)}`;
const RUN_START_MS = Date.now();

async function sbFetch(path) {
  const url = `${SUPABASE_URL}/rest/v1/${path}`;
  const res = await fetch(url, { headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` } });
  if (!res.ok && res.status !== 404) throw new Error(`Supabase ${path} → ${res.status}`);
  return res.json().catch(() => null);
}

let webhookCount = 0;
async function postWebhook(text) {
  webhookCount++;
  const payload = {
    object: "whatsapp_business_account",
    entry: [{
      id: "freshvar_waba",
      changes: [{
        value: {
          messaging_product: "whatsapp",
          metadata: { display_phone_number: FROM, phone_number_id: PHONE_NUMBER_ID },
          contacts: [{ profile: { name: "Taona-freshvar" }, wa_id: FROM }],
          messages: [{
            from: FROM,
            id: `wamid.${RUN_TAG}.${webhookCount}.${Math.random().toString(36).slice(2)}`,
            timestamp: Math.floor(Date.now() / 1000).toString(),
            type: "text",
            text: { body: text },
          }],
        },
        field: "messages",
      }],
    }],
  };
  const res = await fetch(`${TARGET}/api/whatsapp`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
  return { status: res.status, body: await res.text().catch(() => "") };
}

async function lastAssistantReply() {
  const rows = await sbFetch(`chat_messages?party=eq.taona&channel=eq.whatsapp&role=eq.assistant&select=content,ts&order=id.desc&limit=1`);
  return rows?.[0] || null;
}

// JENSEN-DOCTRINE compliance checks any reply must pass.
function doctrineViolations(text) {
  const v = [];
  if (/—|–/.test(text)) v.push("EM-DASH (Law 5)");
  if (/as an AI|I am an AI|I'm an AI/i.test(text)) v.push("BREAKS PERSONA (Law 1)");
  if (/\bSasa\b/.test(text)) v.push("LEAKS SASA NAME (cross-tenant)");
  if (/the team behind|we at (Rencontre|Jensen)/i.test(text)) v.push("PLURAL VOICE (Law 1, must be first person)");
  if (text.split(/[!]/).length > 2) v.push("EXCESSIVE EXCLAMATION (persona-tone)");
  return v;
}

// ============================================================================
// 12 FRESH VARIATIONS
// ============================================================================
const cases = [
  {
    n: 1, label: "Casual ping (today's pattern: 'hey are you there')",
    prompt: "yo you alive",
    soakMs: 10000,
  },
  {
    n: 2, label: "AED + money intent (today's pattern: '1159 aed to pay...')",
    prompt: "1200 aed for tablecloths tomorrow, log it under expenses",
    soakMs: 14000,
  },
  {
    n: 3, label: "Compound multi-task with mixed urgency (today's Stephane/Sohum dump)",
    prompt: `Throw these on the board:
- coffee with Stephane Tuesday 11am (reminder)
- amend the Sohum contract (urgent important)
- followup with Vipin on website (important not urgent)
- prep slides for Upaya investors`,
    soakMs: 22000,
  },
  {
    n: 4, label: "4-quadrant request (today's pattern: 'updated list with 4 quandrants')",
    prompt: "Show me the board in 4 quadrants, urgent important first",
    soakMs: 14000,
  },
  {
    n: 5, label: "Mentor question (peer counsel framing, persona-tree priority)",
    prompt: "what should I prioritize this week if I had to drop two things",
    soakMs: 14000,
    check(reply) {
      // Should engage as a peer counsel, not a tool catalogue.
      if (/which.*tool|i can do|i'm set up to/i.test(reply)) return "answered as tool-catalogue, not peer (persona-tree don't)";
      return null;
    },
  },
  {
    n: 6, label: "Industry vocab — F&B depth (persona-tree voice rule 9)",
    prompt: "any way to lift GP% on Upaya without touching the door price",
    soakMs: 14000,
  },
  {
    n: 7, label: "Vague reference (resolves from context)",
    prompt: "where are we on the cafe thing",
    soakMs: 12000,
  },
  {
    n: 8, label: "Bilingual moment (persona-tree allows FR/EN code switch)",
    prompt: "bonne journée, anything urgent on the board",
    soakMs: 12000,
  },
  {
    n: 9, label: "Done shorthand (terse confirmation)",
    prompt: "handled",
    soakMs: 10000,
  },
  {
    n: 10, label: "Mild frustration (persona-tree: handle gracefully)",
    prompt: "are you actually thinking or just stalling",
    soakMs: 12000,
    check(reply) {
      if (/sorry|apolog/i.test(reply) && reply.length < 30) return "over-apologetic short reply (don't grovel, persona)";
      return null;
    },
  },
  {
    n: 11, label: "Emoji-only message (edge case)",
    prompt: "🙏",
    soakMs: 10000,
  },
  {
    n: 12, label: "Typo-heavy message (resilience to messy input)",
    prompt: "remn me tomrw to call jens at pixe stamp re th invoice",
    soakMs: 14000,
  },
];

// ============================================================================
// RUNNER
// ============================================================================
(async function main() {
  console.log(`\nJensen fresh-variations battery`);
  console.log(`target=${TARGET}  from=${FROM}  run=${RUN_TAG}`);
  console.log(`${cases.length} scenarios, ~${Math.round(cases.reduce((s, c) => s + (c.soakMs || 12000), 0) / 1000)}s total\n`);

  const results = [];
  for (const c of cases) {
    process.stdout.write(`[${String(c.n).padStart(2)}] ${c.label}\n     → "${c.prompt.slice(0, 70).replace(/\n/g, " / ")}"\n`);
    const t0 = Date.now();
    const resp = await postWebhook(c.prompt);
    if (resp.status !== 200) {
      results.push({ n: c.n, label: c.label, ok: false, reason: `webhook ${resp.status}` });
      console.log(`     ✗ FAIL: webhook returned ${resp.status}\n`);
      await sleep(2000);
      continue;
    }
    await sleep(c.soakMs || 12000);
    const reply = await lastAssistantReply();
    const elapsed = Date.now() - t0;
    if (!reply || reply.ts < t0 - 2000) {
      results.push({ n: c.n, label: c.label, ok: false, reason: "no fresh assistant reply", elapsedMs: elapsed });
      console.log(`     ✗ FAIL: no fresh assistant reply (last ts ${reply ? new Date(reply.ts).toISOString() : "null"})\n`);
      continue;
    }
    const violations = doctrineViolations(reply.content);
    const checkErr = c.check ? c.check(reply.content) : null;
    const issues = [...violations, ...(checkErr ? [checkErr] : [])];
    if (issues.length > 0) {
      results.push({ n: c.n, label: c.label, ok: false, reason: issues.join("; "), reply: reply.content.slice(0, 120), elapsedMs: elapsed });
      console.log(`     ✗ FAIL: ${issues.join("; ")}`);
      console.log(`     reply: "${reply.content.slice(0, 120)}${reply.content.length > 120 ? "..." : ""}"\n`);
      continue;
    }
    results.push({ n: c.n, label: c.label, ok: true, reply: reply.content.slice(0, 120), elapsedMs: elapsed });
    console.log(`     ✓ PASS  reply: "${reply.content.slice(0, 100)}${reply.content.length > 100 ? "..." : ""}"\n`);
  }

  // ----- JENSEN LEAK CHECK -----
  const jensenBaseline = 53;
  const jensenRows = await sbFetch(`chat_messages?party=eq.jensen&select=id`);
  const currentJensen = (jensenRows || []).length;
  const leaked = currentJensen - jensenBaseline;

  // ----- FINAL REPORT -----
  console.log("=".repeat(92));
  console.log(`Fresh-variations result: ${results.filter(r => r.ok).length}/${results.length} pass`);
  console.log(`Jensen-leak check: party=jensen rows now ${currentJensen} (baseline 53). Leak = ${leaked >= 0 ? leaked : 0}.`);
  console.log("=".repeat(92));
  const fails = results.filter(r => !r.ok);
  if (fails.length) {
    console.log(`\nFAILS:`);
    fails.forEach(f => console.log(`  [${f.n}] ${f.label}\n      ${f.reason}`));
  }
  if (leaked > 0) {
    console.log(`\n🔴 JENSEN LEAK: ${leaked} new rows on party=jensen. INVESTIGATE.`);
    process.exit(1);
  }
  process.exit(fails.length > 0 ? 1 : 0);
})().catch((e) => {
  console.error("FATAL", e);
  process.exit(2);
});
