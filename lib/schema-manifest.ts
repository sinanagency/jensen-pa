// Jensen schema manifest, boot-time drift detection (KT #295, 2026-06-16).
//
// Every (table, columns) pair the bot's HOT PATHS touch. checkSchema() at
// boot probes each pair against the live DB and flags drift before the
// app starts serving traffic.
//
// SCOPE TODAY: the WhatsApp ingest + concierge ops layer. The recently
// landed swipe-reply migration (chat_messages.external_id +
// reply_to_external_id, commit c23cf41) is explicitly listed here, so if
// a future Vercel deploy ever ships before that migration is applied to a
// new environment, the guard catches it at boot instead of after the
// first swipe-reply inbound.
//
// EXPANDING: add a table block when you ship a write/update path that
// references a column the bot's correctness depends on. The cost of a
// missed column is a silent agent failure; the cost of an over-listed
// column is one extra `select ... limit 0` per boot.

import type { SchemaManifest } from "./brain-core/index.js";

export const JENSEN_SCHEMA_MANIFEST: SchemaManifest = {
  // The cascade target. KT #293 port added external_id + reply_to_external_id.
  chat_messages: [
    "id", "role", "content", "channel", "ts", "party",
    "external_id", "reply_to_external_id",
  ],
  // Task primitive, Wall 2 (discriminator) targets this surface.
  tasks: [
    "id", "title", "entity_id", "quadrant", "done", "due", "created_at",
  ],
  // Entity (people Jensen tracks). Wall 2 reads names from this surface.
  entities: [
    "id", "kind", "name", "subtitle", "status", "notes",
    "created_at", "parent_id", "role",
  ],
  // Calendar surface. complete_event (KT #288) writes outcome here.
  events: [
    "id", "title", "entity_id", "date", "time", "note",
    "created_at", "reminded_at", "source_message_id",
    "meeting_url", "digital_u_status", "outcome",
  ],
  // wamid dedupe. The insert IS the check (PRIMARY KEY collision = already
  // seen), so the columns matter for correctness of that primitive.
  wa_seen: [
    "wamid", "seen_at",
  ],
  // Contact lookup. resolveContact + lookup tooling read from here.
  contacts: [
    "id", "name", "company", "role", "email", "phone", "notes",
    "entity_id", "created_at",
  ],
};
