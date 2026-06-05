"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useDB } from "@/components/useDB";
import {
  Search, CheckSquare, Building2, User, StickyNote, Wallet, Sparkles,
  LayoutGrid, MessageCircle, Calendar, Library, FileText, ScrollText, Mail, CornerDownLeft, Mic, BookOpen, Plus,
} from "lucide-react";

type Group = "Ask" | "Actions" | "Go to" | "Results";
type Item = { id: string; label: string; sub?: string; icon: any; group: Group; run: () => void };

const PAGES: { label: string; href: string; icon: any }[] = [
  { label: "Today", href: "/", icon: LayoutGrid },
  { label: "Concierge", href: "/mentor", icon: MessageCircle },
  { label: "Mail", href: "/mail", icon: Mail },
  { label: "Portfolio", href: "/portfolio", icon: Building2 },
  { label: "Tasks", href: "/tasks", icon: CheckSquare },
  { label: "Calendar", href: "/calendar", icon: Calendar },
  { label: "Finance", href: "/finance", icon: Wallet },
  { label: "Meetings", href: "/meetings", icon: Mic },
  { label: "Documents", href: "/brain", icon: Library },
  { label: "Notes", href: "/notes", icon: StickyNote },
  { label: "Journal", href: "/journal", icon: BookOpen },
  { label: "Generate", href: "/generate", icon: FileText },
  { label: "Legal", href: "/legal", icon: ScrollText },
];

export default function CommandPalette() {
  const { db } = useDB();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [sel, setSel] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);

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

    // ASK — only with a query
    if (ql) out.push({ id: "ask", group: "Ask", label: `Ask the concierge: "${q.trim()}"`, sub: "Enter", icon: Sparkles, run: () => ask(q.trim()) });

    // ACTIONS
    const actions: Item[] = [
      { id: "newnote", group: "Actions", label: "New note", sub: "Capture", icon: StickyNote, run: () => go("/notes?new=1") },
      { id: "newtask", group: "Actions", label: "New task", sub: "Tasks", icon: CheckSquare, run: () => go("/tasks") },
      { id: "logexp", group: "Actions", label: "Log income or expense", sub: "Finance", icon: Wallet, run: () => go("/finance") },
      { id: "newmeet", group: "Actions", label: "Capture a meeting", sub: "Meetings", icon: Mic, run: () => go("/meetings") },
      { id: "journal", group: "Actions", label: "Write a journal entry", sub: "Journal", icon: BookOpen, run: () => go("/journal") },
    ];
    actions.filter((a) => !ql || a.label.toLowerCase().includes(ql)).forEach((a) => out.push(a));

    // GO TO
    PAGES.forEach((p) => { if (!ql || p.label.toLowerCase().includes(ql)) out.push({ id: "p" + p.href, group: "Go to", label: p.label, sub: "Go to", icon: p.icon, run: () => go(p.href) }); });

    // RESULTS — only with a query
    const match = (s?: string) => !!s && s.toLowerCase().includes(ql);
    if (ql) {
      db.tasks.filter((t) => match(t.title)).slice(0, 5).forEach((t) => out.push({ id: t.id, group: "Results", label: t.title, sub: "Task", icon: CheckSquare, run: () => go("/tasks") }));
      db.entities.filter((e) => match(e.name)).slice(0, 5).forEach((e) => out.push({ id: e.id, group: "Results", label: e.name, sub: e.kind, icon: Building2, run: () => go("/portfolio") }));
      db.contacts.filter((c) => match(c.name) || match(c.company)).slice(0, 5).forEach((c) => out.push({ id: c.id, group: "Results", label: c.name, sub: c.company || "Contact", icon: User, run: () => go("/contacts") }));
      db.notes.filter((n) => match(n.title) || match(n.body)).slice(0, 5).forEach((n) => out.push({ id: n.id, group: "Results", label: n.title || n.body.slice(0, 50), sub: "Note", icon: StickyNote, run: () => go("/notes") }));
    }
    return out;
  }, [db, q]); // eslint-disable-line

  const clamped = Math.min(sel, Math.max(0, items.length - 1));
  useEffect(() => {
    const el = listRef.current?.querySelector(`[data-i="${clamped}"]`) as HTMLElement | null;
    el?.scrollIntoView({ block: "nearest" });
  }, [clamped]);

  if (!open) return null;

  return (
    <div onClick={() => setOpen(false)} className="cmdk-scrim">
      <div onClick={(e) => e.stopPropagation()} className="cmdk">
        <div className="cmdk-input">
          <Search size={18} />
          <input
            autoFocus value={q}
            onChange={(e) => { setQ(e.target.value); setSel(0); }}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") { e.preventDefault(); setSel((s) => Math.min(s + 1, items.length - 1)); }
              if (e.key === "ArrowUp") { e.preventDefault(); setSel((s) => Math.max(s - 1, 0)); }
              if (e.key === "Enter") { e.preventDefault(); items[clamped]?.run(); }
            }}
            placeholder="Search or ask anything…"
          />
          <span className="cmdk-esc">esc</span>
        </div>
        <div className="cmdk-list" ref={listRef}>
          {items.length === 0 && <div className="cmdk-empty">Type to search.</div>}
          {items.map((it, i) => {
            const Icon = it.icon;
            const newGroup = i === 0 || items[i - 1].group !== it.group;
            return (
              <div key={it.id}>
                {newGroup && <div className="cmdk-group">{it.group}</div>}
                <button data-i={i} onMouseEnter={() => setSel(i)} onClick={() => it.run()} className={`cmdk-row ${i === clamped ? "on" : ""}`}>
                  <Icon size={16} className="cmdk-ico" />
                  <span className="cmdk-label">{it.label}</span>
                  {it.sub && <span className="cmdk-sub">{it.sub}</span>}
                  {i === clamped && <CornerDownLeft size={13} className="cmdk-enter" />}
                </button>
              </div>
            );
          })}
        </div>
      </div>

      <style>{`
        .cmdk-scrim{position:fixed;inset:0;z-index:500;background:rgba(6,5,10,0.62);backdrop-filter:blur(5px);display:flex;align-items:flex-start;justify-content:center;padding-top:12vh}
        .cmdk{width:min(640px,92vw);background:#17151f;border:1px solid rgba(255,255,255,0.1);border-radius:18px;box-shadow:0 40px 90px rgba(0,0,0,0.62),0 0 0 1px rgba(124,107,176,0.12);overflow:hidden;animation:cmdkin .16s cubic-bezier(.16,1,.3,1) both}
        @keyframes cmdkin{from{opacity:0;transform:translateY(-8px) scale(.99)}to{opacity:1;transform:none}}
        .cmdk-input{display:flex;align-items:center;gap:11px;padding:15px 17px;border-bottom:1px solid rgba(255,255,255,0.08);color:#8a8a96}
        .cmdk-input input{flex:1;border:0;background:none;color:#f4f4f6;font-size:16px;padding:0;outline:none;box-shadow:none}
        .cmdk-input input::placeholder{color:#6a6a76}
        .cmdk-esc{font-size:11px;color:#5e5e68;border:1px solid rgba(255,255,255,0.1);border-radius:6px;padding:2px 7px}
        .cmdk-list{max-height:54vh;overflow-y:auto;padding:7px}
        .cmdk-empty{padding:18px;color:#8a8a96;font-size:14px}
        .cmdk-group{font-size:10.5px;letter-spacing:0.12em;text-transform:uppercase;color:#6a6a76;font-weight:700;padding:11px 10px 5px}
        .cmdk-row{display:flex;align-items:center;gap:12px;width:100%;text-align:left;padding:10px 11px;border-radius:11px;border:0;background:transparent;color:#e9e8ee;font-size:14px;font-family:inherit;cursor:pointer}
        .cmdk-row.on{background:rgba(124,107,176,0.18);box-shadow:inset 0 0 0 1px rgba(124,107,176,0.34)}
        .cmdk-ico{color:#a99fd0;flex:none}
        .cmdk-label{flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
        .cmdk-sub{font-size:11.5px;color:#6a6a76;flex:none}
        .cmdk-enter{color:#a99fd0;flex:none}
      `}</style>
    </div>
  );
}
