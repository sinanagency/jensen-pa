export const meta = {
  name: 'dorje-remediation-loop',
  description: 'Close all 13 amber + 4 red Dorje capabilities without breaking prod: seam-first TDD -> gate -> adversarial refute -> serialized hard-wall deploy -> synthetic-prod-fire verify -> re-badge tree. T1 client-facing items are staged for operator sign-off.',
  phases: [
    { title: 'Build', detail: 'per item: failing seam test first, minimal fix, npm run gate green, commit' },
    { title: 'Refute', detail: 'parallel skeptics try to BREAK each item (3 votes T1, 1 vote T2/T3)' },
    { title: 'Ship', detail: 'serialized deploy through the hard-wall gate + synthetic-prod-fire verify + re-badge; T1 staged' },
  ],
}

// ---- the work-list, in dependency-correct order (shared-file clusters serialized) ----
// tier: T3 obvious-bugfix | T2 internal | T1 client-facing/irreversible (staged, not auto-shipped)
const ITEMS = [
  { key: 'passive-claim',   tier: 'T2', files: ['lib/brain-core/honesty-guards*', 'lib/concierge/honest-reply.ts'],
    fix: 'Add a passive-claim guard: "<record> is now set/moved/changed/rescheduled to <date>" with NO successful date-edit tool this turn -> rewrite to honest reask. Key success on a NARROW set of Jensen-OWN date-mutating tool names (rebuild DATE_EDIT_TOOLS from lib/concierge/tools.ts, NEVER copy Sasa tool names - wrong names = silently rewrites true edits as lies, the #344 P0). Require "now"/change-verb so a pure status report ("set for July 3") never trips. Active arm requires completed first-person prefix (I have / I just) so "I will set..." / "should I set..." are excluded.',
    test: 'seam: honest-reply has a passive set/moved regex AND checks a date-edit tool ok===true before letting a passive date claim ship; keyed on Jensen tool names.',
    done: 'PURE-FUNCTION fire: honestReply("The Sotiris meeting is now moved to Friday.", []) -> honest rewrite; same reply WITH a successful update_event run -> passes through. No DB.' },

  { key: 'complete-event-verify', tier: 'T3', files: ['lib/concierge/ops.ts', 'lib/concierge/tools.ts'],
    fix: 'Verify-only + fix the STALE COMMENT (ops.ts ~204/213 says outcome="completed" while code writes the constraint-allowed "happened"). No behavior change.',
    test: 'seam: completeEvent writes outcome:"happened" (not "completed") and complete_event is in COMPLETION_TOOLS.',
    done: 'SYNTHETIC FIRE (0/32 rows ever set outcome): insert far-future test event, call completeEvent, re-query -> outcome==="happened" + note has [completed YYYY-MM-DD]. Delete row.' },

  { key: 'addevent-columns', tier: 'T2', files: ['lib/db.ts', 'lib/calendar-sync.ts', 'app/api/calendar/add/route.ts', 'app/mail/page.tsx'],
    fix: 'SAME root cause as KT #342: addEvent insert still omits source_message_id AND digital_u_status. Thread BOTH through addEvent param+insert, addEmailEvent (forward its messageId as sourceMessageId + accept digitalUStatus), the accept route, and confirm app/mail/page.tsx already sends digitalUStatus on accept. This also makes the digital_u_status "queued" poller path actually work (it was half-wired).',
    test: 'seam: addEvent insert body includes source_message_id AND digital_u_status; addEmailEvent forwards both.',
    done: 'SYNTHETIC FIRE: synthetic-accept a far-future invite (meetingUrl + messageId), query the event row -> source_message_id matches + digital_u_status==="queued"; GET /api/digitalu/pending shows it; delete row.' },

  { key: 'notetaker-failover', tier: 'T2', files: ['lib/digital-u.ts'],
    fix: 'Port Sasa mechanism ONLY (no Nisria content): meetingBotBases() reads MEETING_BOT_URLS comma-list (fallback MEETING_BOT_URL), de-duped; nodeHealthy(base) probes GET /health THEN /api/health (AbortSignal.timeout 5000); dispatchMeetingBot walks bases, skips unhealthy, POSTs /api/dispatch, returns on FIRST success (this is what guarantees never-two-notetakers). Keep MEETING_BOT_URL as fallback + cancelActiveBot single-base.',
    test: 'seam: digital-u references MEETING_BOT_URLS, /health, /api/health, .split(","), and still references MEETING_BOT_URL as fallback.',
    done: 'SYNTHETIC FIRE: MEETING_BOT_URLS="http://127.0.0.1:1/,<real>" in a test invocation, dispatch a synthetic meeting -> skips dead node, lands on real (engine returns job id / link-required 400). No prod data.' },

  { key: 'bare-ack', tier: 'T1', files: ['app/api/whatsapp/route.ts'],
    fix: 'Port Sasa #349 mechanism: ACK_ONLY regex (bare praise/thanks/emoji, $-anchored) placed AFTER the confirm/done-resolution block and BEFORE coalesceTurn/runConcierge. If owner-tier + !swipeAnchor + NO open pending_action awaiting confirm + ACK_ONLY matches -> short-circuit with a tiny Jensen-voice ack, return WITHOUT waking the brain. Must NOT swallow a real pending_action confirm (Law 8).',
    test: 'seam: whatsapp/route.ts has a bare-ack regex guard after done-resolution + before coalesceTurn, gated on owner + !swipeAnchor, returns without runConcierge.',
    done: 'SYNTHETIC FIRE via scripts/dev-ping.mjs: POST "thanks" and "👍" from the DEV number -> brain did NOT run (no new task/event, audit shows short-circuit); a real "yes" with an open pending_action still flows to confirm.' },

  { key: 'dispatch-dedup', tier: 'T1', files: ['lib/digital-u.ts', 'lib/mail-sweep.ts', 'app/api/whatsapp/route.ts'],
    fix: 'AFTER notetaker-failover + bare-ack land. Add normalizeMeetingUrl(url) to lib/digital-u.ts (strip query/fragment/trailing slash, lowercase host). Both the whatsapp-paste path (currently ZERO idempotency) and mail-sweep check+set a shared kv latch dispatch_latch:<eventId|normUrl> before dispatchMeetingBot. Keep mail-sweep m.id latch as secondary.',
    test: 'seam: digital-u exports normalizeMeetingUrl; mail-sweep AND whatsapp/route.ts both consult a shared dispatch_latch kv key before dispatch.',
    done: 'SYNTHETIC FIRE: far-future event with meetingUrl, drive two synthetic paths (paste + invite) for the SAME url -> dispatchMeetingBot invoked exactly ONCE (counter/latch + single heads-up). Delete rows.' },

  { key: 'recurrence-collision', tier: 'T2', files: ['app/api/cron/reminders/route.ts', 'lib/concierge/ops.ts'],
    fix: 'reminders route ~line 106: the recurrence collision query selects ANY event on nextDate; nextKey is computed but unused. Change to select id,title and compare normalizeEventTitleKey(r.title)===nextKey (same-title same-date) so a decoy event no longer suppresses the recurrence.',
    test: 'seam: recurrence block selects title on the next date AND compares normalizeEventTitleKey against nextKey before deciding collision.',
    done: 'SYNTHETIC FIRE: insert a far-future weekly recurring test event + a DIFFERENT-titled decoy on the next occurrence date; fire reminders handler -> recurrence still expands despite the decoy. Delete all.' },

  { key: 'morning-brief-selfheal', tier: 'T2', files: ['app/api/cron/reminders/route.ts', 'app/api/cron/daily/route.ts'],
    fix: 'AFTER recurrence-collision (same reminders file). Extract the daily brief send into an exported sendDailyBriefOnce() in daily route. In the reminders handler (runs every minute), after the reminder loop: if Dubai-hour >= 8 AND kv daily_brief:<today> is null AND onboarding===false -> call sendDailyBriefOnce() (owner-only, window/template branch) then markBriefSent. Re-check the marker to stay idempotent. Builds on the KT #341 instrument.',
    test: 'seam: reminders route imports the brief builder, reads daily_brief:<today> kv marker, has a >=8 Dubai-hour gate, filters role==="owner".',
    done: 'SYNTHETIC FIRE: with daily_brief:<today> marker absent + clock past 08:00 -> exactly one brief sends + marker written; with marker present -> zero sends. Verify via the audit row + kv marker.' },

  { key: 'monitor-rework', tier: 'T1', files: ['app/api/cron/monitor/route.ts'],
    fix: '(a) Alerts route to devPhone() ONLY, never owners()/Jensen. (b) Alert body uses opaque ids (node-1/2/3), NEVER the literal bot names (the "sasa" string trips Jensen own wall). (c) Cooldown keyed on a kv monitor_last_alert (NOT the per-minute degraded health_checks heartbeat). (d) Page only on real DOWN (http.ok===false / status>=500); quiet-night low-inbound degraded must NOT page.',
    test: 'seam: monitor references devPhone, does NOT send the alert to owners(), msg body has no /sasa|cth|jensen/i literal, reads/writes kv monitor_last_alert, gates paging on status==="down" separately from degraded.',
    done: 'SYNTHETIC FIRE: point one BOTS url at a guaranteed-503 in a test invocation -> alert lands on devPhone() only, body has no bot-name literal, second run within cooldown sends zero. Revert.' },

  { key: 'crm-verify', tier: 'T2', files: ['lib/concierge/dispatch.ts', 'lib/concierge/ops.ts'],
    fix: 'Verify-only (no code change unless a CRUD op silently fails). Confirm entity + contact create/read/update/delete are dispatch-wired and delete_contact requires confirm:true (Law 8).',
    test: 'seam: dispatch routes add/update/delete_contact + update_entity to ops.*; delete_contact requires confirm:true.',
    done: 'SYNTHETIC FIRE (live CRUD round-trip): create __TEST_ENTITY_<ts> + a test contact via ops, read-back each field, update one + assert, delete_contact{confirm:true} + assert gone. Delete entity.' },

  { key: 'shopify-quiqup-verify', tier: 'T1', files: ['lib/concierge/dispatch.ts', 'lib/concierge/tools.ts'],
    fix: 'Verify-only. Ensure store_summary returns {connected:false, note} honestly on no-store (never a fabricated zero, Law 6). Confirm Quiqup read returns live tracking not a stale mirror.',
    test: 'seam: store_summary returns connected:false honestly when Shopify unreachable (no fabricated totals).',
    done: 'LIVE READ FIRE (read-only): call ordersContext() against prod Shopify -> connected:true + order count/revenue reconciles to an independent Shopify Admin query (Law 6). Quiqup: one known delivery state matches Quiqup API. No writes.' },
]

const SAFETY = `HARD SAFETY PROTOCOL (every item obeys):
- Write the FAILING seam test in eval/integration/jensen-sweep-seams.test.mjs FIRST (next free seam.NN), then the minimal fix at the SAME node as the bug. Test the human-visible OUTPUT, not just that a function ran.
- Run \`npm run gate\` (typecheck + all seams) until GREEN. NEVER run \`npm run predeploy\` (it has an interactive Continue-anyway prompt that hangs). Commit with a clean tree.
- Read-only DB checks use /Users/milaaj/Code/jensen-pa/.env.prod (SUPABASE_URL + SERVICE key). Any synthetic write MUST be a far-future test row and MUST be deleted in the same run. Never message Jensen. Never hit a send/dispatch endpoint that reaches the client.
- "Sasa" = Nisria-only: port MECHANISM ONLY, never copy Sasa/Nisria/Maisha/AHADI strings, table names, tool names, or org facts (Jensen wall would drop them = a leak).`

phase('Build')
// Sequential build+gate+commit per item (shared files + one tree => no parallel edits). Zero prod risk: all local.
const built = []
for (const it of ITEMS) {
  const r = await agent(
    `${SAFETY}\n\nBUILD item "${it.key}" (${it.tier}) in /Users/milaaj/Code/jensen-pa.\nFiles: ${it.files.join(', ')}\nFIX: ${it.fix}\nSEAM TEST (write first): ${it.test}\nDeliver: the failing seam, then the fix, gate GREEN (paste the final NN/NN pass line), then \`git add\`+\`git commit\` (clean tree). Do NOT deploy. Do NOT push.`,
    { label: `build:${it.key}`, phase: 'Build', schema: {
      type: 'object', additionalProperties: false,
      required: ['key', 'gateGreen', 'committed', 'commit', 'summary'],
      properties: {
        key: { type: 'string' }, gateGreen: { type: 'boolean' }, committed: { type: 'boolean' },
        commit: { type: 'string' }, seam: { type: 'string' }, summary: { type: 'string' },
        blocked: { type: 'string', description: 'reason if it could not be built/gated; empty if fine' },
      } } }
  )
  built.push({ it, build: r })
  if (!r || !r.gateGreen) log(`build HALT: ${it.key} did not gate green (${r?.blocked || 'agent error'})`)
}

phase('Refute')
// Adversarial: separate skeptics try to BREAK each green item. 3 votes for T1, 1 for T2/T3.
const refuted = await parallel(built.filter(b => b.build && b.build.gateGreen).map(b => () => {
  const votes = b.it.tier === 'T1' ? 3 : 1
  return parallel(Array.from({ length: votes }, (_, i) => () =>
    agent(`Adversarially REFUTE item "${b.it.key}" (commit ${b.build.commit}) in /Users/milaaj/Code/jensen-pa. Default to BROKEN unless proven safe. Read the diff (\`git show ${b.build.commit}\`), the seam, and the touched files. Try to find: a regression in existing behavior, a way the new seam passes while the real OUTPUT is wrong, a fail-OPEN that should be fail-closed (or vice-versa), a shared-file collision, a leak of Sasa/dev/infra content, or a Law violation (persona/chokepoint/numbers/destructive-gate). Re-run \`npm run gate\` to confirm still green. Lens ${i + 1}/${votes}.`,
      { label: `refute:${b.it.key}:${i + 1}`, phase: 'Refute', schema: {
        type: 'object', additionalProperties: false, required: ['real', 'verdict'],
        properties: { real: { type: 'boolean', description: 'true = a REAL problem found' }, verdict: { type: 'string' } } }))
  ).then(vs => {
    const broken = vs.filter(Boolean).filter(v => v.real).length
    const survives = broken < Math.ceil(votes / 2)
    return { key: b.it.key, tier: b.it.tier, commit: b.build.commit, survives, broken, votes, build: b.build, done: b.it.done }
  })
}))

phase('Ship')
// Serialized: deploy survivors ONE at a time through the hard-wall gate + synthetic-fire verify + re-badge.
// T1 client-facing items are STAGED (committed + refuted, awaiting operator deploy-ok), never auto-shipped.
const report = []
for (const s of refuted.filter(Boolean)) {
  if (!s.survives) { report.push({ key: s.key, state: 'REFUTED-HALT', detail: `${s.broken}/${s.votes} skeptics found a real problem` }); continue }
  if (s.tier === 'T1') { report.push({ key: s.key, state: 'STAGED-FOR-SIGNOFF', commit: s.commit, detail: 'client-facing/irreversible: committed + refuted, awaiting operator deploy-ok' }); continue }
  const ship = await agent(
    `${SAFETY}\n\nSHIP item "${s.key}" (commit ${s.commit}) in /Users/milaaj/Code/jensen-pa.\n1) Ensure tree clean + on the commit. 2) Deploy: \`vercel --prod --yes\` (Vercel buildCommand re-runs the gate server-side; a red gate aborts and keeps the last good deploy live). 3) Confirm \`vercel inspect jensen.zanii.agency\` serves the new deploy + curl the webhook is up. 4) SYNTHETIC-FIRE VERIFY: ${s.done} 5) \`git push origin main\`. 6) Update ~/.claude/refs/trees/jensen/02-capability.md: flip this capability badge to the proven state with the commit + proof. Report exactly what you verified at the real boundary.`,
    { label: `ship:${s.key}`, phase: 'Ship', schema: {
      type: 'object', additionalProperties: false, required: ['key', 'deployed', 'verified', 'proof'],
      properties: { key: { type: 'string' }, deployed: { type: 'boolean' }, verified: { type: 'boolean' },
        deploymentUrl: { type: 'string' }, proof: { type: 'string' }, badge: { type: 'string' } } }
  )
  report.push({ key: s.key, state: ship && ship.verified ? 'SHIPPED-VERIFIED' : 'DEPLOY-UNVERIFIED', ...ship })
}

log('REMEDIATION LOOP COMPLETE')
return {
  built: built.map(b => ({ key: b.it.key, tier: b.it.tier, gateGreen: !!b.build?.gateGreen, commit: b.build?.commit, blocked: b.build?.blocked || '' })),
  shipped: report,
  blockedExternally: [
    'OpenAI key 401 (BUG-003) — needs a funded OPENAI_API_KEY in Vercel; semantic search + voice fallback stay degraded until then',
    'T4 transcribe tunnel — ephemeral *.trycloudflare.com; needs a stable named tunnel',
    'image-vision re-verify — needs a real inbound image to exercise',
  ],
}
