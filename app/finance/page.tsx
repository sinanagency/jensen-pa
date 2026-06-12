"use client";

import { useRef, useState } from "react";
import Shell from "@/components/Shell";
import { useDB } from "@/components/useDB";
import { FinanceRecord, uid } from "@/lib/store";
import { UAE_TAX, vatFromNet, corporateTax, aed } from "@/lib/tax";
import { dropFile } from "@/lib/drop";
import { Plus, Trash2, TrendingUp, TrendingDown, Receipt, Upload, Loader2, CheckCircle2, RefreshCw, BarChart3, Paperclip } from "lucide-react";

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
            Figures from {UAE_TAX.source}. Last reviewed {UAE_TAX.lastReviewed}. Verify before filing.
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
                    {record.receiptUrl && (
                      <a
                        href={`/api/finance/receipt?path=${encodeURIComponent(record.receiptUrl)}`}
                        target="_blank"
                        rel="noopener"
                        className="pill"
                        style={{ fontSize: 11, height: 22, display: "inline-flex", alignItems: "center", gap: 4, textDecoration: "none" }}
                        title="Open the original file"
                      >
                        <Paperclip size={11} /> Receipt
                      </a>
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

      {/* P&L by month bar chart */}
      <PLChart records={db.finance} />

      {/* Recurring expenses */}
      <RecurringSection mutate={mutate} entities={db.entities} />

    </Shell>
  );
}

// ---------- P&L by month chart ----------
function PLChart({ records }: { records: FinanceRecord[] }) {
  // Build last 6 months
  const now = new Date();
  const months: { key: string; label: string; income: number; expense: number }[] = [];
  for (let i = 5; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    const label = d.toLocaleString("en", { month: "short" });
    months.push({ key, label, income: 0, expense: 0 });
  }
  for (const r of records) {
    const mo = r.date.slice(0, 7);
    const m = months.find((x) => x.key === mo);
    if (!m) continue;
    if (r.kind === "income") m.income += r.amount;
    else m.expense += r.amount;
  }
  const maxVal = Math.max(...months.map((m) => Math.max(m.income, m.expense)), 1);

  return (
    <div className="card fade-up" style={{ padding: 24, marginBottom: 16 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 20 }}>
        <BarChart3 size={16} color="var(--purple-2)" />
        <div style={{ fontWeight: 700, fontSize: 15 }}>P&amp;L by month</div>
        <div style={{ marginLeft: "auto", display: "flex", gap: 12, fontSize: 11.5, color: "var(--muted)" }}>
          <span style={{ display: "flex", alignItems: "center", gap: 5 }}><span style={{ width: 10, height: 10, borderRadius: 3, background: "var(--success)", display: "inline-block" }} /> Income</span>
          <span style={{ display: "flex", alignItems: "center", gap: 5 }}><span style={{ width: 10, height: 10, borderRadius: 3, background: "var(--danger)", display: "inline-block" }} /> Expenses</span>
        </div>
      </div>
      <div style={{ display: "flex", alignItems: "flex-end", gap: 16, height: 140 }}>
        {months.map((m) => {
          const incH = Math.round((m.income / maxVal) * 110);
          const expH = Math.round((m.expense / maxVal) * 110);
          return (
            <div key={m.key} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 5, height: "100%", justifyContent: "flex-end" }}>
              <div style={{ display: "flex", alignItems: "flex-end", gap: 4, width: "100%" }}>
                <div style={{ flex: 1, height: incH || 2, background: "var(--success)", borderRadius: "5px 5px 3px 3px", opacity: 0.8, transition: "height 0.5s" }} title={`Income: AED ${m.income.toFixed(0)}`} />
                <div style={{ flex: 1, height: expH || 2, background: "var(--danger)", borderRadius: "5px 5px 3px 3px", opacity: 0.8, transition: "height 0.5s" }} title={`Expenses: AED ${m.expense.toFixed(0)}`} />
              </div>
              <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 2 }}>{m.label}</div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ---------- Recurring expenses section ----------
type RecurringRow = {
  id: string;
  label: string;
  amount: number;
  frequency: "monthly" | "quarterly" | "annual";
  vatApplies: boolean;
  entity?: string;
  active: boolean;
};

function RecurringSection({ mutate, entities }: { mutate: (fn: (d: import("@/lib/store").DB) => void) => void; entities: import("@/lib/store").Entity[] }) {
  const [open, setOpen] = useState(false);
  const [rlabel, setRlabel] = useState("");
  const [ramount, setRamount] = useState("");
  const [rfreq, setRfreq] = useState<"monthly" | "quarterly" | "annual">("monthly");
  const [rvat, setRvat] = useState(false);
  const [rentity, setRentity] = useState("");

  // Recurring expenses are stored as notes with kind="note" and a special prefix.
  // For a lightweight implementation without a separate Supabase table migration
  // being live, we store them in localStorage only via a React state approach.
  // (The migration is on disk for when Supabase is available.)
  const [recurring, setRecurring] = useState<RecurringRow[]>(() => {
    if (typeof window === "undefined") return [];
    try { return JSON.parse(localStorage.getItem("lr.recurring") || "[]"); } catch { return []; }
  });

  function saveRecurring(rows: RecurringRow[]) {
    setRecurring(rows);
    try { localStorage.setItem("lr.recurring", JSON.stringify(rows)); } catch {}
  }

  function addRecurring() {
    const trimmed = rlabel.trim();
    const amt = Number(ramount);
    if (!trimmed || !amt || amt <= 0) return;
    const id = Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
    saveRecurring([...recurring, { id, label: trimmed, amount: amt, frequency: rfreq, vatApplies: rvat, entity: rentity || undefined, active: true }]);
    setRlabel(""); setRamount(""); setRvat(false); setRentity(""); setOpen(false);
  }

  function logNow(r: RecurringRow) {
    const today = new Date().toISOString().slice(0, 10);
    const newId = Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
    mutate((d) => {
      d.finance.push({
        id: newId, kind: "expense", amount: r.amount, vatApplies: r.vatApplies,
        label: `${r.label} (recurring)`, date: today, createdAt: Date.now(),
      });
    });
  }

  function removeRecurring(id: string) {
    saveRecurring(recurring.filter((r) => r.id !== id));
  }

  const FREQ_LABELS: Record<string, string> = { monthly: "Monthly", quarterly: "Quarterly", annual: "Annual" };

  return (
    <div className="card fade-up" style={{ padding: 24, marginBottom: 16 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: recurring.length > 0 ? 16 : 0 }}>
        <RefreshCw size={15} color="var(--purple-2)" />
        <div style={{ fontWeight: 700, fontSize: 15 }}>Recurring expenses</div>
        <div className="pill" style={{ marginLeft: "auto", fontSize: 11 }}>{recurring.filter((r) => r.active).length}</div>
        <button className="btn purple sm" onClick={() => setOpen(!open)} style={{ height: 30, padding: "0 12px", fontSize: 12 }}>
          <Plus size={12} /> Add
        </button>
      </div>

      {open && (
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 16, padding: 16, background: "rgba(18,20,28,0.04)", borderRadius: 12, border: "1px solid var(--line)" }}>
          <input className="input" style={{ flex: "1 1 160px" }} placeholder="Label (e.g. Office rent)" value={rlabel} onChange={(e) => setRlabel(e.target.value)} />
          <input className="input" type="number" style={{ flex: "0 1 130px" }} placeholder="AED amount" value={ramount} onChange={(e) => setRamount(e.target.value)} />
          <select className="input" style={{ flex: "0 1 140px" }} value={rfreq} onChange={(e) => setRfreq(e.target.value as "monthly" | "quarterly" | "annual")}>
            <option value="monthly">Monthly</option>
            <option value="quarterly">Quarterly</option>
            <option value="annual">Annual</option>
          </select>
          <select className="input" style={{ flex: "0 1 160px" }} value={rentity} onChange={(e) => setRentity(e.target.value)}>
            <option value="">No entity</option>
            {entities.map((en) => <option key={en.id} value={en.id}>{en.name}</option>)}
          </select>
          <label style={{ display: "inline-flex", alignItems: "center", gap: 7, fontSize: 13, color: "var(--ink-2)", cursor: "pointer", textTransform: "none", letterSpacing: "normal" }}>
            <input type="checkbox" checked={rvat} onChange={(e) => setRvat(e.target.checked)} style={{ width: 15, height: 15, accentColor: "var(--purple)" }} /> VAT
          </label>
          <button className="btn purple sm" onClick={addRecurring} style={{ flexShrink: 0 }}><Plus size={13} /> Save</button>
        </div>
      )}

      {recurring.length === 0 && !open && (
        <div className="faint" style={{ fontSize: 13 }}>No recurring expenses yet. Add rent, retainers, subscriptions.</div>
      )}

      {recurring.map((r) => (
        <div key={r.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "11px 0", borderTop: "1px solid var(--line)" }}>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 13.5, fontWeight: 500, color: "var(--ink)" }}>{r.label}</div>
            <div style={{ display: "flex", gap: 6, marginTop: 4, flexWrap: "wrap" }}>
              <span className="pill" style={{ fontSize: 11, height: 22 }}>{FREQ_LABELS[r.frequency]}</span>
              {r.vatApplies && <span className="pill accent" style={{ fontSize: 11, height: 22 }}>VAT</span>}
            </div>
          </div>
          <div style={{ fontWeight: 700, fontSize: 14, color: "var(--danger)", flexShrink: 0 }}>{aed(r.amount)}</div>
          <button className="btn ghost sm" onClick={() => logNow(r)} title="Log now" style={{ padding: "0 10px", height: 28, fontSize: 12, flexShrink: 0 }}>
            Log
          </button>
          <button className="btn ghost sm" onClick={() => removeRecurring(r.id)} style={{ padding: "0 8px", height: 28, flexShrink: 0, color: "var(--faint)" }} title="Remove">
            <Trash2 size={13} />
          </button>
        </div>
      ))}
    </div>
  );
}
