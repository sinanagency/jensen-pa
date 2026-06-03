"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  LayoutGrid, MessageCircle, Building2, CheckSquare, Wallet, Library,
  FileText, Calendar, ChevronDown, Search, LogOut, ChevronLeft,
} from "lucide-react";

const ICONS: Record<string, any> = {
  today: LayoutGrid, mentor: MessageCircle, portfolio: Building2, tasks: CheckSquare,
  finance: Wallet, brain: Library, generate: FileText, calendar: Calendar,
};

const PILLS = [
  { href: "/", label: "Today", icon: "today" },
  { href: "/mentor", label: "Mentor", icon: "mentor" },
  { href: "/portfolio", label: "Portfolio", icon: "portfolio" },
];
const GROUPS = [
  { group: "Operate", items: [
    { href: "/tasks", label: "Tasks", icon: "tasks" },
    { href: "/calendar", label: "Calendar", icon: "calendar" },
    { href: "/finance", label: "Finance", icon: "finance" },
  ]},
  { group: "Studio", items: [
    { href: "/brain", label: "Documents", icon: "brain" },
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
    <div className="appframe">
      <header className="topnav">
        <div className="topnav-inner">
          <button className="iconbtn" onClick={() => router.back()} title="Back"><ChevronLeft size={18} /></button>
          <Link href="/" className="brand">
            <img src="/monogram.svg" alt="" width={28} height={28} />
            <span className="brand-name">La Rencontre</span>
          </Link>

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

          <div className="nav-right">
            <Link href="/mentor" className="omnibox" title="Ask your mentor">
              <Search size={15} /> <span>Ask anything…</span>
            </Link>
            <div className="dropwrap" ref={avRef}>
              <button className="avatar" onClick={() => setAvOpen(!avOpen)} title="Account">J</button>
              {avOpen && (
                <div className="dropmenu" style={{ right: 0, left: "auto" }}>
                  <div style={{ padding: "8px 11px", borderBottom: "1px solid var(--line)", marginBottom: 4 }}>
                    <div style={{ fontSize: 13.5, fontWeight: 600 }}>Jensen</div>
                    <div style={{ fontSize: 11.5, color: "var(--faint)" }}>Founder · La Rencontre</div>
                  </div>
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

      <Link href="/mentor" className="orb float" aria-label="Talk to your mentor" />
    </div>
  );
}
