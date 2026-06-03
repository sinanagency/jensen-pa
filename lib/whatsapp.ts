// WhatsApp Business (Meta Graph) bridge. Gated on env: it only sends when a WABA
// number and token are configured. The webhook lets Jensen read and reply to mail
// from WhatsApp. Because the webhook is server-initiated (no browser cookie), it
// uses mailbox creds stored in env (LR_MAIL_CREDS, the same encrypted blob the
// portal mints) so it can reach his inbox. Set both at activation.

export function waConfigured(): boolean {
  return Boolean(process.env.WHATSAPP_TOKEN && process.env.WHATSAPP_PHONE_NUMBER_ID);
}

export async function sendWhatsApp(to: string, body: string): Promise<boolean> {
  if (!waConfigured()) return false;
  try {
    const res = await fetch(`https://graph.facebook.com/v21.0/${process.env.WHATSAPP_PHONE_NUMBER_ID}/messages`, {
      method: "POST",
      headers: { Authorization: `Bearer ${process.env.WHATSAPP_TOKEN}`, "content-type": "application/json" },
      body: JSON.stringify({ messaging_product: "whatsapp", to, type: "text", text: { body: body.slice(0, 4000) } }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

// The owner's number that is allowed to drive the inbox over WhatsApp.
export function ownerNumber(): string | null {
  return process.env.OWNER_WHATSAPP || null;
}
