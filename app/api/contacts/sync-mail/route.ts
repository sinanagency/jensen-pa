// Extract email participants from the connected mailbox and upsert them as contacts.
// POST /api/contacts/sync-mail
// Returns { added: number, message: string }

import { NextRequest, NextResponse } from "next/server";
import { MAIL_COOKIE, decryptCreds } from "@/lib/mailbox";
import { isConfigured, admin } from "@/lib/db";
import { listInbox } from "@/lib/mail-ops";

export const runtime = "nodejs";
export const maxDuration = 30;

function inferRelationship(email: string): string {
  const domain = email.split("@")[1]?.toLowerCase() || "";
  if (domain === "larencontre.ae") return "staff";
  if (["gmail.com", "yahoo.com", "hotmail.com", "icloud.com", "outlook.com", "me.com"].includes(domain)) return "friend";
  return "client";
}

function parseNameEmail(header: string): { name: string; email: string } | null {
  // "Display Name <email@domain.com>" or just "email@domain.com"
  const match = header.match(/^(.+?)\s*<([^>]+)>$/);
  if (match) return { name: match[1].replace(/['"]/g, "").trim(), email: match[2].trim().toLowerCase() };
  const plain = header.trim().toLowerCase();
  if (plain.includes("@")) return { name: plain.split("@")[0], email: plain };
  return null;
}

export async function POST(req: NextRequest) {
  if (!isConfigured()) {
    return NextResponse.json({ added: 0, message: "Supabase not configured." });
  }

  const creds = await decryptCreds(req.cookies.get(MAIL_COOKIE)?.value);
  if (!creds) {
    return NextResponse.json({ added: 0, message: "No mailbox connected. Connect your mail first." });
  }

  try {
    const messages = await listInbox(creds, 50);
    const db = admin();

    // Get existing contacts by email to dedupe
    const { data: existing } = await db.from("contacts").select("email").not("email", "is", null);
    const knownEmails = new Set((existing || []).map((r: any) => r.email?.toLowerCase()).filter(Boolean));

    // My own email - skip
    knownEmails.add(creds.email.toLowerCase());

    const toInsert: any[] = [];
    const seen = new Set<string>();

    for (const msg of messages) {
      // Parse from header
      const participant = parseNameEmail(msg.from);
      if (!participant) continue;
      const emailLower = participant.email.toLowerCase();
      if (knownEmails.has(emailLower) || seen.has(emailLower)) continue;
      seen.add(emailLower);

      const rel = inferRelationship(emailLower);
      toInsert.push({
        id: `mail_${Buffer.from(emailLower).toString("base64").slice(0, 16)}_${Date.now().toString(36)}`,
        name: participant.name || participant.email.split("@")[0],
        email: participant.email,
        role: rel === "staff" ? "Staff" : rel === "client" ? "Contact" : undefined,
        created_at: Date.now(),
      });
    }

    if (toInsert.length === 0) {
      return NextResponse.json({ added: 0, message: "All participants already in contacts." });
    }

    const { error } = await db.from("contacts").insert(toInsert);
    if (error) throw new Error(error.message);

    return NextResponse.json({ added: toInsert.length, message: `Added ${toInsert.length} contacts from mail.` });
  } catch (e: any) {
    return NextResponse.json({ added: 0, message: `Sync failed: ${e?.message || String(e)}` }, { status: 500 });
  }
}
