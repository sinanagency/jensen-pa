# ADR-0001 — Don't port Nisria's server brain to Jensen; audit Jensen's existing brain in place

Status: Accepted
Date: 2026-06-08
Pipeline: Tier 1 full (this is the architectural fork the spec depends on)

## Context

Jensen-PA was assumed (pre-sweep, per `~/Desktop/jensen/jensen-vs-nisria-gap-and-match.md`
on 2026-06-04 and AGENT-FRAMEWORK.md section E) to need a port of the
Nisria server-brain stack (`lib/memory.ts`, `lib/librarian.ts`,
`agent_memory` schema, the daily curation cron, the /memory query window)
because Jensen's brain was "pgvector RAG only, no lexical/RRF" and lacked
salience auto-capture, entity graph, and curation lifecycle.

Phase 1 source-of-truth read (`~/Code/jensen-pa/lib/concierge/{brain,ops,
dispatch,verify}.ts`) shows the actual state has moved since that audit:

- `brain.ts:recall` already does RRF fusion (`rrf<any>([factVec, factKw],
  ...)`), combining a pgvector RPC arm (`match_brain_facts` /
  `match_doc_chunks`) with a lexical ILIKE arm — same architecture as
  Nisria's `recall()`, simpler schema.
- `brain.ts:captureSalience` exists and is invoked from `loop.ts`.
- `brain.ts:rememberFact`, `rememberDirective`, `listMemory`,
  `forgetMemory`, `queryMemory` cover the brain write/read surface.
- The Jensen schema (`brain_facts` columns: `id, fact, source, embedding,
  created_at, kind, subject, status`) is a SIMPLER cousin of Nisria's
  `agent_memory` (which adds `metadata jsonb, title, content, topic,
  superseded_by, review_note, curated_at, tsv tsvector`). The extra
  columns enable librarian curation, contradiction guard, and FTS
  acceleration — none of which are gating for Jensen v1.
- `ops.createTask` and `ops.createEvent` both already soft-dedupe with an
  explicit comment "Memorae's worst bug." That fix had been previously
  identified as a port target; it is already in Jensen.
- `verify.ts:verifyReply` is the anti-fake-done rail. Already present.

The cost of a verbatim port (the original recommendation) is:
1. Schema migration to wider `brain_facts` shape or a parallel
   `agent_memory` table.
2. Rewriting recall() against the new shape.
3. Librarian cron + cluster Claude calls (~$0.05/day + Claude tokens).
4. Entity graph extraction job (~chunked Claude calls).
5. The /memory query window UI.

For a single-tenant single-operator bot with under 25 brain rows
(snapshot 2026-06-08 shows 19), 0 docs, 0 tasks — the librarian's
contradiction-guard, supersession lifecycle, and entity graph clustering
add no observable user value until the brain is at least ~500-1000 rows
deep. At Jensen's growth rate (a few salience captures per day) that is
months out.

## Decision

We DO NOT port the Nisria server-brain stack to Jensen in this sweep.
We instead AUDIT Jensen's existing brain end-to-end against the
Memorae failure-mode eval, and fix any seam that fails honestly.

Additive schema changes (e.g. adding `superseded_by` column on
`brain_facts` if salience starts colliding) remain a v2 option, deferred
behind a numeric trigger (~500 rows) — not built speculatively now.

## Alternatives considered (rejected)

1. **Verbatim port from Nisria.** Rejected: adds 4-6 commits worth of
   work, breaks the simpler shape Jensen has working, no observable
   gain at Jensen's data volume.

2. **Build the port BEHIND the audit (parallel).** Rejected: violates the
   minimal-change principle. Audit may show no port is needed; building
   in anticipation is speculative work.

3. **Build only the /memory query window + librarian, skip schema.**
   Rejected: librarian needs the supersession columns to be honest about
   contradiction handling. Half a librarian is worse than none.

## Consequences

Positive:
- Sweep stays minimal-diff. Phase 3 becomes "fix what fails eval,"
  not "port + fix what fails eval."
- Jensen's simpler schema is easier to evolve when the actual need
  appears (we measure first).
- Unlock window stays tight (48h soak + cold-input + unlock = days,
  not weeks).

Negative:
- If salience captures start contradicting each other at, say, 100 rows,
  there is no librarian to flag it. Mitigation: a v2 ADR triggers the
  port when brain row count crosses a threshold OR a manual contradiction
  is observed.
- We lose the entity graph as a recall acceleration. Mitigation: at this
  scale, RRF fusion + ILIKE is already <200ms for the realistic queries
  Jensen runs.

## Reversibility

Fully reversible. The port lives in `~/Code/nisria-techops/platform/lib/{memory,librarian}.ts`
and `~/Code/nisria-techops/platform/supabase/migrations/<librarian-era>.sql`
(read those at trigger time). Reversing this ADR means promoting v2 to
build status and porting then.

## Cross-references

- Spec: `~/Code/jensen-pa/specs/001-jensen-sweep/spec.md`
- Capability tree: `~/.claude/refs/trees/jensen/02-capability.md`
- Data tree: `~/.claude/refs/trees/jensen/03-data.md`
- Reference for the port if v2 fires: `~/Code/nisria-techops/AGENT-FRAMEWORK.md` §A
- Prior audit that suggested the port: `~/Desktop/jensen/jensen-vs-nisria-gap-and-match.md`
