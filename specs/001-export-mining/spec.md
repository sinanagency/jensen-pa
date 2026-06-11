# SPEC 001 — OpenAI Export Mining for Rencontre

**Status:** in build (2026-06-11)
**Tier:** 2 (internal feature, settled architecture, fully reversible)
**Owner:** Taona (operator) + Rencontre bot (consumer)

## Problem

Rencontre (the jensen-pa concierge) currently knows Jensen through 56 hand-imported brain_facts and his recent activity in the bot. He has 2.5 years of his own thinking, drafting, and decision-making in his OpenAI/ChatGPT archive that the bot has never seen. Every conversation Jensen starts with Rencontre right now begins from near-zero on his world.

He just handed over his full OpenAI data export (1,180 conversations, 9,485 messages, 271,283 words of his own writing). We need to ingest it without breaking doctrine.

## Outcome

When Jensen messages Rencontre after the ingest:
1. Rencontre can write in Jensen's voice well enough that a draft he asks for feels like he wrote it himself.
2. Rencontre can answer "what have I said about X" for any major topic in Jensen's archive (Upaya, Sohum, cloud kitchens, dharma, contracts, partnerships, etc).
3. Rencontre has ~200-300 distilled atomic facts about his world added to brain_facts via the existing pipeline.

Measured by:
- Voice-quality smoke test: 10 hand-crafted prompts (draft a partnership note, polish this email, etc) → Rencontre's output passes Jensen's "did this sound like me?" check on at least 8/10.
- Corpus recall test: 10 targeted queries → jensen_corpus returns relevant messages on at least 9/10.
- Fact distillation precision: ≥90% of facts written to brain_facts are correct and non-redundant with existing 56.

## Scope (this spec)

In:
- New `jensen_corpus` table (raw user messages + topic tags, no embeddings yet)
- PII redaction at ingest time (phones, emails, IDs, IBANs) — flagged not stripped
- Domain + intent two-axis tagging from inventory-driven rules
- Voice extraction → `JENSEN-VOICE.md` (vocab, opening/closing patterns, em-dash audit, polite formulas)
- Reuse of existing `lib/concierge/brain.ts` + `brain_facts` for distilled facts (tomorrow's work)

Out (deferred):
- Voyage-3 embeddings (existing brain uses OpenAI text-embedding-3 — staying on it)
- CRM seed from extracted entities (Phase 3, decided after Phase 2 lands)
- Live bubble fire (tomorrow morning, after Taona reviews voice file)
- Distill-facts script (tomorrow)
- System prompt rewiring (tomorrow)

## Non-goals

- Storing 4,815 assistant messages (we want Jensen's voice, not GPT's mirror)
- Embedding the raw corpus tonight (defer until distill pass shapes the right granularity)
- Surfacing PII-flagged content to bot unless Jensen explicitly asks for it
- Productizing this ingest as a Sasa tenant onboarding flow (single-tenant per Law 9)

## Doctrine check (every law that touches this work)

| Law | This spec |
|---|---|
| L1 persona-purity | Bot writes ABOUT Jensen but speaks as Rencontre. Ingest is operator-side. No persona impact. |
| L2 send-chokepoint | No outbound until tomorrow's send-bubbles script, which calls sendTextAndLog. |
| L3 PII-quarantine | `lib/openai-export/redact.ts` flags PII at ingest. `contains_pii` boolean on every row. Bot RAG filters by default. |
| L4 white-editorial | No UI in this spec. |
| L5 no-em-dashes | Voice extract has explicit em-dash audit so Rencontre filters/replaces them in any future Jensen-voice draft. |
| L6 numbers-reconcile | All counts in INVENTORY.json and the four bubbles come from `scripts/inventory.py`. Reproducible. |
| L7 source-of-truth | jensen_corpus is canonical for "Jensen's past writing." brain_facts remains canonical for atomic facts about his world. No cross-pollution. |
| L8 tool-call safety | No destructive tools. No mass send. All ingest is to-DB only. |
| L9 single-tenant | This corpus is La Rencontre's. Will not be reused for Sasa or any other tenant. |

## Architecture

```
       12 conversations-*.json
              │
              ▼
       parse + walk mapping tree
              │
              ▼  filter: role=user, drop role=assistant/system/tool
       4,670 raw user messages
              │
              ▼
       lib/openai-export/redact.ts
       (phones, emails, IBANs, Emirates IDs flagged, NOT stripped)
              │
              ▼
       lib/openai-export/cluster.ts
       (domain ∈ 10, intent ∈ 10 — two tags per row)
              │
              ▼
       jensen_corpus rows
       (id, conv_id, conv_title, msg_id, content, contains_pii,
        domain, intent, create_time, word_count)
              │
              ├──► scripts/voice-extract.ts ──► JENSEN-VOICE.md  ← tonight ends here
              │
              └──► scripts/distill-facts.ts ──► brain_facts via rememberFact()  ← tomorrow
                                                       │
                                                       ▼
                                                lib/persona.ts injects voice highlights
                                                       │
                                                       ▼
                                                scripts/send-bubbles.ts fires
```

## Golden tests (10, voice-extract output must pass these)

1. JENSEN-VOICE.md exists and is ≥ 500 lines.
2. The "Top n-grams" section contains "Upaya" (token he uses 109+ times in titles).
3. The "Opening phrases" section contains at least 8 distinct openers.
4. The "Closing phrases" section contains at least 8 distinct closers.
5. The "Em-dash usage" section reports a count and 3 sample sentences.
6. The "Polite formulas" section contains at least 12 phrases.
7. The "Vocabulary signature" section lists his top 50 distinctive content words (after stopword filtering).
8. The "Sentence length" section reports mean and median word count per sentence.
9. The "Domain distribution" section shows message count per cluster, all 10 buckets present.
10. No raw PII (phone numbers, full email addresses other than @larencontre, IBANs) leaks into the markdown file.

## Open questions for the operator review

After voice file lands:
- Is the cluster taxonomy capturing his world correctly, or do any buckets need merge/split?
- Any opening/closing phrases that should be enforced or banned in Rencontre's Jensen-voice drafts?
- Em-dash audit: does Jensen himself use them? (If yes, Rencontre still strips per Law 5 — his bot improves on him.)
