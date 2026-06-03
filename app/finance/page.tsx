"use client";

import { useRef, useState } from "react";
import Shell from "@/components/Shell";
import { useDB } from "@/components/useDB";
import { FinanceRecord, uid } from "@/lib/store";
import { UAE_TAX, vatFromNet, corporateTax, aed } from "@/lib/tax";
import { dropFile } from "@/lib/drop";
import { Plus, Trash2, TrendingUp, TrendingDown, Receipt, Upload, Loader2, CheckCircle2 } from "lucide-react";

export default function FinancePage() {
  const { db, mutate } = useDB();

  const [kind, setKind] = useState<"income" | "expense">("income");
  const [label, setLabel] = useState<string>("");
  const [amount, setAmount] = useState<string>("");
  const [vatApplies, setVatApplies] = useState<boolean>(true);
  const [entityId, setEntityId] = useState<string>("");
  const [date, setDate] = useState<string>(new Date().toISOString().slice(0, 10));

  // drop-to-populate
  const [dropping, setDropping] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [dropMsg, setDropMsg] = useState<string>("");
  const fileRef = useRef<HTMLInputElement>(null);
  const dropDepth = useRef(0);

  async function handleFiles(files: FileList) {
    if (!files.length) return;
    setDropping(true); setDropMsg("");
    let last = "";
    for (const f of Array.from(files)) {
      const r = await dropFile(f, mutate);
      last = r.ok ? r.summary : `Could not read ${f.name}. ${r.error || ""}`;
    }
    setDropMsg(last); setDropping(false);
    setTimeout(() => setDropMsg(""), 7000);
  }

  if (!db) return <Shell><div className="muted">Loading…</div></Shell>;

  const totalIncome = db.finance
    .filter((f) => f.kind === "income")
    .reduce((sum, f) => sum + f.amount, 0);

  const totalExpense = db.finance
    .filter((f) => f.kind === "expense")
    .reduce((sum, f) => sum + f.amount, 0);

  const net = totalIncome - totalExpense;

  const totalVatOnIncome = db.finance
    .filter((f) => f.kind === "income" && f.vatApplies)
    .reduce((sum, f) => sum + vatFromNet(f.amount).vat, 0);

  const ct = corporateTax(net, totalIncome);

  const entityMap = new Map(db.entities.map((e) => [e.id, e.name]));

  function handleAdd(): void {
    const trimmedLabel = label.trim();
    const parsedAmount = Number(amount);
    if (!trimmedLabel || !parsedAmount || parsedAmount <= 0) return;
    mutate((d) => {
      d.finance.push({
        id: uid(),
        kind,
        amount: parsedAmount,
        vatApplies,
        label: trimmedLabel,
        date,
        entityId: entityId || undefined,
        createdAt: Date.now(),
      });
    });
    setLabel("");
    setAmount("");
    setVatApplies(true);
    setEntityId("");
  }

  function handleDelete(id: string): void {
    mutate((d) => {
      d.finance = d.finance.filter((f) => f.id !== id);
    });
  }

  const sorted = [...db.finance].sort((a, b) => b.createdAt - a.createdAt);

  return (
    <Shell>
      {/* Page hero */}
      <div className="page-hero fade-up">
        <div className="eyebrow">Finance</div>
        <h1>Your numbers, UAE ready.</h1>
      </div>

      {/* Headline card: one big net number */}
      <div className="card feature fade-up" style={{ padding: "30px 32px", marginBottom: 16 }}>
        <div className="muted" style={{ fontSize: 12, fontWeight: 600, letterSpacing: "0.06em", textTransform: "uppercase", marginBottom: 8 }}>
          Net position
        </div>
        <div
          style={{
            fontFamily: "var(--font-display)",
            fontSize: "clamp(32px, 5vw, 48px)",
            fontWeight: 700,
            letterSpacing: "-0.025em",
            color: net >= 0 ? "var(--success)" : "var(--danger)",
            lineHeight: 1.05,
            marginBottom: 18,
          }}
        >
          {aed(net)}
        </div>
        <div style={{ display: "flex", gap: 24, flexWrap: "wrap" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <TrendingUp size={16} color="var(--success)" />
            <span style={{ fontSize: 13, color: "var(--muted)" }}>Income</span>
            <span style={{ fontSize: 14, fontWeight: 600, color: "var(--success)" }}>{aed(totalIncome)}</span>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <TrendingDown size={16} color="var(--danger)" />
            <span style={{ fontSize: 13, color: "var(--muted)" }}>Expenses</span>
            <span style={{ fontSize: 14, fontWeight: 600, color: "var(--danger)" }}>{aed(totalExpense)}</span>
          </div>
        </div>
      </div>

      {/* Add record row */}
      <div className="card fade-up" style={{ padding: 20, marginBottom: 16 }}>
        <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
          {/* Kind toggle */}
          <div style={{ display: "flex", gap: 6, flexShrink: 0 }}>
            <button
              className="btn sm"
              onClick={() => setKind("income")}
              style={{
                background: kind === "income" ? "var(--success)" : "var(--glass-2)",
                color: kind === "income" ? "#0a0a0c" : "var(--muted)",
                border: kind === "income" ? "none" : "1px solid var(--line)",
                fontWeight: 700,
              }}
            >
              Income
            </button>
            <button
              className="btn sm"
              onClick={() => setKind("expense")}
              style={{
                background: kind === "expense" ? "var(--danger)" : "var(--glass-2)",
                color: kind === "expense" ? "#0a0a0c" : "var(--muted)",
                border: kind === "expense" ? "none" : "1px solid var(--line)",
                fontWeight: 700,
              }}
            >
              Expense
            </button>
          </div>

          {/* Label */}
          <input
            className="input"
            style={{ flex: "1 1 180px", minWidth: 140 }}
            placeholder="Label…"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") handleAdd(); }}
          />

          {/* Amount */}
          <input
            className="input"
            style={{ flex: "0 1 140px", minWidth: 110 }}
            type="number"
            placeholder="Net AED"
            min={0}
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") handleAdd(); }}
          />

          {/* VAT checkbox */}
          <label style={{ display: "flex", alignItems: "center", gap: 7, flexShrink: 0, cursor: "pointer", fontSize: 13, color: "var(--ink-2)", userSelect: "none" }}>
            <input
              type="checkbox"
              checked={vatApplies}
              onChange={(e) => setVatApplies(e.target.checked)}
              style={{ width: 16, height: 16, accentColor: "var(--purple)", cursor: "pointer" }}
            />
            VAT applies
          </label>

          {/* Entity */}
          <select
            className="input"
            style={{ flex: "0 1 160px", minWidth: 120 }}
            value={entityId}
            onChange={(e) => setEntityId(e.target.value)}
          >
            <option value="">No entity</option>
            {db.entities.map((e) => (
              <option key={e.id} value={e.id}>{e.name}</option>
            ))}
          </select>

          {/* Date */}
          <input
            className="input"
            style={{ flex: "0 1 150px", minWidth: 130 }}
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
          />

          <button className="btn purple sm" onClick={handleAdd} style={{ flexShrink: 0 }}>
            <Plus size={14} /> Add
          </button>
        </div>
      </div>

      {/* Drop zone: drop a receipt or invoice and I log it with VAT */}
      <div
        className="card fade-up"
        onDragEnter={(e) => { e.preventDefault(); dropDepth.current++; setDragOver(true); }}
        onDragOver={(e) => e.preventDefault()}
        onDragLeave={(e) => { e.preventDefault(); dropDepth.current--; if (dropDepth.current <= 0) setDragOver(false); }}
        onDrop={(e) => { e.preventDefault(); dropDepth.current = 0; setDragOver(false); if (e.dataTransfer.files?.length) handleFiles(e.dataTransfer.files); }}
        onClick={() => fileRef.current?.click()}
        style={{
          padding: 20, marginBottom: 16, cursor: "pointer", textAlign: "center",
          border: `1.5px dashed ${dragOver ? "var(--purple)" : "rgba(124,107,176,0.34)"}`,
          background: dragOver ? "rgba(124,107,176,0.10)" : "#ffffff",
        }}
      >
        <input ref={fileRef} type="file" multiple hidden accept="image/*,.pdf,.csv,.xlsx,.xls,.docx,.txt" onChange={(e) => { if (e.target.files) handleFiles(e.target.files); e.currentTarget.value = ""; }} />
        <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 10, color: "var(--purple)", fontWeight: 600 }}>
          {dropping ? <><Loader2 size={18} style={{ animation: "spin 1s linear infinite" }} /> Reading and logging…</> : <><Upload size={18} /> Drop a receipt or invoice, I log it with VAT</>}
        </div>
        <div className="muted" style={{ fontSize: 12.5, marginTop: 6 }}>PDF, photo, or spreadsheet. I read the amount, date, and VAT and add the record.</div>
        {dropMsg && <div style={{ marginTop: 12, display: "inline-flex", alignItems: "center", gap: 8, fontSize: 13.5, color: "var(--ink-2)", background: "rgba(52,211,153,0.12)", border: "1px solid rgba(52,211,153,0.35)", borderRadius: 10, padding: "8px 12px" }}><CheckCircle2 size={15} style={{ color: "var(--success)" }} /> {dropMsg}</div>}
      </div>
      <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>

      {/* Tax position card + Records: side by side on wide, stacked on narrow */}
      <div className="grid cols-2 fade-up" style={{ alignItems: "start", marginBottom: 16 }}>

        {/* Tax position */}
        <div className="card" style={{ padding: 24 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 20 }}>
            <Receipt size={16} color="var(--purple-2)" />
            <div style={{ fontWeight: 700, fontSize: 15 }}>Tax position</div>
          </div>

          {/* VAT */}
          <div style={{ marginBottom: 20, paddingBottom: 20, borderBottom: "1px solid var(--line)" }}>
            <div style={{ fontSize: 12, color: "var(--muted)", fontWeight: 600, letterSpacing: "0.05em", textTransform: "uppercase", marginBottom: 10 }}>
              VAT
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 6 }}>
              <span style={{ fontSize: 13, color: "var(--ink-2)" }}>Output VAT on vatable income</span>
              <span style={{ fontWeight: 700, fontSize: 15, color: "var(--ink)" }}>{aed(totalVatOnIncome)}</span>
            </div>
            <div style={{ display: "flex", gap: 8, marginBottom: 8, flexWrap: "wrap" }}>
              <span className="pill">Standard rate: {(UAE_TAX.vat.standardRate * 100).toFixed(0)}%</span>
              <span className="pill">Reg. threshold: {aed(UAE_TAX.vat.mandatoryRegThreshold)}</span>
            </div>
            <div className="muted" style={{ fontSize: 12, lineHeight: 1.6 }}>{UAE_TAX.vat.filingNote}</div>
          </div>

          {/* Corporate tax */}
          <div>
            <div style={{ fontSize: 12, color: "var(--muted)", fontWeight: 600, letterSpacing: "0.05em", textTransform: "uppercase", marginBottom: 10 }}>
              Corporate tax estimate
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 6 }}>
              <span style={{ fontSize: 13, color: "var(--ink-2)" }}>Estimated CT liability</span>
              <span style={{ fontWeight: 700, fontSize: 15, color: ct.tax > 0 ? "var(--danger)" : "var(--success)" }}>{aed(ct.tax)}</span>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 12 }}>
              <span style={{ fontSize: 13, color: "var(--ink-2)" }}>Effective rate</span>
              <span style={{ fontSize: 13, fontWeight: 600, color: "var(--ink-2)" }}>{(ct.effectiveRate * 100).toFixed(2)}%</span>
            </div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: ct.smallBusinessReliefMayApply ? 10 : 0 }}>
              <span className="pill">{aed(ct.zeroBand)} at 0%</span>
              <span className="pill">9% above band</span>
            </div>
            {ct.smallBusinessReliefMayApply && (
              <span className="pill accent" style={{ marginTop: 10 }}>
                Small Business Relief may apply
              </span>
            )}
          </div>

          {/* Footer */}
          <div className="faint" style={{ fontSize: 11, marginTop: 20, lineHeight: 1.6, paddingTop: 16, borderTop: "1px solid var(--line)" }}>
            Figures from {UAE_TAX.source} Last reviewed {UAE_TAX.lastReviewed}. Verify before filing.
          </div>
        </div>

        {/* Records list */}
        <div className="card" style={{ padding: 24 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 20 }}>
            <div style={{ fontWeight: 700, fontSize: 15 }}>Records</div>
            <span className="pill" style={{ marginLeft: "auto", fontSize: 11 }}>{db.finance.length}</span>
          </div>

          {sorted.length === 0 && (
            <div className="faint" style={{ fontSize: 13 }}>No records yet. Add one above.</div>
          )}

          {sorted.map((record: FinanceRecord) => {
            const entityName = record.entityId ? entityMap.get(record.entityId) : undefined;
            const vatAmt = record.vatApplies ? vatFromNet(record.amount).vat : 0;
            const isIncome = record.kind === "income";

            return (
              <div
                key={record.id}
                style={{
                  display: "flex",
                  alignItems: "flex-start",
                  gap: 10,
                  padding: "12px 0",
                  borderTop: "1px solid var(--line)",
                }}
              >
                {/* Icon */}
                <div style={{ paddingTop: 2, flexShrink: 0 }}>
                  {isIncome
                    ? <TrendingUp size={14} color="var(--success)" />
                    : <TrendingDown size={14} color="var(--danger)" />
                  }
                </div>

                {/* Content */}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13.5, fontWeight: 500, color: "var(--ink)", marginBottom: 4, lineHeight: 1.4 }}>
                    {record.label}
                  </div>
                  <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
                    {entityName && (
                      <span className="pill" style={{ fontSize: 11, height: 22 }}>{entityName}</span>
                    )}
                    <span className="faint" style={{ fontSize: 11 }}>{record.date}</span>
                    {record.vatApplies && (
                      <span className="pill accent" style={{ fontSize: 11, height: 22 }}>
                        VAT {aed(vatAmt)}
                      </span>
                    )}
                  </div>
                </div>

                {/* Amount */}
                <div style={{ flexShrink: 0, textAlign: "right" }}>
                  <div
                    style={{
                      fontWeight: 700,
                      fontSize: 14,
                      color: isIncome ? "var(--success)" : "var(--danger)",
                    }}
                  >
                    {isIncome ? "+" : "-"}{aed(record.amount)}
                  </div>
                </div>

                {/* Delete */}
                <button
                  className="btn ghost sm"
                  onClick={() => handleDelete(record.id)}
                  title="Delete record"
                  style={{ padding: "0 8px", height: 28, flexShrink: 0, color: "var(--faint)" }}
                >
                  <Trash2 size={13} />
                </button>
              </div>
            );
          })}
        </div>
      </div>
    </Shell>
  );
}
