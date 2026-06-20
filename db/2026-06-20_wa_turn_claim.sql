-- wa_turn_claim for Dorje (jensen-pa) — durable per-sender turn coalescing.
-- Ported from Sasa's fix (KT #327). Keyed by SENDER PHONE (jensen-pa has no
-- contact_id). The PRIMARY KEY on sender makes a concurrent second insert a
-- 23505 unique_violation = the loser, so exactly one winner coalesces a burst.
-- Idempotent: safe to run repeatedly.
CREATE TABLE IF NOT EXISTS public.wa_turn_claim (
  "sender"      text PRIMARY KEY,
  "claimed_at"  timestamp with time zone NOT NULL DEFAULT now(),
  "expires_at"  timestamp with time zone NOT NULL,
  "claimed_by"  text,
  "trace_id"    text
);

CREATE INDEX IF NOT EXISTS wa_turn_claim_expires_idx
  ON public.wa_turn_claim (expires_at);

-- Service-role-only access (the webhook uses the service key; anon is denied),
-- consistent with the fleet RLS lockdown.
ALTER TABLE public.wa_turn_claim ENABLE ROW LEVEL SECURITY;
