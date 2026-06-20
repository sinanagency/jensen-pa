# Jensen-PA · Bug Tracker & Build Status

**Last updated:** 2026-06-20
**Summary:** 14 bugs found and fixed + deployed in one session · 8 items open (hardening + capability)

Every fix went through: **FIND → FIX (one root cause) → tsc clean → 43 seam tests → DEPLOY (both domains) → VERIFY**.
Production: `jensen.larencontre.ae` + `jensen.zanii.agency` (same Vercel app).

---

## ✅ Fixed + Live

| #  | Bug (what the user felt)              | Root cause                          | Verify  | Commit  |
|----|----------------------------------------|-------------------------------------|---------|---------|
| 1  | Dead bot, replies to no one            | Anthropic API key expired (401)     | live    | (env)   |
| 2  | Treated Taona as Jensen / "Hey Taona"  | role `developer` ≠ `admin` in routing | live  | 87d41b3 |
| 3  | Fake "Done" + "(Honest note)" recant   | fail-open verify rail, appended note | live   | e9d6342 |
| 4  | Wrong dates in day summaries           | no date-bounded lookup; model guessed | live  | dd65d23 |
| 5  | Honesty rail ate correct summaries     | report tools policed as claims      | live    | 7d52939 |
| 6  | Went silent on errors (22:38 list)     | no fail-closed reply on inbound     | seam    | 9137314 |
| 7  | Double-saved every message             | chatAppend not idempotent on wamid  | live    | 9137314 |
| 8  | Meeting link never reached the reminder| reminder cron ignored `meeting_url` | seam    | 7eb6675 |
| 9  | Tried to join now → showed "unauthorized" | immediate note-taker dispatch     | live    | 7eb6675 |
| 10 | Save-link silently failed for weeks    | `time=is.not.null` invalid (HTTP 400) | live  | 822c8a7 |
| 11 | "Mark the meeting done" always failed  | `outcome='completed'` not in CHECK constraint | seam | effc092 |
| 12 | Could fake "I filed your document"     | draft-only tools were in COMPLETION_TOOLS | seam | effc092 |
| 13 | Contract showed "delivered" when it wasn't | status set even on send failure  | seam    | effc092 |
| 14 | Duplicate reminder spam                | send-before-latch + swallowed error | seam    | effc092 |
| +  | Nag-storm, lost-messages, fake meeting-notes | already fixed in earlier work | confirmed | (prior) |

**Verify legend:** `live` = drove a real signed message into the prod webhook and read the actual reply/DB row. `seam` = typecheck + structural test + matched against the real constraint/code (not live-tested to avoid pinging real phones).

---

## 🟠 Open · Hardening (silent-failure traps — fix when ready)

| ID | Risk                                        | Location          | Cause            |
|----|----------------------------------------------|-------------------|------------------|
| H1 | Fake "clean board" if a query errors         | daily/evening cron| swallowed catch  |
| H2 | Dedup fails OPEN → creates the duplicate      | ops.ts 73 / 176   | swallowed catch  |
| H3 | "Saved" sent without checking the write       | meeting-link patch| swallowed catch  |
| H4 | False "inbox clear" if all mail accounts fail | mail-provider     | swallowed catch  |

## 🔵 Open · Capability (separate tickets, bigger)

| ID | Gap                                                              |
|----|-------------------------------------------------------------------|
| C1 | ✅ FIXED — was NOT external auth. jensen-pa prod env was corrupt: `MEETING_BOT_URL="y\n"` + wrong key (`e89b29…`). Set correct `https://digitalu.zanii.agency` + key `c8a25c…`, verified auth against live digitalu (401→400 link-required), redeployed. KT #326. |
| C2 | Model auto-completes the WRONG task on vague input                 |
| C3 | Date math on WRITES (relative day → wrong calendar date)           |
| C4 | Confident-wrong on outside facts (model limitation)                |

---

## 🟢 Transcript deep-audit — 6 uncovered failures (Jun 16-19), now closed (KT #328)

An exhaustive re-read of all 167 messages found 6 trust-breaking failures the 14-bug
pass missed. Class A (the worst) is now a deterministic wall on the send chokepoint;
Class C is a persona prompt rule; Class B is honesty-rail-mitigated (model-level).

| # | Failure (what Jensen saw) | Class | Fix | Status |
|---|----------------------------|-------|-----|--------|
| L1 | "API tokens were drained… Taona caught it" — infra + dev name narrated to client | A leak | guards-config: `infra_*` drop patterns + `Taona` forbidden brand | ✅ ff0b20e |
| L2 | Literal "test" message + "earlier test… NOT actually sent… ignore" recant on his phone | A leak (Law 10) | `test_artifact_only` + `test_recant` drop patterns | ✅ ff0b20e |
| L3 | "Password: Dorje2026!" plaintext + "sanad.zanii.agency" pushed to a La Rencontre client | A leak (Law 3/9) | `plaintext_credential`/`login_credential` drop + `zanii`/`sanad` forbidden brands | ✅ ff0b20e |
| L4 | "What time works for Jensen?" said TO Jensen (3rd-person owner) | C persona | system-head rule: 2nd-person only, never 3rd-person the owner | ✅ ff0b20e |
| L5 | "No email from Sotiris" after it had surfaced Sotiris emails itself | B consistency | honesty rail + search-before-asking; residual model risk | 🟡 mitigated |
| L6 | Two different timestamp lists for the same "recovered" messages | B consistency | honesty rail; residual model risk | 🟡 mitigated |

**Wall proof:** all 7 real transcript leak strings → dropped + `pre_send_caught` alert; all 5 legit messages (incl. "Morning, Jensen" and "driving test") pass clean. 52/52 seams, tsc clean, deployed jensen-7bevw25xy.

---

## 🟢 Transcript 2nd-lens re-audit — 3 parallel lenses (omissions / numbers / tone), KT #329

Ran 3 more adversarial passes. Verified every concrete claim before acting (2 turned out false).

| Finding | Verdict | Action |
|---------|---------|--------|
| "Fabricated nag-hours (98h/114h)" | ❌ FALSE — nag feature already deleted from code | none |
| "Frozen/templated board counts" | ❌ FALSE — briefs compute counts live (`listTasks().length`); board truly didn't change | none |
| Meetings claimed "saved ✅" but absent from calendar (Bouchara, "Sunday"-person) | ✅ REAL (verified in prod) | Bouchara (Sun 21 11:00) restored in prod; "Sunday"-person was Fri 19, now past |
| Open-loops: bot raises questions/offers/stale items and never closes them (contracts sat 4d, false all-clear, dropped offers) | ✅ REAL theme | slice built: stale-Q1 age-tags in brief + "close your own loops / no hollow all-clear" persona rule. Full open-loop tracker DEFERRED |
| Persona: anxious attendant, not senior peer (telegram reminders, intake-clerk Qs, over-apology) | ✅ REAL theme | slice built: BE-THE-PEER persona block. Deep retrain DEFERRED |

**Shipped:** commit 5cbdb3f, deploy jensen-euuct93kg, 54/54 seams. **Deferred (named, not dropped):** full open-loop engine + deep persona retrain → own session.

---

## 🟢 Hardening done (this session, H1–H4 + integration)

| ID | Fix                                                            | Commit  |
|----|-----------------------------------------------------------------|---------|
| H1 | Briefs say "couldn't read your board" instead of fake "clean"   | daf7bd2 |
| H2 | Dedup logs the failure (kept fail-open: duplicate > lost task)   | daf7bd2 |
| H3 | Meeting-link checks the write before saying "Saved"             | daf7bd2 |
| H4 | aggregateInbox throws if ALL accounts fail (no false "clear")    | daf7bd2 |
| I1 | All 8 inbound paths converge on ONE chat row (idempotent grow)   | d159c1a |
| I2 | complete_event added to COMPLETION_TOOLS (rail collision fix)    | 0cd2c9a |
| A1 | Autonomous join now works for ad-hoc + happening-now meetings (was future-only); dispatch awaited so Vercel can't SIGTERM it; ack reflects real result, never a promised-but-unqueued join | 64a81c4 |

## 🟢 Autonomous meeting-join leg — verified seam by seam (2026-06-20)

Root cause of the dead leg was NOT external auth (C1 myth). Two corrupt env vars (`MEETING_BOT_URL="y\n"` + wrong key) — fixed + redeployed, KT #326. Then the whole leg was walked end to end:

| Seam | State | Proof |
|------|-------|-------|
| Credential handshake (jensen-pa → digitalu) | ✅ | live: bad key 401, correct key `link required` 400 |
| Callback URL/key config (`JENSEN_PUBLIC_URL`, `INGEST_KEY`) | ✅ | both set; `INGEST_KEY` round-trips by construction (same key both sides) |
| digitalu callback sender (`postCallback`) | ✅ | code: posts `x-api-key: callbackKey` to callbackUrl |
| jensen-pa `/api/ingest` auth + handling | ✅ | live: wrong key 401, right key `transcript required` 400 (no ping) |
| Engine join + capture + summarize | ✅ | real history: 3 `done` records incl. 2 Jensen meetings 17 Jun |
| Dispatch behavior (ad-hoc/now/future + awaited) | ✅ | A1 fix, 49/49 seams, tsc clean, deployed 64a81c4 |
| Live audio round-trip on a Jensen meeting | ⏳ | needs a real meeting (Taona declined a test); every seam around it is proven, so the first real meeting is the live proof |

## Integration review (final gate) — PASS

All of the night's fixes were traced as a SET across the whole codebase (not just
individually). 7 of 8 interactions composed cleanly; **1 cross-fix regression found
and fixed**: complete_event now succeeds (fix #5) but wasn't a completion tool, so
the honesty rail (fix #2) rewrote "marked done" into "I have not done that yet" —
fixed by I2. Verified: honesty-rail vs draft tools, chatAppend grow vs swipe-anchor,
routing vs day_log, latch-before-send, meeting-link scope, silent-drop catch scope.
tsc clean · 48 seam + 26 + 7 tests green · dead verify.ts removed.

## Verified clean (audited, no action needed)
Finance (VAT 5% + corp tax 9% over 375k) math correct and traced · email sends from the correct mailbox · Shopify orders real · voice/image intake honest on failure · all 59 tools wired · no other broken PostgREST queries.
