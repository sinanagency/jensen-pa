// Jensen PA's BotGuardsConfig.
//
// CRITICAL CONTEXT: Jensen ACTUALLY uses the Eisenhower four-quadrant framework
// in his consultancy work. So "4Q" / "four quadrant" are LEGITIMATE in Jensen's
// output and MUST NOT be in his bannedPatterns. The historical contamination
// incident was when 4Q leaked FROM Jensen TO Sasa (where it appeared as a
// fictional "Stephen" inventor). Sasa's config bans 4Q + Stephen for that reason;
// Jensen's allows them. Per-bot configuration is the wall.

import type { BotGuardsConfig } from '../bot-guards/index.js'

// Brand names that MUST NEVER appear in Jensen's output.
// Includes other Sinanagency bots + their canonical scopes.
const FORBIDDEN_BRANDS = [
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
] as const

const INTENT_ENUM = [
  'mail_triage',         // "what's in my inbox?", "any reply needed?"
  'mail_draft',          // "draft a reply to X"
  'calendar_query',      // "what do I have on Friday?"
  'calendar_create',     // "schedule a meeting", "block 3 hours"
  'contact_lookup',      // "who is X?", "phone for Y"
  'task_note',           // "remind me about", "note this"
  'consultancy_advice',  // strategy/SOP/menu/cost questions (4Q framework lives here)
  'document_request',    // "draft a PDF for", "create the proposal"
  'open_conversation',   // fallback
] as const

export const JENSEN_BOT_GUARDS_CONFIG: BotGuardsConfig = {
  botName: "Jensen's Concierge",
  bannedPatterns: [],   // No bot-specific banned text yet; brand-leaks handle the wall.
  forbiddenBrands: [...FORBIDDEN_BRANDS],
  intentEnum: [...INTENT_ENUM],
  pendingKinds: ['mail_draft_confirming', 'calendar_clarifying'],
  reaskPhrase: 'Tell me more so I can handle it.',
  anthropicApiKey: process.env.ANTHROPIC_API_KEY || '',
}
