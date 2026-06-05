"use client";

import { useMemo, useState } from "react";
import Shell from "@/components/Shell";
import { Plus, Trash2, FileText, Sparkles, Loader2 } from "lucide-react";

type Item = { description: string; qty: number; unitPrice: number };
const todayIso = () => new Date().toISOString().slice(0, 10);

export default function InvoicePage() {
  const [invoiceNo, setInvoiceNo] = useState("INV-001");
  const [date, setDate] = useState(todayIso());
  const [dueDate, setDueDate] = useState("");
  const [billTo, setBillTo] = useState("");
  const [billToAddress, setBillToAddress] = useState("");
  const [currency, setCurrency] = useState("AED");
  const [taxRate, setTaxRate] = useState(5);
  const [items, setItems] = useState<Item[]>([{ description: "", qty: 1, unitPrice: 0 }]);
  const [notes, setNotes] = useState("");
  const [terms, setTerms] = useState("Payment due within 14 days.");
  const [busy, setBusy] = useState(false);
  const [drafting, setDrafting] = useState(false);
  const [aiText, setAiText] = useState("");
  const [err, setErr] = useState("");

  const { subtotal, tax, total } = useMemo(() => {
    const s = items.reduce((a, it) => a + (Number(it.qty) || 0) * (Number(it.unitPrice) || 0), 0);
    const t = s * (taxRate / 100);
    return { subtotal: s, tax: t, total: s + t };
  }, [items, taxRate]);

  const money = (n: number) => `${currency} ${n.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const setItem = (i: number, patch: Partial<Item>) => setItems((arr) => arr.map((it, j) => (j === i ? { ...it, ...patch } : it)));
  const addItem = () => setItems((arr) => [...arr, { description: "", qty: 1, unitPrice: 0 }]);
  const delItem = (i: number) => setItems((arr) => (arr.length > 1 ? arr.filter((_, j) => j !== i) : arr));

  async function createPdf() {
    setErr(""); setBusy(true);
    try {
      const res = await fetch("/api/invoice", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ invoiceNo, date, dueDate, billTo, billToAddress, currency, taxRate, items: items.filter((i) => i.description.trim()), notes, terms }),
      });
      if (!res.ok) { setErr((await res.json().catch(() => ({})))?.error || `Failed (${res.status})`); return; }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url; a.download = `${invoiceNo || "invoice"}.pdf`; a.click();
      setTimeout(() => URL.revokeObjectURL(url), 4000);
    } catch (e: any) { setErr(e?.message || String(e)); } finally { setBusy(false); }
  }

  async function draftWithAI() {
    if (!aiText.trim()) return;
    setErr(""); setDrafting(true);
    try {
      const res = await fetch("/api/invoice", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ mode: "draft", text: aiText }) });
      const data = await res.json();
      if (!res.ok || !data.draft) { setErr(data?.error || "Draft failed"); return; }
      const d = data.draft;
      if (d.billTo) setBillTo(d.billTo);
      if (d.billToAddress) setBillToAddress(d.billToAddress);
      if (Array.isArray(d.items) && d.items.length) setItems(d.items.map((it: any) => ({ description: String(it.description || ""), qty: Number(it.qty) || 1, unitPrice: Number(it.unitPrice) || 0 })));
      if (d.notes) setNotes(d.notes);
      if (d.terms) setTerms(d.terms);
      setAiText("");
    } catch (e: any) { setErr(e?.message || String(e)); } finally { setDrafting(false); }
  }

  return (
    <Shell>
      <div className="page-hero fade-up">
        <div className="eyebrow">Studio</div>
        <h1>Invoice.</h1>
      </div>

      {/* AI draft */}
      <div className="card fade-up" style={{ padding: 18, marginBottom: 18 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10, fontWeight: 600 }}><Sparkles size={16} style={{ color: "var(--purple-2)" }} /> Draft with AI</div>
        <textarea className="input" rows={2} placeholder="Describe it in plain English, e.g. 'Invoice Zuma for a 2-day menu engineering engagement at 8,000 AED per day plus a 1,500 tasting'…" value={aiText} onChange={(e) => setAiText(e.target.value)} style={{ width: "100%", resize: "vertical" }} />
        <button className="btn ghost sm" onClick={draftWithAI} disabled={drafting} style={{ marginTop: 10 }}>{drafting ? <Loader2 size={14} style={{ animation: "spin 1s linear infinite" }} /> : <Sparkles size={14} />} {drafting ? "Drafting…" : "Fill the invoice"}</button>
      </div>

      <div className="grid cols-2" style={{ alignItems: "start" }}>
        {/* Form */}
        <div className="card fade-up" style={{ padding: 20, display: "flex", flexDirection: "column", gap: 12 }}>
          <div style={{ display: "flex", gap: 10 }}>
            <div style={{ flex: 1 }}><label className="muted" style={{ fontSize: 12 }}>Invoice #</label><input className="input" value={invoiceNo} onChange={(e) => setInvoiceNo(e.target.value)} /></div>
            <div style={{ flex: 1 }}><label className="muted" style={{ fontSize: 12 }}>Date</label><input className="input" type="date" value={date} onChange={(e) => setDate(e.target.value)} /></div>
            <div style={{ flex: 1 }}><label className="muted" style={{ fontSize: 12 }}>Due</label><input className="input" type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} /></div>
          </div>
          <div><label className="muted" style={{ fontSize: 12 }}>Bill to</label><input className="input" placeholder="Client name" value={billTo} onChange={(e) => setBillTo(e.target.value)} /></div>
          <div><label className="muted" style={{ fontSize: 12 }}>Address (optional)</label><textarea className="input" rows={2} placeholder="One line per row" value={billToAddress} onChange={(e) => setBillToAddress(e.target.value)} style={{ width: "100%", resize: "vertical" }} /></div>
          <div style={{ display: "flex", gap: 10 }}>
            <div style={{ flex: 1 }}><label className="muted" style={{ fontSize: 12 }}>Currency</label><input className="input" value={currency} onChange={(e) => setCurrency(e.target.value)} /></div>
            <div style={{ flex: 1 }}><label className="muted" style={{ fontSize: 12 }}>VAT %</label><input className="input" type="number" value={taxRate} onChange={(e) => setTaxRate(Number(e.target.value) || 0)} /></div>
          </div>

          <div style={{ marginTop: 4 }}>
            <label className="muted" style={{ fontSize: 12 }}>Line items</label>
            {items.map((it, i) => (
              <div key={i} style={{ display: "flex", gap: 8, marginTop: 8, alignItems: "center" }}>
                <input className="input" style={{ flex: "3 1 0" }} placeholder="Description" value={it.description} onChange={(e) => setItem(i, { description: e.target.value })} />
                <input className="input" style={{ flex: "0 1 60px" }} type="number" value={it.qty} onChange={(e) => setItem(i, { qty: Number(e.target.value) || 0 })} />
                <input className="input" style={{ flex: "1 1 90px" }} type="number" value={it.unitPrice} onChange={(e) => setItem(i, { unitPrice: Number(e.target.value) || 0 })} />
                <button className="btn ghost sm" onClick={() => delItem(i)} style={{ padding: "0 8px", color: "var(--faint)" }}><Trash2 size={13} /></button>
              </div>
            ))}
            <button className="btn ghost sm" onClick={addItem} style={{ marginTop: 10 }}><Plus size={14} /> Add line</button>
          </div>

          <div><label className="muted" style={{ fontSize: 12 }}>Notes</label><textarea className="input" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} style={{ width: "100%", resize: "vertical" }} /></div>
          <div><label className="muted" style={{ fontSize: 12 }}>Terms</label><input className="input" value={terms} onChange={(e) => setTerms(e.target.value)} /></div>
        </div>

        {/* Summary */}
        <div className="card feature fade-up" style={{ padding: 22, position: "sticky", top: 90 }}>
          <div className="eyebrow" style={{ marginBottom: 14 }}>Summary</div>
          <div style={{ display: "flex", justifyContent: "space-between", padding: "7px 0", fontSize: 14 }}><span className="muted">Subtotal</span><span>{money(subtotal)}</span></div>
          <div style={{ display: "flex", justifyContent: "space-between", padding: "7px 0", fontSize: 14 }}><span className="muted">VAT ({taxRate}%)</span><span>{money(tax)}</span></div>
          <div style={{ display: "flex", justifyContent: "space-between", padding: "12px 0", borderTop: "1px solid var(--line)", marginTop: 6, fontWeight: 700, fontSize: 18 }}><span>Total</span><span style={{ color: "var(--purple-2)" }}>{money(total)}</span></div>
          <button className="btn purple" onClick={createPdf} disabled={busy} style={{ width: "100%", marginTop: 16, justifyContent: "center" }}>{busy ? <Loader2 size={15} style={{ animation: "spin 1s linear infinite" }} /> : <FileText size={15} />} {busy ? "Generating…" : "Create invoice PDF"}</button>
          {err && <div className="err" style={{ marginTop: 12, fontSize: 13 }}>{err}</div>}
        </div>
      </div>

      <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
    </Shell>
  );
}
