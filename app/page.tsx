"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import Shell from "@/components/Shell";
import { useDB } from "@/components/useDB";
import { DB } from "@/lib/store";
import { aed } from "@/lib/tax";
import {
  Building2, Users, PartyPopper, Wallet, CheckSquare, RefreshCw, ArrowRight,
  MessageCircle, Mail, Library, FileText, Calendar,
} from "lucide-react";

function buildContext(db: DB): string {
  const open = db.tasks.filter((t) => !t.done);
  const byQ = (q: number) => open.filter((t) => t.quadrant === q).map((t) => "- " + t.title);
  const income = db.finance.filter((f) => f.kind === "income").reduce((s, f) => s + f.amount, 0);
  const expense = db.finance.filter((f) => f.kind === "expense").reduce((s, f) => s + f.amount, 0);
  return [
    `Goals: ${db.goals.join("; ") || "none"}`,
    `Venues: ${db.entities.filter((e) => e.kind === "venue").map((e) => e.name).join(", ")}`,
    `Clients: ${db.entities.filter((e) => e.kind === "client").map((e) => e.name).join(", ")}`,
    `Events: ${db.entities.filter((e) => e.kind === "event").map((e) => e.name).join(", ")}`,
    `Q1 urgent+important:\n${byQ(1).join("\n") || "none"}`,
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

  const venues = db.entities.filter((e) => e.kind === "venue");
  const clients = db.entities.filter((e) => e.kind === "client");
  const events = db.entities.filter((e) => e.kind === "event");
  const income = db.finance.filter((f) => f.kind === "income").reduce((s, f) => s + f.amount, 0);
  const expense = db.finance.filter((f) => f.kind === "expense").reduce((s, f) => s + f.amount, 0);
  const q1 = db.tasks.filter((t) => !t.done && t.quadrant === 1);
  const hour = new Date().getHours();
  const greet = hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";

  const tiles = [
    { label: "Do first", value: q1.length, sub: "urgent + important", icon: CheckSquare, href: "/tasks" },
    { label: "Venues", value: venues.length, sub: venues.map((v) => v.name).join(", ") || "none", icon: Building2, href: "/portfolio" },
    { label: "Clients", value: clients.length, sub: clients.map((c) => c.name).join(", ") || "none", icon: Users, href: "/portfolio" },
    { label: "Events", value: events.length, sub: events.map((e) => e.name).join(", ") || "none", icon: PartyPopper, href: "/portfolio" },
  ];
  const modules = [
    { label: "Mentor", icon: MessageCircle, href: "/mentor" },
    { label: "Mail", icon: Mail, href: "/mail" },
    { label: "Documents", icon: Library, href: "/brain" },
    { label: "Generate", icon: FileText, href: "/generate" },
    { label: "Calendar", icon: Calendar, href: "/calendar" },
  ];

  return (
    <Shell>
      {/* header: greeting + HUD */}
      <div className="dash-head fade-up">
        <div>
          <div className="eyebrow">{greet}, Jensen</div>
          <h1>Here is what matters today.</h1>
        </div>
        <div className="hud"><div className="hud-ring" /><span>READY</span></div>
      </div>

      {/* insight strip: the mentor briefing */}
      <div className="card insight fade-up">
        <div className="orb sm" style={{ flex: "none" }} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 12.5, color: "var(--muted)", marginBottom: 4 }}>Rencontre, your chief of staff</div>
          <div style={{ fontSize: 14, lineHeight: 1.6, color: "var(--ink-2)", whiteSpace: "pre-wrap" }}>
            {brief || (loading ? "Reading your day…" : "Open your briefing.")}
          </div>
        </div>
        <button className="btn ghost sm" onClick={loadBrief} disabled={loading} style={{ flex: "none" }}><RefreshCw size={13} /> {loading ? "…" : "Refresh"}</button>
      </div>

      {/* bento: stat tiles (2/3) + priority feed (1/3) */}
      <div className="bento">
        <div className="tiles">
          {tiles.map((t) => (
            <Link key={t.label} href={t.href} className="card tile">
              <div className="tile-top"><span className="tile-label">{t.label}</span><span className="chip"><t.icon size={15} /></span></div>
              <div className="tile-val">{t.value}</div>
              <div className="tile-sub">{t.sub}</div>
            </Link>
          ))}
        </div>

        <div className="card feed">
          <div className="feed-head"><span>Do first</span><Link href="/tasks" className="muted" style={{ fontSize: 12.5 }}>All →</Link></div>
          {q1.length === 0 && <div className="muted" style={{ fontSize: 13.5, padding: "8px 0" }}>Nothing urgent. Protect your focus time.</div>}
          {q1.slice(0, 6).map((t) => (
            <label key={t.id} className="feed-row">
              <input type="checkbox" checked={t.done} onChange={() => mutate((d) => { const x = d.tasks.find((y) => y.id === t.id); if (x) x.done = !x.done; })} />
              <span>{t.title}</span>
            </label>
          ))}
        </div>
      </div>

      {/* finance strip + module tiles */}
      <div className="bento2">
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
      </div>

      <style>{`
        .dash-head{display:flex;align-items:flex-start;justify-content:space-between;margin-bottom:18px}
        .dash-head h1{margin-top:6px}
        .hud{display:flex;flex-direction:column;align-items:center;gap:6px}
        .hud-ring{width:64px;height:64px;border-radius:50%;border:1.5px solid var(--purple-line);position:relative;
          box-shadow:0 0 30px var(--purple-glow), inset 0 0 22px rgba(124,107,176,.18)}
        .hud-ring::after{content:"";position:absolute;inset:11px;border-radius:50%;border:1px solid rgba(255,255,255,.12);
          background:radial-gradient(circle at 40% 35%, rgba(169,159,208,.5), rgba(124,107,176,.12) 60%, transparent)}
        .hud span{font-size:9.5px;letter-spacing:.28em;color:var(--purple-2)}
        .insight{display:flex;gap:14px;align-items:center;padding:16px 18px;margin-bottom:16px}
        .bento{display:grid;grid-template-columns:2fr 1fr;gap:14px;margin-bottom:14px}
        .tiles{display:grid;grid-template-columns:1fr 1fr;gap:14px}
        .tile{padding:18px;display:block}
        .tile-top{display:flex;align-items:center;justify-content:space-between}
        .tile-label{font-size:12.5px;color:var(--muted)}
        .chip{width:30px;height:30px;border-radius:9px;display:grid;place-items:center;background:var(--purple-soft);color:var(--purple-2);border:1px solid var(--purple-line)}
        .tile-val{font-family:var(--font-display);font-size:34px;margin-top:12px;line-height:1}
        .tile-sub{font-size:11.5px;color:var(--faint);margin-top:7px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
        .feed{padding:18px;display:flex;flex-direction:column}
        .feed-head{display:flex;justify-content:space-between;align-items:center;font-weight:600;font-size:14px;margin-bottom:6px}
        .feed-row{display:flex;gap:11px;align-items:flex-start;padding:9px 0;border-top:1px solid var(--line);font-size:13.8px;cursor:pointer}
        .feed-row input{width:17px;height:17px;margin-top:1px;accent-color:var(--purple)}
        .bento2{display:grid;grid-template-columns:1fr 2fr;gap:14px}
        .fin{padding:18px}
        .fin-val{font-family:var(--font-display);font-size:30px;margin-top:8px}
        .mods{display:grid;grid-template-columns:repeat(5,1fr);gap:14px}
        .mod{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:9px;padding:18px 8px;font-size:13px;color:var(--ink-2)}
        .mod .chip{width:38px;height:38px;border-radius:11px}
        @media(max-width:900px){.bento,.bento2{grid-template-columns:1fr}.tiles{grid-template-columns:1fr 1fr}.mods{grid-template-columns:repeat(3,1fr)}.dash-head .hud{display:none}}
      `}</style>
    </Shell>
  );
}
