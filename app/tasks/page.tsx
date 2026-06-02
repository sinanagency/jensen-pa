"use client";

import { useState } from "react";
import Shell from "@/components/Shell";
import { useDB } from "@/components/useDB";
import { Task, Quadrant, uid } from "@/lib/store";
import { Plus, Trash2 } from "lucide-react";

type QuadrantMeta = {
  q: Quadrant;
  label: string;
  sub: string;
  color: string;
};

const QUADRANTS: QuadrantMeta[] = [
  { q: 1, label: "Do first", sub: "Urgent and important", color: "var(--q1)" },
  { q: 2, label: "Schedule", sub: "Important, not urgent", color: "var(--q2)" },
  { q: 3, label: "Delegate", sub: "Urgent, not important", color: "var(--q3)" },
  { q: 4, label: "Drop", sub: "Neither", color: "var(--q4)" },
];

export default function TasksPage() {
  const { db, mutate } = useDB();

  const [title, setTitle] = useState<string>("");
  const [quadrant, setQuadrant] = useState<Quadrant>(1);
  const [entityId, setEntityId] = useState<string>("");

  if (!db) return <Shell><div className="muted">Loading…</div></Shell>;

  function handleAdd() {
    const trimmed = title.trim();
    if (!trimmed) return;
    mutate((d) => {
      d.tasks.push({
        id: uid(),
        title: trimmed,
        quadrant,
        entityId: entityId || undefined,
        done: false,
        createdAt: Date.now(),
      });
    });
    setTitle("");
    setEntityId("");
  }

  function handleToggle(id: string) {
    mutate((d) => {
      const t = d.tasks.find((x) => x.id === id);
      if (t) t.done = !t.done;
    });
  }

  function handleMove(id: string, q: Quadrant) {
    mutate((d) => {
      const t = d.tasks.find((x) => x.id === id);
      if (t) t.quadrant = q;
    });
  }

  function handleDelete(id: string) {
    mutate((d) => {
      d.tasks = d.tasks.filter((t) => t.id !== id);
    });
  }

  const entityMap = new Map(db.entities.map((e) => [e.id, e.name]));

  return (
    <Shell>
      {/* Page hero */}
      <div className="page-hero fade-up">
        <div className="eyebrow">Priorities</div>
        <h1>The four quadrants.</h1>
        <div className="muted" style={{ marginTop: 8, fontSize: 14, lineHeight: 1.6 }}>
          Q1: do first. Q2: schedule and protect. Q3: delegate. Q4: drop entirely.
        </div>
      </div>

      {/* Add row */}
      <div className="card fade-up" style={{ padding: 20, marginBottom: 22, display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
        <input
          className="input"
          style={{ flex: "1 1 200px", minWidth: 160 }}
          placeholder="New task…"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") handleAdd(); }}
        />

        {/* Quadrant pill selector */}
        <div style={{ display: "flex", gap: 6 }}>
          {QUADRANTS.map(({ q, label, color }) => (
            <button
              key={q}
              onClick={() => setQuadrant(q)}
              className="btn sm"
              style={{
                background: quadrant === q ? color : "var(--glass-2)",
                color: quadrant === q ? "#fff" : "var(--muted)",
                border: quadrant === q ? "none" : "1px solid var(--line)",
                fontWeight: 600,
                minWidth: 42,
              }}
            >
              Q{q}
            </button>
          ))}
        </div>

        {/* Entity selector */}
        <select
          className="input"
          style={{ flex: "0 1 180px", minWidth: 120 }}
          value={entityId}
          onChange={(e) => setEntityId(e.target.value)}
        >
          <option value="">No entity</option>
          {db.entities.map((e) => (
            <option key={e.id} value={e.id}>{e.name}</option>
          ))}
        </select>

        <button className="btn purple sm" onClick={handleAdd} style={{ flexShrink: 0 }}>
          <Plus size={14} /> Add
        </button>
      </div>

      {/* 2x2 grid */}
      <div className="grid cols-2 fade-up">
        {QUADRANTS.map(({ q, label, sub, color }) => {
          const all = db.tasks.filter((t) => t.quadrant === q);
          const active = all.filter((t) => !t.done);
          const done = all.filter((t) => t.done);
          const ordered = [...active, ...done];

          return (
            <div
              key={q}
              className="card"
              style={{ padding: 22, display: "flex", flexDirection: "column", gap: 0 }}
            >
              {/* Column header */}
              <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 16 }}>
                <div style={{ width: 4, height: 36, borderRadius: 999, background: color, flexShrink: 0 }} />
                <div>
                  <div style={{ fontWeight: 700, fontSize: 14.5, color: color }}>
                    Q{q} · {label}
                  </div>
                  <div className="muted" style={{ fontSize: 12 }}>{sub}</div>
                </div>
                <div className="pill" style={{ marginLeft: "auto", fontSize: 11 }}>
                  {active.length}
                </div>
              </div>

              {/* Task rows */}
              {ordered.length === 0 && (
                <div className="faint" style={{ fontSize: 13, padding: "6px 0" }}>Nothing here yet.</div>
              )}
              {ordered.map((task: Task) => {
                const entityName = task.entityId ? entityMap.get(task.entityId) : undefined;
                return (
                  <div
                    key={task.id}
                    style={{
                      display: "flex",
                      alignItems: "flex-start",
                      gap: 10,
                      padding: "10px 0",
                      borderTop: "1px solid var(--line)",
                      opacity: task.done ? 0.4 : 1,
                      transition: "opacity 0.2s",
                    }}
                  >
                    <input
                      type="checkbox"
                      checked={task.done}
                      onChange={() => handleToggle(task.id)}
                      style={{ width: 17, height: 17, marginTop: 2, flexShrink: 0, accentColor: "var(--purple)", cursor: "pointer" }}
                    />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 14, lineHeight: 1.5, textDecoration: task.done ? "line-through" : "none", color: task.done ? "var(--muted)" : "var(--ink)" }}>
                        {task.title}
                      </div>
                      {entityName && (
                        <span className="pill" style={{ marginTop: 5, fontSize: 11, height: 22 }}>
                          {entityName}
                        </span>
                      )}
                    </div>
                    <button
                      className="btn ghost sm"
                      onClick={() => handleDelete(task.id)}
                      style={{ padding: "0 8px", height: 28, flexShrink: 0, color: "var(--faint)" }}
                      title="Delete task"
                    >
                      <Trash2 size={13} />
                    </button>
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>
    </Shell>
  );
}
