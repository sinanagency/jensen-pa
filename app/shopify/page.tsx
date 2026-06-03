"use client";

import { useEffect, useState } from "react";
import Shell from "@/components/Shell";
import { ShoppingBag, Bell, Copy, Check } from "lucide-react";

export default function Shopify() {
  const [domain, setDomain] = useState("");
  const [saved, setSaved] = useState(false);
  const [copied, setCopied] = useState(false);
  const [origin, setOrigin] = useState("");

  useEffect(() => {
    setOrigin(window.location.origin);
    setDomain(localStorage.getItem("lr.shopify.domain") || "");
  }, []);

  const webhookUrl = `${origin}/api/shopify/webhook`;

  function save() {
    localStorage.setItem("lr.shopify.domain", domain.trim());
    setSaved(true); setTimeout(() => setSaved(false), 1500);
  }
  function copy() {
    navigator.clipboard.writeText(webhookUrl);
    setCopied(true); setTimeout(() => setCopied(false), 1500);
  }

  return (
    <Shell>
      <div className="page-hero fade-up">
        <div className="eyebrow">Store</div>
        <h1>Your orders, on WhatsApp.</h1>
      </div>
      <p className="muted" style={{ marginTop: -10, marginBottom: 18, maxWidth: 620 }}>
        Connect a Shopify store and every order pings you on WhatsApp the moment it lands. The live order feed and revenue view land here next, once your database is up.
      </p>

      <div className="grid cols-2">
        <div className="card feature" style={{ padding: 20 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
            <ShoppingBag size={18} style={{ color: "var(--purple-2)" }} />
            <div style={{ fontWeight: 600 }}>Connect your store</div>
          </div>
          <label>Shopify store domain</label>
          <input value={domain} onChange={(e) => setDomain(e.target.value)} placeholder="your-store.myshopify.com" style={{ margin: "8px 0 12px" }} />
          <button className="btn ghost sm" onClick={save}>{saved ? "Saved" : "Save store"}</button>

          <div style={{ marginTop: 18 }}>
            <label>Webhook URL (paste into Shopify)</label>
            <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
              <input readOnly value={webhookUrl} style={{ flex: 1, fontSize: 12.5, color: "var(--ink-2)" }} />
              <button className="btn ghost sm" onClick={copy} style={{ flex: "none" }}>{copied ? <Check size={14} /> : <Copy size={14} />}</button>
            </div>
            <div className="faint" style={{ fontSize: 11.5, marginTop: 8 }}>
              In Shopify: Settings, Notifications, Webhooks, create an "Order creation" webhook (JSON) pointing here.
            </div>
          </div>
        </div>

        <div className="card" style={{ padding: 20 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
            <Bell size={18} style={{ color: "var(--purple-2)" }} />
            <div style={{ fontWeight: 600 }}>What lands now, what expands</div>
          </div>
          <ul style={{ margin: 0, paddingLeft: 18, fontSize: 14, lineHeight: 1.7, color: "var(--ink-2)" }}>
            <li><strong>Now:</strong> each new order pings your WhatsApp instantly, once the WhatsApp number is connected.</li>
            <li><strong>Next:</strong> a live order feed and a revenue headline on this tab.</li>
            <li><strong>Later:</strong> best sellers, repeat customers, and ties into the finance view.</li>
          </ul>
          <div className="pill accent" style={{ marginTop: 16 }}>Foundation tab, expanding</div>
        </div>
      </div>
    </Shell>
  );
}
