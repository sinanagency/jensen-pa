"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import Shell from "@/components/Shell";
import { useDB } from "@/components/useDB";
import { DB, Task } from "@/lib/store";
import { aed } from "@/lib/tax";
import { Building2, Users, PartyPopper, ArrowRight, Sparkles, RefreshCw } from "lucide-react";

function buildContext(db: DB): string {
  const open = db.tasks.filter((t) => !t.done);
  const byQ = (q: number) => open.filter((t) => t.quadrant === q).map((t) => "- " + t.title);
  const income = db.finance.filter((f) => f.kind === "income").reduce((s, f) => s + f.amount, 0);
  const expense = db.finance.filter((f) => f.kind === "expense").reduce((s, f) => s + f.amount, 0);
  return [
    `Goals: ${db.goals.join("; ") || "none set"}`,
    `Venues: ${db.entities.filter((e) => e.kind === "venue").map((e) => e.name).join(", ")}`,
    `Clients: ${db.entities.filter((e) => e.kind === "client").map((e) => e.name).join(", ")}`,
    `Events: ${db.entities.filter((e) => e.kind === "event").map((e) => e.name).join(", ")}`,
    `Urgent + important (Q1):\n${byQ(1).join("\n") || "none"}`,
    `Important not urgent (Q2):\n${byQ(2).join("\n") || "none"}`,
    `Net this period: ${aed(income - expense)} (income ${aed(income)}, expense ${aed(expense)})`,
    `Upcoming: ${db.events.slice(0, 3).map((e) => `${e.title} (${e.date})`).join(", ")}`,
  ].join("\n");
}

export default function Today() {
  const { db, mutate } = useDB();
  const [brief, setBrief] = useState<string>("");
  const [loading, setLoading] = useState(false);

  async function loadBrief(force = false) {
    if (!db) return;
    setLoading(true);
    try {
      const res = await fetch("/api/brief", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ context: buildContext(db) }),
      });
      const data = await res.json();
      if (data.brief) { setBrief(data.brief); sessionStorage.setItem("lr-brief", data.brief); }
    } catch { /* keep silent on dashboard */ } finally { setLoading(false); }
  }

  useEffect(() => {
    if (!db) return;
    const cached = sessionStorage.getItem("lr-brief");
    if (cached) setBrief(cached);
    else loadBrief();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [!!db]);

  if (!db) return <Shell><div className="muted">Loading…</div></Shell>;

  const q1 = db.tasks.filter((t) => !t.done && t.quadrant === 1).slice(0, 4);
  const income = db.finance.filter((f) => f.kind === "income").reduce((s, f) => s + f.amount, 0);
  const expense = db.finance.filter((f) => f.kind === "expense").reduce((s, f) => s + f.amount, 0);
  const venues = db.entities.filter((e) => e.kind === "venue");
  const clients = db.entities.filter((e) => e.kind === "client");
  const events = db.entities.filter((e) => e.kind === "event");
  const hour = new Date().getHours();
  const greet = hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";

  return (
    <Shell>
      <div className="page-hero fade-up">
        <div className="eyebrow">{greet}, Jensen</div>
        <h1>Here is what matters today.</h1>
      </div>

      {/* Mentor brief — feature card */}
      <div className="card feature fade-up" style={{ padding: 24, marginBottom: 18 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 12 }}>
          <div className="orb sm" />
          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: 600, fontSize: 14 }}>Your briefing</div>
            <div style={{ fontSize: 12, color: "var(--muted)" }}>From Rencontre, your chief of staff</div>
          </div>
          <button className="btn ghost sm" onClick={() => loadBrief(true)} disabled={loading}>
            <RefreshCw size={14} /> {loading ? "Thinking…" : "Refresh"}
          </button>
        </div>
        <div style={{ whiteSpace: "pre-wrap", fontSize: 14.5, lineHeight: 1.66, color: "var(--ink-2)" }}>
          {brief || (loading ? "Reading your day…" : "Open your briefing to see today at a glance.")}
        </div>
        <Link href="/mentor" className="btn purple sm" style={{ marginTop: 16 }}>
          <Sparkles size={14} /> Talk it through
        </Link>
      </div>

      <div className="grid cols-3" style={{ marginBottom: 18 }}>
        <RollCard icon={<Building2 size={18} />} label="Venues" value={venues.length} href="/portfolio" sub={venues.map((v) => v.name).join(", ")} />
        <RollCard icon={<Users size={18} />} label="Clients" value={clients.length} href="/portfolio" sub={clients.map((c) => c.name).join(", ")} />
        <RollCard icon={<PartyPopper size={18} />} label="Events" value={events.length} href="/portfolio" sub={events.map((e) => e.name).join(", ")} />
      </div>

      <div className="grid cols-2">
        <div className="card" style={{ padding: 22 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
            <div style={{ fontWeight: 600 }}>Do first <span className="pill" style={{ marginLeft: 8 }}>Q1 · urgent + important</span></div>
            <Link href="/tasks" className="muted" style={{ fontSize: 13 }}>All tasks →</Link>
          </div>
          {q1.length === 0 && <div className="muted" style={{ fontSize: 14 }}>Nothing urgent. Protect your Q2 time.</div>}
          {q1.map((t) => (
            <label key={t.id} style={{ display: "flex", gap: 12, alignItems: "flex-start", padding: "10px 0", borderTop: "1px solid var(--line)", cursor: "pointer" }}>
              <input type="checkbox" checked={t.done} onChange={() => mutate((d) => { const x = d.tasks.find((y) => y.id === t.id); if (x) x.done = !x.done; })} style={{ width: 18, height: 18, marginTop: 1, accentColor: "var(--purple)" }} />
              <span style={{ fontSize: 14.5 }}>{t.title}</span>
            </label>
          ))}
        </div>

        <div className="card" style={{ padding: 22 }}>
          <div style={{ fontWeight: 600, marginBottom: 6 }}>Net this period</div>
          <div style={{ fontFamily: "var(--font-display)", fontSize: 38, letterSpacing: "-0.02em" }} className={income - expense >= 0 ? "accent" : ""}>
            {aed(income - expense)}
          </div>
          <div style={{ display: "flex", gap: 18, marginTop: 14, fontSize: 13 }}>
            <div><div className="muted">Income</div><div style={{ color: "var(--success)" }}>{aed(income)}</div></div>
            <div><div className="muted">Expense</div><div style={{ color: "var(--danger)" }}>{aed(expense)}</div></div>
          </div>
          <Link href="/finance" className="btn ghost sm" style={{ marginTop: 18 }}>Open finance <ArrowRight size={14} /></Link>
        </div>
      </div>
    </Shell>
  );
}

function RollCard({ icon, label, value, sub, href }: { icon: React.ReactNode; label: string; value: number; sub: string; href: string }) {
  return (
    <Link href={href} className="card" style={{ padding: 20, display: "block" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, color: "var(--muted)", marginBottom: 10 }}>
        {icon}<span style={{ fontSize: 13 }}>{label}</span>
      </div>
      <div style={{ fontFamily: "var(--font-display)", fontSize: 32 }}>{value}</div>
      <div className="faint" style={{ fontSize: 12, marginTop: 6, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{sub || "Nothing yet"}</div>
    </Link>
  );
}
