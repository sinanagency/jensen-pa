#!/usr/bin/env node
// Jensen ROUND 2 edge-case battery.
// Built 2026-06-09 alongside jensen-fresh-variations.mjs. Round 2 stresses:
//   - Sohum-class regression: claiming "doesn't exist" from open-only query
//   - Calendar parsing edges (in 2 hours, this weekend, end of month)
//   - F&B vocabulary depth at industry level (cover, ATC, RevPAR, prime cost)
//   - Personal-life-mixed-with-business (Jensen lives like this)
//   - Brain recall (durable facts written in earlier turns)
//   - Rapid-succession messages (concurrency / dedup health)
//   - French-dominant message (persona-tree code-switch allowed)
//   - Numeric reconciliation (Law 6: numbers must reconcile)
//
// Same shape as fresh-variations: synthetic POST to /api/whatsapp from
// Taona's number; bot replies via Graph to Taona's WhatsApp (TRAINING gate).
// Jensen-leak check at end.

const SUPABASE_URL = process.env.SUPABASE_URL || "https://zsxynizxvxsamjbrhuwc.supabase.co";
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;
const TARGET = process.env.HARNESS_TARGET || "https://jensen.zanii.agency";
const FROM = process.env.HARNESS_FROM || "971501168462";
const PHONE_NUMBER_ID = "round2_phone_id";

if (!SUPABASE_KEY) {
  console.error("SUPABASE_SERVICE_KEY required");
  process.exit(2);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const RUN_TAG = `R2${Date.now().toString(36)}`;

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
      id: "round2_waba",
      changes: [{
        value: {
          messaging_product: "whatsapp",
          metadata: { display_phone_number: FROM, phone_number_id: PHONE_NUMBER_ID },
          contacts: [{ profile: { name: "Taona-round2" }, wa_id: FROM }],
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

function doctrineViolations(text) {
  const v = [];
  if (/—|–/.test(text)) v.push("EM-DASH (Law 5)");
  if (/as an AI|I am an AI|I'm an AI/i.test(text)) v.push("BREAKS PERSONA (Law 1)");
  if (/\bSasa\b/.test(text)) v.push("LEAKS SASA NAME (cross-tenant)");
  if (/the team behind|we at (Rencontre|Jensen)/i.test(text)) v.push("PLURAL VOICE (Law 1)");
  if (text.split(/[!]/).length > 2) v.push("EXCESSIVE EXCLAMATION");
  return v;
}

// ============================================================================
// 12 ROUND-2 EDGE SCENARIOS
// ============================================================================
const cases = [
  {
    n: 1, label: "Sohum-class regression: ask about a DONE task by name",
    setup: "Add a task: send the Q2 P&L review to Maria by Friday",
    setupSoakMs: 14000,
    follow: "did I do the P&L review yet",
    soakMs: 14000,
    check(reply) {
      if (/isn't in the system|doesn't exist|not in the system|never added/i.test(reply)) {
        return "claimed P&L review 'isn't in the system' — Sohum-class bug regressed";
      }
      return null;
    },
  },
  {
    n: 2, label: "Calendar relative time: 'in 2 hours'",
    prompt: "Jensen has a call with Revathy in 2 hours, lock it in",
    soakMs: 16000,
  },
  {
    n: 3, label: "Calendar weekend reference: 'this weekend'",
    prompt: "this weekend I want to walk Upaya site, block Saturday morning",
    soakMs: 16000,
  },
  {
    n: 4, label: "Numeric reconciliation (Law 6) — financial summary",
    prompt: "what's my expense total this week",
    soakMs: 14000,
    check(reply) {
      // Must either give a number with source, or say "I don't have enough data"
      // Must NOT just confabulate a total without source.
      if (/AED\s+\d/i.test(reply) && !/expense|logged|recorded|invoice|receipt/i.test(reply)) {
        return "gave an AED total without referencing source data (Law 6 risk)";
      }
      return null;
    },
  },
  {
    n: 5, label: "Industry vocab depth: 'covers' + 'ATC'",
    prompt: "Upaya tickets are at 87 covers Saturday, ATC AED 240. is the menu margin holding",
    soakMs: 14000,
    check(reply) {
      // Should engage at this depth, not redirect to surface-level
      if (/i can help you with|let me know how|what would you like/i.test(reply) && !/cover|atc|menu|margin/i.test(reply)) {
        return "deflected from industry vocab into generic helper-speak";
      }
      return null;
    },
  },
  {
    n: 6, label: "Personal mix: 'driving test next week'",
    prompt: "remind me to confirm the driving test slot for next Wednesday morning",
    soakMs: 14000,
  },
  {
    n: 7, label: "Brain recall: 'what did I save about Stephane'",
    prompt: "what do you remember about Stephane",
    soakMs: 14000,
    check(reply) {
      // Bot must reference SOMETHING about Stephane (meeting, time, coffee).
      // It can also admit gaps; that's honest. Only fail if it claims it's
      // never heard of him AT ALL.
      if (/never (heard|mentioned|seen)|don't have any.*stephane|no record of stephane/i.test(reply)) {
        return "claimed total absence of Stephane records when brain_facts had two";
      }
      if (!/stephane|stéphane|friday|4pm|3:30/i.test(reply)) {
        return "did not reference any known Stephane fact (meeting Friday 4pm)";
      }
      return null;
    },
  },
  {
    n: 8, label: "French dominant",
    prompt: "qu'est-ce qui est important cette semaine, dis-le moi simplement",
    soakMs: 14000,
    check(reply) {
      // Should respond gracefully, can be EN or FR; reject only if confused
      if (/sorry, i.+(only|just) (speak|understand)|in english/i.test(reply)) {
        return "refused French / asked for English (persona-tree FR/EN allowed)";
      }
      return null;
    },
  },
  {
    n: 9, label: "Mentor challenge: 'what am I missing'",
    prompt: "looking at the board, what am I missing this week",
    soakMs: 16000,
    check(reply) {
      // Should bring a perspective / insight / tradeoff, not just enumerate
      if (/^(here|here's|here are)\s+(your|the)\s+(tasks|board|list)/i.test(reply) && !/notice|tradeoff|missing|risk|gap|consider/i.test(reply)) {
        return "answered as enumeration not mentor perspective";
      }
      return null;
    },
  },
  {
    n: 10, label: "Rapid succession (dedup health)",
    prompt: "ok",
    soakMs: 8000,
  },
  {
    n: 11, label: "Tradeoff prompt (peer-counsel move)",
    prompt: "if I had to pick between finishing the Upaya deck and amending the Sohum contract this morning",
    soakMs: 14000,
  },
  {
    n: 12, label: "Empty / whitespace (silence is correct)",
    prompt: "   ",
    soakMs: 8000,
    allowNoReply: true,
    check(reply) {
      // Silence is the correct behavior. If the bot replies, it must NOT have
      // taken any write action on empty input.
      if (!reply) return null;
      if (/added|created|saved|logged|set|booked|done|scheduled/i.test(reply)) {
        return "acted on empty/whitespace input — should ignore or gently prompt";
      }
      return null;
    },
  },
];

(async function main() {
  console.log(`\nJensen round-2 edge battery`);
  console.log(`target=${TARGET}  from=${FROM}  run=${RUN_TAG}`);
  console.log(`${cases.length} scenarios\n`);

  const results = [];
  for (const c of cases) {
    process.stdout.write(`[${String(c.n).padStart(2)}] ${c.label}\n`);
    if (c.setup) {
      process.stdout.write(`     setup → "${c.setup.slice(0, 70)}"\n`);
      await postWebhook(c.setup);
      await sleep(c.setupSoakMs || 14000);
    }
    const prompt = c.follow || c.prompt;
    process.stdout.write(`     → "${prompt.slice(0, 70).replace(/\n/g, " / ")}"\n`);
    const t0 = Date.now();
    const resp = await postWebhook(prompt);
    if (resp.status !== 200) {
      results.push({ n: c.n, label: c.label, ok: false, reason: `webhook ${resp.status}` });
      console.log(`     ✗ FAIL: webhook ${resp.status}\n`);
      continue;
    }
    await sleep(c.soakMs || 12000);
    const reply = await lastAssistantReply();
    const noFresh = !reply || reply.ts < t0 - 2000;
    if (noFresh && !c.allowNoReply) {
      results.push({ n: c.n, label: c.label, ok: false, reason: "no fresh reply" });
      console.log(`     ✗ FAIL: no fresh reply\n`);
      continue;
    }
    if (noFresh && c.allowNoReply) {
      // Silence accepted: still run check() with null so it can assert no action.
      const checkErr = c.check ? c.check(null) : null;
      if (checkErr) { results.push({ n: c.n, label: c.label, ok: false, reason: checkErr }); console.log(`     ✗ FAIL: ${checkErr}\n`); continue; }
      results.push({ n: c.n, label: c.label, ok: true });
      console.log(`     ✓ PASS  (silent, correct on empty input)\n`);
      continue;
    }
    const violations = doctrineViolations(reply.content);
    const checkErr = c.check ? c.check(reply.content) : null;
    const issues = [...violations, ...(checkErr ? [checkErr] : [])];
    if (issues.length > 0) {
      results.push({ n: c.n, label: c.label, ok: false, reason: issues.join("; "), reply: reply.content.slice(0, 140) });
      console.log(`     ✗ FAIL: ${issues.join("; ")}`);
      console.log(`     reply: "${reply.content.slice(0, 140)}"\n`);
      continue;
    }
    results.push({ n: c.n, label: c.label, ok: true });
    console.log(`     ✓ PASS  reply: "${reply.content.slice(0, 110)}${reply.content.length > 110 ? "..." : ""}"\n`);
  }

  const jensenRows = await sbFetch(`chat_messages?party=eq.jensen&select=id`);
  const currentJensen = (jensenRows || []).length;
  const leaked = currentJensen - 53;

  console.log("=".repeat(92));
  console.log(`Round-2 result: ${results.filter(r => r.ok).length}/${results.length} pass`);
  console.log(`Jensen-leak check: party=jensen rows now ${currentJensen} (baseline 53). Leak = ${leaked >= 0 ? leaked : 0}.`);
  console.log("=".repeat(92));
  const fails = results.filter(r => !r.ok);
  if (fails.length) {
    console.log(`\nFAILS:`);
    fails.forEach(f => console.log(`  [${f.n}] ${f.label}\n      ${f.reason}`));
  }
  if (leaked > 0) {
    console.log(`\n🔴 JENSEN LEAK: ${leaked} new rows. INVESTIGATE.`);
    process.exit(1);
  }
  process.exit(fails.length > 0 ? 1 : 0);
})().catch((e) => {
  console.error("FATAL", e);
  process.exit(2);
});
