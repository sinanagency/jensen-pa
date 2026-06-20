# Jensen

La Rencontre's private concierge bot. One brand (larencontre.ae). Built by zanii. Live at jensen.larencontre.ae and jensen.zanii.agency (same Vercel app).

Stack: Next.js App Router, TypeScript, Supabase (Postgres + RLS), Vercel, WhatsApp Cloud API, Anthropic Claude, Shopify Admin (Upaya orders), Quiqup delivery.

Mission: replace the freelancer stack for La Rencontre (marketing, accountant, content, invoices, Memorae substitute) with one luxury single-tenant bot. First step toward productized Sasa.

## The doctrine governs everything

This project obeys JENSEN-DOCTRINE (the nine laws below). Before any change, read the laws that touch your surface. After any change, verify against them. No "done" without proof attached.

## The nine laws

1. Persona-purity law. Jensen speaks in the first person, always. Every bot-sent message is Jensen ("I checked your calendar", "I sent the invoice"). Never "the team", never "we at Jensen", never break character. No emoji unless the user uses one first. No exclamation marks in client copy.

2. Send-chokepoint law. Exactly one door for outbound messages, the same pattern as Sasa: a single sendTextAndLog function that logs every message to Supabase before WhatsApp ack. No raw Graph API calls scattered across handlers. Any new sender goes through the chokepoint or it does not ship.

3. PII-quarantine law. Guest names, phone numbers, addresses, card data, passport scans, dietary or health notes never reach non-vetted third parties. No PII in logs. No PII in prompts to model providers beyond the vetted Anthropic endpoint. No PII in analytics. Redact before logging.

4. White-editorial-luxury aesthetic law. Any client-facing surface uses Fraunces + Inter, generous whitespace, sparing gold accents on white. Dark mode is opt-in, never default. No glassmorphism. No gradient backgrounds for decoration. No cyan plus purple. If it does not feel like a Mayfair hotel printed menu, it ships back.

5. No-em-dashes law. Every client-facing string (WhatsApp message, email, invoice line, web copy) uses commas, periods, colons. No em-dashes. No en-dashes used as sentence breaks. This applies to LLM-generated text too (filter or re-prompt).

6. Numbers-reconcile law. Invoices, expense totals, GP, commissions, and reports always reconcile to the source of truth. No fabricated totals. No "estimated" displayed as final. Every displayed figure traces to a query, a Shopify line, or a Supabase row. Mismatches surface as an alert, never as a rounded fudge.

7. Source-of-truth law. Shopify Admin is canonical for Upaya orders. Supabase is canonical for guests, conversations, and tool-call audit. The Quiqup API is canonical for delivery state. Never duplicate canonical state into a side table without a documented sync direction. Webhooks write to Supabase; Supabase never lies to Shopify.

8. Tool-call safety law. Any destructive or money-moving tool call (send invoice, refund, charge, cancel order, post publicly, send mass message) requires a pending_action intent token written to Supabase, surfaced to the operator, and only executed on explicit confirm. Read-only tools may run inline. Write tools never run inline.

9. Single-tenant law. Jensen is La Rencontre only. No cross-tenant data. No "if brand X" branches. When this productizes into Sasa, the multi-tenant boundary is built fresh; this codebase stays single-tenant until then.

10. Test-mode law. Every bot in the fleet recognises Taona as the `developer` role (whoIs defaults + OWNER_PROFILES override). Test traffic NEVER lands on the owner's phone and NEVER persists. The mechanism is `opts.dev === true` on sendTextAndLog: reroutes the send to `devPhone()` and skips chat_messages + audit inserts. Guards/dash-strip still run so dev sees what the prod path would have sent. The smoke harness is `scripts/dev-ping.mjs`. No `TEST_MODE` env flag, no "from Taona's number = test" inference, no separate side-door function. One chokepoint, documented dev branch. This pattern propagates to every new bot we build.

## The canonical files

JENSEN-DOCTRINE in this CLAUDE.md (the constitution).
README.md (operating notes).
.env.local and Vercel env (the secret map, never committed).
supabase/migrations/ (the schema contract).
lib/whatsapp.ts and lib/sendTextAndLog.ts (the send chokepoint).
lib/tools/ (every tool the LLM can call, one file per tool).
docs/decisions/ (ADRs when a law gets refined).

## How to work

Each module gets its own CLAUDE.md when it grows past a single file (lib/tools/CLAUDE.md, app/api/whatsapp/CLAUDE.md, etc.). Load only what you need. Invoke the doctrine-reviewer sub-agent before claiming done.

## The tricky-logic protocol (MANDATORY on intent-loaded changes)

Full text: `TRICKY-LOGIC-PROTOCOL.md` (repo root). A green test proves the code does what you WROTE, not what the user MEANT. Intent bugs live in that gap and a seam that checks "was the function called?" stays green while the human reads the wrong words.

**Trigger — run the protocol if the change touches any of:** time (relative expressions, timezones, before/after, due vs reminder), reference/deixis ("this"/"that"/"the same one"/a swipe-reply), identity (self vs other, who assigned whom, which of two records), claim words (done/paid/sent/reminded/handled), money or any irreversible action, OR the actual words a human reads (any template, reminder, draft, or proactive push). Pure refactor/styling/log line: skip.

**When triggered, the four steps are NON-NEGOTIABLE:**
1. Write the intent first, as concrete input→exact-human-visible-output examples, in the user's words. Those examples ARE the test cases.
2. Test the OUTPUT a human sees (rendered message text / final stored value), never just that a function ran.
3. Adversarial read-back by a separate perspective: "how would the real user read this, what did they mean?" — not "does it run."
4. Verify the first real fire via the owner-mirror, and for a time-bound event the fix lands BEFORE the event (or you send a correction after). A green wall is not "done" for an intent change.

**Product rule that makes the bot self-correcting:** echo your interpretation when confident ("I'll remind you at 21:00 tomorrow"); ASK (flag_for_clarity / needs-steer) when not. Never silently guess on an intent-loaded input. The email draft surface implements this (KT #332/#333): confident → draft, not sure → ask Jensen, never a guess.

## Hard rules at this layer

No em-dashes in any output. PII never reaches non-vetted services. Send only through sendTextAndLog. White editorial luxury, never dark by default. No fabricated totals. Shopify wins for Upaya orders. Destructive tools go through pending_action. No raw Graph API outside the chokepoint. Deploy through the configured Vercel project only, never a second driver.

## When in doubt

Read the law. Run the doctrine-reviewer. Trace the number to its source. Show proof. If a law seems wrong, write an ADR proposing the change. Do not silently violate.
