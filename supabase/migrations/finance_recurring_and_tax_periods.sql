-- Correction 3: Finance module additions
-- source column on finance (manual | receipt | recurring)
alter table public.finance
  add column if not exists source text not null default 'manual'
    check (source in ('manual', 'receipt', 'recurring'));

alter table public.finance
  add column if not exists receipt_url text;

-- Recurring expenses: set once, log each period automatically
create table if not exists public.recurring_expenses (
  id           text primary key,
  label        text not null,
  amount_aed   numeric(14,2) not null,
  frequency    text not null default 'monthly'
    check (frequency in ('monthly', 'quarterly', 'annual')),
  day_of_month integer not null default 1,
  vat_applies  boolean not null default false,
  entity       text,
  next_due     date not null,
  active       boolean not null default true,
  created_at   bigint not null default (extract(epoch from now()) * 1000)::bigint
);

alter table public.recurring_expenses enable row level security;

create policy "service role full access recurring_expenses"
  on public.recurring_expenses
  for all
  using (true)
  with check (true);

-- Tax periods: VAT quarters
create table if not exists public.tax_periods (
  period          text primary key,   -- e.g. '2026-Q1'
  vat_payable_aed numeric(14,2) not null default 0,
  status          text not null default 'open'
    check (status in ('open', 'filed', 'paid')),
  created_at      bigint not null default (extract(epoch from now()) * 1000)::bigint
);

alter table public.tax_periods enable row level security;

create policy "service role full access tax_periods"
  on public.tax_periods
  for all
  using (true)
  with check (true);
