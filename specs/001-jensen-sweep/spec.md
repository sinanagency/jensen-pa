# Spec — Jensen Sweep v1

> 001-jensen-sweep. Equivalent of Sasa 727 v1.x for La Rencontre / Rencontre bot.
> Authored 2026-06-07/08 during the autonomous sweep session.

## Problem

Jensen cancelled Memorae because it ran 11 specific failure modes (see
`~/.claude/refs/trees/jensen/01-failure-modes.md`), most severe being:
reflex-loop confirmations that never actually executed, "Copy of X" reminder
duplication, inability to reschedule a past-time reminder, multi-list
confusion despite his stated "only one list" contract, and a sterile refusal
to handle anything outside its narrow scope.

Jensen-PA / Rencontre is architecturally further along than the 04 June
audit assumed: 52 tools, 38 ops functions, RRF-hybrid brain recall,
anti-fake-done verifier, soft-dedup on tasks AND events (with explicit
"Memorae's worst bug" code comment), one-brain WA + portal parity. The
risk is not "needs porting" — it is **untested cold-input behavior**.

This sweep proves the bot can deliver, end-to-end, on every capability
Memorae promised AND failed to deliver, AND on the richer surface Jensen
has on top (UAE finance, doc generation, mail triage). The output is a
unlock decision backed by green eval + prod harness + cold-input phone
trial.

## Outcome (with metrics)

A: Every leaf in `01-failure-modes.md` passes its eval test (target 11/11
green; minimum to unlock 10/11 with the 11th deliberately deferred and
documented).

B: Every cell in `02-capability.md` that was 🟡 wired+needs-eval flips to
✅ wired+verified — OR is downgraded to 🔴 with a Phase 3 fix queued and
re-verified.

C: The persona prompt rewrite per `04-persona-tone.md` lands in
`lib/concierge/loop.ts:buildSystem` and survives a doctrine-reviewer pass.

D: A 48-hour soak window with the production crons enabled (but outbound
to Jensen still walled) shows zero false-positive draft messages — the
watchdog cron verifies green every 30 minutes.

E: Cold-input trial from Taona's real phone hits every capability category
with fresh vocabulary, transcript saved, no failure-mode regression
observed.

## Scope

In:
- The 11 Memorae failure-mode tests + their fixes
- Persona system-prompt rewrite to peer-counsel tone
- Seam-level integration tests on architectural promises (verifier, dedup,
  chokepoint, RRF, tool dispatch)
- Prod harness (synthetic Meta webhook battery against jensen.zanii.agency)
- Cold-input phone trial
- 48h soak with watchdog cron + outbound walled
- Doctrine-reviewer + Qwen adversarial diff before each merge
- Unlock with `MAINTENANCE_MODE=0` + `JENSEN_MODE=LIVE` (or unset)

Out (explicit non-goals for this sweep, deferred to v2 with doc):
- Recurring reminder daemon (Memorae had it, Jensen doesn't yet — Phase 4
  carries a deferred design note, not code)
- Snooze button affordances (WA list message interactivity)
- Daily evening check-in cron
- Google Calendar 2-way sync activation (requires Jensen OAuth consent
  per PRD §8)
- Server-side multi-device sync for any portal surface that today reads
  localStorage only (assessed in Phase 1 03-data.md; if any exist, log
  for v2)
- Onboarding tour rebuild (already classy in code, accept as-is)

## User flow (the proof Jensen will run)

```
day 0  Jensen receives unlock notice from Rencontre on WhatsApp
       (single message, signed in first person, says "I am back online,
       here is what is new.")
       Jensen opens jensen.larencontre.ae from his phone, lands on
       login, signs in.
day 0  Jensen sends "morning, what is on" to the bot on WhatsApp.
       → Rencontre returns the morning brief, named entities (Sohum,
         Surf, Pixel Stamp, Cafe), 3 things that matter, one coaching
         note, no em-dashes, no exclamation marks.
day 0  Jensen says "add to q1, finalise Sohum agenda" → one task row
       created, reply confirms with id, no draft loop, no Copy-of-X
       duplicate.
day 0  Jensen sends a voice note describing a fresh client call.
       → transcript filed, salience auto-captured into brain_facts,
         no fake-done claim about scheduling unless he asked.
day 0  Jensen sends a screenshot of a contract.
       → filed to docs, classified, RAG-searchable from "what did that
         contract say about payment terms"
day 1  Jensen asks "give me my updated list, what is left for this week"
       → grouped by quadrant, ordered consistently, same data Jensen
         sees on the portal.
day 1  Jensen says "move the Sohum thing to Friday" — no past-time loop.
day 1  Jensen asks "what color is the moon" — warm 2-line answer, then
       gentle pivot back to his world.
day 7  Jensen has used the bot daily, the brain has grown via salience
       capture, the morning brief references things he has actually
       worked on, he has not had a single "you are useless" moment.
```

## Non-goals (this PR, not this sweep)

- Onboarding rebuild
- A new portal surface
- Multi-tenant productization (JENSEN-DOCTRINE Law 9 — single-tenant
  until productization, which is a separate project)
- Memorae UI replication (e.g. button affordances, "Done / Remind me in 1
  hour / Remind me tomorrow" buttons) — model + tool framing replaces
  buttons; if interactive list messages are needed they get their own ADR

## Open questions

All six pre-Phase-0 questions answered by Taona on 2026-06-07. Carried
notes:
- Drafts queue at unlock: review + sign-off (Phase 6 step)
- Soak window: 48 hours, watchdog continuous-verify (Phase 5)

No new open questions at spec time.

## 11 golden-set test cases

These map 1:1 to `01-failure-modes.md` FM-01 through FM-11. Each becomes a
prod-harness battery entry in Phase 4 and a seam-check entry in Phase 2
where the architecture (not the model) enforces it.

(Numbered identically to make cross-walks trivial.)

## Pipeline

This work is Tier 1 (full): SPEC (this doc) → ADR-0001 (the
"don't port the brain, audit it" call) → SCHEMA-CHECK (additive only,
documented in ADR) → EVAL (seam tests + failing prod harness) → CODE
(surgical, one fix per commit) → SOAK (48h).

Doctrine reviewer (`~/.claude/agents/doctrine-reviewer.md` analogue in
this repo: `.claude/agents/doctrine-reviewer.md`) gates every merge.
Qwen adversarial diff (`qclaude` route to Qwen3-Coder on DGX node 03)
runs on each fix tier per HOW-TO-SWEEP step 5.

## Done definition

Unlock means: maintenance flags off, the bot live, the drafts queue
reviewed and dispositioned, the report at `~/Desktop/jensen-sweep-report.md`
filed, knowledge-tree nodes appended, Jensen has been told he is back.
