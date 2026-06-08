-- sanad_pending_drafts.sql
-- In-flight Sanad contract drafts that the cron poller delivers when ready.
--
-- Lifecycle:
--   1. Bot tool sanad_draft_contract calls Sanad's /api/v1/contract/draft, gets a job_id.
--   2. Row inserted here with status='queued' + recipient_wa (the user's WA number).
--   3. Bot tells the user "I'll have that ready in two minutes."
--   4. Cron /api/cron/sanad-deliver runs every minute, polls each row's job_id.
--   5. When Sanad reports ready, cron downloads the PDF and calls sendTextAndLog
--      to upload the document to the user's WA, then marks delivered_at.
--   6. Row remains for the portal /legal tab + audit; auto-purged after 30 days.
--
-- Run this migration manually in Jensen's Supabase SQL editor before deploy.

create table if not exists sanad_pending_drafts (
  id              uuid primary key default gen_random_uuid(),
  job_id          text not null unique,                 -- Sanad's job_id
  recipient_wa    text not null,                        -- user's WhatsApp E.164
  requested_by    text,                                 -- internal context (Jensen / contact name)
  kind            text not null,                        -- 'nda' etc
  jurisdiction    text not null,
  status          text not null default 'queued',       -- queued, processing, ready, delivered, failed
  poll_url        text,                                 -- mirror of Sanad's poll_url
  last_polled_at  timestamptz,
  ready_at        timestamptz,
  delivered_at    timestamptz,
  delivered_msg_id text,                                -- sendTextAndLog message id for audit
  failure_reason  text,
  pdf_url         text,                                 -- Sanad-hosted pdf URL once ready
  metadata        jsonb default '{}'::jsonb,            -- {party_a_name, party_b_name, effective_date}
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index if not exists sanad_pending_drafts_status_idx on sanad_pending_drafts (status, last_polled_at);
create index if not exists sanad_pending_drafts_recipient_idx on sanad_pending_drafts (recipient_wa, created_at desc);

comment on table sanad_pending_drafts is 'Sanad v1 contract-draft jobs awaiting delivery to a WhatsApp recipient.';
