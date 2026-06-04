// app/shopify/page.tsx — AUTO-CONNECTED. No manual setup. Reads live status + orders.
"use client";

import { useEffect, useState } from "react";
import Shell from "@/components/Shell";
import { ShoppingBag, CheckCircle2, Truck, ExternalLink, AlertTriangle } from "lucide-react";

type Order = { name: string; total: string; currency: string; customer: string; items: string[]; fulfillment: string; tracking: string | null; createdAt: string };
type Status = { connected: boolean; reason?: string; error?: string; store?: { name: string; domain: string; currency: string }; orderCount?: number; revenue?: string; webhookLive?: boolean; orders?: Order[] };

export default function Shopify() {
  const [s, setS] = useState<Status | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/shopify/status", { cache: "no-store" }).then((r) => r.json()).then(setS).catch(() => setS({ connected: false, reason: "error" })).finally(() => setLoading(false));
  }, []);

  return (
    <Shell>
      <div className="page-hero fade-up">
        <div className="eyebrow">Store</div>
        <h1>Upaya orders, live.</h1>
      </div>

      {loading && <p className="muted">Connecting to your store…</p>}

      {!loading && s?.connected && (
        <>
          {/* ONE headline metric, the rest demoted */}
          <div className="card feature" style={{ padding: 24, marginBottom: 18 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, color: "var(--purple-2)", fontSize: 13, fontWeight: 600 }}>
              <CheckCircle2 size={16} /> Connected to {s.store?.name} · {s.store?.domain}
              {s.webhookLive && <span className="pill accent" style={{ marginLeft: 8 }}>Live feed on</span>}
            </div>
            <div style={{ fontSize: 44, fontWeight: 700, marginTop: 14, letterSpacing: "-0.02em" }}>
              {s.store?.currency} {Number(s.revenue).toLocaleString()}
            </div>
            <div className="muted" style={{ marginTop: 2 }}>{s.orderCount} order{s.orderCount === 1 ? "" : "s"} all-time · auto-synced, nothing to set up</div>
          </div>

          {/* Live order feed */}
          <div className="card" style={{ padding: 0, overflow: "hidden" }}>
            <div style={{ padding: "14px 18px", borderBottom: "1px solid var(--line)", fontWeight: 600, display: "flex", alignItems: "center", gap: 8 }}>
              <ShoppingBag size={16} style={{ color: "var(--purple-2)" }} /> Recent orders
            </div>
            {(s.orders || []).map((o, i) => (
              <div key={i} style={{ padding: "14px 18px", borderBottom: "1px solid var(--line)", display: "flex", justifyContent: "space-between", gap: 16 }}>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontWeight: 600 }}>{o.name} · {o.customer}</div>
                  <div className="muted" style={{ fontSize: 13, marginTop: 2, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{o.items.join(", ")}</div>
                </div>
                <div style={{ textAlign: "right", flex: "none" }}>
                  <div style={{ fontWeight: 600 }}>{o.currency} {o.total}</div>
                  <div className="muted" style={{ fontSize: 12, marginTop: 2, display: "flex", alignItems: "center", gap: 4, justifyContent: "flex-end" }}>
                    <Truck size={12} /> {o.fulfillment}
                    {o.tracking && <a href={o.tracking} target="_blank" rel="noreferrer" style={{ color: "var(--purple-2)" }}><ExternalLink size={12} /></a>}
                  </div>
                </div>
              </div>
            ))}
            {(!s.orders || !s.orders.length) && <div className="muted" style={{ padding: 18 }}>No orders yet — they'll appear here the moment they land.</div>}
          </div>
        </>
      )}

      {!loading && s && !s.connected && (
        <div className="card" style={{ padding: 20, display: "flex", gap: 10, alignItems: "flex-start" }}>
          <AlertTriangle size={18} style={{ color: "#e0a800", flex: "none", marginTop: 2 }} />
          <div>
            <div style={{ fontWeight: 600 }}>Store not reachable</div>
            <div className="muted" style={{ fontSize: 13, marginTop: 4 }}>
              {s.reason === "not_configured" ? "Shopify credentials aren't set on the server yet." : `Connection error: ${s.error || "unknown"}`}
            </div>
          </div>
        </div>
      )}
    </Shell>
  );
}
