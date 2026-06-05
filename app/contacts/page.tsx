"use client";

import { useRef, useState } from "react";
import Shell from "@/components/Shell";
import { useDB } from "@/components/useDB";
import { Contact, uid } from "@/lib/store";
import { User, Plus, Trash2, ScanLine, Loader2, Mail, Phone, Building2, Search } from "lucide-react";

type VisionResponse =
  | { data: { name?: string; company?: string; role?: string; email?: string; phone?: string }; error?: never }
  | { error: string; data?: never };

function initials(name: string): string {
  return (name || "")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => (w[0] ?? "").toUpperCase())
    .join("") || "?";
}

export default function Contacts() {
  const { db, mutate } = useDB();

  const [name, setName] = useState("");
  const [company, setCompany] = useState("");
  const [role, setRole] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [notes, setNotes] = useState("");
  const [entityId, setEntityId] = useState("");

  const [scanning, setScanning] = useState(false);
  const [scanError, setScanError] = useState<string | null>(null);
  const [search, setSearch] = useState("");

  const fileRef = useRef<HTMLInputElement>(null);

  if (!db) {
    return (
      <Shell>
        <div className="muted">Loading…</div>
      </Shell>
    );
  }

  function clearForm() {
    setName("");
    setCompany("");
    setRole("");
    setEmail("");
    setPhone("");
    setNotes("");
    setEntityId("");
  }

  function handleAdd() {
    const trimmed = name.trim();
    if (!trimmed) return;
    mutate((d) =>
      d.contacts.push({
        id: uid(),
        name: trimmed,
        company: company.trim() || undefined,
        role: role.trim() || undefined,
        email: email.trim() || undefined,
        phone: phone.trim() || undefined,
        notes: notes.trim() || undefined,
        entityId: entityId || undefined,
        createdAt: Date.now(),
      })
    );
    clearForm();
  }

  function handleDelete(id: string) {
    mutate((d) => {
      d.contacts = d.contacts.filter((c: Contact) => c.id !== id);
    });
  }

  async function handleScan(file: File) {
    setScanError(null);
    setScanning(true);
    try {
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const r = new FileReader();
        r.onload = () => resolve(String(r.result));
        r.onerror = () => reject(r.error);
        r.readAsDataURL(file);
      });
      const base64 = dataUrl.split(",")[1] || "";
      const res = await fetch("/api/vision", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ imageBase64: base64, mime: file.type, mode: "card" }),
      });
      const json: VisionResponse = await res.json();
      if (json.error) {
        setScanError(json.error);
        return;
      }
      const d = json.data ?? {};
      if (d.name) setName(String(d.name).trim());
      if (d.company) setCompany(d.company);
      if (d.role) setRole(d.role);
      if (d.email) setEmail(d.email);
      if (d.phone) setPhone(d.phone);
    } catch (e: unknown) {
      setScanError(e instanceof Error ? e.message : "Scan failed. Please try again.");
    } finally {
      setScanning(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  const q = search.toLowerCase();
  const filtered = db.contacts.filter(
    (c: Contact) =>
      c.name.toLowerCase().includes(q) ||
      (c.company ?? "").toLowerCase().includes(q)
  );

  const entityName = (id?: string) => db.entities.find((e: { id: string; name: string; kind: string }) => e.id === id)?.name;

  return (
    <Shell>
      <div className="page-hero fade-up">
        <div className="eyebrow">People</div>
        <h1>Everyone in your world.</h1>
      </div>

      <div className="grid cols-2" style={{ gap: 14, marginBottom: 14 }}>
        {/* Add contact card */}
        <div className="card" style={{ padding: 20, display: "flex", flexDirection: "column", gap: 10 }}>
          <div style={{ fontWeight: 600, fontSize: 15, marginBottom: 2 }}>Add a contact</div>
          <input
            className="input"
            placeholder="Full name"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          <input
            className="input"
            placeholder="Company"
            value={company}
            onChange={(e) => setCompany(e.target.value)}
          />
          <input
            className="input"
            placeholder="Role or title"
            value={role}
            onChange={(e) => setRole(e.target.value)}
          />
          <input
            className="input"
            placeholder="Email address"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
          <input
            className="input"
            placeholder="Phone number"
            type="tel"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
          />
          <input
            className="input"
            placeholder="Notes (optional)"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
          />
          <select
            className="input"
            value={entityId}
            onChange={(e) => setEntityId(e.target.value)}
            style={{ height: 40, padding: "0 10px" }}
          >
            <option value="">No entity linked</option>
            {db.entities.map((e: { id: string; name: string; kind: string }) => (
              <option key={e.id} value={e.id}>{e.name}</option>
            ))}
          </select>
          <button
            className="btn purple sm"
            onClick={handleAdd}
            disabled={!name.trim()}
            style={{ display: "flex", alignItems: "center", gap: 6, alignSelf: "flex-start" }}
          >
            <Plus size={15} /> Add contact
          </button>
        </div>

        {/* Business card scan card */}
        <div className="card feature" style={{ padding: 20, display: "flex", flexDirection: "column", gap: 12, alignItems: "flex-start", justifyContent: "center" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
            <ScanLine size={20} style={{ color: "var(--purple-2)" }} />
            <span style={{ fontWeight: 600, fontSize: 15 }}>Scan a business card</span>
          </div>
          <p className="muted" style={{ fontSize: 13.5, margin: 0, lineHeight: 1.55 }}>
            Take a photo or upload an image of any business card. The details will be read automatically and prefilled in the form so you can review and save.
          </p>
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            hidden
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) handleScan(file);
            }}
          />
          <button
            className="btn purple"
            onClick={() => fileRef.current?.click()}
            disabled={scanning}
            style={{ display: "flex", alignItems: "center", gap: 7 }}
          >
            {scanning ? (
              <>
                <Loader2 size={15} style={{ animation: "spin 1s linear infinite" }} />
                Reading the card…
              </>
            ) : (
              <>
                <ScanLine size={15} /> Scan a card
              </>
            )}
          </button>
          {scanError && (
            <div className="err" style={{ fontSize: 13 }}>{scanError}</div>
          )}
        </div>
      </div>

      {/* Search and list */}
      <div className="card" style={{ padding: 18 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12, gap: 10 }}>
          <div style={{ fontWeight: 600, fontSize: 15 }}>
            {db.contacts.length} contact{db.contacts.length === 1 ? "" : "s"}
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8, flex: 1, maxWidth: 300 }}>
            <Search size={15} style={{ color: "var(--muted)", flexShrink: 0 }} />
            <input
              className="input"
              placeholder="Search by name or company"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              style={{ height: 36, flex: 1 }}
            />
          </div>
        </div>

        {db.contacts.length === 0 && (
          <div className="muted" style={{ fontSize: 14, padding: "12px 0", display: "flex", alignItems: "center", gap: 8 }}>
            <User size={16} style={{ opacity: 0.4 }} />
            No contacts yet. Add your first one above.
          </div>
        )}

        {db.contacts.length > 0 && filtered.length === 0 && (
          <div className="muted" style={{ fontSize: 14, padding: "12px 0" }}>
            No contacts match that search.
          </div>
        )}

        {filtered.map((c: Contact) => {
          const ent = entityName(c.entityId);
          const label = [c.role, c.company].filter(Boolean).join(" at ");
          return (
            <div
              key={c.id}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 14,
                padding: "13px 0",
                borderTop: "1px solid var(--line)",
              }}
            >
              {/* Avatar */}
              <div
                style={{
                  width: 40,
                  height: 40,
                  borderRadius: "50%",
                  background: "linear-gradient(135deg,var(--purple),#6d28d9)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  color: "#fff",
                  fontWeight: 700,
                  fontSize: 14,
                  flexShrink: 0,
                  letterSpacing: 0.5,
                }}
              >
                {initials(c.name)}
              </div>

              {/* Info */}
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 600, fontSize: 14.5, marginBottom: 1 }}>{c.name}</div>
                {label && (
                  <div className="muted" style={{ fontSize: 13, marginBottom: 3 }}>{label}</div>
                )}
                <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
                  {c.email && (
                    <a
                      href={`mailto:${c.email}`}
                      className="faint"
                      style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 12.5, textDecoration: "none" }}
                    >
                      <Mail size={12} /> {c.email}
                    </a>
                  )}
                  {c.phone && (
                    <a
                      href={`tel:${c.phone}`}
                      className="faint"
                      style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 12.5, textDecoration: "none" }}
                    >
                      <Phone size={12} /> {c.phone}
                    </a>
                  )}
                  {ent && (
                    <span className="pill accent" style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 11.5 }}>
                      <Building2 size={11} /> {ent}
                    </span>
                  )}
                </div>
              </div>

              {/* Delete */}
              <button
                className="btn ghost sm iconbtn"
                title="Remove contact"
                onClick={() => handleDelete(c.id)}
                style={{ flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center", width: 34, height: 34, padding: 0 }}
              >
                <Trash2 size={15} />
              </button>
            </div>
          );
        })}
      </div>

      <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
    </Shell>
  );
}
