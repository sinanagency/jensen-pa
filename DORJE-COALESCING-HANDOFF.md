# HANDOFF: Durable per-sender message coalescing for Dorje (jensen-pa)

> Paste this whole file into the jensen-pa driver session. It is the spec to port the
> proven Sasa fix to Dorje. You are the **one driver** for the `jensen-pa` Vercel
> project. Build test-first, fail-open, deploy via `vercel --prod`, apply the migration
> to jensen-pa's Supabase, verify. Do not claim "live" without a curl/probe.

## The bug (same one that hit Sasa)
A contact sends two quick WhatsApp messages ("you're cool" then "thanks") and Dorje
replies **twice** (two independent brain runs, one per inbound message). The unit of
work must be the **conversational turn** (a burst of rapid messages), not the single
message. One burst -> one reply.

## Root cause (verified on Sasa, same applies here)
Every inbound message triggers its own `runConcierge` -> its own reply. brain-core's
`shouldProcess` HAS a per-sender lock, but it is an **in-memory `Map`**
(`PROCESSING_LOCKS = new Map()` in `lib/brain-core/webhook-guard.js`). On Vercel
serverless, memory does **not** survive across invocations, so the lock never holds
across the separate function calls that process each message. `shouldProcess` only
de-dups identical wamids; it does **not** coalesce a sequential burst. A lock is only
as durable as its backing store. **The fix must be Postgres-backed, not in-memory.**

## The proven reference (Sasa — read these, same machine)
The identical fix is already live on Sasa. Read it as the template:
- `/Users/milaaj/Code/nisria-techops/platform/lib/whatsapp-coalesce.ts` — the claim/assemble/finish logic
- `/Users/milaaj/Code/nisria-techops/platform/db/migrations/20260620_wa_turn_claim.sql` — the durable claim table
- `/Users/milaaj/Code/nisria-techops/platform/eval/integration/sasa-message-coalescing-wall.test.mjs` — the test seams
- KT #327 in `~/.claude/refs/knowledge-tree.md` — the decision record

**Do NOT copy Sasa's code verbatim.** Sasa uses a job-queue worker keyed by `contact_id`.
jensen-pa is **inline** and keyed by the sender phone. Adapt as below.

## jensen-pa specifics (verified)
- **Inline processing:** `app/api/whatsapp/route.ts` runs `recentHistory()` -> `runConcierge()` -> `sendWhatsApp()` all inside the webhook request. There is NO job queue to defer.
- **Already imports** `shouldProcess, mediaArrived from "@/lib/brain-core/index.js"` (line ~15) and already does an in-request settle-wait for the media buffer — your coalesce settle-wait follows the SAME pattern.
- **Chat store:** `chat_messages` table (`role, content, channel, ts`), written via `admin().from("chat_messages").insert(...)` and `lib/db.ts` `recordTurn`. History loaded via `recentHistory(party)` where party is `"jensen"` (owner) or `"taona"` (dev).
- **Sender identity:** `from` (the WhatsApp phone string) + `sender` (from `whoIs`). There is NO `contact_id`. **Key the claim by `from`.**
- **Dedup:** `wa_seen` table (wamid PRIMARY KEY), atomic insert. KEEP THIS INTACT.
- **Deploy wire:** `.vercel/project.json` -> project `jensen-pa`. Deploy = `cd ~/Code/jensen-pa && vercel --prod`.
- **DB:** jensen-pa's own Supabase (read `SUPABASE_URL` + service key from `.env.local`). The migration below applies HERE, not to Nisria.

## The adapted mechanism (inline + durable claim, keyed by sender)
1. Webhook saves the inbound to `chat_messages` and inserts the wamid into `wa_seen` (UNCHANGED — keep dedup).
2. **Acquire a durable claim:** `INSERT INTO wa_turn_claim (sender, expires_at, ...)`. The PK on `sender` makes a concurrent insert a `23505` unique_violation.
   - **Loser** (claim already held, not expired): the message is already saved to `chat_messages`, so just **return 200 without replying**. The holder will coalesce it.
   - **Winner** (insert succeeded, or the prior claim was expired and you overwrote it): proceed.
3. **Settle:** the winner waits a short quiet window (~5–7s) in-request (same shape as the existing `shouldProcess` media-buffer `setTimeout`/`setInterval` wait). During this window, loser invocations land, save their text to `chat_messages`, and bail.
4. **Assemble + reply once:** after settling, reload `recentHistory()` (now contains the whole burst), run `runConcierge()` **once**, `sendWhatsApp()` **once**, then **release the claim** (`DELETE FROM wa_turn_claim WHERE sender = ...`).
5. `expires_at` TTL (~90s) self-heals a crashed winner so a sender can never be wedged into silence.

## HARD REQUIREMENTS (non-negotiable)
1. **Durable only** — the claim lives in Postgres (`wa_turn_claim`), never an in-memory Map. That is the entire point.
2. **FAIL-OPEN — never go silent.** Wrap the whole coalesce path in try/catch. If ANYTHING throws (table missing, query error, settle error), fall through to the CURRENT behavior: process this one message and reply. A coalescer bug must degrade to *double-reply* (noisy), NEVER to *no reply* (silent). This is the honesty law. Prove it with a revert test (inject a `return` into the catch -> the fail-open seam goes RED).
3. **Exactly-once** — exactly one reply per burst. Losers return without sending. The winner is the only writer that calls `sendWhatsApp` for the burst.
4. **Migration is load-bearing — check the live DB.** `wa_turn_claim` does not exist in jensen-pa's DB yet. The fail-open path means a forgotten migration degrades to per-message (no silence), but coalescing stays OFF until applied. Apply it, then probe-insert to confirm (HTTP 201), then delete the probe. (This is the KT #316/#323/#325/#327 trap: a new table the live DB rejects = silently inactive feature.)
5. **Keep `wa_seen` dedup intact.** Do not replace it. Coalescing is a separate, additional durable mechanism.
6. **Watch Meta webhook timeout.** Inline settle adds ~5–7s before the 200. jensen-pa already holds the request during `runConcierge`, so this is the same order of magnitude, but confirm the route's `maxDuration` (vercel function config) comfortably exceeds settle + brain time, and that `wa_seen` absorbs any Meta retry during the hold.

## The migration (apply to jensen-pa's Supabase, NOT Nisria's)
```sql
-- wa_turn_claim for jensen-pa (Dorje) — durable per-sender turn coalescing.
-- Keyed by sender phone (jensen-pa has no contact_id). Idempotent.
CREATE TABLE IF NOT EXISTS public.wa_turn_claim (
  "sender"      text PRIMARY KEY,
  "claimed_at"  timestamp with time zone NOT NULL DEFAULT now(),
  "expires_at"  timestamp with time zone NOT NULL,
  "claimed_by"  text,
  "trace_id"    text
);
CREATE INDEX IF NOT EXISTS wa_turn_claim_expires_idx
  ON public.wa_turn_claim (expires_at);
ALTER TABLE public.wa_turn_claim ENABLE ROW LEVEL SECURITY;
```
Run it in jensen-pa's Supabase SQL editor. (RLS on + service-role-only access; the
webhook uses the service key, anon is denied — consistent with the fleet RLS lockdown.)

## Test-first (write the wall BEFORE the code)
Create `eval/integration/dorje-message-coalescing-wall.test.mjs` (pure-local source-seam
harness: read the `.ts` source as strings, `fail()`/`ok()`, `WALL GREEN`/`WALL RED`,
`process.exitCode`). Seams:
- **S1** the reply path no longer fires unconditionally per message — there is a per-sender claim gate before `runConcierge`/`sendWhatsApp`.
- **S2** the claim is DURABLE — a `wa_turn_claim` DB insert, NOT an in-memory Map.
- **S3** the winner re-reads ALL recent inbound (turn assembly) before replying, not just the current message.
- **S4** FAIL-OPEN — a try/catch around the coalesce path that falls back to the normal single-message reply on error (prove with inject-return -> RED -> revert -> GREEN).
- **S5** exactly-once — the loser path returns without calling `sendWhatsApp`.
Run RED first, implement, GREEN. Keep existing walls + the brain-core-drift/ingress
tests green. `npx tsc --noEmit` -> 0 errors.

## Ship sequence
1. Build test-first (wall RED -> implement -> GREEN), `tsc` clean.
2. Commit locally (Taona's repos default to "leave it local" unless he says push).
3. Apply the migration in jensen-pa's Supabase SQL editor.
4. Probe-insert a `wa_turn_claim` row (expect HTTP 201), delete it (204) — proves the table.
5. `cd ~/Code/jensen-pa && vercel --prod` — confirm the alias/READY, curl the prod URL.
6. Log a KT node mirroring Sasa's #327 (cite "same as KT #327").
7. Soak: watch the coalesce events (mirror Sasa's `whatsapp.coalesced` / `coalesce_noop` /
   `coalesce_fail_open`, or whatever you name them) and confirm a two-line burst collapses to one reply.

## One-driver rule
You are the sole driver of the `jensen-pa` Vercel + Supabase project for this change.
Do not let another session touch jensen-pa concurrently. The Nisria/Sasa session that
wrote this handoff is NOT touching jensen-pa.
