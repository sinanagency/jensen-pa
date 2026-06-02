"use client";

import { useState } from "react";
import Shell from "@/components/Shell";
import { useDB } from "@/components/useDB";
import { CalEvent, uid } from "@/lib/store";
import { Plus, Trash2, CalendarDays, Clock } from "lucide-react";

export default function CalendarPage() {
  const { db, mutate } = useDB();

  const [title, setTitle] = useState<string>("");
  const [date, setDate] = useState<string>("");
  const [time, setTime] = useState<string>("");
  const [entityId, setEntityId] = useState<string>("");
  const [note, setNote] = useState<string>("");

  if (!db) return <Shell><div className="muted">Loading…</div></Shell>;

  function handleAdd(): void {
    const trimmed = title.trim();
    if (!trimmed || !date) return;
    mutate((d) => {
      d.events.push({
        id: uid(),
        title: trimmed,
        date,
        time: time || undefined,
        note: note.trim() || undefined,
        entityId: entityId || undefined,
        createdAt: Date.now(),
      });
    });
    setTitle("");
    setDate("");
    setTime("");
    setEntityId("");
    setNote("");
  }

  function handleDelete(id: string): void {
    mutate((d) => {
      d.events = d.events.filter((e) => e.id !== id);
    });
  }

  const today: string = new Date().toISOString().slice(0, 10);
  const entityMap = new Map(db.entities.map((e) => [e.id, e.name]));

  const upcoming: CalEvent[] = db.events
    .filter((e) => e.date >= today)
    .sort((a, b) => {
      if (a.date !== b.date) return a.date < b.date ? -1 : 1;
      if (a.time && b.time) return a.time < b.time ? -1 : 1;
      if (a.time) return -1;
      if (b.time) return 1;
      return 0;
    });

  const past: CalEvent[] = db.events
    .filter((e) => e.date < today)
    .sort((a, b) => {
      if (a.date !== b.date) return b.date < a.date ? -1 : 1;
      if (a.time && b.time) return b.time < a.time ? -1 : 1;
      return 0;
    });

  function formatDateHeader(iso: string): string {
    const [year, month, day] = iso.split("-").map(Number);
    const d = new Date(year, month - 1, day);
    return d.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" });
  }

  function groupByDate(events: CalEvent[]): Map<string, CalEvent[]> {
    const map = new Map<string, CalEvent[]>();
    for (const ev of events) {
      const existing = map.get(ev.date);
      if (existing) {
        existing.push(ev);
      } else {
        map.set(ev.date, [ev]);
      }
    }
    return map;
  }

  const upcomingGroups = groupByDate(upcoming);
  const pastGroups = groupByDate(past);

  function renderEventRow(ev: CalEvent): React.ReactNode {
    const entityName = ev.entityId ? entityMap.get(ev.entityId) : undefined;
    return (
      <div
        key={ev.id}
        style={{
          display: "flex",
          alignItems: "flex-start",
          gap: 14,
          padding: "14px 0",
          borderTop: "1px solid var(--line)",
        }}
      >
        <div style={{ paddingTop: 2, color: "var(--muted)", flexShrink: 0 }}>
          <Clock size={14} />
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
            <span style={{ fontWeight: 700, fontSize: 14.5, color: "var(--ink)", lineHeight: 1.4 }}>
              {ev.title}
            </span>
            {ev.time ? (
              <span className="pill" style={{ fontSize: 11 }}>{ev.time}</span>
            ) : (
              <span className="pill" style={{ fontSize: 11 }}>All day</span>
            )}
            {entityName && (
              <span className="pill accent" style={{ fontSize: 11 }}>{entityName}</span>
            )}
          </div>
          {ev.note && (
            <div className="muted" style={{ fontSize: 12.5, marginTop: 5, lineHeight: 1.5 }}>
              {ev.note}
            </div>
          )}
        </div>
        <button
          className="btn ghost sm"
          onClick={() => handleDelete(ev.id)}
          style={{ padding: "0 8px", height: 28, flexShrink: 0, color: "var(--faint)" }}
          title="Delete event"
        >
          <Trash2 size={13} />
        </button>
      </div>
    );
  }

  function renderGroup(dateStr: string, events: CalEvent[]): React.ReactNode {
    return (
      <div key={dateStr} style={{ marginBottom: 24 }}>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 10,
            marginBottom: 8,
          }}
        >
          <CalendarDays size={14} style={{ color: "var(--purple)", flexShrink: 0 }} />
          <span
            style={{
              fontSize: 12,
              fontWeight: 700,
              letterSpacing: "0.08em",
              textTransform: "uppercase",
              color: dateStr === today ? "var(--purple)" : "var(--ink-2)",
              fontFamily: "var(--font-display)",
            }}
          >
            {formatDateHeader(dateStr)}
            {dateStr === today && (
              <span className="pill accent" style={{ marginLeft: 8, fontSize: 10 }}>Today</span>
            )}
          </span>
        </div>
        <div className="card" style={{ padding: "0 20px" }}>
          {events.map((ev) => renderEventRow(ev))}
        </div>
      </div>
    );
  }

  return (
    <Shell>
      {/* Page hero */}
      <div className="page-hero fade-up">
        <div className="eyebrow">Calendar</div>
        <h1>What is coming up.</h1>
        <div style={{ marginTop: 10 }}>
          <span className="pill accent" style={{ fontSize: 12 }}>
            Two way sync with Google and Outlook is the next step.
          </span>
        </div>
      </div>

      {/* Add event row */}
      <div
        className="card fade-up"
        style={{ padding: 20, marginBottom: 28, display: "flex", gap: 12, alignItems: "flex-end", flexWrap: "wrap" }}
      >
        <input
          className="input"
          style={{ flex: "2 1 180px", minWidth: 140 }}
          placeholder="Event title…"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") handleAdd(); }}
        />
        <input
          className="input"
          type="date"
          style={{ flex: "1 1 140px", minWidth: 130 }}
          value={date}
          onChange={(e) => setDate(e.target.value)}
        />
        <input
          className="input"
          type="time"
          style={{ flex: "0 1 120px", minWidth: 110 }}
          value={time}
          onChange={(e) => setTime(e.target.value)}
        />
        <select
          className="input"
          style={{ flex: "1 1 160px", minWidth: 130 }}
          value={entityId}
          onChange={(e) => setEntityId(e.target.value)}
        >
          <option value="">No entity</option>
          {db.entities.map((e) => (
            <option key={e.id} value={e.id}>{e.name}</option>
          ))}
        </select>
        <input
          className="input"
          style={{ flex: "2 1 180px", minWidth: 140 }}
          placeholder="Note (optional)"
          value={note}
          onChange={(e) => setNote(e.target.value)}
        />
        <button
          className="btn purple sm"
          onClick={handleAdd}
          style={{ flexShrink: 0, display: "flex", alignItems: "center", gap: 6 }}
        >
          <Plus size={14} /> Add
        </button>
      </div>

      {/* Agenda: upcoming */}
      <div className="fade-up">
        {upcomingGroups.size === 0 && pastGroups.size === 0 && (
          <div className="muted" style={{ padding: "32px 0", textAlign: "center", fontSize: 14 }}>
            Nothing scheduled. Add your first event above.
          </div>
        )}

        {upcomingGroups.size > 0 && (
          <div style={{ marginBottom: 8 }}>
            {Array.from(upcomingGroups.entries()).map(([dateStr, events]) =>
              renderGroup(dateStr, events)
            )}
          </div>
        )}

        {/* Past events */}
        {pastGroups.size > 0 && (
          <div style={{ marginTop: 36, opacity: 0.45 }}>
            <div
              style={{
                fontSize: 11,
                fontWeight: 700,
                letterSpacing: "0.1em",
                textTransform: "uppercase",
                color: "var(--muted)",
                marginBottom: 16,
              }}
            >
              Earlier
            </div>
            {Array.from(pastGroups.entries()).map(([dateStr, events]) =>
              renderGroup(dateStr, events)
            )}
          </div>
        )}
      </div>
    </Shell>
  );
}
