# Dorje — Integration & Operations Reference

> Dorje is the WhatsApp concierge for **Jensen Moonien / La Rencontre**. One brain (Claude),
> two surfaces (WhatsApp + the web portal), one send chokepoint, one wall. This is the
> single source of truth for how it is wired, what it can do, and how to operate it.
>
> Brand law: **Jensen only ever sees `jensen.larencontre.ae`.** Never `zanii.agency`.
> Bot persona is **Dorje**; it speaks first person and never names its developer or infra to Jensen.

---

## 1. What it is

- **Client:** Jensen Moonien (La Rencontre, Dubai). **Developer:** Taona.
- **Brain:** Anthropic Claude — `claude-sonnet-4-6` default, `claude-opus-4-8` available (`lib/anthropic.ts`).
- **Store:** Supabase (Postgres + PostgREST). No local DDL access — migrations are run by the owner.
- **Host:** Vercel (Next.js App Router, `runtime = "nodejs"`).
- **Channel:** WhatsApp Cloud API (Meta Graph v21).

### Roles (who is who)
| Number | Who | Role | Notes |
|---|---|---|---|
| `971528902032` | Jensen | `owner` | the client — protected; sees only clean, branded replies |
| `971501168462` | Taona | `developer` | dev/oversight — **skips the wall**, gets `[DEV]` reroutes and error diagnostics |

Resolution lives in `OWNER_PROFILES` / `OWNER_WHATSAPP` env + `whoIs()` in `lib/whatsapp.ts`.

---

## 2. Request flow

```
Jensen (WhatsApp) ──► Meta ──► POST /api/whatsapp (HMAC verified)
                                   │
                                   ├─ media? → download → text-extract → readPdf/readImage OCR → addDoc
                                   │
                                   └─ text → Claude brain (lib/concierge/loop.ts)
                                              │  picks tools (lib/concierge/tools.ts)
                                              ▼
                                       dispatch (lib/concierge/dispatch.ts)
                                              │  DESTRUCTIVE tools gated on confirm:true
                                              ▼
                                       reply ──► sendTextAndLog ──► THE WALL ──► Meta ──► Jensen
```

The web portal is the second surface onto the **same** brain + store (board, docs, mail, finance).

---

## 3. The send chokepoint + the wall

Every outbound bot message passes one path. Do not bypass it.

- **`sendTextAndLog(to, body, opts?)`** (`lib/sendTextAndLog.ts`) — logs to `chat_messages` **before** the send (Law 2: transcript never diverges from the wire), then delegates to the primitive.
- **`sendWhatsAppRaw` / `sendWhatsApp`** (`lib/whatsapp.ts`) — the primitive. The wall runs **here**:
  - **Law 5** — strip em/en dashes.
  - **Brand wall** — `sanitizeReply` with `JENSEN_BOT_GUARDS_CONFIG` (`lib/bot/guards-config.ts`). Drops/strips cross-bot leaks (Sasa, Nisria, Stephen, Cape Town Halaal) and dev-persona leaks. On a **drop** to the client, Jensen gets one graceful line and the full diagnostic is routed to the **developer** only.
  - **Law 10 / dev reroute** — a message to the **developer** (`role === "developer"`) **skips the wall** entirely (he is allowed to see infra/brands); `opts.dev:true` reroutes test traffic to the dev phone and skips persistence.
  - **Mute kill switch** — `kv.bot_muted = true` blocks all outbound instantly, no deploy needed (`/api/mute`).

> ⚠️ A row in `chat_messages` means *the bot logged it*, not *Jensen received it*. Log happens before the Meta send (Law 2); a failed send still leaves a row. Confirm delivery by the Meta `ok` result, not the transcript row.

---

## 4. Capabilities (tool catalog)

Tools are defined in `lib/concierge/tools.ts`, executed in `lib/concierge/dispatch.ts`. Tools marked 🔒 are **confirm-gated** (the bot must echo the action and get an explicit "yes" before it fires — enforced by the `DESTRUCTIVE` set).

**Board / entities** — `list_entities`, `find_entity`, `create_entity`, `update_entity`, `delete_entity`🔒, `entity_dashboard`
**Tasks (Covey board Q1–Q4)** — `list_tasks`, `create_task`, `update_task`, `complete_task`, `delete_task`🔒
**Calendar** — `query_calendar`, `create_event` (recurrence), `update_event`, `complete_event`, `delete_event`🔒, `day_log`
**Finance (AED, UAE VAT 5% / CT 9%)** — `finance_summary`, `list_finance`, `record_finance`, `update_finance`, `delete_finance`🔒, `vat_report`, `ct_estimate`
**Documents** — `search_documents`, `list_documents`, `file_document`, `delete_document`🔒, `generate_document`, `generate_legal`, `set_legal_blueprint`
**Contacts** — `list_contacts`, `find_contact`, `add_contact`, `update_contact`, `delete_contact`🔒
**Mail (Jensen's own mailboxes)** — `list_inbox`, `read_email`, `search_email`, `draft_reply`, `reply_email`🔒, `send_email`🔒, `send_meeting_invite`🔒
**Notes / memory** — `list_notes`, `add_note`, `delete_note`🔒, `remember_fact`, `remember_preference`, `query_memory`, `list_memory`, `forget_memory`🔒
**Voice** — `call_owner`🔒 (Twilio TTS call)
**Briefs / settings** — `morning_brief`, `get_settings`, `update_prefs`, `set_goals`
**Integrations** — `store_summary` (Shopify), `sanad_draft_contract`, `sanad_review_contract`
**Admin only** — `read_owner_chats`

---

## 5. Document intake pipeline (both surfaces)

Same shared core feeds both surfaces: **extract text → OCR fallback for scans → file with content → search by meaning.**

- **OCR** — `readPdf(base64)` and `readImage(base64, mime)` in `lib/anthropic.ts`. `readPdf` uses a **direct `/v1/messages` fetch with a `document` content block** (NOT `runClaude`, which silently drops the document block). Claude is the **only** endpoint allowed to read a passport scan (PII Law 3).
- **Bot surface** — `app/api/whatsapp/route.ts`: media → download → text-extract → `readPdf`/`readImage` fallback when the text layer is empty → `ops.addDoc`.
- **Portal surface** — `app/api/ingest-file/route.ts`: extract → `readPdf` fallback → `addDoc`. Embedding is **degrade-safe**: a dead embed key no longer aborts the upload (file is kept, keyword-searchable).
- **Filing** — `lib/docs-server.ts` `addServerDoc` saves `docs.content` regardless of whether embedded chunks exist.
- **Search-back** — `searchDocsWithClaude(query, k)` is **Claude-as-retriever** over the doc index (title+kind+snippet). No OpenAI/embeddings dependency. Exposed to the brain as `search_documents`.

Verified live (2026-06-22): a scanned PDF was OCR'd → filed with content → found back by name → cleaned up, end to end on prod infra.

---

## 6. Integration endpoints

| Endpoint | Auth | Purpose |
|---|---|---|
| `POST /api/whatsapp` | HMAC `WHATSAPP_APP_SECRET` (GET verify `WHATSAPP_VERIFY_TOKEN`) | Meta inbound webhook (text + media) |
| `POST /api/ingest` | `x-api-key: INGEST_KEY` | meeting transcript → tasks → WhatsApp heads-up to Jensen |
| `POST /api/ingest-file` | portal session | web document upload |
| `POST /api/digital-u/notify` | `x-api-key: INGEST_KEY` | push an out-of-band message to Jensen via the **live** chokepoint. Body: `{"message": "..."}` |
| `POST /api/ingest/sanad` | `Bearer SANAD_INGEST_KEY` | Sanad contract ingest |
| `POST /api/shopify/webhook` | HMAC `SHOPIFY_WEBHOOK_SECRET` | order events |
| `POST /api/cron/*` | `Bearer CRON_SECRET` or `?key=CRON_SECRET` | scheduled jobs |
| `POST /api/cron/send-{completion,onboarding}-bubbles` | `x-admin-secret: ADMIN_SECRET` | one-shot bubble fires |
| `POST /api/mute` | admin | toggle `bot_muted` kill switch |

> **To message Jensen from outside the bot**, POST `/api/digital-u/notify` — it runs on Vercel with the live token and routes through `sendTextAndLog`. Do **not** send from a local script: `vercel env pull` returns a `WHATSAPP_TOKEN` that 401s locally even while the deployment sends fine. Always send through the deployed endpoint.

---

## 7. Cron jobs (`vercel.json`)

| Schedule (UTC) | Dubai | Job | Does |
|---|---|---|---|
| `0 4 * * *` | 08:00 | `cron/daily` | morning brief (writes a `daily_brief_run` audit marker) |
| `0 16 * * *` | 20:00 | `cron/evening` | evening check to owner(s) |
| `* * * * *` | — | `cron/reminders` | fires due reminders; skips events with an `outcome` set (FM-23) |
| `* * * * *` | — | `cron/monitor` | health check; pages the **developer** on `status==="down"` (`sendWhatsAppRaw`, cooldown via `kv.monitor_last_alert`) |
| `* * * * *` | — | `cron/sanad-deliver` | deliver ready Sanad PDFs to the requester |
| `*/5 * * * *` | — | `cron/mail-triage` | triage Jensen's mailboxes |

---

## 8. Environment variables

**Core** — `ANTHROPIC_API_KEY`, `SUPABASE_URL`, `SUPABASE_SERVICE_KEY`/`SUPABASE_SECRET_KEY`, `SESSION_SECRET`, `NEXT_PUBLIC_APP_URL`
**WhatsApp** — `WHATSAPP_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_APP_SECRET`, `WHATSAPP_VERIFY_TOKEN`, `OWNER_WHATSAPP`, `OWNER_PROFILES`, `JENSEN_MODE`
**Secrets / auth** — `INGEST_KEY`, `CRON_SECRET`, `ADMIN_SECRET`, `SANAD_INGEST_KEY`, `MEETING_BOT_API_KEY`
**Mail** — `MS_CLIENT_ID`/`MS_CLIENT_SECRET` (Outlook, currently unset → IMAP path), `ZOHO_CLIENT_ID`/`ZOHO_CLIENT_SECRET`/`ZOHO_ACCOUNTS_HOST`/`ZOHO_API_HOST`
**Voice** — `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FROM`, `TWILIO_VOICE`, `CALL_REMINDERS`
**Shopify** — `SHOPIFY_CLIENT_ID`, `SHOPIFY_CLIENT_SECRET`, `SHOPIFY_STORE`, `SHOPIFY_API_VERSION`, `SHOPIFY_WEBHOOK_SECRET`
**Obs** — `LANGFUSE_PUBLIC_KEY`, `LANGFUSE_SECRET_KEY`, `LANGFUSE_HOST`, `MIRROR_TO`, `CHATWOOT_URL`, `CHATWOOT_JENSEN_INBOX_IDENTIFIER`
**Briefs** — `MORNING_BRIEF_TEMPLATE`, `MORNING_BRIEF_TEMPLATE_LANG`

> ⚠️ `NEXT_PUBLIC_APP_URL` is currently `jensen.zanii.agency`. Any **link** the bot sends Jensen would show zanii — that violates the brand law. Fix to `jensen.larencontre.ae`.

---

## 9. Operations runbook

- **Stop the bot now:** set `kv.bot_muted = true` (`/api/mute`). Re-enable: `false`. No deploy.
- **Message Jensen out-of-band:** `POST /api/digital-u/notify` with `x-api-key: INGEST_KEY`, body `{"message": "..."}`. `ok:true` = Meta accepted = delivered.
- **Test without touching Jensen:** route to the developer (`opts.dev:true`) or send to the developer number — both skip the wall and skip Jensen's transcript. Never test by sending to Jensen's number.
- **Health:** `cron/monitor` pages the developer on a real outage (network/5xx). Off-window free-text can be dropped by Meta, so a silent night ≠ healthy; check the audit markers.
- **Brand check before any deploy:** `grep -rni "sasa\|zanii" ` the client-facing paths. Jensen must never see either.

---

## 10. Status snapshot (2026-06-22)

| Capability | State |
|---|---|
| Document admission (OCR → file → search), both surfaces | ✅ core proven live; per-surface live upload pending Jensen's test |
| `send_email` (new email from Jensen's mailbox) | ✅ proven (real send), confirm-gated |
| `send_meeting_invite` (.ics accept/decline over SMTP) | ✅ proven (real invite), confirm-gated |
| Brand wall + dev-persona guard | ✅ deployed (KT #340) |
| Monitor paging the developer | ✅ deployed (KT #344) |
| Reminders skip completed events (FM-23) | ✅ deployed + observed firing live |
| `isOwner` fail-closed on empty env (FM-18) | ✅ deployed |
| `NEXT_PUBLIC_APP_URL` → larencontre | 🔴 still zanii — fix pending |

---

*Source of truth is the code. When this drifts, the code wins — update this file.*
