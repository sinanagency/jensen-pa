# La Rencontre — Product Requirements Document

> A private AI chief of staff and mentor for Jensen, founder of La Rencontre Hospitality (Dubai).
> v1 built 2026-06-02. This document is the source of truth for what the product is and why.

## 1. Vision

One line: **ChatGPT that runs your life and remembers your business, living in your pocket, with a luxury portal on your domain.**

Jensen is a talented multi venue F&B consultant who is drowning in bandwidth, not talent. The product is not a tool that does tasks on command. It is a **mentor and guide** that holds his entire world, tells him what matters and why, never lets anything slip, makes his actual work faster, and thinks with him so he grows. What he is really buying is the feeling of waking up on top of his life instead of behind it.

## 2. The user

Jensen runs La Rencontre: F&B consultancy (concept creation, menu engineering, target market alignment, 360 venue optimization), venue management, and high profile events. He runs many venues, clients, and events in parallel. He cancelled Memorae because it is a cute memory box, not a mentor that knows his business.

## 3. Positioning

- **PA first (the hero).** The personal chief of staff that runs his life and business.
- **Instant consultancy co pilot (act two).** Producing his billable deliverables.
- The AI is always a **mentor**: proactive, prioritizing with reasoning, holding him to goals, flagging risks and opportunities, coaching, celebrating wins. First person, always in character (named Rencontre).

## 4. Goals and non goals

Goals: a deployed, genuinely working PA that he can use daily, beautiful enough to feel like magic, grounded in his real world.

Non goals (this product): the marketing and social engine (a separate reusable product, ported to zanii, Nisria, others). The services and pricing agreement (a separate later document). The NDA is a separate signed document.

## 5. Functional requirements (v1)

| Area | What it does | State in v1 |
|---|---|---|
| Mentor chat | Streaming, grounded, first person mentor. The hero. | Live (Claude) |
| Morning brief | Mentor reads his world and writes today's briefing with the 3 things that matter + a coaching note | Live (Claude) |
| Entity first portfolio | Venues, clients, events as workspaces with rolled up tasks, finance, events | Live (localStorage) |
| Tasks | Eisenhower four quadrant board (do first, schedule, delegate, drop) | Live |
| Finance, UAE aware | Income and expense, net headline, VAT and corporate tax position from a maintained ruleset | Live |
| Document brain | Ingest his docs, embed, retrieve. The mentor grounds answers in it (RAG) | Live (OpenAI embeddings) |
| Document generation | Branded La Rencontre PDF deliverables (proposal, concept, menu, SOP, cost, letter) | Live (Claude + headless Chrome) |
| Calendar | Agenda of events tied to entities | Live (sync is next step) |

## 6. Architecture

- Next.js 14 App Router, deployed on Vercel at jensen.zanii.agency.
- **Runtime inference on a hosted Claude API under zero retention, no training terms.** GPUs are reserved for offline training and improvement only, never the live request path (the cluster is only stable for training). See knowledge node #32.
- Embeddings via OpenAI text-embedding-3-small for the document brain. Local cosine retrieval over stored chunks.
- Auth: a shared passphrase gate with an HMAC signed session cookie, enforced by middleware.
- **Persistence v1: localStorage** (genuinely persists per browser, the same sanctioned fallback used on the Equity build when the Supabase project cap blocked a new project). Documented next step: a dedicated Supabase project for server side multi device sync, isolated per the NDA.
- Tax figures come only from `lib/tax.ts`, a maintained verified ruleset, never the model's memory. A wrong tax number is a liability (knowledge nodes #28, #29).

## 7. Design

Reference: Memorae (`~/Desktop/Memorae`) married to Nisria's real module structure. Dark luxury: black canvas, white and grey type, purple as a restrained text and accent only. Glassmorphic cards, conversational hero headlines, a persona orb, an elegant La Rencontre wordmark and monogram, a cinematic hero login.

## 8. What needs Jensen's input to light up further (honest gaps)

These are owner actions, not failures, deferred by design for v1:
- Email over WhatsApp: needs a Microsoft Graph app registration and his OAuth consent.
- WhatsApp channel: needs a dedicated WABA number and Meta approval.
- Google or Outlook calendar two way sync: needs his account connection.
- Server side multi device persistence: needs a dedicated Supabase project.
- His real data and his legal blueprint for the AI lawyer.

## 9. Success

He opens it in the morning and his mentor has already told him the three things that matter and one move that grows the business. He generates a proposal in minutes. He asks it anything and it answers grounded in his world. It feels like a mentor, not a tool.
