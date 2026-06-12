"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  LayoutGrid, MessageCircle, Building2, CheckSquare, Wallet, Library,
  FileText, Calendar, ChevronDown, Search, LogOut, ChevronLeft, ScrollText, Mail, ShoppingBag, StickyNote, User, SlidersHorizontal, BookOpen, Mic, Inbox, Receipt, FolderOpen,
} from "lucide-react";
import CommandPalette from "@/components/CommandPalette";
import Logo from "@/components/Logo";

const ICONS: Record<string, any> = {
  today: LayoutGrid, mentor: MessageCircle, portfolio: Building2, tasks: CheckSquare,
  finance: Wallet, brain: Library, generate: FileText, calendar: Calendar, legal: ScrollText, mail: Mail, store: ShoppingBag,
  notes: StickyNote, contacts: User, journal: BookOpen, meetings: Mic, inbox: Inbox, invoice: Receipt,
  docs: FolderOpen,
};

// Top pills: the 4 surfaces Jensen reaches for every day. Inbox folded into
// Mail (one mailbox, two views via the page itself). Concierge is the chat.
const PILLS = [
  { href: "/", label: "Today", icon: "today" },
  { href: "/mentor", label: "Concierge", icon: "mentor" },
  { href: "/mail", label: "Mail", icon: "mail" },
  { href: "/finance", label: "Finance", icon: "finance" },
  { href: "/portfolio", label: "Portfolio", icon: "portfolio" },
];
// Folded menus: everything else, grouped by intent. "Documents" now points
// at the real /docs page (was /brain, which is the bot's memory of facts).
// Journal folded into Notes (same store, kind filter). Meetings stays — own UX.
const GROUPS = [
  // Operate = the daily-work surfaces. Money, time, sales.
  { group: "Operate", items: [
    { href: "/tasks", label: "Tasks", icon: "tasks" },
    { href: "/calendar", label: "Calendar", icon: "calendar" },
    { href: "/invoice", label: "Invoice", icon: "invoice" },
    { href: "/shopify", label: "Store", icon: "store" },
  ]},
  { group: "Studio", items: [
    { href: "/docs", label: "Documents", icon: "docs" },
    { href: "/notes", label: "Notes", icon: "notes" },
    { href: "/meetings", label: "Meetings", icon: "meetings" },
    { href: "/legal", label: "Legal", icon: "legal" },
    { href: "/generate", label: "Generate", icon: "generate" },
  ]},
];

function Ico({ name, size = 16 }: { name: string; size?: number }) {
  const C = ICONS[name] || FileText;
  return <C size={size} strokeWidth={1.8} />;
}

export default function Shell({ children }: { children: React.ReactNode }) {
  const path = usePathname();
  const router = useRouter();
  const [openCat, setOpenCat] = useState<string | null>(null);
  const [avOpen, setAvOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const avRef = useRef<HTMLDivElement>(null);

  const isActive = (href: string) => (href === "/" ? path === "/" : path.startsWith(href));

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpenCat(null);
      if (avRef.current && !avRef.current.contains(e.target as Node)) setAvOpen(false);
    };
    document.addEventListener("click", onClick);
    return () => document.removeEventListener("click", onClick);
  }, []);

  async function logout() {
    await fetch("/api/auth", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "logout" }),
    });
    router.push("/login"); router.refresh();
  }

  return (
    <>
      <div className="app-bg" aria-hidden>
        <video autoPlay muted loop playsInline poster="/login-bg-poster.jpg">
          <source src="/login-bg.mp4" type="video/mp4" />
        </video>
      </div>
    <div className="appframe">
      <header className="topnav">
        <div className="topnav-inner">
          <Link href="/" className="brand" aria-label="La Rencontre">
            <Logo variant="lockup" size={32} />
          </Link>

          <div className="nav-spacer" />

          <nav className="navpills" ref={ref}>
            {PILLS.map((p) => (
              <Link key={p.href} href={p.href} className={`navpill ${isActive(p.href) ? "active" : ""}`}>
                <span className="ico"><Ico name={p.icon} /></span> {p.label}
              </Link>
            ))}
            {GROUPS.map((g) => {
              const gActive = g.items.some((i) => isActive(i.href));
              const open = openCat === g.group;
              return (
                <div className="dropwrap" key={g.group}>
                  <button className={`navpill ${gActive ? "active" : ""}`} onClick={() => setOpenCat(open ? null : g.group)}>
                    {g.group} <ChevronDown size={14} className="caret" />
                  </button>
                  {open && (
                    <div className="dropmenu">
                      {g.items.map((r) => (
                        <Link key={r.href} href={r.href} className={isActive(r.href) ? "active" : ""} onClick={() => setOpenCat(null)}>
                          <span className="ico"><Ico name={r.icon} /></span> {r.label}
                        </Link>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </nav>

          <div className="nav-spacer" />

          <div className="nav-right">
            <button className="omnibox" title="Search or ask (Cmd K)" onClick={() => window.dispatchEvent(new Event("open-cmdk"))}>
              <Search size={15} /> <span>Search or ask…</span> <kbd style={{ fontFamily: "inherit", background: "var(--glass-2)", border: "1px solid var(--line)", borderRadius: 6, padding: "1px 6px", fontSize: 11, color: "var(--muted)" }}>⌘K</kbd>
            </button>
            <div className="dropwrap" ref={avRef}>
              <button className="avatar" onClick={() => setAvOpen(!avOpen)} title="Account">J</button>
              {avOpen && (
                <div className="dropmenu" style={{ right: 0, left: "auto" }}>
                  <div style={{ padding: "8px 11px", borderBottom: "1px solid var(--line)", marginBottom: 4 }}>
                    <div style={{ fontSize: 13.5, fontWeight: 600 }}>Jensen</div>
                    <div style={{ fontSize: 11.5, color: "var(--faint)" }}>Founder · La Rencontre</div>
                  </div>
                  <Link href="/settings" onClick={() => setAvOpen(false)} style={{ display: "flex", alignItems: "center", gap: 10, width: "100%", color: "var(--ink-2)", padding: "9px 11px", borderRadius: 11, fontSize: 13.5 }}>
                    <SlidersHorizontal size={15} /> Settings
                  </Link>
                  <button onClick={logout} style={{ display: "flex", alignItems: "center", gap: 10, width: "100%", background: "none", border: 0, color: "var(--ink-2)", padding: "9px 11px", borderRadius: 11, fontSize: 13.5, fontFamily: "inherit" }}>
                    <LogOut size={15} /> Sign out
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      </header>

      <main className="main">{children}</main>

      {path !== "/mentor" && <Link href="/mentor" className="orb float" aria-label="Talk to your concierge" />}
      <CommandPalette />
    </div>
    </>
  );
}
