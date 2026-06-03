import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import { sendWhatsApp, waConfigured, ownerNumber } from "@/lib/whatsapp";

export const runtime = "nodejs";

// Shopify order webhook. Verifies the HMAC, then pings WhatsApp with the order.
// This works with no database (fire and forget). The persistent in-portal order
// feed is the later expansion, once Jensen's Supabase is up.
export async function POST(req: NextRequest) {
  const raw = await req.text();
  const secret = process.env.SHOPIFY_WEBHOOK_SECRET;
  if (secret) {
    const digest = crypto.createHmac("sha256", secret).update(raw, "utf8").digest("base64");
    const got = req.headers.get("x-shopify-hmac-sha256") || "";
    if (digest.length !== got.length || !crypto.timingSafeEqual(Buffer.from(digest), Buffer.from(got))) {
      return new NextResponse("invalid signature", { status: 401 });
    }
  }
  try {
    const o = JSON.parse(raw || "{}");
    const name = o.name || `#${o.order_number || ""}`;
    const amount = o.total_price ? `${o.currency || "AED"} ${o.total_price}` : "";
    const who = [o.customer?.first_name, o.customer?.last_name].filter(Boolean).join(" ") || o.email || "a customer";
    const items = Array.isArray(o.line_items) ? o.line_items.length : 0;
    const summary = `New Shopify order ${name}${amount ? ` for ${amount}` : ""} from ${who}${items ? ` (${items} item${items === 1 ? "" : "s"})` : ""}.`;
    const owner = ownerNumber();
    if (waConfigured() && owner) await sendWhatsApp(owner.replace(/[^0-9]/g, ""), summary);
  } catch { /* never fail the webhook back to Shopify */ }
  return NextResponse.json({ ok: true });
}
