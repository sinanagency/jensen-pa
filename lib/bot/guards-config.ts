// Jensen PA's BotGuardsConfig — v0.2 (defineBotConfig: frozen, precompiled).
//
// CRITICAL CONTEXT: Jensen ACTUALLY uses the Eisenhower four-quadrant framework
// in his consultancy work. So "4Q" / "four quadrant" are LEGITIMATE in Jensen's
// output and MUST NOT be in his bannedPatterns or forbiddenBrands. The
// historical contamination incident was when 4Q leaked FROM Jensen TO Sasa
// (where it appeared as a fictional "Stephen" inventor). Sasa's config bans
// 4Q + Stephen for that reason; Jensen's allows them. Per-bot configuration
// is the wall — and as of 2026-06-12 this config is enforced INSIDE
// sendWhatsApp (the primitive), so the morning brief, every webhook reply,
// and every cron push pass it with no bypassable wrapper.

import { defineBotConfig } from '../bot-guards/index.js'

export const JENSEN_BOT_GUARDS_CONFIG = defineBotConfig({
  botName: "Jensen's Concierge",

  // Class A client-leakage wall (KT #328). Every entry below fires ONLY on a
  // bot self-leak (a bug), never on normal client copy, so `drop` (kill the
  // reply, swap in reaskPhrase, log a pre_send_caught alert for the operator)
  // is the safe failure, not a hot-path cost. These close the uncovered
  // transcript failures: infra narration to the client ("API tokens drained,
  // Taona caught it"), a literal "test" artifact + its recant, and a plaintext
  // "Password: ..." over WhatsApp. Law 5 (dashes) stays upstream in stripDashes.
  bannedPatterns: [
    // Credentials must never traverse the client channel (Law 3).
    { label: 'plaintext_credential', mode: 'drop', pattern: /\b(password|passcode|pwd)\b\s*[:=]\s*\S+/i },
    { label: 'login_credential', mode: 'drop', pattern: /\blogin\b\s*[:=]\s*\S+/i },
    // Internal/infra narration must never reach the client (Law 1 persona).
    { label: 'infra_api_token', mode: 'drop', pattern: /\bapi[\s-]?(key|token)s?\b/i },
    { label: 'infra_tokens_drained', mode: 'drop', pattern: /\btokens?\b[^.]{0,40}\bdrained\b/i },
    { label: 'infra_system_logs', mode: 'drop', pattern: /\bsystem logs?\b/i },
    { label: 'infra_code_bug', mode: 'drop', pattern: /\bcode bug\b/i },
    // Test/dev artifacts must never land on the owner's phone (Law 10).
    { label: 'test_artifact_only', mode: 'drop', pattern: /^\s*test\s*$/i },
    { label: 'test_recant', mode: 'drop', pattern: /\btest\b[^.]{0,40}\bnot actually sent\b/i },
  ],

  // Brand names + the developer's name that MUST NEVER appear in Jensen's
  // output. Any match drops the whole reply (contamination event).
  forbiddenBrands: [
    'Sasa',
    'Nisria',
    'Maisha',
    'AHADI',
    'Cape Town Halaal',
    'Young at Heart Festival',
    'Stephen',           // historical fictional persona that contaminated Sasa
    'Canada Made',
    'Sinan Agency',
    'sinanagency',
    // 'Stephen' REMOVED (KT #339): it was a Sasa-only fictional-persona guard, and
    // the file's own header says Jensen should ALLOW it. Jensen has a REAL contact
    // "Stephen Sutherland", so banning the bare first name dropped legitimate replies
    // about a real client into the graceful fallback. Sasa keeps it in Sasa's config.
    'Taona',             // the developer — never named to the client (Law 1)
    'zanii',             // agency brand — Jensen is single-tenant larencontre.ae (Law 9)
    'sanad',             // sibling zanii product — never surfaced to this client
  ],

  intentEnum: [
    'mail_triage',         // "what's in my inbox?", "any reply needed?"
    'mail_draft',          // "draft a reply to X"
    'calendar_query',      // "what do I have on Friday?"
    'calendar_create',     // "schedule a meeting", "block 3 hours"
    'contact_lookup',      // "who is X?", "phone for Y"
    'task_note',           // "remind me about", "note this"
    'consultancy_advice',  // strategy/SOP/menu/cost questions (4Q framework lives here)
    'document_request',    // "draft a PDF for", "create the proposal"
    'open_conversation',   // fallback
  ],

  pendingKinds: ['mail_draft_confirming', 'calendar_clarifying'],

  reaskPhrase: 'Tell me more so I can handle it.',

  anthropicApiKey: process.env.ANTHROPIC_API_KEY || '',
})
