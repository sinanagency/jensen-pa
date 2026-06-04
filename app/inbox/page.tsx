"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import Shell from "@/components/Shell";
import { RefreshCw, Loader2, Plug, Send, Check, X, CalendarPlus } from "lucide-react";

type Mail = {
  id: string; accountId: string; accountEmail: string; provider: "microsoft" | "zoho" | "imap";
  from: string; fromEmail: string; subject: string; date: string; seen: boolean; attachments: number;
  important: boolean; urgent: boolean; needsReply: boolean; quadrant: 1 | 2 | 3 | 4; summary: string; draft: string;
  event?: { title: string; date: string; time?: string; note?: string } | null;
};

function dateShort(iso: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  const now = new Date();
  const diffH = (now.getTime() - d.getTime()) / 3.6e6;
  if (diffH < 1) return `${Math.max(1, Math.round(diffH * 60))}m`;
  if (diffH < 24 && now.getDate() === d.getDate()) return `${Math.round(diffH)}h`;
  const sameYear = now.getFullYear() === d.getFullYear();
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short", ...(sameYear ? {} : { year: "2-digit" }) });
}
function dateFull(iso: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  return d.toLocaleString("en-GB", { weekday: "short", day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

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
  const [open, setOpen] = useState<Mail | null>(null);

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
                  <div key={m.id} className="mrow" onClick={() => setOpen(m)}>
                    <span className="mdot" data-reply={m.needsReply ? "true" : "false"} />
                    <span className="msubj">{m.subject || "(no subject)"}</span>
                    {m.event && <CalendarPlus size={12} className="mcal" />}
                    <span className="mwho">{senderName(m.from)}</span>
                    <span className="mdate">{dateShort(m.date)}</span>
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>
      <style>{`@keyframes spin{to{transform:rotate(360deg)}}
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
        .mcal{color:#8b5cf6;flex:none}
        .mwho{font-size:11px;color:#8a8a96;flex:none;max-width:78px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
        .mdate{font-size:10.5px;color:#9aa0aa;flex:none;width:42px;text-align:right}
        .lr-modal-bg{position:fixed;inset:0;z-index:600;background:rgba(8,7,11,.62);backdrop-filter:blur(3px);display:grid;place-items:center;padding:24px}
        .lr-modal{background:#fff;color:#16171d;width:min(720px,94vw);max-height:88vh;border-radius:18px;box-shadow:0 40px 120px rgba(0,0,0,.55);display:flex;flex-direction:column;overflow:hidden}
        .lr-modal-head{display:flex;align-items:flex-start;gap:12px;padding:18px 20px 14px;border-bottom:1px solid rgba(18,20,28,.10)}
        .lr-modal-body{overflow-y:auto;padding:16px 20px}
        .lr-modal-foot{border-top:1px solid rgba(18,20,28,.10);padding:14px 20px}
        .lr-xbtn{flex:none;width:32px;height:32px;border-radius:9px;border:1px solid rgba(18,20,28,.14);background:#fff;display:grid;place-items:center;cursor:pointer;color:#41454f}
        .lr-xbtn:hover{background:#f4f4f6}
        .lr-emailbody{font-size:13.5px;line-height:1.6;color:#2a2c33;white-space:pre-wrap;word-break:break-word}
        .lr-chip{display:inline-flex;align-items:center;gap:5px;font-size:11.5px;background:rgba(139,92,246,.12);color:#6b4fb0;border:1px solid rgba(139,92,246,.26);border-radius:999px;padding:3px 9px}
        .evt-card{border:1px solid rgba(139,92,246,.3);background:linear-gradient(180deg,rgba(139,92,246,.06),rgba(139,92,246,.02));border-radius:12px;padding:13px 15px;margin-bottom:16px}
      `}</style>
      {open && <MailModal m={open} onClose={() => setOpen(null)} />}
    </Shell>
  );
}

function meetingLink(text: string): string {
  if (!text) return "";
  const pats = [
    /https?:\/\/[\w.-]*zoom\.us\/[^\s"'<>)\]]+/i,
    /https?:\/\/meet\.google\.com\/[^\s"'<>)\]]+/i,
    /https?:\/\/teams\.microsoft\.com\/[^\s"'<>)\]]+/i,
    /https?:\/\/[\w.-]*teams\.live\.com\/[^\s"'<>)\]]+/i,
    /https?:\/\/[\w.-]*webex\.com\/[^\s"'<>)\]]+/i,
  ];
  for (const p of pats) { const x = text.match(p); if (x) return x[0]; }
  return "";
}

function MailModal({ m, onClose }: { m: Mail; onClose: () => void }) {
  const [body, setBody] = useState<string | null>(null);
  const [to, setTo] = useState(m.fromEmail);
  const [subject, setSubject] = useState(`Re: ${m.subject}`);
  const [link, setLink] = useState("");
  const [evStatus, setEvStatus] = useState<"idle" | "adding" | "added" | "already" | "err">("idle");
  const [evErr, setEvErr] = useState("");

  useEffect(() => {
    function onKey(e: KeyboardEvent) { if (e.key === "Escape") onClose(); }
    window.addEventListener("keydown", onKey);
    fetch(`/api/mail/message?id=${encodeURIComponent(m.id)}`).then((x) => x.json()).then((r) => {
      if (r.message) {
        setBody(r.message.text || "(no text content)");
        setTo(r.message.fromEmail || m.fromEmail);
        setSubject(`Re: ${r.message.subject || m.subject}`);
        setLink(meetingLink(r.message.text || ""));
      } else setBody("(could not load the message)");
    }).catch(() => setBody("(could not load the message)"));
    return () => window.removeEventListener("keydown", onKey);
  }, [m, onClose]);

  async function addToCalendar() {
    if (!m.event) return;
    setEvStatus("adding"); setEvErr("");
    const note = [m.event.note, link ? `Join: ${link}` : ""].filter(Boolean).join(" · ");
    const r = await fetch("/api/calendar/add", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ messageId: m.id, title: m.event.title, date: m.event.date, time: m.event.time || null, note }),
    }).then((x) => x.json()).catch(() => ({ ok: false, error: "Network error." }));
    if (r.ok) setEvStatus(r.already ? "already" : "added");
    else { setEvStatus("err"); setEvErr(r.error || "Could not add."); }
  }

  return (
    <div className="lr-modal-bg" onClick={onClose}>
      <div className="lr-modal" onClick={(e) => e.stopPropagation()}>
        <div className="lr-modal-head">
          <div style={{ minWidth: 0, flex: 1 }}>
            <div style={{ fontSize: 16, fontWeight: 600, lineHeight: 1.25 }}>{m.subject || "(no subject)"}</div>
            <div style={{ fontSize: 12.5, color: "#71757f", marginTop: 5 }}>
              <b style={{ color: "#41454f" }}>{m.from}</b> · into {m.accountEmail} · {dateFull(m.date)}
            </div>
            <div style={{ display: "flex", gap: 8, marginTop: 8, flexWrap: "wrap" }}>
              {m.needsReply && <span className="lr-chip">Needs reply</span>}
              {m.event && <span className="lr-chip"><CalendarPlus size={12} /> Meeting detected</span>}
            </div>
          </div>
          <button className="lr-xbtn" onClick={onClose} aria-label="Close"><X size={16} /></button>
        </div>
        <div className="lr-modal-body">
          {m.event && (
            <div className="evt-card">
              <div style={{ display: "flex", alignItems: "center", gap: 7, fontSize: 11.5, color: "#6b4fb0", fontWeight: 600, textTransform: "uppercase", letterSpacing: ".04em" }}>
                <CalendarPlus size={13} /> Add this to your calendar?
              </div>
              <div style={{ fontSize: 14, fontWeight: 600, marginTop: 6 }}>{m.event.title}</div>
              <div style={{ fontSize: 12.5, color: "#41454f", marginTop: 2 }}>
                {new Date(m.event.date + (m.event.time ? `T${m.event.time}` : "T00:00")).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", year: "numeric" })}
                {m.event.time ? ` · ${m.event.time}` : ""}
              </div>
              {link && (
                <div style={{ fontSize: 12, marginTop: 6 }}>
                  <a href={link} target="_blank" rel="noreferrer" style={{ color: "#6b4fb0", wordBreak: "break-all" }}>
                    {/zoom/i.test(link) ? "Zoom" : /meet\.google/i.test(link) ? "Google Meet" : /teams/i.test(link) ? "Microsoft Teams" : "Join"} link detected — will be saved
                  </a>
                </div>
              )}
              <div style={{ marginTop: 10 }}>
                {evStatus === "added" ? <span style={{ color: "#34a853", fontSize: 13, display: "inline-flex", gap: 5, alignItems: "center" }}><Check size={15} /> Added to calendar</span>
                  : evStatus === "already" ? <span style={{ color: "#71757f", fontSize: 13 }}>Already on your calendar</span>
                  : <button className="btn purple" onClick={addToCalendar} disabled={evStatus === "adding"} style={{ height: 34 }}>
                      {evStatus === "adding" ? <Loader2 size={14} style={{ animation: "spin 1s linear infinite" }} /> : <CalendarPlus size={14} />} Add to calendar
                    </button>}
                {evStatus === "err" && <span style={{ color: "#d93025", fontSize: 12, marginLeft: 10 }}>{evErr}</span>}
              </div>
            </div>
          )}
          {m.summary && <div style={{ fontSize: 12.5, color: "#6b4fb0", background: "rgba(139,92,246,.07)", border: "1px solid rgba(139,92,246,.18)", borderRadius: 10, padding: "8px 11px", marginBottom: 14 }}>{m.summary}</div>}
          {body === null
            ? <div style={{ color: "#71757f", display: "flex", gap: 8, alignItems: "center" }}><Loader2 size={15} style={{ animation: "spin 1s linear infinite" }} /> Loading…</div>
            : <div className="lr-emailbody">{body}</div>}
        </div>
        <div className="lr-modal-foot">
          <ReplyBox m={m} presetTo={to} presetSubject={subject} onDone={onClose} />
        </div>
      </div>
    </div>
  );
}

function senderName(from: string): string {
  if (!from) return "";
  // strip an email in angle brackets, drop quotes, take the display name
  const name = from.replace(/<[^>]*>/, "").replace(/["']/g, "").trim() || from;
  return name.split(/\s+/).slice(0, 2).join(" ");
}

function ReplyBox({ m, presetTo, presetSubject, onDone }: { m: Mail; presetTo: string; presetSubject: string; onDone: () => void }) {
  const [text, setText] = useState(m.draft || "");
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [err, setErr] = useState("");

  async function send() {
    setSending(true); setErr("");
    const r = await fetch("/api/mail/reply", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ id: m.id, to: presetTo || m.fromEmail, subject: presetSubject || `Re: ${m.subject}`, text }),
    }).then((x) => x.json()).catch(() => ({ error: "Network error." }));
    setSending(false);
    if (r.ok) { setSent(true); setTimeout(onDone, 900); } else setErr(r.error || "Could not send.");
  }

  if (sent) return <div style={{ color: "#34a853", fontSize: 13, display: "flex", gap: 6, alignItems: "center" }}><Check size={15} /> Sent.</div>;

  return (
    <div>
      <div style={{ fontSize: 11, color: "#71757f", marginBottom: 6 }}>Reply from {m.accountEmail} to {presetTo || m.fromEmail}</div>
      <textarea value={text} onChange={(e) => setText(e.target.value)} rows={3}
        placeholder="Write your reply…" style={{ width: "100%", resize: "vertical", fontSize: 13.5, padding: "10px 12px", borderRadius: 10, border: "1px solid rgba(18,20,28,.16)", color: "#16171d", outline: "none" }} />
      {err && <div style={{ color: "#d93025", fontSize: 12, marginTop: 4 }}>{err}</div>}
      <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
        <button className="btn purple" onClick={send} disabled={sending || !text.trim()} style={{ height: 38 }}>
          {sending ? <Loader2 size={15} style={{ animation: "spin 1s linear infinite" }} /> : <Send size={15} />} Send reply
        </button>
      </div>
    </div>
  );
}
