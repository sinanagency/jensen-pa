"use client";

// Portfolio, post-2026-06-12 rewrite. Three changes from the old flat view:
//
// 1. BRAND-FIRST. Top-level "brand" entities are the spine. Each brand expands
//    to show its children (sub-venues + sub-events) below the card. Mirrors how
//    Jensen actually thinks: Sohum the client, NOT Sohum Cafe + Sohum Sanctuary
//    + Sohum Prelude as three flat cards.
//
// 2. INHOUSE vs RETAINER. Brands carry a role: 'inhouse' (Jensen's own — La
//    Rencontre, Upaya, Buddha Shop) or 'retainer' (active client engagements
//    — Sohum, Panther). The page renders these as two grouped sections.
//
// 3. PAST HIDDEN. Anything with status='past' is folded into a single
//    collapsible "Previous" section at the bottom. The main view shows only
//    his current world, not his 8-year hotel CV. Operator note 2026-06-12:
//    "don't show companies that are not active u can folderize them into
//    previous or something."

import { useMemo, useState } from "react";
import Shell from "@/components/Shell";
import { useDB } from "@/components/useDB";
import { Entity, EntityKind, uid } from "@/lib/store";
import { aed } from "@/lib/tax";
import {
  Building2, Users, PartyPopper, Plus, Trash2, X, ChevronDown, ChevronRight,
  Sparkles, Briefcase, Archive,
} from "lucide-react";

const KIND_ICON: Record<EntityKind, React.ReactNode> = {
  brand: <Sparkles size={14} />,
  venue: <Building2 size={14} />,
  client: <Users size={14} />,
  event: <PartyPopper size={14} />,
};
const KIND_LABEL: Record<EntityKind, string> = {
  brand: "Brand",
  venue: "Venue",
  client: "Client",
  event: "Event",
};

export default function Portfolio() {
  const { db, mutate } = useDB();

  // Add-form state — defaults to a child venue/event tied to one of his brands.
  const [name, setName] = useState("");
  const [subtitle, setSubtitle] = useState("");
  const [kind, setKind] = useState<EntityKind>("venue");
  const [parentId, setParentId] = useState<string>("");

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [showPrevious, setShowPrevious] = useState(false);

  if (!db) return <Shell><div className="muted">Loading…</div></Shell>;

  const store = db;
  const isPast = (e: Entity) => (e.status || "").toLowerCase() === "past";
  const isActive = (e: Entity) => !isPast(e);

  // Top-level brands, grouped by role
  const brandsInhouse = db.entities.filter((e) => e.kind === "brand" && e.role === "inhouse" && isActive(e));
  const brandsRetainer = db.entities.filter((e) => e.kind === "brand" && e.role === "retainer" && isActive(e));

  // Active non-brand entities that are NOT under any brand. Render in a small
  // "loose" section so we never silently hide a live row. Should normally be empty.
  const looseActive = db.entities.filter(
    (e) => e.kind !== "brand" && isActive(e) && !e.parentId
  );

  // Children index by parent
  const childrenOf = (parentId: string) =>
    db.entities.filter((e) => e.parentId === parentId && isActive(e));

  const pastEntities = db.entities.filter(isPast);

  const selected = selectedId ? db.entities.find((e) => e.id === selectedId) ?? null : null;

  // Pretty list of brands for the add form
  const allBrands = useMemo(
    () => db.entities.filter((e) => e.kind === "brand" && isActive(e)).sort((a, b) => a.name.localeCompare(b.name)),
    [db.entities]
  );

  function counts(e: Entity) {
    const myIds = [e.id, ...childrenOf(e.id).map((c) => c.id)];
    const openTasks = store.tasks.filter((t) => t.entityId && myIds.includes(t.entityId) && !t.done).length;
    const upcoming = store.events.filter((ev) => ev.entityId && myIds.includes(ev.entityId)).length;
    const net = store.finance
      .filter((f) => f.entityId && myIds.includes(f.entityId))
      .reduce((sum, f) => sum + (f.kind === "income" ? f.amount : -f.amount), 0);
    return { openTasks, upcoming, net };
  }

  function handleAdd() {
    const trimmed = name.trim();
    if (!trimmed) return;
    mutate((d) => {
      d.entities.push({
        id: uid(),
        kind,
        name: trimmed,
        subtitle: subtitle.trim() || undefined,
        status: "active",
        parentId: parentId || undefined,
        createdAt: Date.now(),
      });
    });
    setName(""); setSubtitle(""); setParentId("");
  }

  function handleDelete(id: string) {
    if (selectedId === id) setSelectedId(null);
    mutate((d) => {
      d.entities = d.entities.filter((e) => e.id !== id);
    });
  }

  function archive(id: string) {
    mutate((d) => {
      const e = d.entities.find((x) => x.id === id);
      if (e) e.status = "past";
    });
  }

  function restore(id: string) {
    mutate((d) => {
      const e = d.entities.find((x) => x.id === id);
      if (e) e.status = "active";
    });
  }

  function BrandCard({ e }: { e: Entity }) {
    const kids = childrenOf(e.id);
    const { openTasks, upcoming, net } = counts(e);
    const isOpen = expanded[e.id] ?? false;
    const isSelected = selectedId === e.id;
    return (
      <div className="brand-card" style={{
        border: `1px solid ${isSelected ? "var(--purple-line)" : "var(--line)"}`,
        background: isSelected ? "var(--surface-elevated)" : "var(--surface)",
        borderRadius: "var(--radius)",
        padding: 18,
        boxShadow: isSelected ? "var(--shadow-lg)" : "none",
      }}>
        <div style={{ display: "flex", alignItems: "flex-start", gap: 12 }}>
          <button
            onClick={() => setExpanded((m) => ({ ...m, [e.id]: !isOpen }))}
            aria-label={isOpen ? "Collapse" : "Expand"}
            style={{ background: "none", border: 0, color: "var(--muted)", cursor: kids.length ? "pointer" : "default", padding: 0, marginTop: 2 }}
          >
            {kids.length > 0 ? (isOpen ? <ChevronDown size={16} /> : <ChevronRight size={16} />) : <span style={{ width: 16, display: "inline-block" }} />}
          </button>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div
              style={{ cursor: "pointer", minWidth: 0 }}
              onClick={() => setSelectedId(isSelected ? null : e.id)}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 8, color: "var(--purple-2)", marginBottom: 4 }}>
                <Sparkles size={13} />
                <span style={{ fontSize: 11, letterSpacing: "0.05em", textTransform: "uppercase", fontWeight: 600 }}>
                  {e.role === "inhouse" ? "In-house brand" : "Retainer"}
                </span>
              </div>
              <div style={{ fontSize: 18, fontWeight: 700, fontFamily: "var(--font-display)", marginBottom: 4 }}>{e.name}</div>
              {e.subtitle && <div className="muted" style={{ fontSize: 13, marginBottom: 10 }}>{e.subtitle}</div>}
              <div style={{ display: "flex", gap: 14, fontSize: 12.5, color: "var(--faint)" }}>
                <span>{kids.length} sub-{kids.length === 1 ? "entity" : "entities"}</span>
                <span>{openTasks} open task{openTasks !== 1 ? "s" : ""}</span>
                <span>{upcoming} event{upcoming !== 1 ? "s" : ""}</span>
                <span style={{ marginLeft: "auto", color: net >= 0 ? "var(--success)" : "var(--danger)", fontWeight: 600 }}>{aed(net)}</span>
              </div>
            </div>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <button
              className="btn ghost sm"
              style={{ height: 28, width: 28, padding: 0, display: "grid", placeItems: "center", color: "var(--faint)" }}
              onClick={() => archive(e.id)}
              title="Move to Previous"
            >
              <Archive size={13} />
            </button>
          </div>
        </div>

        {isOpen && kids.length > 0 && (
          <div className="children" style={{ marginTop: 14, paddingTop: 14, borderTop: "1px solid var(--line)" }}>
            {kids.map((c) => <ChildRow key={c.id} c={c} />)}
          </div>
        )}
      </div>
    );
  }

  function ChildRow({ c }: { c: Entity }) {
    const { openTasks, upcoming, net } = (() => {
      const openTasks = store.tasks.filter((t) => t.entityId === c.id && !t.done).length;
      const upcoming = store.events.filter((ev) => ev.entityId === c.id).length;
      const net = store.finance.filter((f) => f.entityId === c.id).reduce((s, f) => s + (f.kind === "income" ? f.amount : -f.amount), 0);
      return { openTasks, upcoming, net };
    })();
    const isSelected = selectedId === c.id;
    return (
      <div
        onClick={() => setSelectedId(isSelected ? null : c.id)}
        style={{
          display: "flex", alignItems: "center", gap: 10,
          padding: "10px 12px", marginBottom: 6, borderRadius: 10,
          cursor: "pointer",
          background: isSelected ? "var(--purple-soft)" : "var(--glass)",
          border: `1px solid ${isSelected ? "var(--purple-line)" : "var(--line)"}`,
        }}
      >
        <span style={{ color: "var(--muted)", display: "grid", placeItems: "center" }}>{KIND_ICON[c.kind]}</span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 13.5, fontWeight: 500 }}>{c.name}</div>
          {c.subtitle && <div className="faint" style={{ fontSize: 11.5, marginTop: 1 }}>{c.subtitle}</div>}
        </div>
        <span className="pill" style={{ fontSize: 10, height: 20, padding: "0 8px" }}>{KIND_LABEL[c.kind]}</span>
        {openTasks > 0 && <span className="faint" style={{ fontSize: 11 }}>{openTasks} task{openTasks > 1 ? "s" : ""}</span>}
        {upcoming > 0 && <span className="faint" style={{ fontSize: 11 }}>{upcoming} event{upcoming > 1 ? "s" : ""}</span>}
        <span style={{ fontSize: 12, fontWeight: 600, color: net >= 0 ? "var(--success)" : "var(--danger)" }}>{aed(net)}</span>
      </div>
    );
  }

  const noBrands = brandsInhouse.length === 0 && brandsRetainer.length === 0;

  return (
    <Shell>
      <div className="page-hero fade-up" style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end" }}>
        <div>
          <div className="eyebrow">Portfolio</div>
          <h1>Your active world.</h1>
        </div>
      </div>

      {noBrands && (
        <div className="card" style={{ padding: 32, textAlign: "center", marginBottom: 22 }}>
          <div className="muted" style={{ fontSize: 14 }}>
            No brands yet. Add your first brand below.
          </div>
        </div>
      )}

      {brandsInhouse.length > 0 && (
        <div style={{ marginBottom: 30 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 14 }}>
            <Sparkles size={14} color="var(--purple-2)" />
            <div style={{ fontSize: 12, letterSpacing: "0.07em", textTransform: "uppercase", color: "var(--ink-2)", fontWeight: 600 }}>
              In-house brands
            </div>
            <span className="pill" style={{ fontSize: 10, height: 18, padding: "0 7px", color: "var(--muted)" }}>{brandsInhouse.length}</span>
          </div>
          <div className="brand-grid">
            {brandsInhouse.map((e) => <BrandCard key={e.id} e={e} />)}
          </div>
        </div>
      )}

      {brandsRetainer.length > 0 && (
        <div style={{ marginBottom: 30 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 14 }}>
            <Briefcase size={14} color="var(--purple-2)" />
            <div style={{ fontSize: 12, letterSpacing: "0.07em", textTransform: "uppercase", color: "var(--ink-2)", fontWeight: 600 }}>
              Active retainers
            </div>
            <span className="pill" style={{ fontSize: 10, height: 18, padding: "0 7px", color: "var(--muted)" }}>{brandsRetainer.length}</span>
          </div>
          <div className="brand-grid">
            {brandsRetainer.map((e) => <BrandCard key={e.id} e={e} />)}
          </div>
        </div>
      )}

      {looseActive.length > 0 && (
        <div style={{ marginBottom: 30 }}>
          <div style={{ fontSize: 12, letterSpacing: "0.07em", textTransform: "uppercase", color: "var(--faint)", fontWeight: 600, marginBottom: 14 }}>
            Unattached
          </div>
          <div className="card" style={{ padding: 14 }}>
            {looseActive.map((c) => <ChildRow key={c.id} c={c} />)}
          </div>
        </div>
      )}

      {/* Add form */}
      <div className="card" style={{ padding: 22, marginBottom: 28 }}>
        <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 14 }}>Add to portfolio</div>

        <div style={{ display: "flex", gap: 8, marginBottom: 14, flexWrap: "wrap" }}>
          {(["brand", "venue", "client", "event"] as EntityKind[]).map((k) => (
            <button
              key={k}
              className={`pill${kind === k ? " accent" : ""}`}
              style={{ cursor: "pointer", border: "1px solid var(--line)" }}
              onClick={() => setKind(k)}
            >
              {KIND_ICON[k]} {KIND_LABEL[k]}
            </button>
          ))}
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10, marginBottom: 12 }}>
          <input className="input" placeholder="Name" value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") handleAdd(); }} />
          <input className="input" placeholder="Subtitle (optional)" value={subtitle} onChange={(e) => setSubtitle(e.target.value)} />
          {kind !== "brand" ? (
            <select className="input" value={parentId} onChange={(e) => setParentId(e.target.value)}>
              <option value="">Under a brand…</option>
              {allBrands.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
          ) : (
            <span />
          )}
        </div>

        <button className="btn purple sm" onClick={handleAdd} disabled={!name.trim()}>
          <Plus size={14} /> Add {KIND_LABEL[kind]}
        </button>
      </div>

      {/* Selected entity detail */}
      {selected && (
        <div className="card feature fade-up" style={{ padding: 22, marginBottom: 22 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 14 }}>
            <div>
              <div style={{ display: "flex", alignItems: "center", gap: 8, color: "var(--muted)", marginBottom: 4 }}>
                {KIND_ICON[selected.kind]}
                <span style={{ fontSize: 11, letterSpacing: "0.05em", textTransform: "uppercase", fontWeight: 600 }}>{KIND_LABEL[selected.kind]}</span>
              </div>
              <div style={{ fontSize: 22, fontFamily: "var(--font-display)", fontWeight: 700 }}>{selected.name}</div>
              {selected.subtitle && <div className="muted" style={{ fontSize: 13.5, marginTop: 3 }}>{selected.subtitle}</div>}
            </div>
            <div style={{ display: "flex", gap: 6 }}>
              <button className="btn ghost sm" onClick={() => archive(selected.id)} title="Move to Previous"><Archive size={13} /></button>
              <button className="btn ghost sm" onClick={() => handleDelete(selected.id)} title="Delete"><Trash2 size={13} /></button>
              <button className="btn ghost sm" onClick={() => setSelectedId(null)} title="Close"><X size={13} /></button>
            </div>
          </div>
        </div>
      )}

      {/* Previous (collapsible) */}
      {pastEntities.length > 0 && (
        <div className="card" style={{ padding: 18, marginTop: 12, background: "transparent" }}>
          <button
            onClick={() => setShowPrevious((v) => !v)}
            style={{ display: "flex", alignItems: "center", gap: 8, width: "100%", background: "none", border: 0, cursor: "pointer", color: "var(--ink-2)" }}
          >
            {showPrevious ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
            <span style={{ fontSize: 12, letterSpacing: "0.07em", textTransform: "uppercase", fontWeight: 600 }}>Previous</span>
            <span className="pill" style={{ fontSize: 10, height: 18, padding: "0 7px", color: "var(--muted)" }}>{pastEntities.length}</span>
            <span className="faint" style={{ marginLeft: 10, fontSize: 12, fontWeight: 400 }}>Past venues, clients, events. Folded out of the active view.</span>
          </button>

          {showPrevious && (
            <div style={{ marginTop: 16 }}>
              <div className="prev-grid">
                {pastEntities.sort((a, b) => a.name.localeCompare(b.name)).map((e) => (
                  <div
                    key={e.id}
                    className="prev-card"
                    onClick={() => setSelectedId(selectedId === e.id ? null : e.id)}
                  >
                    <div style={{ display: "flex", alignItems: "center", gap: 6, color: "var(--faint)", marginBottom: 4 }}>
                      {KIND_ICON[e.kind]}
                      <span style={{ fontSize: 10.5, letterSpacing: "0.05em", textTransform: "uppercase" }}>{KIND_LABEL[e.kind]}</span>
                    </div>
                    <div style={{ fontSize: 13.5, fontWeight: 500, marginBottom: 3 }}>{e.name}</div>
                    {e.subtitle && <div className="faint" style={{ fontSize: 11.5, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{e.subtitle}</div>}
                    <button
                      className="pill"
                      style={{ marginTop: 8, fontSize: 10, height: 22, padding: "0 8px", cursor: "pointer" }}
                      onClick={(ev) => { ev.stopPropagation(); restore(e.id); }}
                    >
                      Restore
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      <style>{`
        .brand-grid{display:grid;grid-template-columns:repeat(2, 1fr);gap:14px}
        @media (max-width: 900px){.brand-grid{grid-template-columns:1fr}}
        .prev-grid{display:grid;grid-template-columns:repeat(3, 1fr);gap:10px}
        @media (max-width: 900px){.prev-grid{grid-template-columns:repeat(2, 1fr)}}
        @media (max-width: 600px){.prev-grid{grid-template-columns:1fr}}
        .prev-card{padding:12px;background:var(--glass);border:1px solid var(--line);border-radius:10px;cursor:pointer;transition:border-color .15s ease}
        .prev-card:hover{border-color:var(--line-2)}
      `}</style>
    </Shell>
  );
}
