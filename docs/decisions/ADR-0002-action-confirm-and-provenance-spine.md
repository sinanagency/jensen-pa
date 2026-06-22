# ADR-0002 — The action-confirm layer + the dorje_actions provenance spine

Status: Accepted (design); implementation phased.
Date: 2026-06-23
Context source: CRCC master-loop Pass 1 (21-agent swarm) + orchestrator verification. Class Registry C1–C5 (`~/.claude/refs/trees/jensen/class-registry.md`). KT #206556.

## Context

Pass 1 proved, on real code, that two doctrine laws are effectively unenforced:

- **Law 8 (tool-call safety / `pending_action`)** has **0 lines of implementation** (`grep pending_action lib app` = 0). The only gate is `destructiveGate` (`dispatch.ts:103-114`) checking `input.confirm === true` — a field the **model supplies on itself**. `loop.ts:257-283` re-feeds the gate's "retry with confirm:true" error as a tool_result, so the model can self-confirm in the same turn with no user reply. **Class C1: model-must-call-its-own-tool.**
- **No durable record of what Dorje actually did.** `runs[]` lives only inside one `runConcierge` call and is never persisted; honesty (`honest-reply.ts`), idempotency, and "did I already" all read a single turn. `sendTextAndLog` logs the row BEFORE the Meta send (Law 2) and patches delivery best-effort (not atomic), so a guard reading `chat_messages` can claim "sent" when it wasn't. **Classes C3 (polluted-source provenance) + C4 (this-turn-only state).**

Concrete live exposure: `sanad_draft_contract` is absent from the gated set and `cron/sanad-deliver:101` ships the PDF to a caller-supplied `recipient_wa` with `{force:true}` — a single (or prompt-injected) message can send a contract PDF to an arbitrary number. **Class C2: trust-the-caller's-destination** (today's sanad lock was on the wrong door — the inbound `/api/ingest/sanad`, not this send seam).

## Decision

Build, in phases, two linked primitives at their convergence nodes:

1. **`pending_actions` confirm layer (Law 8, real).** A durable table: `id, tool, args jsonb, party, surface, proposed_inbound_id, status (pending|confirmed|executed|expired), confirm_inbound_id, created_at, expires_at`. `destructiveGate` STOPS returning a self-confirmable error: it writes a `pending` row keyed to the proposing inbound and returns an echo+ask. Execution happens via a **deterministic confirm-router** (not the model) that fires only when a *distinct* inbound confirms (`confirm_inbound_id != proposed_inbound_id`). This structurally kills self-confirm.

2. **`dorje_actions` provenance spine.** The send chokepoint and tool dispatch write verified outcomes (`dispatched|delivered|failed`, `wamid`) to a durable, append-only record. Honesty/idempotency read THIS, not the turn or the pre-send log. Dissolves C3 + C4 and feeds C1/C2 recipient resolution.

Recipient validation for sends (C2) moves to the **send seam** (`recipient_resolved` set server-side at confirm time, not from raw LLM `recipient_wa`); the seam drops `{force:true}` for non-owner recipients.

## Rejected alternatives

- **Lock sanad recipient to Jensen only** (the obvious extension of today's fix). REJECTED: the Blue skeptic proved sanad's purpose is to send a draft to an external counterparty (party_b) for signature; a Jensen-only lock SUPPRESSES the true use case. The control is a *confirm*, not a recipient allowlist.
- **Allowlist = existing contacts.** REJECTED: `add_contact` is LLM-callable inline (`tools.ts:57`), so the allowlist is caller-writable in the same turn — no real constraint.
- **Keep the model-confirm gate, just add more tools to it.** REJECTED: self-confirm defeats it; gating `create_task` on `quadrant===1` reads a model-controlled field (circular) and suppresses legitimate Q1 tasks.
- **Durable table keyed on `turn_id`.** REJECTED (State-auditor): semantically identical to `runs[]` at the honest-reply node — must key on the durable action + verified outcome to actually change the decision semantic.
- **Rewrite the whole confirm flow in one shot.** REJECTED: it changes how EVERY destructive tool confirms; a bug means Jensen can't confirm anything (covenant: better, never worse). Phase it behind the green seam net + live-prove.

## Phasing

- **Phase 0 (this session, no migration, non-breaking):** add `sanad_draft_contract` to the confirm-gated set — same proven flow as `send_email`. Strictly reduces the live exposure (a contract can no longer be silently enqueued) without touching the working confirm flow, the counterparty use case, or `{force:true}`. Partial mitigation of C1; C1 stays OPEN.
- **Phase 1:** `pending_actions` table + migration (Taona runs) + deterministic confirm-router + gate rewrite to bind confirm to a distinct inbound. Closes C1. Behind the green net, live-proven, fail-safe if the table is absent.
- **Phase 2:** `dorje_actions` provenance spine; move recipient validation to the send seam (C2); honesty/idempotency read the durable record (C3/C4).

## Consequences

Confirmations become operator-anchored, not model-asserted; "I sent X" becomes a projection of verified state. Cost: two migrations Taona runs, and a deterministic confirm-router added to the webhook path. Until Phase 1 ships, C1 is OPEN (mitigated) — tracked loud in the Class Registry, not rounded up to fixed.
