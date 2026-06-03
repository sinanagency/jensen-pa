"use client";

import { useRef, useState } from "react";
import Shell from "@/components/Shell";
import { useDB } from "@/components/useDB";
import { Entity, EntityKind, uid } from "@/lib/store";
import { aed } from "@/lib/tax";
import { Building2, Users, PartyPopper, Plus, Trash2, X } from "lucide-react";

const KIND_ICONS: Record<EntityKind, React.ReactNode> = {
  venue: <Building2 size={15} />,
  client: <Users size={15} />,
  event: <PartyPopper size={15} />,
};

const KIND_LABELS: Record<EntityKind, string> = {
  venue: "Venue",
  client: "Client",
  event: "Event",
};

export default function Portfolio() {
  const { db, mutate } = useDB();

  // Add-form state
  const [name, setName] = useState<string>("");
  const [subtitle, setSubtitle] = useState<string>("");
  const [status, setStatus] = useState<string>("");
  const [kind, setKind] = useState<EntityKind>("venue");

  // Selected entity for detail panel
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const formRef = useRef<HTMLDivElement>(null);

  if (!db) return <Shell><div className="muted">Loading…</div></Shell>;

  // Capture narrowed non-null reference for use inside nested functions/closures.
  const store = db;

  const venues = db.entities.filter((e: Entity) => e.kind === "venue");
  const clients = db.entities.filter((e: Entity) => e.kind === "client");
  const events = db.entities.filter((e: Entity) => e.kind === "event");

  const selected = selectedId ? db.entities.find((e: Entity) => e.id === selectedId) ?? null : null;

  function handleAdd() {
    const trimmed = name.trim();
    if (!trimmed) return;
    mutate((d) => {
      d.entities.push({
        id: uid(),
        kind,
        name: trimmed,
        subtitle: subtitle.trim() || undefined,
        status: status.trim() || undefined,
        createdAt: Date.now(),
      });
    });
    setName("");
    setSubtitle("");
    setStatus("");
  }

  function handleDelete(id: string) {
    if (selectedId === id) setSelectedId(null);
    mutate((d) => {
      d.entities = d.entities.filter((e: Entity) => e.id !== id);
    });
  }

  function entityCounts(e: Entity) {
    const openTasks = store.tasks.filter((t) => t.entityId === e.id && !t.done).length;
    const upcomingEvents = store.events.filter((ev) => ev.entityId === e.id).length;
    const net = store.finance
      .filter((f) => f.entityId === e.id)
      .reduce((sum, f) => sum + (f.kind === "income" ? f.amount : -f.amount), 0);
    return { openTasks, upcomingEvents, net };
  }

  function EntityCard({ e }: { e: Entity }) {
    const { openTasks, upcomingEvents, net } = entityCounts(e);
    const isSelected = selectedId === e.id;
    return (
      <div
        className={`card${isSelected ? " feature" : ""}`}
        style={{ padding: 18, cursor: "pointer", position: "relative" }}
        onClick={() => setSelectedId(isSelected ? null : e.id)}
      >
        <button
          className="btn ghost sm"
          style={{
            position: "absolute", top: 12, right: 12,
            height: 28, width: 28, padding: 0,
            display: "grid", placeItems: "center",
            color: "var(--muted)",
          }}
          onClick={(ev: React.MouseEvent) => { ev.stopPropagation(); handleDelete(e.id); }}
          aria-label={`Delete ${e.name}`}
        >
          <Trash2 size={13} />
        </button>

        <div style={{ display: "flex", alignItems: "center", gap: 6, color: "var(--muted)", marginBottom: 8 }}>
          {KIND_ICONS[e.kind]}
          <span style={{ fontSize: 11.5, letterSpacing: "0.04em", textTransform: "uppercase", fontWeight: 500 }}>
            {KIND_LABELS[e.kind]}
          </span>
        </div>

        <div style={{ fontWeight: 700, fontSize: 15.5, marginBottom: 3, paddingRight: 28 }}>{e.name}</div>
        {e.subtitle && (
          <div className="muted" style={{ fontSize: 13, marginBottom: 10 }}>{e.subtitle}</div>
        )}
        {e.status && (
          <span className="pill accent" style={{ marginBottom: 12, display: "inline-flex" }}>{e.status}</span>
        )}

        <div style={{ display: "flex", gap: 14, marginTop: 10, fontSize: 12.5, color: "var(--faint)" }}>
          <span>{openTasks} open task{openTasks !== 1 ? "s" : ""}</span>
          <span>{upcomingEvents} event{upcomingEvents !== 1 ? "s" : ""}</span>
          <span style={{ marginLeft: "auto", color: net >= 0 ? "var(--success)" : "var(--danger)" }}>
            {aed(net)}
          </span>
        </div>
      </div>
    );
  }

  function Section({ label, items, addKind }: { label: string; items: Entity[]; addKind: EntityKind }) {
    if (items.length === 0) return null;
    return (
      <div style={{ marginBottom: 28 }}>
        <div style={{
          fontSize: 11.5, letterSpacing: "0.07em", textTransform: "uppercase",
          color: "var(--faint)", fontWeight: 600, marginBottom: 12,
        }}>
          {label}
        </div>
        <div className="grid cols-3">
          {items.map((e: Entity) => <EntityCard key={e.id} e={e} />)}
          <button
            className="add-ghost"
            onClick={() => { setKind(addKind); formRef.current?.scrollIntoView({ behavior: "smooth", block: "center" }); }}
            aria-label={`Add ${KIND_LABELS[addKind]}`}
          >
            <Plus size={18} /> Add {KIND_LABELS[addKind].toLowerCase()}
          </button>
        </div>
      </div>
    );
  }

  // Detail panel data
  const relatedTasks = selected
    ? db.tasks.filter((t) => t.entityId === selected.id && !t.done)
    : [];
  const relatedEvents = selected
    ? db.events
        .filter((ev) => ev.entityId === selected.id)
        .sort((a, b) => a.date.localeCompare(b.date))
        .slice(0, 6)
    : [];

  const noEntities = db.entities.length === 0;

  return (
    <Shell>
      <div className="page-hero fade-up">
        <div className="eyebrow">Portfolio</div>
        <h1>Your venues, clients, and events.</h1>
      </div>

      {/* Add form */}
      <div ref={formRef} className="card" style={{ padding: 22, marginBottom: 28 }}>
        <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 16 }}>Add to portfolio</div>

        {/* Kind selector */}
        <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
          {(["venue", "client", "event"] as EntityKind[]).map((k) => (
            <button
              key={k}
              className={`pill${kind === k ? " accent" : ""}`}
              style={{ cursor: "pointer", border: "1px solid var(--line)" }}
              onClick={() => setKind(k)}
            >
              {KIND_ICONS[k]}
              {KIND_LABELS[k]}
            </button>
          ))}
        </div>

        <div className="grid cols-3" style={{ marginBottom: 12 }}>
          <input
            className="input"
            placeholder="Name"
            value={name}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => setName(e.target.value)}
            onKeyDown={(e: React.KeyboardEvent<HTMLInputElement>) => { if (e.key === "Enter") handleAdd(); }}
          />
          <input
            className="input"
            placeholder="Subtitle (optional)"
            value={subtitle}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => setSubtitle(e.target.value)}
          />
          <input
            className="input"
            placeholder="Status (optional)"
            value={status}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => setStatus(e.target.value)}
          />
        </div>

        <button className="btn purple sm" onClick={handleAdd} disabled={!name.trim()}>
          <Plus size={14} /> Add {KIND_LABELS[kind]}
        </button>
      </div>

      {noEntities && (
        <div className="card" style={{ padding: 32, textAlign: "center" }}>
          <div className="muted" style={{ fontSize: 14 }}>
            Nothing in your portfolio yet. Add your first venue, client, or event above.
          </div>
        </div>
      )}

      <Section label="Venues" items={venues} addKind="venue" />
      <Section label="Clients" items={clients} addKind="client" />
      <Section label="Events" items={events} addKind="event" />

      {/* Detail panel */}
      {selected && (
        <div className="card feature fade-up" style={{ padding: 24, marginTop: 8 }}>
          <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 18 }}>
            <div>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4, color: "var(--muted)" }}>
                {KIND_ICONS[selected.kind]}
                <span style={{ fontSize: 11.5, letterSpacing: "0.05em", textTransform: "uppercase", fontWeight: 500 }}>
                  {KIND_LABELS[selected.kind]}
                </span>
              </div>
              <div style={{ fontFamily: "var(--font-display)", fontSize: 22, fontWeight: 700 }}>{selected.name}</div>
              {selected.subtitle && (
                <div className="muted" style={{ fontSize: 13.5, marginTop: 3 }}>{selected.subtitle}</div>
              )}
            </div>
            <button
              className="btn ghost sm"
              style={{ height: 32, width: 32, padding: 0, display: "grid", placeItems: "center" }}
              onClick={() => setSelectedId(null)}
              aria-label="Close"
            >
              <X size={14} />
            </button>
          </div>

          <div className="grid cols-2">
            {/* Open tasks */}
            <div>
              <div style={{ fontSize: 11.5, color: "var(--faint)", letterSpacing: "0.06em", textTransform: "uppercase", fontWeight: 600, marginBottom: 10 }}>
                Open tasks
              </div>
              {relatedTasks.length === 0 ? (
                <div className="faint" style={{ fontSize: 13.5 }}>No open tasks. All clear.</div>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  {relatedTasks.map((t) => (
                    <div key={t.id} style={{
                      fontSize: 13.5, padding: "9px 12px",
                      background: "var(--glass)", borderRadius: "var(--radius-sm)",
                      border: "1px solid var(--line)",
                    }}>
                      {t.title}
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Upcoming events */}
            <div>
              <div style={{ fontSize: 11.5, color: "var(--faint)", letterSpacing: "0.06em", textTransform: "uppercase", fontWeight: 600, marginBottom: 10 }}>
                Calendar
              </div>
              {relatedEvents.length === 0 ? (
                <div className="faint" style={{ fontSize: 13.5 }}>Nothing on the calendar.</div>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  {relatedEvents.map((ev) => (
                    <div key={ev.id} style={{
                      display: "flex", alignItems: "center", justifyContent: "space-between",
                      fontSize: 13.5, padding: "9px 12px",
                      background: "var(--glass)", borderRadius: "var(--radius-sm)",
                      border: "1px solid var(--line)",
                    }}>
                      <span>{ev.title}</span>
                      <span className="faint" style={{ fontSize: 12, marginLeft: 12, flexShrink: 0 }}>{ev.date}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </Shell>
  );
}
