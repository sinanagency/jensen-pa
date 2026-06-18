create table if not exists health_checks (
  id bigint generated always as identity primary key,
  bot text not null,
  status text not null,
  error text,
  latency_ms int,
  inbound_last_5m int,
  inbound_baseline int,
  http_status int,
  checked_at timestamptz not null default now()
);

create index if not exists idx_health_checks_bot_ts on health_checks (bot, checked_at desc);
create index if not exists idx_health_checks_ts on health_checks (checked_at desc);

comment on table health_checks is 'Fleet monitor check log. One row per bot per 60s tick.';
comment on column health_checks.bot is 'one of: jensen, sasa, cth';
comment on column health_checks.status is 'ok | degraded | down';
