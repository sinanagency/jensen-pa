-- Recurring events: weekly, monthly, or yearly cadence on calendar events.
-- When a recurring event fires, the reminders cron creates the next occurrence.
-- recurrence.until is the last date the recurrence should produce rows (inclusive).

alter table public.events
  add column if not exists recurrence text
    check (recurrence is null or recurrence in ('weekly', 'monthly', 'yearly'));

alter table public.events
  add column if not exists recurrence_until date;
