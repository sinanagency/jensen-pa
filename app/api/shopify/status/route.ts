// app/api/shopify/status/route.ts
// Auto-connected status for the /shopify tab. No manual setup, no user input:
// reads creds from env, mints a token, and returns live connection + orders.
// Works WITHOUT the Supabase persistence layer — pulls straight from Shopify.
import { NextResponse } from "next/server";
import { adminApi, getToken } from "@/lib/shopify";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const configured = !!(process.env.SHOPIFY_STORE && process.env.SHOPIFY_CLIENT_ID && process.env.SHOPIFY_CLIENT_SECRET);
  if (!configured) return NextResponse.json({ connected: false, reason: "not_configured" });
  try {
    await getToken(); // proves creds are valid
    const shop = await (await adminApi("shop.json")).json();
    const countRes = await (await adminApi("orders/count.json?status=any")).json();
    const ordersRes = await (await adminApi("orders.json?status=any&limit=20&order=created_at%20desc")).json();
    const webhooks = await (await adminApi("webhooks.json")).json();
    const orders = (ordersRes.orders || []).map((o: any) => ({
      name: o.name,
      total: o.total_price,
      currency: o.currency,
      customer: [o.customer?.first_name, o.customer?.last_name].filter(Boolean).join(" ") || o.email || "—",
      items: (o.line_items || []).map((l: any) => `${l.title}${l.quantity > 1 ? ` ×${l.quantity}` : ""}`),
      fulfillment: o.fulfillment_status || "unfulfilled",
      tracking: (o.fulfillments || [])[0]?.tracking_url || null,
      createdAt: o.created_at,
    }));
    const revenue = orders.reduce((s: number, o: any) => s + parseFloat(o.total || "0"), 0);
    return NextResponse.json({
      connected: true,
      store: { name: shop.shop?.name, domain: process.env.SHOPIFY_STORE, currency: shop.shop?.currency },
      orderCount: countRes.count ?? orders.length,
      revenue: revenue.toFixed(2),
      webhookLive: (webhooks.webhooks || []).some((w: any) => w.topic === "orders/create"),
      orders,
    });
  } catch (e: any) {
    // Surface the real error, never fake a healthy state.
    return NextResponse.json({ connected: false, reason: "error", error: e?.message || String(e) }, { status: 502 });
  }
}
