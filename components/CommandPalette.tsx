"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useDB } from "@/components/useDB";
import {
  Search, CheckSquare, Building2, User, StickyNote, Wallet, Sparkles,
  LayoutGrid, MessageCircle, Calendar, Library, FileText, ScrollText, Mail, ShoppingBag, CornerDownLeft,
} from "lucide-react";

type Item = { id: string; label: string; sub?: string; icon: any; run: () => void };

const PAGES: { label: string; href: string; icon: any }[] = [
  { label: "Today", href: "/", icon: LayoutGrid },
  { label: "Mentor", href: "/mentor", icon: MessageCircle },
  { label: "Mail", href: "/mail", icon: Mail },
  { label: "Portfolio", href: "/portfolio", icon: Building2 },
  { label: "Tasks", href: "/tasks", icon: CheckSquare },
  { label: "Calendar", href: "/calendar", icon: Calendar },
  { label: "Finance", href: "/finance", icon: Wallet },
  { label: "Store", href: "/shopify", icon: ShoppingBag },
  { label: "Documents", href: "/brain", icon: Library },
  { label: "Generate", href: "/generate", icon: FileText },
  { label: "Legal", href: "/legal", icon: ScrollText },
  { label: "Notes", href: "/notes", icon: StickyNote },
  { label: "Contacts", href: "/contacts", icon: User },
];

export default function CommandPalette() {
  const { db } = useDB();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [sel, setSel] = useState(0);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") { e.preventDefault(); setOpen((o) => !o); }
      if (e.key === "Escape") setOpen(false);
    };
    const onOpen = () => setOpen(true);
    window.addEventListener("keydown", onKey);
    window.addEventListener("open-cmdk", onOpen);
    return () => { window.removeEventListener("keydown", onKey); window.removeEventListener("open-cmdk", onOpen); };
  }, []);

  useEffect(() => { if (!open) { setQ(""); setSel(0); } }, [open]);

  const go = (href: string) => { router.push(href); setOpen(false); };
  const ask = (query: string) => { sessionStorage.setItem("lr-ask", query); router.push("/mentor"); setOpen(false); };

  const items: Item[] = useMemo(() => {
    if (!db) return [];
    const out: Item[] = [];
    const ql = q.trim().toLowerCase();

    if (ql) {
      out.push({ id: "ask", label: `Ask the mentor: "${q.trim()}"`, icon: Sparkles, run: () => ask(q.trim()) });
    }
    // quick actions
    out.push({ id: "newnote", label: "New note", sub: "Capture", icon: StickyNote, run: () => go("/notes?new=1") });
    out.push({ id: "newtask", label: "New task", sub: "Tasks", icon: CheckSquare, run: () => go("/tasks") });

    const match = (s?: string) => s && s.toLowerCase().includes(ql);
    PAGES.forEach((p) => { if (!ql || p.label.toLowerCase().includes(ql)) out.push({ id: "p" + p.href, label: p.label, sub: "Go to", icon: p.icon, run: () => go(p.href) }); });
    if (ql) {
      db.tasks.filter((t) => match(t.title)).slice(0, 6).forEach((t) => out.push({ id: t.id, label: t.title, sub: "Task", icon: CheckSquare, run: () => go("/tasks") }));
      db.entities.filter((e) => match(e.name)).slice(0, 6).forEach((e) => out.push({ id: e.id, label: e.name, sub: e.kind, icon: Building2, run: () => go("/portfolio") }));
      db.contacts.filter((c) => match(c.name) || match(c.company)).slice(0, 6).forEach((c) => out.push({ id: c.id, label: c.name, sub: c.company || "Contact", icon: User, run: () => go("/contacts") }));
      db.notes.filter((n) => match(n.title) || match(n.body)).slice(0, 6).forEach((n) => out.push({ id: n.id, label: n.title || n.body.slice(0, 50), sub: "Note", icon: StickyNote, run: () => go("/notes") }));
    }
    return out;
  }, [db, q]); // eslint-disable-line

  if (!open) return null;
  const clamped = Math.min(sel, Math.max(0, items.length - 1));

  return (
    <div onClick={() => setOpen(false)} style={{ position: "fixed", inset: 0, zIndex: 500, background: "rgba(0,0,0,0.5)", backdropFilter: "blur(3px)", display: "flex", alignItems: "flex-start", justifyContent: "center", paddingTop: "12vh" }}>
      <div onClick={(e) => e.stopPropagation()} className="card" style={{ width: "min(620px, 92vw)", padding: 0, overflow: "hidden", background: "var(--surface-elevated)" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "14px 16px", borderBottom: "1px solid var(--line)" }}>
          <Search size={18} style={{ color: "var(--muted)" }} />
          <input
            autoFocus value={q}
            onChange={(e) => { setQ(e.target.value); setSel(0); }}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") { e.preventDefault(); setSel((s) => Math.min(s + 1, items.length - 1)); }
              if (e.key === "ArrowUp") { e.preventDefault(); setSel((s) => Math.max(s - 1, 0)); }
              if (e.key === "Enter") { e.preventDefault(); items[clamped]?.run(); }
            }}
            placeholder="Search or ask anything…"
            style={{ border: 0, background: "none", flex: 1, fontSize: 15.5, padding: 0 }}
          />
          <span className="faint" style={{ fontSize: 11 }}>esc</span>
        </div>
        <div style={{ maxHeight: "52vh", overflowY: "auto", padding: 6 }}>
          {items.length === 0 && <div className="muted" style={{ padding: 16, fontSize: 14 }}>Type to search.</div>}
          {items.map((it, i) => {
            const Icon = it.icon;
            return (
              <button key={it.id} onMouseEnter={() => setSel(i)} onClick={() => it.run()}
                style={{ display: "flex", alignItems: "center", gap: 12, width: "100%", textAlign: "left", padding: "11px 12px", borderRadius: 11, border: 0, fontSize: 14, fontFamily: "inherit",
                  background: i === clamped ? "var(--glass-2)" : "transparent", color: "var(--ink)" }}>
                <Icon size={16} style={{ color: "var(--purple-2)", flex: "none" }} />
                <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{it.label}</span>
                {it.sub && <span className="faint" style={{ fontSize: 11.5 }}>{it.sub}</span>}
                {i === clamped && <CornerDownLeft size={13} style={{ color: "var(--muted)" }} />}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
