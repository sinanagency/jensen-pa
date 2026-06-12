-- Jensen PA: race proof webhook dedupe (Architecture 2, 2026-06-12).
-- The kv array dedupe lost wamids under concurrent Meta retries; this table's
-- PRIMARY KEY makes the insert itself the atomic check. The route falls back
-- to kv until this is applied, so deploy order is flexible.
create table if not exists wa_seen (
  wamid text primary key,
  seen_at timestamptz not null default now()
);
-- Optional janitor (cron or manual):
-- delete from wa_seen where seen_at < now() - interval '7 days';
