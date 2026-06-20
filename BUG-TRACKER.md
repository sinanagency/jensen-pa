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
| C1 | Note-taker can't actually JOIN meetings (Teams/Zoom auth fails)    |
| C2 | Model auto-completes the WRONG task on vague input                 |
| C3 | Date math on WRITES (relative day → wrong calendar date)           |
| C4 | Confident-wrong on outside facts (model limitation)                |

---

## Verified clean (audited, no action needed)
Finance (VAT 5% + corp tax 9% over 375k) math correct and traced · email sends from the correct mailbox · Shopify orders real · voice/image intake honest on failure · all 59 tools wired · no other broken PostgREST queries.
