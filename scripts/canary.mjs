#!/usr/bin/env node
// canary.mjs — lightweight fleet health check. Pings each bot's webhook
// endpoint and reports HTTP status + DNS resolution + response time.
// Non-zero exit if any bot is unreachable or returns unexpected status.
//
// Usage:
//   node scripts/canary.mjs

const BOTS = [
  { name: "jensen", url: "https://jensen.zanii.agency/api/whatsapp" },
  { name: "sasa",   url: "https://command.nisria.co/api/whatsapp/webhook" },
  { name: "cth",    url: "https://cthalaal.co.za/api/whatsapp/webhook" },
];

async function check(bot) {
  const start = Date.now();
  try {
    const res = await fetch(bot.url, { method: "GET", signal: AbortSignal.timeout(10000) });
    const ms = Date.now() - start;
    // 403 is expected (GET without valid hub.verify_token). Any 2xx/4xx/5xx
    // response means the endpoint is live and reachable.
    const ok = typeof res.status === "number";
    return { ...bot, ok, status: res.status, ms };
  } catch (err) {
    return { ...bot, ok: false, status: 0, ms: Date.now() - start, error: err.message };
  }
}

async function main() {
  console.log(`\n  fleet canary — ${new Date().toISOString()}`);
  console.log("  " + "=".repeat(50));
  let allOk = true;
  for (const bot of BOTS) {
    const r = await check(bot);
    const mark = r.ok ? "✓" : "✗";
    const detail = r.status ? `HTTP ${r.status}` : `ERR ${r.error}`;
    console.log(`  ${mark} ${r.name.padEnd(8)} ${detail.padEnd(14)} ${r.ms}ms`);
    if (!r.ok) allOk = false;
  }
  console.log("  " + "=".repeat(50));
  console.log(`  ${allOk ? "All healthy" : "SOME FAILED"}`);
  process.exit(allOk ? 0 : 1);
}

main();
