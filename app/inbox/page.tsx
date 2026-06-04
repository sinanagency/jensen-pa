"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import Shell from "@/components/Shell";
import { RefreshCw, Loader2, Plug, Send, CornerUpLeft, Check } from "lucide-react";

type Mail = {
  id: string; accountId: string; accountEmail: string; provider: "microsoft" | "zoho";
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

      <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 14 }}>
        {QUADS.map(({ q, title, sub, accent }) => {
          const items = byQuad(q);
          return (
            <div key={q} className="card" style={{ padding: 16, borderTop: `2px solid ${accent}` }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 10 }}>
                <div>
                  <div style={{ fontWeight: 600, fontSize: 14.5 }}>Q{q} · {title}</div>
                  <div className="faint" style={{ fontSize: 11.5 }}>{sub}</div>
                </div>
                <span className="pill" style={{ height: 22 }}>{items.length}</span>
              </div>

              {items.length === 0 && <div className="faint" style={{ fontSize: 12.5, padding: "8px 0" }}>Clear.</div>}

              {items.map((m) => (
                <div key={m.id} style={{ borderTop: "1px solid var(--line)", padding: "9px 0" }}>
                  <div style={{ display: "flex", gap: 8, justifyContent: "space-between", cursor: "pointer" }}
                    onClick={() => setOpenId(openId === m.id ? null : m.id)}>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontSize: 13.5, fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{m.subject || "(no subject)"}</div>
                      <div className="faint" style={{ fontSize: 11.5, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{m.from} · {m.accountEmail}</div>
                      {m.summary && <div className="muted" style={{ fontSize: 12, marginTop: 3 }}>{m.summary}</div>}
                    </div>
                    {m.needsReply && <span className="pill accent" style={{ height: 20, alignSelf: "flex-start", flex: "none" }}>Reply</span>}
                  </div>
                  {openId === m.id && <ReplyBox m={m} onDone={() => setOpenId(null)} />}
                </div>
              ))}
            </div>
          );
        })}
      </div>
      <style>{`@keyframes spin{to{transform:rotate(360deg)}}
        .btn.ghost{background:rgba(255,255,255,.05);border:1px solid var(--line);color:var(--fg, #f6f6f8)}
      `}</style>
    </Shell>
  );
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
