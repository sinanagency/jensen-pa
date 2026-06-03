"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import Shell from "@/components/Shell";
import { useDB } from "@/components/useDB";
import { DB, Quadrant } from "@/lib/store";
import { aed } from "@/lib/tax";
import { RefreshCw, ArrowRight, MessageCircle, Mail, Library, FileText, Mic, Building2 } from "lucide-react";

const QUADS: { q: Quadrant; title: string; note: string; color: string }[] = [
  { q: 1, title: "Do first", note: "Urgent + important", color: "var(--q1)" },
  { q: 2, title: "Schedule", note: "Important, not urgent", color: "var(--q2)" },
  { q: 3, title: "Delegate", note: "Urgent, not important", color: "var(--q3)" },
  { q: 4, title: "Drop", note: "Neither", color: "var(--q4)" },
];

function buildContext(db: DB): string {
  const open = db.tasks.filter((t) => !t.done);
  const income = db.finance.filter((f) => f.kind === "income").reduce((s, f) => s + f.amount, 0);
  const expense = db.finance.filter((f) => f.kind === "expense").reduce((s, f) => s + f.amount, 0);
  return [
    `Goals: ${db.goals.join("; ") || "none"}`,
    `Open by quadrant: Q1 ${open.filter((t) => t.quadrant === 1).length}, Q2 ${open.filter((t) => t.quadrant === 2).length}`,
    `Q1: ${open.filter((t) => t.quadrant === 1).map((t) => t.title).join(", ")}`,
    `Venues: ${db.entities.filter((e) => e.kind === "venue").map((e) => e.name).join(", ")}`,
    `Net this period: ${aed(income - expense)}`,
  ].join("\n");
}

export default function Today() {
  const { db, mutate } = useDB();
  const [brief, setBrief] = useState("");
  const [loading, setLoading] = useState(false);

  async function loadBrief() {
    if (!db) return;
    setLoading(true);
    try {
      const res = await fetch("/api/brief", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ context: buildContext(db) }) });
      const data = await res.json();
      if (data.brief) { setBrief(data.brief); sessionStorage.setItem("lr-brief", data.brief); }
    } catch {} finally { setLoading(false); }
  }
  useEffect(() => {
    if (!db) return;
    const c = sessionStorage.getItem("lr-brief");
    if (c) setBrief(c); else loadBrief();
    // eslint-disable-next-line
  }, [!!db]);

  if (!db) return <Shell><div className="muted">Loading…</div></Shell>;

  const income = db.finance.filter((f) => f.kind === "income").reduce((s, f) => s + f.amount, 0);
  const expense = db.finance.filter((f) => f.kind === "expense").reduce((s, f) => s + f.amount, 0);
  const hour = new Date().getHours();
  const greet = hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";
  const toggle = (id: string) => mutate((d) => { const x = d.tasks.find((y) => y.id === id); if (x) x.done = !x.done; });

  const modules = [
    { label: "Concierge", icon: MessageCircle, href: "/mentor" },
    { label: "Mail", icon: Mail, href: "/mail" },
    { label: "Meetings", icon: Mic, href: "/meetings" },
    { label: "Documents", icon: Library, href: "/brain" },
    { label: "Generate", icon: FileText, href: "/generate" },
    { label: "Portfolio", icon: Building2, href: "/portfolio" },
  ];

  return (
    <Shell>
      <div className="dash-head fade-up">
        <div>
          <div className="eyebrow">{greet}, Jensen</div>
          <h1>Here is what matters today.</h1>
        </div>
        <div className="hud"><div className="hud-ring" /><span>READY</span></div>
      </div>

      {/* SPLIT: concierge brief rail on the left, the four-quadrant board on the right */}
      <div className="home-split fade-up">
        <aside className="rail">
          <div className="card insight">
            <div className="insight-head">
              <div className="orb sm" style={{ flex: "none" }} />
              <div style={{ fontSize: 12.5, color: "var(--muted)" }}>Rencontre, your concierge</div>
              <button className="btn ghost sm" onClick={loadBrief} disabled={loading} style={{ flex: "none", marginLeft: "auto", height: 30, padding: "0 10px" }}>
                <RefreshCw size={13} /> {loading ? "…" : "Refresh"}
              </button>
            </div>
            <div className="insight-body">{brief || (loading ? "Reading your day…" : "Open your briefing.")}</div>
          </div>

          <div className="card fin">
            <div className="tile-label">Net this period</div>
            <div className="fin-val accent">{aed(income - expense)}</div>
            <div style={{ display: "flex", gap: 20, marginTop: 10, fontSize: 12.5 }}>
              <div><div className="muted">Income</div><div style={{ color: "var(--success)" }}>{aed(income)}</div></div>
              <div><div className="muted">Expense</div><div style={{ color: "var(--danger)" }}>{aed(expense)}</div></div>
            </div>
            <Link href="/finance" className="btn ghost sm" style={{ marginTop: 14 }}>Open finance <ArrowRight size={13} /></Link>
          </div>

          <div className="mods">
            {modules.map((m) => (
              <Link key={m.label} href={m.href} className="card mod">
                <span className="chip"><m.icon size={16} /></span>
                <span>{m.label}</span>
              </Link>
            ))}
          </div>
        </aside>

        <section className="board">
          <div className="quad-head"><span>The four quadrants</span><Link href="/tasks" className="muted" style={{ fontSize: 12.5 }}>Manage →</Link></div>
          <div className="quads">
            {QUADS.map(({ q, title, note, color }) => {
              const tasks = db.tasks.filter((t) => t.quadrant === q && !t.done);
              return (
                <div key={q} className="card quad">
                  <div className="quad-top">
                    <span className="quad-dot" style={{ background: color }} />
                    <div style={{ flex: 1 }}>
                      <div className="quad-title">{title}</div>
                      <div className="quad-note">{note}</div>
                    </div>
                    <span className="quad-count" style={{ color }}>{tasks.length}</span>
                  </div>
                  <div className="quad-list">
                    {tasks.length === 0 && <div className="muted" style={{ fontSize: 13, padding: "6px 0" }}>Clear.</div>}
                    {tasks.slice(0, 6).map((t) => (
                      <label key={t.id} className="quad-row inline">
                        <input type="checkbox" checked={t.done} onChange={() => toggle(t.id)} style={{ accentColor: color }} />
                        <span>{t.title}</span>
                      </label>
                    ))}
                    {tasks.length > 6 && <div className="faint" style={{ fontSize: 12, paddingTop: 6 }}>+{tasks.length - 6} more</div>}
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      </div>

      <style>{`
        .dash-head{display:flex;align-items:flex-start;justify-content:space-between;margin-bottom:20px}
        .dash-head h1{margin-top:6px}
        .hud{display:flex;flex-direction:column;align-items:center;gap:6px}
        .hud-ring{width:60px;height:60px;border-radius:50%;border:1.5px solid var(--purple-line);position:relative;box-shadow:0 0 30px var(--purple-glow), inset 0 0 22px rgba(124,107,176,.18)}
        .hud-ring::after{content:"";position:absolute;inset:11px;border-radius:50%;border:1px solid rgba(255,255,255,.12);background:radial-gradient(circle at 40% 35%, rgba(169,159,208,.5), rgba(124,107,176,.12) 60%, transparent)}
        .hud span{font-size:9.5px;letter-spacing:.28em;color:var(--purple-2)}

        .home-split{display:grid;grid-template-columns:360px 1fr;gap:16px;align-items:start}
        .rail{display:flex;flex-direction:column;gap:14px}
        .insight{padding:16px 18px}
        .insight-head{display:flex;align-items:center;gap:10px;margin-bottom:10px}
        .insight-body{font-size:13.8px;line-height:1.62;color:var(--ink-2);white-space:pre-wrap}
        .fin{padding:18px}
        .tile-label{font-size:12.5px;color:var(--muted)}
        .fin-val{font-family:var(--font-display);font-size:30px;margin-top:8px}
        .chip{width:38px;height:38px;border-radius:11px;display:grid;place-items:center;background:var(--purple-soft);color:var(--purple-2);border:1px solid var(--purple-line)}
        .mods{display:grid;grid-template-columns:repeat(3,1fr);gap:12px}
        .mod{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:8px;padding:16px 6px;font-size:12.5px;color:var(--ink-2)}

        .board{min-width:0}
        .quad-head{display:flex;justify-content:space-between;align-items:center;font-weight:600;font-size:14px;margin-bottom:12px}
        .quads{display:grid;grid-template-columns:1fr 1fr;gap:14px}
        .quad{padding:18px;display:flex;flex-direction:column}
        .quad-top{display:flex;align-items:flex-start;gap:11px;margin-bottom:12px}
        .quad-dot{width:10px;height:10px;border-radius:50%;margin-top:5px;flex:none;box-shadow:0 0 12px currentColor}
        .quad-title{font-size:15.5px;font-weight:600}
        .quad-note{font-size:11.5px;color:var(--faint);margin-top:1px}
        .quad-count{font-family:var(--font-display);font-size:24px;line-height:1}
        .quad-row{display:flex;gap:11px;align-items:flex-start;padding:8px 0;border-top:1px solid var(--line);font-size:13.8px;cursor:pointer;color:var(--ink-2)}
        .quad-row input{width:16px;height:16px;margin-top:1px;flex:none}

        @media(max-width:1040px){.home-split{grid-template-columns:1fr}.mods{grid-template-columns:repeat(6,1fr)}}
        @media(max-width:900px){.quads{grid-template-columns:1fr 1fr}.mods{grid-template-columns:repeat(3,1fr)}.dash-head .hud{display:none}}
        @media(max-width:560px){.quads{grid-template-columns:1fr}}
      `}</style>
    </Shell>
  );
}
