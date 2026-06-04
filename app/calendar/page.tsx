"use client";

import { useState } from "react";
import Shell from "@/components/Shell";
import { useDB } from "@/components/useDB";
import { CalEvent, uid } from "@/lib/store";
import { Plus, Trash2, CalendarDays, Clock, ChevronLeft, ChevronRight } from "lucide-react";

type View = "month" | "week" | "agenda";

const iso = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export default function CalendarPage() {
  const { db, mutate } = useDB();

  const [view, setView] = useState<View>("month");
  const [cursor, setCursor] = useState<Date>(new Date());
  const [selected, setSelected] = useState<string>("");

  const [title, setTitle] = useState("");
  const [date, setDate] = useState("");
  const [time, setTime] = useState("");
  const [entityId, setEntityId] = useState("");
  const [note, setNote] = useState("");

  if (!db) return <Shell><div className="muted">Loading…</div></Shell>;

  const today = iso(new Date());
  const entityMap = new Map(db.entities.map((e) => [e.id, e.name]));

  const byDate = new Map<string, CalEvent[]>();
  for (const ev of db.events) {
    const arr = byDate.get(ev.date) || [];
    arr.push(ev);
    byDate.set(ev.date, arr);
  }
  const dayEvents = (d: string) =>
    (byDate.get(d) || []).slice().sort((a, b) => (a.time || "99").localeCompare(b.time || "99"));

  function handleAdd(target?: string) {
    const t = title.trim();
    const d = target || date;
    if (!t || !d) return;
    mutate((db2) => {
      db2.events.push({ id: uid(), title: t, date: d, time: time || undefined, note: note.trim() || undefined, entityId: entityId || undefined, createdAt: Date.now() });
    });
    setTitle(""); setDate(""); setTime(""); setEntityId(""); setNote("");
  }
  const handleDelete = (id: string) => mutate((db2) => { db2.events = db2.events.filter((e) => e.id !== id); });

  // ---- month matrix (6 weeks, Sunday start) ----
  const first = new Date(cursor.getFullYear(), cursor.getMonth(), 1);
  const gridStart = new Date(first);
  gridStart.setDate(1 - first.getDay());
  const weeks: Date[][] = Array.from({ length: 6 }, (_, w) =>
    Array.from({ length: 7 }, (_, d) => {
      const cell = new Date(gridStart);
      cell.setDate(gridStart.getDate() + w * 7 + d);
      return cell;
    })
  );

  // ---- current week (Sunday start) ----
  const wkStart = new Date(cursor);
  wkStart.setDate(cursor.getDate() - cursor.getDay());
  const weekDays = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(wkStart);
    d.setDate(wkStart.getDate() + i);
    return d;
  });

  const shift = (n: number) => {
    const d = new Date(cursor);
    if (view === "month") d.setMonth(d.getMonth() + n);
    else d.setDate(d.getDate() + n * 7);
    setCursor(d);
  };
  const label = view === "week"
    ? `${weekDays[0].toLocaleDateString("en-GB", { day: "numeric", month: "short" })} – ${weekDays[6].toLocaleDateString("en-GB", { day: "numeric", month: "short" })}`
    : cursor.toLocaleDateString("en-GB", { month: "long", year: "numeric" });

  function eventRow(ev: CalEvent) {
    const en = ev.entityId ? entityMap.get(ev.entityId) : undefined;
    return (
      <div key={ev.id} style={{ display: "flex", alignItems: "flex-start", gap: 14, padding: "14px 0", borderTop: "1px solid var(--line)" }}>
        <div style={{ paddingTop: 2, color: "var(--muted)", flexShrink: 0 }}><Clock size={14} /></div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
            <span style={{ fontWeight: 700, fontSize: 14.5, color: "var(--ink)", lineHeight: 1.4 }}>{ev.title}</span>
            <span className="pill" style={{ fontSize: 11 }}>{ev.time || "All day"}</span>
            {en && <span className="pill accent" style={{ fontSize: 11 }}>{en}</span>}
          </div>
          {ev.note && <div className="muted" style={{ fontSize: 12.5, marginTop: 5, lineHeight: 1.5 }}>{ev.note}</div>}
        </div>
        <button className="btn ghost sm" onClick={() => handleDelete(ev.id)} style={{ padding: "0 8px", height: 28, flexShrink: 0, color: "var(--faint)" }} title="Delete event"><Trash2 size={13} /></button>
      </div>
    );
  }

  // agenda groups
  const upcoming = db.events.filter((e) => e.date >= today).sort((a, b) => a.date.localeCompare(b.date) || (a.time || "").localeCompare(b.time || ""));
  const past = db.events.filter((e) => e.date < today).sort((a, b) => b.date.localeCompare(a.date));
  const groupBy = (evs: CalEvent[]) => {
    const m = new Map<string, CalEvent[]>();
    for (const e of evs) { const a = m.get(e.date) || []; a.push(e); m.set(e.date, a); }
    return m;
  };
  const fmtHead = (s: string) => { const [y, m, d] = s.split("-").map(Number); return new Date(y, m - 1, d).toLocaleDateString("en-GB", { weekday: "long", month: "long", day: "numeric" }); };
  const renderGroup = (s: string, evs: CalEvent[]) => (
    <div key={s} style={{ marginBottom: 24 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
        <CalendarDays size={14} style={{ color: "var(--purple)", flexShrink: 0 }} />
        <span style={{ fontSize: 12, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", color: s === today ? "var(--purple)" : "var(--ink-2)", fontFamily: "var(--font-display)" }}>
          {fmtHead(s)}{s === today && <span className="pill accent" style={{ marginLeft: 8, fontSize: 10 }}>Today</span>}
        </span>
      </div>
      <div className="card" style={{ padding: "0 20px" }}>{evs.map(eventRow)}</div>
    </div>
  );

  return (
    <Shell>
      <div className="page-hero fade-up">
        <div className="eyebrow">Calendar</div>
        <h1>What is coming up.</h1>
      </div>

      {/* Add event */}
      <div className="card fade-up" style={{ padding: 20, marginBottom: 20, display: "flex", gap: 12, alignItems: "flex-end", flexWrap: "wrap" }}>
        <input className="input" style={{ flex: "2 1 180px", minWidth: 140 }} placeholder="Event title…" value={title} onChange={(e) => setTitle(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") handleAdd(); }} />
        <input className="input" type="date" style={{ flex: "1 1 140px", minWidth: 130 }} value={date} onChange={(e) => setDate(e.target.value)} />
        <input className="input" type="time" style={{ flex: "0 1 120px", minWidth: 110 }} value={time} onChange={(e) => setTime(e.target.value)} />
        <select className="input" style={{ flex: "1 1 160px", minWidth: 130 }} value={entityId} onChange={(e) => setEntityId(e.target.value)}>
          <option value="">No entity</option>
          {db.entities.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
        </select>
        <input className="input" style={{ flex: "2 1 180px", minWidth: 140 }} placeholder="Note (optional)" value={note} onChange={(e) => setNote(e.target.value)} />
        <button className="btn purple sm" onClick={() => handleAdd()} style={{ flexShrink: 0, display: "flex", alignItems: "center", gap: 6 }}><Plus size={14} /> Add</button>
      </div>

      {/* Controls */}
      <div className="cal-bar fade-up">
        <div className="cal-seg">
          {(["month", "week", "agenda"] as View[]).map((v) => (
            <button key={v} className={`cal-segbtn ${view === v ? "on" : ""}`} onClick={() => setView(v)}>{v[0].toUpperCase() + v.slice(1)}</button>
          ))}
        </div>
        {view !== "agenda" && (
          <div className="cal-nav">
            <button className="iconbtn" onClick={() => shift(-1)} aria-label="Previous"><ChevronLeft size={16} /></button>
            <button className="btn ghost sm" onClick={() => setCursor(new Date())}>Today</button>
            <button className="iconbtn" onClick={() => shift(1)} aria-label="Next"><ChevronRight size={16} /></button>
            <span className="cal-label">{label}</span>
          </div>
        )}
      </div>

      {/* MONTH */}
      {view === "month" && (
        <div className="fade-up">
          <div className="cal-dow">{DOW.map((d) => <div key={d}>{d}</div>)}</div>
          <div className="cal-grid card" style={{ padding: 0, overflow: "hidden" }}>
            {weeks.flat().map((cell, i) => {
              const key = iso(cell);
              const out = cell.getMonth() !== cursor.getMonth();
              const evs = dayEvents(key);
              return (
                <button key={i} className={`cal-cell ${out ? "out" : ""} ${key === today ? "today" : ""} ${key === selected ? "sel" : ""}`} onClick={() => { setSelected(key); setDate(key); }}>
                  <span className="cal-daynum">{cell.getDate()}</span>
                  <span className="cal-chips">
                    {evs.slice(0, 3).map((ev) => <span key={ev.id} className="cal-chip">{ev.time ? ev.time + " " : ""}{ev.title}</span>)}
                    {evs.length > 3 && <span className="cal-more">+{evs.length - 3} more</span>}
                  </span>
                </button>
              );
            })}
          </div>
          {selected && (
            <div style={{ marginTop: 18 }}>
              <div className="eyebrow" style={{ marginBottom: 8 }}>{fmtHead(selected)}</div>
              <div className="card" style={{ padding: "0 20px" }}>
                {dayEvents(selected).length ? dayEvents(selected).map(eventRow) : <div className="muted" style={{ padding: "14px 0" }}>Nothing on this day. Add an event above (date is filled in).</div>}
              </div>
            </div>
          )}
        </div>
      )}

      {/* WEEK */}
      {view === "week" && (
        <div className="cal-week fade-up">
          {weekDays.map((d) => {
            const key = iso(d);
            const evs = dayEvents(key);
            return (
              <div key={key} className={`card cal-wkcol ${key === today ? "today" : ""}`} style={{ padding: 0 }}>
                <div className="cal-wkhead" onClick={() => setDate(key)}>
                  <div className="cal-wkdow">{DOW[d.getDay()]}</div>
                  <div className="cal-wknum">{d.getDate()}</div>
                </div>
                <div className="cal-wkbody">
                  {evs.length ? evs.map((ev) => (
                    <div key={ev.id} className="cal-wkev" title={ev.note || ""}>
                      <span className="cal-wktime">{ev.time || "all day"}</span>
                      <span className="cal-wktitle">{ev.title}</span>
                    </div>
                  )) : <div className="faint" style={{ fontSize: 11.5, padding: "8px 0" }}>—</div>}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* AGENDA */}
      {view === "agenda" && (
        <div className="fade-up">
          {upcoming.length === 0 && past.length === 0 && <div className="muted" style={{ padding: "32px 0", textAlign: "center", fontSize: 14 }}>Nothing scheduled. Add your first event above.</div>}
          {Array.from(groupBy(upcoming).entries()).map(([s, evs]) => renderGroup(s, evs))}
          {past.length > 0 && (
            <div style={{ marginTop: 36, opacity: 0.45 }}>
              <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase", color: "var(--muted)", marginBottom: 16 }}>Earlier</div>
              {Array.from(groupBy(past).entries()).map(([s, evs]) => renderGroup(s, evs))}
            </div>
          )}
        </div>
      )}

      <style>{`
        .cal-bar{display:flex;align-items:center;justify-content:space-between;gap:14px;margin-bottom:14px;flex-wrap:wrap}
        .cal-seg{display:inline-flex;background:var(--glass);border:1px solid var(--line);border-radius:var(--radius-pill);padding:3px}
        .cal-segbtn{border:0;background:none;color:var(--ink-2);font:inherit;font-size:13px;padding:6px 16px;border-radius:var(--radius-pill);cursor:pointer}
        .cal-segbtn.on{background:rgba(124,107,176,0.26);color:#e7e1f7;box-shadow:inset 0 0 0 1px rgba(124,107,176,0.5)}
        .cal-nav{display:flex;align-items:center;gap:8px}
        .cal-label{font-family:var(--font-serif-stack);font-size:18px;margin-left:6px}
        .cal-dow{display:grid;grid-template-columns:repeat(7,1fr);gap:0;padding:0 2px 8px;font-size:11px;color:var(--muted);text-transform:uppercase;letter-spacing:.06em}
        .cal-dow div{text-align:center}
        .cal-grid{display:grid;grid-template-columns:repeat(7,1fr)}
        .cal-cell{min-height:104px;border-right:1px solid var(--line);border-bottom:1px solid var(--line);background:none;text-align:left;padding:7px 7px 9px;display:flex;flex-direction:column;gap:5px;cursor:pointer;font:inherit;color:inherit}
        .cal-cell:nth-child(7n){border-right:0}
        .cal-cell:hover{background:var(--purple-soft)}
        .cal-cell.out{opacity:.4}
        .cal-cell.sel{background:var(--purple-soft);box-shadow:inset 0 0 0 1.5px var(--purple-line)}
        .cal-daynum{font-size:12.5px;font-weight:600;width:24px;height:24px;display:grid;place-items:center;border-radius:50%}
        .cal-cell.today .cal-daynum{background:var(--purple);color:#fff}
        .cal-chips{display:flex;flex-direction:column;gap:3px;min-width:0}
        .cal-chip{font-size:10.5px;background:rgba(124,107,176,0.16);color:#5b4b8a;border-radius:5px;padding:2px 5px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
        .cal-more{font-size:10px;color:var(--muted)}
        .cal-week{display:grid;grid-template-columns:repeat(7,1fr);gap:8px}
        .cal-wkcol{overflow:hidden}
        .cal-wkcol.today{box-shadow:inset 0 0 0 1.5px var(--purple-line)}
        .cal-wkhead{padding:10px;text-align:center;border-bottom:1px solid var(--line);cursor:pointer}
        .cal-wkdow{font-size:10.5px;color:var(--muted);text-transform:uppercase;letter-spacing:.06em}
        .cal-wknum{font-family:var(--font-display);font-size:18px;margin-top:2px}
        .cal-wkcol.today .cal-wknum{color:var(--purple)}
        .cal-wkbody{padding:8px;display:flex;flex-direction:column;gap:6px}
        .cal-wkev{font-size:11.5px;display:flex;flex-direction:column;background:var(--purple-soft);border:1px solid var(--purple-line);border-radius:7px;padding:5px 7px}
        .cal-wktime{font-size:10px;color:#5b4b8a;font-weight:700}
        .cal-wktitle{color:var(--ink-2);overflow:hidden;text-overflow:ellipsis}
        @media(max-width:820px){.cal-week{grid-template-columns:1fr;gap:6px}.cal-cell{min-height:78px}.cal-chip:nth-child(n+3){display:none}}
      `}</style>
    </Shell>
  );
}
