"use client";

import { useState } from "react";
import Shell from "@/components/Shell";
import { useDB } from "@/components/useDB";
import { Save, Target, Plus, X, SlidersHorizontal } from "lucide-react";

export default function Settings() {
  const { db, mutate } = useDB();
  const [local, setLocal] = useState<{ workStyle: string; tone: string; hours: string; extra: string } | null>(null);
  const [newGoal, setNewGoal] = useState("");
  const [flash, setFlash] = useState(false);

  if (!db) return <Shell><div className="muted">Loading…</div></Shell>;
  const p = local ?? { workStyle: db.prefs.workStyle || "", tone: db.prefs.tone || "", hours: db.prefs.hours || "", extra: db.prefs.extra || "" };
  const set = (k: keyof typeof p, v: string) => setLocal({ ...p, [k]: v });

  function save() {
    mutate((d) => { d.prefs = { workStyle: p.workStyle, tone: p.tone, hours: p.hours, extra: p.extra }; });
    setFlash(true); setTimeout(() => setFlash(false), 1500);
  }

  return (
    <Shell>
      <div className="page-hero fade-up"><div className="eyebrow">Settings</div><h1>How I work for you.</h1></div>
      <p className="muted" style={{ marginTop: -10, marginBottom: 18, maxWidth: 620 }}>
        Tell your mentor how you like to work. It shapes how I prioritise, how I speak to you, and what I always keep in mind.
      </p>

      <div className="grid cols-2">
        <div className="card feature" style={{ padding: 20 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 14 }}>
            <SlidersHorizontal size={18} style={{ color: "var(--purple-2)" }} />
            <div style={{ fontWeight: 600 }}>Your preferences</div>
          </div>
          <label>How you like to work</label>
          <textarea className="input" rows={3} value={p.workStyle} onChange={(e) => set("workStyle", e.target.value)} placeholder="e.g. Mornings for deep work, batch calls in the afternoon, keep me out of small decisions." style={{ margin: "8px 0 14px" }} />
          <label>Tone you want from me</label>
          <input value={p.tone} onChange={(e) => set("tone", e.target.value)} placeholder="e.g. Direct, warm, no fluff." style={{ margin: "8px 0 14px" }} />
          <label>Working hours and focus time</label>
          <input value={p.hours} onChange={(e) => set("hours", e.target.value)} placeholder="e.g. 8am to 7pm Dubai, Fridays light." style={{ margin: "8px 0 14px" }} />
          <label>Anything I should always honour</label>
          <textarea className="input" rows={3} value={p.extra} onChange={(e) => set("extra", e.target.value)} placeholder="e.g. Never commit me past 8pm. Always copy my partner on venue contracts." style={{ margin: "8px 0 14px" }} />
          <button className="btn purple" onClick={save}><Save size={15} /> {flash ? "Saved" : "Save preferences"}</button>
        </div>

        <div className="card" style={{ padding: 20 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 14 }}>
            <Target size={18} style={{ color: "var(--purple-2)" }} />
            <div style={{ fontWeight: 600 }}>Your goals</div>
          </div>
          <p className="faint" style={{ fontSize: 12.5, marginBottom: 12 }}>I hold you to these and check in on them.</p>
          {db.goals.map((g, i) => (
            <div key={i} style={{ display: "flex", alignItems: "center", gap: 10, padding: "9px 0", borderTop: i ? "1px solid var(--line)" : "none" }}>
              <span style={{ flex: 1, fontSize: 14 }}>{g}</span>
              <button className="iconbtn" onClick={() => mutate((d) => { d.goals = d.goals.filter((_, j) => j !== i); })}><X size={14} /></button>
            </div>
          ))}
          <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
            <input value={newGoal} onChange={(e) => setNewGoal(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && newGoal.trim()) { mutate((d) => d.goals.push(newGoal.trim())); setNewGoal(""); } }} placeholder="Add a goal" />
            <button className="btn ghost" onClick={() => { if (newGoal.trim()) { mutate((d) => d.goals.push(newGoal.trim())); setNewGoal(""); } }} style={{ flex: "none" }}><Plus size={16} /></button>
          </div>
        </div>
      </div>
    </Shell>
  );
}
