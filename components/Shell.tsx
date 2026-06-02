"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  LayoutGrid, MessageCircle, Building2, CheckSquare, Wallet,
  Library, FileText, Calendar, LogOut,
} from "lucide-react";

const NAV = [
  { href: "/", label: "Today", icon: LayoutGrid },
  { href: "/mentor", label: "Mentor", icon: MessageCircle },
  { href: "/portfolio", label: "Portfolio", icon: Building2 },
  { href: "/tasks", label: "Tasks", icon: CheckSquare },
  { href: "/finance", label: "Finance", icon: Wallet },
  { href: "/brain", label: "Documents", icon: Library },
  { href: "/generate", label: "Generate", icon: FileText },
  { href: "/calendar", label: "Calendar", icon: Calendar },
];

export default function Shell({ children }: { children: React.ReactNode }) {
  const path = usePathname();
  const router = useRouter();

  async function logout() {
    await fetch("/api/auth", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "logout" }),
    });
    router.push("/login"); router.refresh();
  }

  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="brand">
          <img src="/monogram.svg" alt="" width={30} height={30} />
          <div>
            <div style={{ fontFamily: "var(--font-display)", fontSize: 15, letterSpacing: "0.5px" }}>La Rencontre</div>
            <div style={{ fontSize: 10.5, color: "var(--faint)", letterSpacing: "0.06em" }}>CHIEF OF STAFF</div>
          </div>
        </div>
        {NAV.map(({ href, label, icon: Icon }) => {
          const active = href === "/" ? path === "/" : path.startsWith(href);
          return (
            <Link key={href} href={href} className={`nav-item ${active ? "active" : ""}`}>
              <Icon size={18} strokeWidth={1.8} /> {label}
            </Link>
          );
        })}
        <div className="spacer" />
        <div className="profile">
          <div className="avatar">J</div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 13.5, fontWeight: 600 }}>Jensen</div>
            <div style={{ fontSize: 11, color: "var(--faint)" }}>Founder</div>
          </div>
          <button onClick={logout} title="Sign out"
            style={{ background: "none", border: "none", color: "var(--muted)", display: "grid", placeItems: "center" }}>
            <LogOut size={16} />
          </button>
        </div>
      </aside>

      <main className="main">{children}</main>

      <Link href="/mentor" className="orb float" aria-label="Talk to your mentor" />
    </div>
  );
}
