// Read-only mirror of every chat_messages turn into Chatwoot (Path B).
// Lives entirely outside the prod critical path: catches and swallows every
// error so a Chatwoot outage cannot ever block a Jensen reply. Same instinct
// as mirrorToOperator in lib/whatsapp.ts, pointed at a different destination.
//
// Two writes per turn:
//   1. ensure a contact + conversation exists for this phone in the inbox
//   2. POST the message body as incoming (from user) or outgoing (from bot)
//
// Uses Chatwoot's public Client API keyed by the inbox_identifier so no
// account-level token leaves the prod env. The identifier is a per-inbox
// secret, scoped to that inbox only.

const URL = process.env.CHATWOOT_URL || "";
const INBOX_IDENTIFIER = process.env.CHATWOOT_JENSEN_INBOX_IDENTIFIER || "";

type Direction = "incoming" | "outgoing";

async function getOrCreateContactSourceId(phone: string): Promise<string | null> {
  const identifier = encodeURIComponent(phone);
  // Try fetch first; create on 404.
  try {
    const res = await fetch(`${URL}/public/api/v1/inboxes/${INBOX_IDENTIFIER}/contacts/${identifier}`, {
      method: "GET",
    });
    if (res.ok) {
      const j: any = await res.json();
      return j?.source_id || identifier;
    }
  } catch { /* fall through to create */ }
  try {
    const res = await fetch(`${URL}/public/api/v1/inboxes/${INBOX_IDENTIFIER}/contacts`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ identifier: phone, name: phone, phone_number: phone.startsWith("+") ? phone : `+${phone}` }),
    });
    if (!res.ok) return null;
    const j: any = await res.json();
    return j?.source_id || identifier;
  } catch { return null; }
}

async function getOrCreateConversation(sourceId: string): Promise<string | null> {
  try {
    const res = await fetch(`${URL}/public/api/v1/inboxes/${INBOX_IDENTIFIER}/contacts/${sourceId}/conversations`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    if (!res.ok) return null;
    const j: any = await res.json();
    return j?.id ? String(j.id) : null;
  } catch { return null; }
}

let conversationCache: Map<string, string> = new Map();

export async function mirrorToChatwoot(direction: Direction, phone: string, body: string): Promise<void> {
  if (!URL || !INBOX_IDENTIFIER || !phone || !body) return;
  try {
    const sourceId = await getOrCreateContactSourceId(phone);
    if (!sourceId) return;
    let convId = conversationCache.get(sourceId);
    if (!convId) {
      convId = (await getOrCreateConversation(sourceId)) || undefined;
      if (!convId) return;
      conversationCache.set(sourceId, convId);
    }
    await fetch(`${URL}/public/api/v1/inboxes/${INBOX_IDENTIFIER}/contacts/${sourceId}/conversations/${convId}/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: body, message_type: direction }),
    });
  } catch { /* never block delivery */ }
}
