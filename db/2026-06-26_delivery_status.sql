-- Delivery-status capture for outbound WhatsApp (KT #206576).
-- Meta posts status webhooks (sent/delivered/read/failed) keyed by the message
-- wamid, which we already store on chat_messages.external_id. These columns let
-- the webhook record the real delivery lifecycle so "did it land?" is a column,
-- not a guess.
alter table chat_messages
  add column if not exists delivery_status text,
  add column if not exists delivery_at    bigint,
  add column if not exists delivery_error text;

-- external_id (wamid) is the join key for status updates; index it for the lookup.
create index if not exists chat_messages_external_id_idx on chat_messages (external_id);
