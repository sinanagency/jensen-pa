# Dorje (jensen-pa) — BUG MASTER

> Open issues found but **deliberately not fixed** before the operator went away.
> Each was judged too risky to patch right before going dark (a bad change has no one
> to catch it). Fix on return, in priority order. Source: the 6-agent pre-departure
> skeptic sweep, 2026-06-21 (KT #339).
>
> **Status legend:** 🔴 fix first · 🟡 fix soon · 🟢 low / accept for now
> **Severity = blast radius if it bites while unattended.**

---

## BUG-001 — Watchdog is blind (monitor cron never alerts, would leak/spam if naively fixed)
- **Severity:** 🔴 high (you are NOT auto-paged if the bot dies while away)
- **Status:** OPEN — flagged, not changed
- **Where:** `app/api/cron/monitor/route.ts` (~lines 113-129)
- **What's wrong (three faults, must fix together):**
  1. **Self-suppressed:** the alert cooldown reads the last *degraded `health_checks` row* (`lastAlerts.data?.[1]`), but a degraded heartbeat is written **every minute**, so the cooldown is *always* active → the `[fleet monitor]` WhatsApp alert has **never fired** (zero alert rows in the DB, ever).
  2. **Would leak to the client:** the alert sends to `owners()` = `OWNER_WHATSAPP`, which **includes Jensen**. If the cooldown were naively fixed, Jensen would receive internal `[fleet monitor] jensen: degraded` messages — an internal-monitoring leak to the client.
  3. **False-positive degradation:** it flags `jensen: degraded` whenever Jensen simply isn't texting (low inbound vs baseline) — i.e. every quiet night. Fixing the cooldown alone would **spam you** with "Jensen is quiet" non-alerts.
- **Why deferred:** a one-line cooldown fix makes #2 and #3 *worse* (leak + spam). Needs a real rework, not a rushed patch.
- **Proposed fix (on return):**
  - Track the last *alert actually sent* in `kv` (e.g. `kv['last_fleet_alert_ts']`), not the heartbeat rows, for the cooldown.
  - Route the alert to **`devPhone()` only** (the developer), never `owners()` — same protect-the-client routing as KT #338.
  - Distinguish **DOWN** (webhook unreachable / brain throwing — real outage) from **degraded** (low inbound = normal quiet). Only page on real DOWN.
- **How to confirm it's broken now:** `select count(*) from chat_messages where content ilike '%fleet monitor%'` → 0.

---

## BUG-002 — Mail-sweep auto-joins ANY emailed meeting invite (no human confirm)
- **Severity:** 🟡 medium (a phishing / wrong-tenant invite = Digital Jensen joins a stranger's call + sends Jensen notes from it)
- **Status:** OPEN — flagged; **operator may want this gated before leaving** (ask)
- **Where:** `lib/mail-sweep.ts` (~lines 223-262), the auto-latch / `dispatchMeetingBot` block, runs every 5 min via `/api/cron/mail-triage`.
- **What's wrong:** any inbound email whose body parses to a `meetingUrl + date + time` triggers an **automatic** dispatch of Digital Jensen to that meeting, with **no confirm** — only a "reply skip" heads-up *after* it's scheduled. Unattended, a spam/phishing/wrong-tenant calendar invite that parses cleanly = the bot joins an unknown call as "Digital Jensen", records it, and WhatsApps Jensen an extracted-task summary from someone else's meeting.
- **Current exposure:** dormant (`lr_dispatch_latched` count = 0, no pending joins, no future `meeting_url` events). Idempotent + capped, so it won't loop/storm. But it is the **one path that acts on the outside world with no human in the loop.**
- **Proposed fix:** gate the auto-dispatch behind (a) an explicit Jensen confirm, OR (b) a known-sender allowlist (sender in `contacts`), OR (c) disable the auto-latch block and require a pasted link. Recommend (b) as the balance.

---

## BUG-003 — OpenAI key dead in prod (voice notes degraded)
- **Severity:** 🟢 low (degrades gracefully, no crash)
- **Status:** OPEN — needs a valid key (not available to the agent)
- **Where:** prod env `OPENAI_API_KEY` (Vercel) → used by `lib/transcribe.ts` (voice transcription fallback) + `lib/openai.ts` (embeddings for document semantic search).
- **What's wrong:** the prod `OPENAI_API_KEY` returns **HTTP 401** (revoked). Effects: (1) voice notes can't be transcribed → the bot can't "hear" voice notes; (2) document uploads still save but fall back to **keyword search** instead of semantic (handled gracefully at `route.ts:262`). No crash either way.
- **Related risk:** `TRANSCRIBE_PRIMARY_URL` is an **ephemeral `*.trycloudflare.com` quick tunnel** — it will vanish on any T4 restart and won't auto-recover at the same address. Combined with the dead OpenAI fallback, **voice intake is effectively gone** until both are restored.
- **Proposed fix:** swap a funded `OPENAI_API_KEY` into Vercel prod + redeploy; move the transcribe URL behind a stable named tunnel (not a quick tunnel).

---

## Verified HEALTHY in the same sweep (no action needed)
Anthropic brain (Vercel prod key live, 200) · WhatsApp token (permanent system-user, never expires) · Supabase · coalescing (fail-open, 90s TTL, no wedge) · webhook (fail-closed) · data integrity (32 events, sane upcoming reminders) · meeting-bot no-fabrication guard + ingest auth · mute off · TRAINING off · the un-skippable pre-deploy gate (caught a bad edit this session).

---

*Created 2026-06-21 from the pre-departure skeptic sweep (KT #339). Update this file as bugs are fixed; move resolved ones to a `RESOLVED.md` or strike them with the fixing commit.*
