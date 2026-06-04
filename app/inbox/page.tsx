"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import Shell from "@/components/Shell";
import { RefreshCw, Loader2, Plug, Send, CornerUpLeft, Check } from "lucide-react";

type Mail = {
  id: string; accountId: string; accountEmail: string; provider: "microsoft" | "zoho" | "imap";
  from: string; fromEmail: string; subject: string; date: string; seen: boolean; attachments: number;
  important: boolean; urgent: boolean; needsReply: boolean; quadrant: 1 | 2 | 3 | 4; summary: string; draft: string;
};

const QUADS = [
  { q: 1, title: "Do now", sub: "Urgent & important", accent: "var(--q1, #f87171)" },
  { q: 2, title: "Decide & schedule", sub: "Important, not urgent", accent: "var(--q2, #8b5cf6)" },
  { q: 3, title: "Quick / delegate", sub: "Urgent, not important", accent: "var(--q3, #fbbf24)" },
  { q: 4, title: "Everything else", sub: "Low signal", accent: "var(--q4, #5e5e68)" },
] as const;

export default function InboxPage() {
  const [state, setState] = useState<"loading" | "out" | "in">("loading");
  const [mail, setMail] = useState<Mail[]>([]);
  const [err, setErr] = useState("");
  const [openId, setOpenId] = useState<string | null>(null);

  async function load() {
    setState("loading"); setErr("");
    const r = await fetch("/api/mail/triage").then((x) => x.json()).catch(() => ({ error: "Network error." }));
    if (r.messages) { setMail(r.messages); setState("in"); }
    else if (r.error && /no mailbox/i.test(r.error)) setState("out");
    else { setErr(r.error || "Could not load."); setState("in"); }
  }
  useEffect(() => { load(); /* eslint-disable-next-line */ }, []);

  const byQuad = (q: number) => mail.filter((m) => m.quadrant === q);
  const needReply = mail.filter((m) => m.needsReply && m.important).length;

  if (state === "loading") {
    return <Shell><div className="page-hero fade-up"><div className="eyebrow">Inbox</div><h1>Sorting your mail…</h1></div>
      <div className="muted" style={{ display: "flex", gap: 8, alignItems: "center" }}><Loader2 size={16} style={{ animation: "spin 1s linear infinite" }} /> Reading and ranking across your mailboxes.</div>
      <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style></Shell>;
  }

  if (state === "out") {
    return <Shell>
      <div className="page-hero fade-up"><div className="eyebrow">Inbox</div><h1>Connect your mailboxes.</h1></div>
      <div className="card" style={{ padding: 26, textAlign: "center", maxWidth: 460 }}>
        <Plug size={22} style={{ opacity: 0.7 }} />
        <p className="muted" style={{ marginTop: 10, fontSize: 14 }}>Connect Outlook and Zoho once and I sort every message into your four quadrants and flag what needs a reply.</p>
        <Link href="/mail" className="btn purple" style={{ marginTop: 6, display: "inline-flex" }}>Connect mailbox</Link>
      </div>
    </Shell>;
  }

  return (
    <Shell>
      <div className="page-hero fade-up" style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end" }}>
        <div>
          <div className="eyebrow">Inbox</div>
          <h1>Your mail, by what matters.</h1>
        </div>
        <button className="btn ghost" onClick={load} style={{ height: 38 }}><RefreshCw size={15} /> Refresh</button>
      </div>
      <p className="muted" style={{ marginTop: -8, marginBottom: 16, fontSize: 13.5 }}>
        {needReply > 0 ? `${needReply} important message${needReply === 1 ? "" : "s"} need a reply.` : "Nothing important is waiting on a reply right now."}
      </p>
      {err && <div className="card" style={{ padding: 12, marginBottom: 12, color: "var(--danger)" }}>{err}</div>}

      <div className="quad-grid">
        {QUADS.map(({ q, title, sub, accent }) => {
          const items = byQuad(q);
          return (
            <div key={q} className="card quad" style={{ borderTop: `2px solid ${accent}` }}>
              <div className="quad-head">
                <div style={{ minWidth: 0 }}>
                  <span style={{ fontWeight: 600, fontSize: 13 }}>Q{q} · {title}</span>
                  <span className="faint" style={{ fontSize: 10.5, marginLeft: 6 }}>{sub}</span>
                </div>
                <span className="pill" style={{ height: 20, fontSize: 11 }}>{items.length}</span>
              </div>

              <div className="quad-list">
                {items.length === 0 && <div className="faint" style={{ fontSize: 11.5, padding: "6px 8px" }}>Clear.</div>}
                {items.map((m) => (
                  <div key={m.id}>
                    <div className="mrow" onClick={() => setOpenId(openId === m.id ? null : m.id)}>
                      <span className="mdot" data-reply={m.needsReply ? "true" : "false"} />
                      <span className="msubj">{m.subject || "(no subject)"}</span>
                      <span className="mwho">{senderName(m.from)}</span>
                    </div>
                    {openId === m.id && (
                      <div className="mdetail">
                        <div className="faint" style={{ fontSize: 11, marginBottom: 6 }}>
                          {m.from} · {m.accountEmail}{m.summary ? ` — ${m.summary}` : ""}
                        </div>
                        <ReplyBox m={m} onDone={() => setOpenId(null)} />
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>
      <style>{`@keyframes spin{to{transform:rotate(360deg)}}
        .btn.ghost{background:rgba(255,255,255,.05);border:1px solid var(--line);color:var(--fg, #f6f6f8)}
        .quad-grid{display:grid;grid-template-columns:repeat(2,1fr);gap:12px}
        @media (max-width:760px){.quad-grid{grid-template-columns:1fr}}
        .quad{padding:0;overflow:hidden;display:flex;flex-direction:column}
        .quad-head{display:flex;justify-content:space-between;align-items:center;gap:8px;padding:11px 14px 9px}
        .quad-list{overflow-y:auto;max-height:clamp(190px,33vh,300px);padding:0 6px 8px}
        .quad-list::-webkit-scrollbar{width:6px}
        .quad-list::-webkit-scrollbar-thumb{background:rgba(120,120,140,.28);border-radius:3px}
        .mrow{display:flex;align-items:center;gap:9px;padding:6px 8px;border-radius:8px;cursor:pointer}
        .mrow:hover{background:rgba(124,107,176,.10)}
        .mdot{width:6px;height:6px;border-radius:50%;flex:none;background:rgba(18,20,28,.22)}
        .mdot[data-reply="true"]{background:#8b5cf6;box-shadow:0 0 0 3px rgba(139,92,246,.16)}
        .msubj{flex:1;min-width:0;font-size:12.5px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
        .mwho{font-size:11px;color:#8a8a96;flex:none;max-width:84px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
        .mdetail{padding:4px 8px 10px}
      `}</style>
    </Shell>
  );
}

function senderName(from: string): string {
  if (!from) return "";
  // strip an email in angle brackets, drop quotes, take the display name
  const name = from.replace(/<[^>]*>/, "").replace(/["']/g, "").trim() || from;
  return name.split(/\s+/).slice(0, 2).join(" ");
}

function ReplyBox({ m, onDone }: { m: Mail; onDone: () => void }) {
  const [text, setText] = useState(m.draft || "");
  const [full, setFull] = useState<{ to: string; subject: string } | null>(null);
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [err, setErr] = useState("");

  useEffect(() => {
    fetch(`/api/mail/message?id=${encodeURIComponent(m.id)}`).then((x) => x.json()).then((r) => {
      if (r.message) setFull({ to: r.message.fromEmail || m.fromEmail, subject: `Re: ${r.message.subject || m.subject}` });
      else setFull({ to: m.fromEmail, subject: `Re: ${m.subject}` });
    }).catch(() => setFull({ to: m.fromEmail, subject: `Re: ${m.subject}` }));
  }, [m]);

  async function send() {
    setSending(true); setErr("");
    const r = await fetch("/api/mail/reply", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ id: m.id, to: full?.to || m.fromEmail, subject: full?.subject || `Re: ${m.subject}`, text }),
    }).then((x) => x.json()).catch(() => ({ error: "Network error." }));
    setSending(false);
    if (r.ok) { setSent(true); setTimeout(onDone, 900); } else setErr(r.error || "Could not send.");
  }

  if (sent) return <div className="accent" style={{ fontSize: 12.5, marginTop: 8, display: "flex", gap: 6, alignItems: "center" }}><Check size={14} /> Sent.</div>;

  return (
    <div style={{ marginTop: 8 }}>
      <div className="faint" style={{ fontSize: 11, marginBottom: 5, display: "flex", gap: 5, alignItems: "center" }}><CornerUpLeft size={12} /> Reply from {m.accountEmail} to {full?.to || m.fromEmail}</div>
      <textarea value={text} onChange={(e) => setText(e.target.value)} rows={4}
        placeholder="Write your reply…" className="input" style={{ width: "100%", resize: "vertical", fontSize: 13 }} />
      {err && <div style={{ color: "var(--danger)", fontSize: 12, marginTop: 4 }}>{err}</div>}
      <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
        <button className="btn purple" onClick={send} disabled={sending || !text.trim()} style={{ height: 34 }}>
          {sending ? <Loader2 size={14} style={{ animation: "spin 1s linear infinite" }} /> : <Send size={14} />} Send
        </button>
        <button className="btn ghost" onClick={onDone} style={{ height: 34 }}>Cancel</button>
      </div>
    </div>
  );
}
