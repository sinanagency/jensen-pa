-- events.reminded_at: ms timestamp the reminder cron pinged Jensen.
-- NULL = not yet reminded. Once set, never fire again for that event.
-- Bigint to match the row's existing created_at convention (ms since epoch).
alter table public.events
  add column if not exists reminded_at bigint;

create index if not exists events_reminder_scan_idx
  on public.events (date)
  where reminded_at is null;
