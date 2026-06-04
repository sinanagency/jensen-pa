# Agent + Memory Framework (A–Z) — reusable template

> Extracted from the Nisria "Sasa" build (command.nisria.co) on 2026-06-04, generalised
> so it can be dropped onto any single-owner portal (Jensen / La Rencontre is the first
> port; zanii, others follow). Each instance is fully isolated: its own DB, its own
> brand/persona, its own data. Instances NEVER share memory or talk to each other.

## 0. What "the bot" actually is

Not a chat box. It is **one persona (first person, in character) that reads and writes the
same portal the human uses**, grounded in a shared brain, reachable from the web portal AND
a messaging channel (WhatsApp), kept honest by a curation job. Five layers:

```
  CHANNELS        web dispatch box  +  WhatsApp (inbound webhook + outbound send)
       |
  PERSONA         system prompt, first-person, never breaks character, owner-aware tiering
       |
  ACTION LAYER    "smart-tools": typed tools the model calls to READ and DO things
       |          in the portal (tasks, finance, calendar, contacts, documents...)
       |
  BRAIN           shared memory: hybrid retrieval (vector + full-text RRF) + grounding
       |          + librarian curation (dedup / contradiction-guard / entity graph)
       |
  STORE           one Postgres (per instance). Everything else reads/writes through it.
```

## A. The brain (the part just built for Nisria, the reusable core)

**Table `agent_memory`**: `id, kind, brand, title, content, metadata jsonb, embedding vector,
tsv tsvector, status, topic, superseded_by, review_note, curated_at, created_at`.
- `kind`: `org_fact | auto_fact | owner_private | brand_voice | asset | approved_reply | ...`
- `status`: `active | superseded | needs_review | archived`. **Only `active` ever grounds.**

**Write path** (`lib/memory.ts`): `remember()` (append, embeds if an embedder is set),
`rememberUpsert(slug)` (singleton overwrite by `metadata.slug` so a correction replaces in place).

**Read path** (`recall(query, opts)`): (1) always-on grounding kinds (`brand_voice` + `org_fact`)
so every answer is anchored in who the org is, PLUS (2) **hybrid retrieval**: semantic arm
(pgvector `match_memory` RPC) + lexical arm (`tsv` websearch), **fused with Reciprocal Rank
Fusion** (k=60). Either arm can be down and the other still answers. An asymmetric **privacy
wall**: `owner_private` facts ground only when `ownerView` is true.

**Librarian** (`lib/librarian.ts`, daily cron `/api/cron/librarian`): a JOB, not a live agent.
1. CONSOLIDATION — one Claude call clusters duplicate facts; high-confidence, non-conflicting
   clusters merge into one canonical row, the rest become `superseded`.
2. CONTRADICTION GUARD — members that state different values for the same attribute are NOT
   merged; they are flagged `needs_review` for a human. (A contradiction stops grounding until
   resolved, which is safer than recall picking one at random.)
3. ENTITY GRAPH — chunked Claude calls extract people/orgs/accounts/programs per fact and link
   them (`memory_entities` + `memory_entity_links`), so recall answers "everything about X".
   Split phases (consolidate all-at-once for cross-row dedup; entities chunked 20/call) so output
   never truncates as the brain grows.

**Query window** (`queryMemory()` + a `query_memory` tool + a `/memory` page): ask the brain in
plain words; returns closest facts + everything linked to the named entity. Read-only, owner-wall aware.

## B. The persona + action layer

- One system prompt, first person, never says "as an AI", never breaks character. Owner-aware
  **tiers**: `owner` (sees all incl. owner_private) / `founder|admin` (all but owner-private) /
  `member` (a restricted allowlist of tools, money/PII walled).
- **smart-tools**: an array of `{ name, description, input_schema }` + one dispatch switch. READ
  tools go through a `runRead(db, name, input, tier, viewerIsOwner)` gate; WRITE tools run through
  an **action gateway** with idempotency keys + autonomy lanes (auto / needs-approval). Every
  outward effect (send, post, pay) is gated and logged.
- Output contract (`humanize.ts`): one cleaner every generated string passes through (no
  em-dashes, no `[placeholders]`, current date injected, canonical org facts substituted).

## C. The channels + proactivity

- **Web**: a dispatch box posts to `/api/smart` → `runAgent(command, ctx)` → tool calls → reply.
- **WhatsApp**: inbound webhook resolves the sender to an operator + tier, runs the agent, sends
  via a single `sendTextAndLog` chokepoint (Graph API, permanent SYSTEM_USER token). One brain,
  both channels.
- **Proactive**: daily brief cron (per-owner "today's 3 things + coaching note"), urgent pings on
  create, reminders cron. The agent reaches out, not just responds.

## D. Per-instance isolation checklist (when porting to a new project)

1. **New, dedicated Postgres** (own project). Never shares an instance with another client's brain.
2. Swap brand/persona: name, system prompt, `ORG_FACTS`, voice, design tokens.
3. Re-point the data model to the project's entities (Nisria: beneficiaries/donors/grants;
   Jensen: venues/clients/events; next project: its own).
4. Its own API keys (Anthropic, OpenAI embedder, WhatsApp WABA).
5. Copy `agent_memory` + curation/entity schema verbatim (it is domain-agnostic).
6. Copy `lib/memory.ts`, `lib/librarian.ts`, the librarian cron, the query window verbatim.
7. Adapt smart-tools to the project's portal modules.
8. Confirm: this instance can NEVER read another instance's DB. Separate `DATABASE_URL`, separate keys.

## E. Jensen / La Rencontre application (this repo)

Jensen already has: mentor chat (Claude), morning brief, portfolio/tasks/finance/calendar,
a client-side document brain. What this framework ADDS:
- A **server brain** (the four-part memory system above) replacing the localStorage/IndexedDB
  RAG, so curation + entity graph + multi-device + cron become possible. **Requires a dedicated
  isolated Postgres** (PRD section 6 already names this as the deferred next step).
- A **smart-tools action layer** so Rencontre DOES things in the portal (create task, log expense,
  add a venue/client/event, draft a deliverable), not just chats.
- A **WhatsApp channel** linked to the same brain (needs Jensen's WABA number + Meta approval).
- Persona stays **Rencontre**, first person, mentor tone. Data stays 100% isolated from Nisria.

Build order: provision isolated DB → port schema → port memory + librarian + query window →
wrap Jensen's existing modules as smart-tools → add WhatsApp channel → proactive briefs.
