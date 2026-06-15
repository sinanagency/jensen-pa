-- 2026-06-16, Jensen swipe-reply anchor (Wall 1 of bug-family "fragment match
-- without anchor"; KT #229 wall-at-primitive doctrine, sibling of Sasa's
-- 20260615_swipe_reply_anchor migration and KT #293).
--
-- When Jensen uses WhatsApp's swipe-to-reply on a Dorje message, Meta's
-- inbound payload carries messages[].context.id, the wamid of the quoted
-- outbound. Until this change the webhook ignored it and the concierge saw
-- free-floating text like "done" with no anchor, so the LLM matcher fuzzed
-- and sometimes picked the wrong task or event.
--
-- This adds two columns on chat_messages:
--   external_id          the Meta wamid for a row (outbound: returned by the
--                        Graph send; inbound: from messages[].id). Until now
--                        no row carried it, so a quoted-message lookup was
--                        impossible. Required for Wall 1 to function.
--   reply_to_external_id the wamid of the message the user reply-quoted, set
--                        only on inbound rows whose payload had m.context.id.
--                        Lookup at turn time joins reply_to_external_id ->
--                        external_id to recover the quoted Dorje outbound.
--
-- Indexes:
--   uq_chat_messages_external is a UNIQUE index on external_id WHERE NOT NULL.
--     Partial so the existing million-row history (all NULL) does not bloat the
--     index, and so future outbound writes can collide-detect on duplicate
--     wamid (defensive: Meta should never return the same wamid twice).
--   idx_chat_messages_reply_to_external is a btree on reply_to_external_id
--     WHERE NOT NULL, used by the worker join.
--
-- Migration must be applied BEFORE any code that references these columns
-- ships, or the webhook insert will throw 42703 column does not exist and
-- ingress fails silently. (Lesson paid on Sasa 2026-06-15: code first, migration
-- never; every swipe-reply turn went deaf for hours.)
alter table public.chat_messages
  add column if not exists external_id text;

alter table public.chat_messages
  add column if not exists reply_to_external_id text;

create unique index if not exists uq_chat_messages_external
  on public.chat_messages (external_id)
  where external_id is not null;

create index if not exists idx_chat_messages_reply_to_external
  on public.chat_messages (reply_to_external_id)
  where reply_to_external_id is not null;
