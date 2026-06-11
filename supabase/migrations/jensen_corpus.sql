-- SPEC 001 — Jensen's OpenAI export corpus.
-- Raw user-authored messages from 2.5 years of ChatGPT, tagged on two axes
-- (domain ∈ what it's about, intent ∈ what it's for). Embeddings deliberately
-- deferred: brain.ts owns the embed/retrieval layer for atomic facts; this
-- table holds bulk historical writing for voice analysis and topic recall.

create table if not exists public.jensen_corpus (
  id bigserial primary key,
  conv_id text not null,
  conv_title text,
  msg_id text not null,
  content text not null,                    -- redacted at ingest, raw PII flagged not stripped
  word_count int not null default 0,
  create_time timestamptz,                  -- when Jensen sent it in his ChatGPT thread

  -- two-axis taxonomy (see spec.md)
  domain text not null check (domain in (
    'upaya_festival',
    'sohum_consulting',
    'larencontre_fnb',
    'dharma_personal',
    'cloud_kitchen',
    'dubai_market',
    'partnerships_outreach',
    'content_marketing',
    'staff_hr',
    'personal_admin'
  )),
  intent text not null check (intent in (
    'polish',
    'draft',
    'plan',
    'legal',
    'comms',
    'social',
    'finance',
    'hr',
    'research',
    'study'
  )),

  contains_pii boolean not null default false,
  pii_kinds text[] not null default '{}',   -- e.g. ['phone','email','iban','emirates_id']

  source text not null default 'openai-export-2026-06-11',
  created_at timestamptz not null default now(),

  unique (conv_id, msg_id)
);

create index if not exists jensen_corpus_domain_idx on public.jensen_corpus (domain);
create index if not exists jensen_corpus_intent_idx on public.jensen_corpus (intent);
create index if not exists jensen_corpus_created_idx on public.jensen_corpus (create_time);
create index if not exists jensen_corpus_pii_idx on public.jensen_corpus (contains_pii) where contains_pii = false;
create index if not exists jensen_corpus_content_fts_idx on public.jensen_corpus using gin (to_tsvector('english', content));

-- RLS: server-only writes via service key. No client read paths for now.
alter table public.jensen_corpus enable row level security;
