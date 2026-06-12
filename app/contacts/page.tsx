"use client";

import { useState } from "react";
import Shell from "@/components/Shell";
import { useDB } from "@/components/useDB";
import { Contact, uid } from "@/lib/store";
import { Users, Mail, Calendar, RefreshCw, Plus, Trash2, Building2, User, Loader2, ChevronDown } from "lucide-react";

// Heuristic: infer relationship from email domain
function inferRelationship(email?: string): "staff" | "client" | "vendor" | "friend" {
  if (!email) return "friend";
  const domain = email.split("@")[1]?.toLowerCase() || "";
  if (domain === "larencontre.ae") return "staff";
  if (["gmail.com", "yahoo.com", "hotmail.com", "icloud.com", "outlook.com", "me.com"].includes(domain)) return "friend";
  return "client";
}

const REL_LABELS: Record<string, string> = {
  staff: "Staff",
  client: "Client / Partner",
  vendor: "Vendor",
  friend: "Personal",
};
const REL_COLORS: Record<string, string> = {
  staff: "var(--purple-2)",
  client: "var(--success)",
  vendor: "var(--warning)",
  friend: "var(--info)",
};

export default function ContactsPage() {
  const { db, mutate } = useDB();
  const [syncing, setSyncing] = useState(false);
  const [syncMsg, setSyncMsg] = useState("");
  const [filter, setFilter] = useState<"all" | "staff" | "client" | "vendor" | "friend">("all");
  const [addOpen, setAddOpen] = useState(false);
  const [aName, setAName] = useState("");
  const [aEmail, setAEmail] = useState("");
  const [aCompany, setACompany] = useState("");
  const [aRole, setARole] = useState("");
  const [aPhone, setAPhone] = useState("");

  if (!db) return <Shell><div className="muted">Loading...</div></Shell>;

  // Tag each contact with a relationship type
  const tagged = db.contacts.map((c) => ({
    ...c,
    rel: inferRelationship(c.email),
    lastContact: c.createdAt,
  }));

  const filtered = filter === "all" ? tagged : tagged.filter((c) => c.rel === filter);
  const sorted = [...filtered].sort((a, b) => b.lastContact - a.lastContact);

  async function syncFromMail() {
    setSyncing(true);
    setSyncMsg("");
    try {
      const r = await fetch("/api/contacts/sync-mail", { method: "POST" });
      const json = await r.json();
      if (json.added > 0) {
        setSyncMsg(`Added ${json.added} new contact${json.added !== 1 ? "s" : ""} from mail.`);
        // Trigger a re-hydrate by dispatching the store event
        window.dispatchEvent(new Event("lr-db-change"));
        // Also reload from server
        const res = await fetch("/api/state", { cache: "no-store" });
        if (res.ok) {
          const db2 = await res.json();
          window.dispatchEvent(new CustomEvent("lr-db-hydrate", { detail: db2 }));
        }
      } else {
        setSyncMsg(json.message || "No new contacts found.");
      }
    } catch {
      setSyncMsg("Could not reach the mail sync endpoint.");
    } finally {
      setSyncing(false);
      setTimeout(() => setSyncMsg(""), 7000);
    }
  }

  // Also pull people from calendar events (names in event notes) and brain notes
  const calNames = new Set(db.contacts.map((c) => c.name.toLowerCase()));
  const calPeople: Contact[] = [];
  for (const ev of db.events) {
    if (ev.note) {
      const matches = ev.note.match(/\b([A-Z][a-z]+ [A-Z][a-z]+)\b/g) || [];
      for (const name of matches) {
        if (!calNames.has(name.toLowerCase())) {
          calNames.add(name.toLowerCase());
          calPeople.push({ id: uid(), name, createdAt: ev.createdAt });
        }
      }
    }
  }

  function addContact() {
    const trimmed = aName.trim();
    if (!trimmed) return;
    mutate((d) => {
      d.contacts.push({
        id: uid(), name: trimmed,
        email: aEmail.trim() || undefined,
        company: aCompany.trim() || undefined,
        role: aRole.trim() || undefined,
        phone: aPhone.trim() || undefined,
        createdAt: Date.now(),
      });
    });
    setAName(""); setAEmail(""); setACompany(""); setARole(""); setAPhone("");
    setAddOpen(false);
  }

  function deleteContact(id: string) {
    mutate((d) => { d.contacts = d.contacts.filter((c) => c.id !== id); });
  }

  const counts = { all: tagged.length, staff: 0, client: 0, vendor: 0, friend: 0 };
  for (const c of tagged) counts[c.rel]++;

  return (
    <Shell>
      <div className="page-hero fade-up">
        <div className="eyebrow">People</div>
        <h1>Your network.</h1>
      </div>

      {/* Action bar */}
      <div className="card fade-up" style={{ padding: "16px 20px", marginBottom: 16, display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", flex: 1 }}>
          {(["all", "staff", "client", "vendor", "friend"] as const).map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`pill${filter === f ? " accent" : ""}`}
              style={{ cursor: "pointer", border: "1px solid var(--line)", height: 30, fontSize: 12 }}
            >
              {f === "all" ? "All" : REL_LABELS[f]}
              <span style={{ opacity: 0.6, marginLeft: 4 }}>{counts[f]}</span>
            </button>
          ))}
        </div>
        <button
          className="btn ghost sm"
          onClick={syncFromMail}
          disabled={syncing}
          style={{ gap: 7, flexShrink: 0 }}
        >
          {syncing ? <Loader2 size={14} style={{ animation: "spin 1s linear infinite" }} /> : <RefreshCw size={14} />}
          Sync from mail
        </button>
        <button className="btn purple sm" onClick={() => setAddOpen(!addOpen)} style={{ flexShrink: 0 }}>
          <Plus size={14} /> Add
        </button>
      </div>

      {syncMsg && (
        <div className="card fade-up" style={{ padding: "12px 18px", marginBottom: 12, fontSize: 13.5, color: "var(--ink-2)" }}>
          {syncMsg}
        </div>
      )}

      {/* Manual add form */}
      {addOpen && (
        <div className="card fade-up" style={{ padding: 20, marginBottom: 16 }}>
          <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 14 }}>Add person</div>
          <div className="grid cols-3" style={{ gap: 10, marginBottom: 12 }}>
            <input className="input" placeholder="Full name" value={aName} onChange={(e) => setAName(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") addContact(); }} />
            <input className="input" placeholder="Email" type="email" value={aEmail} onChange={(e) => setAEmail(e.target.value)} />
            <input className="input" placeholder="Phone" type="tel" value={aPhone} onChange={(e) => setAPhone(e.target.value)} />
            <input className="input" placeholder="Company" value={aCompany} onChange={(e) => setACompany(e.target.value)} />
            <input className="input" placeholder="Role" value={aRole} onChange={(e) => setARole(e.target.value)} />
          </div>
          <button className="btn purple sm" onClick={addContact} disabled={!aName.trim()}>
            <Plus size={14} /> Save
          </button>
        </div>
      )}

      {/* Calendar-derived people (auto-detected, unconfirmed) */}
      {calPeople.length > 0 && (
        <div className="card fade-up" style={{ padding: 20, marginBottom: 16 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 14 }}>
            <Calendar size={14} color="var(--purple-2)" />
            <div style={{ fontWeight: 600, fontSize: 14 }}>Detected from calendar</div>
            <span className="pill" style={{ fontSize: 11, marginLeft: "auto" }}>{calPeople.length}</span>
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
            {calPeople.slice(0, 8).map((p) => (
              <button
                key={p.id}
                className="pill"
                style={{ cursor: "pointer", border: "1px solid var(--line)", height: 32 }}
                onClick={() => {
                  mutate((d) => {
                    if (!d.contacts.some((c) => c.name === p.name)) {
                      d.contacts.push({ id: uid(), name: p.name, createdAt: Date.now() });
                    }
                  });
                }}
                title="Click to add to contacts"
              >
                <Plus size={11} /> {p.name}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* People grid */}
      {sorted.length === 0 ? (
        <div className="card fade-up" style={{ padding: 40, textAlign: "center" }}>
          <Users size={28} style={{ color: "var(--muted)", margin: "0 auto 14px" }} />
          <div className="muted" style={{ fontSize: 14, marginBottom: 8 }}>
            No contacts yet.
          </div>
          <div className="faint" style={{ fontSize: 12.5 }}>
            Click "Sync from mail" to pull participants from your inbox, or add someone manually.
          </div>
        </div>
      ) : (
        <div className="grid cols-3 fade-up">
          {sorted.map((c) => {
            const rel = c.rel;
            const lastDate = new Date(c.lastContact).toLocaleDateString("en-AE", { month: "short", day: "numeric", year: "numeric" });
            const entityName = c.entityId ? db.entities.find((e) => e.id === c.entityId)?.name : undefined;
            return (
              <div key={c.id} className="card" style={{ padding: 18, position: "relative" }}>
                <button
                  className="btn ghost sm"
                  style={{ position: "absolute", top: 12, right: 12, height: 26, width: 26, padding: 0, display: "grid", placeItems: "center", color: "var(--muted)" }}
                  onClick={() => deleteContact(c.id)}
                  title="Remove"
                >
                  <Trash2 size={12} />
                </button>

                {/* Avatar */}
                <div style={{
                  width: 42, height: 42, borderRadius: "50%", background: REL_COLORS[rel],
                  display: "grid", placeItems: "center", color: "#fff",
                  fontWeight: 700, fontSize: 17, marginBottom: 12, opacity: 0.85,
                }}>
                  {c.name.charAt(0).toUpperCase()}
                </div>

                <div style={{ fontWeight: 700, fontSize: 14.5, marginBottom: 3, paddingRight: 28 }}>{c.name}</div>
                {(c.role || c.company) && (
                  <div className="muted" style={{ fontSize: 12.5, marginBottom: 8 }}>
                    {[c.role, c.company].filter(Boolean).join(" at ")}
                  </div>
                )}

                <span
                  style={{
                    display: "inline-flex", alignItems: "center", gap: 5,
                    fontSize: 11, height: 22, padding: "0 9px", borderRadius: 999,
                    background: `${REL_COLORS[rel]}20`,
                    color: REL_COLORS[rel],
                    border: `1px solid ${REL_COLORS[rel]}40`,
                    marginBottom: 10,
                  }}
                >
                  {rel === "staff" && <Building2 size={10} />}
                  {rel === "client" && <Users size={10} />}
                  {rel === "friend" && <User size={10} />}
                  {REL_LABELS[rel]}
                </span>

                <div style={{ display: "flex", gap: 8, marginTop: 6, flexDirection: "column" }}>
                  {c.email && (
                    <a href={`mailto:${c.email}`} style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: "var(--ink-2)", textDecoration: "none" }}>
                      <Mail size={11} /> {c.email}
                    </a>
                  )}
                  {entityName && (
                    <span className="faint" style={{ fontSize: 11 }}>{entityName}</span>
                  )}
                </div>

                <div className="faint" style={{ fontSize: 11, marginTop: 10 }}>
                  Added {lastDate}
                </div>
              </div>
            );
          })}
        </div>
      )}

      <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
    </Shell>
  );
}
