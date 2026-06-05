"use client";

import { useState } from "react";
import Shell from "@/components/Shell";
import { useDB } from "@/components/useDB";
import { ScrollText, Loader2, Download, Save, ShieldCheck } from "lucide-react";

const TYPES = [
  { id: "nda", label: "Non disclosure agreement" },
  { id: "service", label: "Services agreement" },
  { id: "consultancy", label: "Consultancy agreement" },
  { id: "engagement", label: "Engagement letter" },
  { id: "letter", label: "Formal letter" },
];

export default function Legal() {
  const { db, mutate } = useDB();
  const [blueprint, setBlueprint] = useState<string | null>(null);
  const [savedFlash, setSavedFlash] = useState(false);
  const [type, setType] = useState("nda");
  const [title, setTitle] = useState("");
  const [details, setDetails] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  if (!db) return <Shell><div className="muted">Loading…</div></Shell>;
  const bp = blueprint ?? db.legalBlueprint ?? "";

  function saveBlueprint() {
    mutate((d) => { d.legalBlueprint = bp; });
    setSavedFlash(true); setTimeout(() => setSavedFlash(false), 1600);
  }

  async function generate() {
    if (!title.trim() || !details.trim()) return;
    setBusy(true); setErr("");
    try {
      const grounded = (bp ? `Standing legal blueprint and preferences to honour:\n${bp}\n\n` : "") + details;
      const res = await fetch("/api/generate", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ type, title, details: grounded }),
      });
      const ct = res.headers.get("content-type") || "";
      if (ct.includes("application/json")) { const j = await res.json(); setErr(j.error || "Generation failed."); return; }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      if (ct.includes("pdf")) { a.download = `${title}.pdf`; a.style.display = "none"; document.body.appendChild(a); a.click(); a.remove(); } else { window.open(url, "_blank"); }
      setTimeout(() => URL.revokeObjectURL(url), 60000);
    } catch (e: any) { setErr(e?.message || "Failed."); } finally { setBusy(false); }
  }

  return (
    <Shell>
      <div className="page-hero fade-up">
        <div className="eyebrow">Legal</div>
        <h1>Your legal corner.</h1>
      </div>
      <p className="muted" style={{ marginTop: -10, marginBottom: 18, maxWidth: 640 }}>
        Set your standing terms once, then generate agreements grounded in them. I draft, you review. For binding documents, have a UAE lawyer glance before signing.
      </p>

      <div className="grid cols-2">
        {/* blueprint */}
        <div className="card" style={{ padding: 20 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
            <ShieldCheck size={18} style={{ color: "var(--purple-2)" }} />
            <div style={{ fontWeight: 600 }}>Legal blueprint</div>
          </div>
          <p className="faint" style={{ fontSize: 12.5, marginBottom: 10 }}>
            Your standing preferences: governing law, payment terms, confidentiality stance, anything I should always reflect.
          </p>
          <textarea className="input" rows={9} value={bp} onChange={(e) => setBlueprint(e.target.value)}
            placeholder={"e.g. Governing law: Dubai, UAE. Always mutual NDAs. Net 14 payment terms. No personal liability. Data handled under zero retention terms."} />
          <button className="btn ghost sm" onClick={saveBlueprint} style={{ marginTop: 12 }}>
            <Save size={14} /> {savedFlash ? "Saved" : "Save blueprint"}
          </button>
        </div>

        {/* generator */}
        <div className="card feature" style={{ padding: 20 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
            <ScrollText size={18} style={{ color: "var(--purple-2)" }} />
            <div style={{ fontWeight: 600 }}>Draft a legal document</div>
          </div>
          <label>Type</label>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8, margin: "8px 0 14px" }}>
            {TYPES.map((t) => (
              <button key={t.id} className={`pill ${type === t.id ? "accent" : ""}`} onClick={() => setType(t.id)} style={{ cursor: "pointer", height: 32 }}>{t.label}</button>
            ))}
          </div>
          <label>Title</label>
          <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Mutual NDA with Khalifa Hospitality" style={{ margin: "8px 0 14px" }} />
          <label>Details</label>
          <textarea className="input" rows={5} value={details} onChange={(e) => setDetails(e.target.value)} style={{ marginTop: 8 }}
            placeholder="Who are the parties, what is the purpose, key terms, anything specific." />
          <button className="btn purple" onClick={generate} disabled={busy || !title.trim() || !details.trim()} style={{ marginTop: 14 }}>
            {busy ? <><Loader2 size={15} style={{ animation: "spin 1s linear infinite" }} /> Drafting…</> : <><Download size={15} /> Generate document</>}
          </button>
          {err && <div className="err">{err}</div>}
          <div className="faint" style={{ fontSize: 11.5, marginTop: 12 }}>Drafts in your blueprint terms. Not a substitute for legal advice.</div>
        </div>
      </div>

      <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
    </Shell>
  );
}
