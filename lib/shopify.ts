// Shopify Admin API access for the new Dev Dashboard model.
//
// The new dev.shopify.com apps DON'T hand you a permanent shpat_ token. They give
// a Client ID + Client Secret, and you exchange them for a SHORT-LIVED (~24h) token
// via the client_credentials grant. So we mint on demand and cache until it expires.
// Ref: https://shopify.dev/docs/apps/build/dev-dashboard/get-api-access-tokens?lang=node
//
// Env (set on Vercel):
//   SHOPIFY_STORE          = <store>.myshopify.com
//   SHOPIFY_CLIENT_ID      = ce19...
//   SHOPIFY_CLIENT_SECRET  = shpss_65d2...   (the shpss_ prefix is REQUIRED)
//   SHOPIFY_API_VERSION    = 2025-01 (optional)

const STORE = () => process.env.SHOPIFY_STORE!;
const VERSION = () => process.env.SHOPIFY_API_VERSION || "2025-01";

let cached: { token: string; expiresAt: number } | null = null;

// Mint (or reuse) an Admin API access token. Refreshes 5 min before expiry.
export async function getToken(): Promise<string> {
  if (cached && Date.now() < cached.expiresAt - 300_000) return cached.token;
  const res = await fetch(`https://${STORE()}/admin/oauth/access_token`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      client_id: process.env.SHOPIFY_CLIENT_ID,
      client_secret: process.env.SHOPIFY_CLIENT_SECRET,
      grant_type: "client_credentials",
    }),
  });
  if (!res.ok) throw new Error(`Shopify token mint failed: ${res.status} ${await res.text()}`);
  const j = await res.json();
  cached = { token: j.access_token, expiresAt: Date.now() + (j.expires_in ?? 86399) * 1000 };
  return cached.token;
}

// Authenticated Admin API call (REST). Path is relative, e.g. "orders.json?status=any".
export async function adminApi(path: string, init: RequestInit = {}): Promise<Response> {
  const token = await getToken();
  return fetch(`https://${STORE()}/admin/api/${VERSION()}/${path}`, {
    ...init,
    headers: { "X-Shopify-Access-Token": token, "content-type": "application/json", ...(init.headers || {}) },
  });
}

// Register the orders/create webhook -> our bot endpoint. Idempotent-ish: dedupes by address.
export async function ensureOrderWebhook(callbackUrl: string): Promise<void> {
  const existing = await (await adminApi("webhooks.json")).json();
  if ((existing.webhooks || []).some((w: any) => w.address === callbackUrl && w.topic === "orders/create")) return;
  const r = await adminApi("webhooks.json", {
    method: "POST",
    body: JSON.stringify({ webhook: { topic: "orders/create", address: callbackUrl, format: "json" } }),
  });
  if (!r.ok) throw new Error(`webhook create failed: ${r.status} ${await r.text()}`);
}

// Pull all orders (for the one-time backfill into the brain).
export async function fetchAllOrders(): Promise<any[]> {
  const out: any[] = [];
  let url = `orders.json?status=any&limit=250`;
  // (For >250 orders, follow the Link: rel="next" header — store volumes are low, so one page is plenty for now.)
  const r = await adminApi(url);
  const j = await r.json();
  out.push(...(j.orders || []));
  return out;
}

// A compact, grounded snapshot of the store for the assistant to answer order
// questions (sales, revenue, customers, delivery/tracking). Returns null if not
// configured or unreachable, so chat degrades gracefully and never blocks.
export async function ordersContext(): Promise<string | null> {
  if (!(process.env.SHOPIFY_STORE && process.env.SHOPIFY_CLIENT_ID && process.env.SHOPIFY_CLIENT_SECRET)) return null;
  try {
    const shop = (await (await adminApi("shop.json")).json()).shop || {};
    const count = (await (await adminApi("orders/count.json?status=any")).json()).count;
    const orders = (await (await adminApi("orders.json?status=any&limit=15&order=created_at%20desc")).json()).orders || [];
    const cur = shop.currency || "AED";
    const revenue = orders.reduce((s: number, o: any) => s + parseFloat(o.total_price || "0"), 0).toFixed(2);
    const lines = orders.map((o: any) => {
      const who = [o.customer?.first_name, o.customer?.last_name].filter(Boolean).join(" ") || o.email || "unknown";
      const items = (o.line_items || []).map((l: any) => `${l.title}${l.quantity > 1 ? ` x${l.quantity}` : ""}`).join(", ");
      const f = (o.fulfillments || [])[0];
      const track = f?.tracking_number ? `, tracking ${f.tracking_number} (${f.tracking_company || "courier"})` : "";
      return `${o.name} — ${o.currency || cur} ${o.total_price}, ${who}, [${items}], ${o.fulfillment_status || "unfulfilled"}${track}, ordered ${(o.created_at || "").slice(0, 10)}`;
    });
    return `Store: ${shop.name} (${cur}). Total orders all-time: ${count}. Recent ${orders.length} orders revenue: ${cur} ${revenue}.\n` + lines.map((l: string) => `- ${l}`).join("\n");
  } catch {
    return null;
  }
}
