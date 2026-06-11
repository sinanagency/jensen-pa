-- SPEC 001 follow-up — paste-back flag.
-- Some "user" messages in the OpenAI export are not Jensen's own composition:
-- they're text he pasted into ChatGPT to ask for a polish (his previous draft,
-- a forwarded email, a Watts quote, a contract clause GPT wrote earlier in the
-- thread that he wants refined). These contaminate voice extraction because the
-- emergent vocabulary is GPT's, not his.
--
-- Heuristics: em-dashes / en-dashes (Jensen does not type these natively) and
-- length > 400 words in a single user turn. Both are conservative. Flagged not
-- dropped so RAG can still surface them if asked, while voice modelling only
-- pulls authentic messages.
alter table public.jensen_corpus add column if not exists looks_pasted boolean not null default false;
create index if not exists jensen_corpus_authentic_idx on public.jensen_corpus (created_at) where looks_pasted = false;
