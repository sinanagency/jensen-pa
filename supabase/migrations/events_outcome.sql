-- events.outcome: meeting CONTENT state, orthogonal to digital_u_status.
-- digital_u_status answers "did the bot reach the room" (queued/dispatched/
-- attended/failed/skipped). outcome answers "did the conversation actually
-- yield substance" (happened/empty/awaiting_human_verdict/resolved_by_email).
--
-- Two separate axes because they can disagree: the bot can be 'attended'
-- (recording uploaded fine) AND outcome 'empty' (other side never showed,
-- silent recording). The 2026-06-12 Zomato incident at 17:00 was exactly
-- this shape: dispatch worked, recording captured, but Jatin never spoke.
-- The bot at /api/ingest then said "I finished + here are notes" because
-- there was no state distinguishing "captured substance" from "captured
-- silence" — see KT #234 and the post-incident chat at 17:23.
--
-- States:
--   null                      = pre-meeting OR meeting hasn't yielded a verdict yet
--   'happened'                = substantive content captured, tasks extracted
--   'empty'                   = bot joined but content was below substance threshold
--                               (e.g., < 60s audio, transcript < 500 chars, no notes)
--   'awaiting_human_verdict'  = bot asked the operator if it happened, waiting reply
--   'resolved_by_email'       = other party reached out via email instead;
--                               mail-autopilot can flip this when it sees a
--                               counterparty message that resolves the question
--
-- The partial index supports "find me past meetings still waiting for a
-- verdict" without scanning every event row.

alter table public.events
  add column if not exists outcome text
  check (outcome is null or outcome in ('happened','empty','awaiting_human_verdict','resolved_by_email'));

create index if not exists events_outcome_pending_idx
  on public.events (date, time)
  where outcome in ('empty','awaiting_human_verdict');
