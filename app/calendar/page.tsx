"use client";

// Apple Calendar grade month view, skinned in La Rencontre. Monday-first 6-week
// matrix, soft event chips per day, today ring, click a day for the full list
// + quick compose. Single source: db.events.
import { useMemo, useState } from "react";
import Shell from "@/components/Shell";
import { useDB } from "@/components/useDB";
import { CalEvent, uid } from "@/lib/store";
import {
  ChevronLeft, ChevronRight, Plus, Trash2, Clock, X, CalendarDays,
} from "lucide-react";

const WD = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

function iso(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function parse(s: string) {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y, m - 1, d, 12, 0, 0);
}

function monthMatrix(year: number, month: number): Date[][] {
  const lead = (new Date(year, month, 1).getDay() + 6) % 7;
  const start = new Date(year, month, 1 - lead, 12, 0, 0);
  const weeks: Date[][] = [];
  for (let w = 0; w < 6; w++) {
    const row: Date[] = [];
    for (let d = 0; d < 7; d++) {
      const cur = new Date(start);
      cur.setDate(start.getDate() + w * 7 + d);
      row.push(cur);
    }
    weeks.push(row);
  }
  return weeks;
}

function formatTime(t?: string) {
  if (!t) return "";
  const [h, m] = t.split(":").map(Number);
  const h12 = ((h + 11) % 12) + 1;
  return `${h12}:${String(m || 0).padStart(2, "0")} ${h >= 12 ? "PM" : "AM"}`;
}

export default function CalendarPage() {
  const { db, mutate } = useDB();
  const [cursor, setCursor] = useState(new Date());
  const [view, setView] = useState<"month" | "agenda">("month");
  const [dayOpen, setDayOpen] = useState<string | null>(null);
  const [composeFor, setComposeFor] = useState<string | null>(null);
  const [compTitle, setCompTitle] = useState("");
  const [compTime, setCompTime] = useState("");
  const [compNote, setCompNote] = useState("");

  if (!db) return <Shell><div className="muted">Loading…</div></Shell>;

  const today = iso(new Date());
  const month = cursor.getMonth();
  const year = cursor.getFullYear();
  const matrix = useMemo(() => monthMatrix(year, month), [year, month]);

  const byDate = useMemo(() => {
    const m: Record<string, CalEvent[]> = {};
    for (const e of db.events) (m[e.date] ||= []).push(e);
    for (const k of Object.keys(m)) m[k].sort((a, b) => (a.time || "").localeCompare(b.time || ""));
    return m;
  }, [db.events]);

  const monthEvents = useMemo(() => {
    return db.events
      .filter((e) => {
        const d = parse(e.date);
        return d.getMonth() === month && d.getFullYear() === year;
      })
      .sort((a, b) => (a.date + (a.time || "")).localeCompare(b.date + (b.time || "")));
  }, [db.events, month, year]);

  function prevMonth() { const d = new Date(cursor); d.setMonth(d.getMonth() - 1); setCursor(d); }
  function nextMonth() { const d = new Date(cursor); d.setMonth(d.getMonth() + 1); setCursor(d); }
  function goToday()   { setCursor(new Date()); }

  function openCompose(dateStr: string) {
    setComposeFor(dateStr); setCompTitle(""); setCompTime(""); setCompNote("");
  }
  function saveCompose() {
    const t = compTitle.trim();
    if (!t || !composeFor) return;
    mutate((d) => {
      d.events.push({
        id: uid(), title: t, date: composeFor, time: compTime.trim() || undefined,
        note: compNote.trim() || undefined, createdAt: Date.now(),
      } as CalEvent);
    });
    setComposeFor(null);
  }
  function deleteEvent(id: string) {
    mutate((d) => { d.events = d.events.filter((e) => e.id !== id); });
  }

  const openDay = dayOpen ? parse(dayOpen) : null;
  const openDayEvents = dayOpen ? (byDate[dayOpen] || []) : [];

  return (
    <Shell>
      <div className="cal-page">
        <header className="cal-head">
          <div>
            <div className="eyebrow">Calendar</div>
            <h1 className="month-name">{MONTHS[month]} <span className="year">{year}</span></h1>
          </div>
          <div className="cal-nav">
            <button className="cal-btn" onClick={prevMonth} aria-label="Previous month"><ChevronLeft size={16} /></button>
            <button className="cal-btn today-btn" onClick={goToday}>Today</button>
            <button className="cal-btn" onClick={nextMonth} aria-label="Next month"><ChevronRight size={16} /></button>
            <div className="cal-view">
              <button className={`v-pill ${view === "month" ? "on" : ""}`} onClick={() => setView("month")}>Month</button>
              <button className={`v-pill ${view === "agenda" ? "on" : ""}`} onClick={() => setView("agenda")}>Agenda</button>
            </div>
            <button className="cal-btn add-btn" onClick={() => openCompose(today)}><Plus size={14} /> Add</button>
          </div>
        </header>

        {view === "month" ? (
          <div className="cal-grid">
            <div className="cal-row cal-row-head">
              {WD.map((d) => <div key={d} className="cal-dow">{d}</div>)}
            </div>
            {matrix.map((week, wi) => (
              <div key={wi} className="cal-row">
                {week.map((d) => {
                  const k = iso(d);
                  const isOther = d.getMonth() !== month;
                  const isToday = k === today;
                  const events = byDate[k] || [];
                  return (
                    <button
                      key={k}
                      className={`cal-cell ${isOther ? "other" : ""} ${isToday ? "today" : ""}`}
                      onClick={() => setDayOpen(k)}
                    >
                      <div className="cell-head">
                        <span className={`cell-day ${isToday ? "today-ring" : ""}`}>{d.getDate()}</span>
                      </div>
                      <div className="cell-events">
                        {events.slice(0, 3).map((e) => (
                          <div key={e.id} className="ev-chip" title={`${e.title}${e.time ? " · " + formatTime(e.time) : ""}`}>
                            {e.time && <span className="ev-time">{formatTime(e.time)}</span>}
                            <span className="ev-title">{e.title}</span>
                          </div>
                        ))}
                        {events.length > 3 && <div className="ev-more">+{events.length - 3} more</div>}
                      </div>
                    </button>
                  );
                })}
              </div>
            ))}
          </div>
        ) : (
          <div className="agenda">
            {monthEvents.length === 0 ? (
              <div className="empty">
                <CalendarDays size={28} />
                <div>Nothing on the calendar this month.</div>
                <button className="cal-btn add-btn" onClick={() => openCompose(today)}><Plus size={14} /> Add an event</button>
              </div>
            ) : (
              monthEvents.map((e) => (
                <div key={e.id} className="ag-row" onClick={() => setDayOpen(e.date)}>
                  <div className="ag-date">
                    <div className="ag-day">{parse(e.date).getDate()}</div>
                    <div className="ag-mon">{MONTHS[parse(e.date).getMonth()].slice(0, 3)}</div>
                  </div>
                  <div className="ag-body">
                    <div className="ag-title">{e.title}</div>
                    {e.time && <div className="ag-time"><Clock size={12} /> {formatTime(e.time)}</div>}
                    {e.note && <div className="ag-note">{e.note}</div>}
                  </div>
                  <button className="ag-del" onClick={(ev) => { ev.stopPropagation(); deleteEvent(e.id); }} aria-label="Delete"><Trash2 size={14} /></button>
                </div>
              ))
            )}
          </div>
        )}

        {dayOpen && (
          <div className="modal-bg" onClick={() => setDayOpen(null)}>
            <div className="modal" onClick={(e) => e.stopPropagation()}>
              <div className="modal-head">
                <div>
                  <div className="modal-eyebrow">{openDay && WD[(openDay.getDay() + 6) % 7]}</div>
                  <h2 className="modal-title">{openDay && `${MONTHS[openDay.getMonth()]} ${openDay.getDate()}`}</h2>
                </div>
                <button className="modal-x" onClick={() => setDayOpen(null)} aria-label="Close"><X size={16} /></button>
              </div>
              <div className="modal-body">
                {openDayEvents.length === 0 ? (
                  <div className="day-empty">Nothing scheduled.</div>
                ) : (
                  openDayEvents.map((e) => (
                    <div key={e.id} className="day-ev">
                      <div className="day-ev-main">
                        {e.time && <div className="day-ev-time">{formatTime(e.time)}</div>}
                        <div className="day-ev-title">{e.title}</div>
                        {e.note && <div className="day-ev-note">{e.note}</div>}
                      </div>
                      <button className="day-ev-del" onClick={() => deleteEvent(e.id)} aria-label="Delete"><Trash2 size={14} /></button>
                    </div>
                  ))
                )}
                <button className="add-day-btn" onClick={() => { setDayOpen(null); openCompose(iso(openDay!)); }}>
                  <Plus size={14} /> Add to this day
                </button>
              </div>
            </div>
          </div>
        )}

        {composeFor && (
          <div className="modal-bg" onClick={() => setComposeFor(null)}>
            <div className="modal" onClick={(e) => e.stopPropagation()}>
              <div className="modal-head">
                <div>
                  <div className="modal-eyebrow">New event</div>
                  <h2 className="modal-title">{(() => { const d = parse(composeFor); return `${MONTHS[d.getMonth()]} ${d.getDate()}`; })()}</h2>
                </div>
                <button className="modal-x" onClick={() => setComposeFor(null)} aria-label="Close"><X size={16} /></button>
              </div>
              <div className="modal-body">
                <label className="lbl">Title</label>
                <input className="inp" placeholder="What is it?" value={compTitle} onChange={(e) => setCompTitle(e.target.value)} autoFocus />
                <label className="lbl">Time (optional)</label>
                <input className="inp" type="time" value={compTime} onChange={(e) => setCompTime(e.target.value)} />
                <label className="lbl">Note (optional)</label>
                <textarea className="inp" rows={3} placeholder="Anything else?" value={compNote} onChange={(e) => setCompNote(e.target.value)} />
                <button className="save-btn" onClick={saveCompose} disabled={!compTitle.trim()}>Save</button>
              </div>
            </div>
          </div>
        )}
      </div>

      <style>{`
        .cal-page { padding: 26px 32px 60px; max-width: 1200px; margin: 0 auto; }
        .cal-head { display: flex; justify-content: space-between; align-items: center; margin-bottom: 22px; flex-wrap: wrap; gap: 14px; }
        .eyebrow { font-size: 11px; letter-spacing: 0.32em; text-transform: uppercase; color: var(--purple-2); margin-bottom: 6px; }
        .month-name { font-family: var(--font-serif-stack); font-size: 36px; font-weight: 500; letter-spacing: -0.01em; }
        .month-name .year { color: var(--muted); font-weight: 400; margin-left: 8px; }
        .cal-nav { display: flex; align-items: center; gap: 8px; }
        .cal-btn { display: inline-flex; align-items: center; gap: 6px; background: var(--glass-2); border: 1px solid var(--line); color: var(--ink); padding: 8px 13px; border-radius: 10px; cursor: pointer; font-size: 13px; transition: all 0.18s var(--ease); font-family: inherit; }
        .cal-btn:hover { background: var(--glass); border-color: var(--line-2); }
        .today-btn { font-weight: 500; }
        .add-btn { background: var(--purple-soft); border-color: var(--purple-line); color: var(--ink); }
        .add-btn:hover { background: rgba(124,107,176,0.24); }
        .cal-view { display: inline-flex; gap: 2px; background: var(--glass-3); border: 1px solid var(--line); border-radius: 10px; padding: 3px; margin-left: 6px; }
        .v-pill { padding: 5px 12px; border: 0; background: transparent; color: var(--ink-2); border-radius: 7px; font-size: 12.5px; cursor: pointer; font-family: inherit; }
        .v-pill.on { background: var(--glass); color: var(--ink); }

        .cal-grid { border: 1px solid var(--line); border-radius: var(--radius-sm); overflow: hidden; background: var(--glass-3); }
        .cal-row { display: grid; grid-template-columns: repeat(7, 1fr); }
        .cal-row-head { background: var(--glass); border-bottom: 1px solid var(--line); }
        .cal-dow { padding: 12px 14px; font-size: 11px; letter-spacing: 0.16em; text-transform: uppercase; color: var(--muted); font-weight: 500; }
        .cal-row:not(.cal-row-head) { border-top: 1px solid var(--line); }
        .cal-row:not(.cal-row-head):first-of-type { border-top: 0; }

        .cal-cell { min-height: 108px; padding: 8px 10px; border-left: 1px solid var(--line); background: transparent; color: var(--ink); text-align: left; cursor: pointer; transition: background 0.15s var(--ease); display: flex; flex-direction: column; gap: 6px; font-family: inherit; }
        .cal-cell:first-child { border-left: 0; }
        .cal-cell:hover { background: var(--glass-2); }
        .cal-cell.other { color: var(--faint); background: rgba(255,255,255,0.01); }
        .cal-cell.other .cell-day { color: var(--faint); }

        .cell-head { display: flex; justify-content: flex-end; }
        .cell-day { font-size: 13px; font-weight: 500; color: var(--ink-2); padding: 2px 6px; }
        .cell-day.today-ring { background: var(--purple); color: white; border-radius: 50%; width: 24px; height: 24px; display: inline-flex; align-items: center; justify-content: center; padding: 0; }

        .cell-events { display: flex; flex-direction: column; gap: 3px; }
        .ev-chip { display: flex; align-items: center; gap: 6px; padding: 3px 7px; background: var(--purple-soft); border-left: 2px solid var(--purple); border-radius: 4px; font-size: 11.5px; color: var(--ink); overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
        .ev-time { color: var(--purple-2); font-weight: 500; flex-shrink: 0; }
        .ev-title { overflow: hidden; text-overflow: ellipsis; }
        .ev-more { font-size: 11px; color: var(--muted); padding: 1px 6px; }

        .agenda { display: flex; flex-direction: column; gap: 6px; }
        .ag-row { display: flex; align-items: center; gap: 16px; padding: 14px 16px; background: var(--glass-2); border: 1px solid var(--line); border-radius: var(--radius-sm); cursor: pointer; transition: all 0.15s var(--ease); }
        .ag-row:hover { background: var(--glass); border-color: var(--purple-line); }
        .ag-date { text-align: center; min-width: 50px; }
        .ag-day { font-family: var(--font-serif-stack); font-size: 26px; font-weight: 500; line-height: 1; }
        .ag-mon { font-size: 11px; color: var(--muted); margin-top: 2px; text-transform: uppercase; letter-spacing: 0.1em; }
        .ag-body { flex: 1; }
        .ag-title { font-size: 14px; font-weight: 500; }
        .ag-time { display: inline-flex; align-items: center; gap: 4px; font-size: 12px; color: var(--purple-2); margin-top: 3px; }
        .ag-note { font-size: 12.5px; color: var(--muted); margin-top: 4px; }
        .ag-del { background: transparent; border: 0; color: var(--faint); padding: 6px; cursor: pointer; border-radius: 6px; }
        .ag-del:hover { color: var(--danger); background: var(--glass-3); }
        .empty { display: flex; flex-direction: column; align-items: center; gap: 12px; padding: 80px 20px; color: var(--muted); }

        .modal-bg { position: fixed; inset: 0; background: rgba(8,7,10,0.72); backdrop-filter: blur(10px); z-index: var(--z-modal); display: flex; justify-content: center; align-items: flex-start; padding-top: 12vh; }
        .modal { width: min(440px, 92vw); background: var(--surface-elevated); border: 1px solid var(--line-2); border-radius: var(--radius); padding: 24px; box-shadow: var(--shadow-lg); animation: modalIn 0.22s var(--ease); }
        @keyframes modalIn { from { transform: translateY(-12px); opacity: 0; } to { transform: translateY(0); opacity: 1; } }
        .modal-head { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 18px; }
        .modal-eyebrow { font-size: 11px; letter-spacing: 0.22em; text-transform: uppercase; color: var(--purple-2); margin-bottom: 6px; }
        .modal-title { font-family: var(--font-serif-stack); font-size: 22px; font-weight: 500; }
        .modal-x { background: var(--glass-3); border: 1px solid var(--line); color: var(--ink-2); border-radius: 8px; padding: 7px; cursor: pointer; display: inline-flex; }
        .modal-x:hover { color: var(--ink); }
        .modal-body { display: flex; flex-direction: column; gap: 10px; }
        .lbl { font-size: 11px; letter-spacing: 0.06em; text-transform: uppercase; color: var(--muted); margin-top: 6px; }
        .inp { background: var(--glass-3); border: 1px solid var(--line); border-radius: 9px; color: var(--ink); padding: 10px 12px; font-size: 13.5px; font-family: inherit; outline: none; }
        .inp:focus { border-color: var(--purple-line); }
        .save-btn { margin-top: 10px; background: var(--purple); color: white; border: 0; border-radius: 10px; padding: 11px; font-weight: 500; cursor: pointer; font-family: inherit; font-size: 14px; }
        .save-btn:hover { background: #8c7bc0; }
        .save-btn:disabled { opacity: 0.5; cursor: default; }

        .day-empty { color: var(--muted); padding: 16px 0; font-size: 13px; font-style: italic; }
        .day-ev { display: flex; justify-content: space-between; gap: 12px; padding: 12px 0; border-bottom: 1px solid var(--line); }
        .day-ev:last-of-type { border-bottom: 0; }
        .day-ev-main { flex: 1; }
        .day-ev-time { font-size: 11.5px; color: var(--purple-2); font-weight: 500; margin-bottom: 3px; }
        .day-ev-title { font-size: 14px; font-weight: 500; }
        .day-ev-note { font-size: 12.5px; color: var(--muted); margin-top: 4px; }
        .day-ev-del { background: transparent; border: 0; color: var(--faint); cursor: pointer; padding: 4px; }
        .day-ev-del:hover { color: var(--danger); }
        .add-day-btn { margin-top: 14px; display: inline-flex; align-items: center; gap: 6px; background: var(--purple-soft); border: 1px solid var(--purple-line); color: var(--ink); padding: 9px 14px; border-radius: 9px; cursor: pointer; font-family: inherit; font-size: 13px; align-self: flex-start; }
        .add-day-btn:hover { background: rgba(124,107,176,0.24); }

        @media (max-width: 720px) {
          .cal-page { padding: 18px 18px 60px; }
          .cal-head { flex-direction: column; align-items: stretch; }
          .cal-cell { min-height: 70px; padding: 5px 6px; }
          .cell-day { font-size: 11px; }
          .ev-chip { font-size: 10px; padding: 2px 4px; }
          .modal { padding: 18px; }
        }
      `}</style>
    </Shell>
  );
}
