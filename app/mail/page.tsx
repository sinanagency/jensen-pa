"use client";

import { useEffect, useRef, useState } from "react";
import Shell from "@/components/Shell";
import { Loader2, Paperclip, Send, RefreshCw, X, ChevronLeft, Plug, Settings2 } from "lucide-react";

// Mail surface, post-rewrite (2026-06-12). Two changes:
//
// 1. The page now hits /api/mail/triage instead of /api/mail/list. The triage
//    endpoint already aggregates from BOTH credential sources (legacy MAIL_COOKIE
//    + multi-account store), so when Jensen has 2 IMAPs connected it pulls both
//    and merges. The old /api/mail/list only knew about the cookie, which is why
//    a 2-account inbox showed "No mailbox connected" — same shape as the bug we
//    fixed in /api/mail/status last session. Same root cause as KT #221: two paths
//    to the same state, only one path knew the new path.
//
// 2. The inbox renders in 4 quadrants (Do first · Schedule · Delegate · Drop)
//    rather than a flat reverse-chronological list, matching Jensen's operating
//    philosophy and the Today/tasks surface. Triage classification comes from the
//    Haiku call in lib/mail-triage.ts, cached in kv by message id.
//
// What we deliberately don't do here: re-verify credentials. Jensen isn't on call
// right now, the verified state on disk IS the source of truth, no popups asking
// for the password again.

type TriagedSummary = {
  id: string;
  accountId: string;
  accountEmail: string;
  provider: "microsoft" | "zoho" | "imap";
  from: string;
  fromEmail: string;
  subject: string;
  date: string;
  snippet: string;
  seen: boolean;
  attachments: number;
  important: boolean;
  urgent: boolean;
  needsReply: boolean;
  quadrant: 1 | 2 | 3 | 4;
  summary: string;
  draft: string;
};

type Full = TriagedSummary & { text: string; to: string; messageId?: string; attachmentNames?: string[] };
type Out = { filename: string; content: string; contentType?: string };

type OAuthAccount = { id: string; provider: "microsoft" | "zoho" | "imap"; email: string; createdAt: number };

const QUADS: { q: 1 | 2 | 3 | 4; title: string; note: string; color: string }[] = [
  { q: 1, title: "Do first", note: "Urgent + important", color: "var(--q1)" },
  { q: 2, title: "Schedule", note: "Important, not urgent", color: "var(--q2)" },
  { q: 3, title: "Delegate", note: "Urgent, not important", color: "var(--q3)" },
  { q: 4, title: "Drop", note: "Neither", color: "var(--q4)" },
];

export default function MailPage() {
  const [status, setStatus] = useState<"loading" | "out" | "in">("loading");
  const [accounts, setAccounts] = useState<OAuthAccount[]>([]);

  // inbox + triage
  const [msgs, setMsgs] = useState<TriagedSummary[]>([]);
  const [loadingList, setLoadingList] = useState(false);
  const [listErr, setListErr] = useState("");
  const [open, setOpen] = useState<Full | null>(null);
  const [loadingMsg, setLoadingMsg] = useState(false);
  const [managing, setManaging] = useState(false);

  // reply
  const [rTo, setRTo] = useState("");
  const [rSub, setRSub] = useState("");
  const [rText, setRText] = useState("");
  const [atts, setAtts] = useState<Out[]>([]);
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  // add-mailbox form (only visible when manage panel is open)
  const [iemail, setIemail] = useState("");
  const [ipass, setIpass] = useState("");
  const [ipreset, setIpreset] = useState("larencontre");
  const [ibusy, setIbusy] = useState(false);
  const [ierr, setIerr] = useState("");

  useEffect(() => {
    (async () => {
      const s = await fetch("/api/mail/status").then((x) => x.json()).catch(() => ({}));
      const a = await fetch("/api/mail/accounts").then((x) => x.json()).catch(() => ({}));
      setAccounts(a.accounts || []);
      if (s.connected) { setStatus("in"); loadInbox(); } else setStatus("out");
    })();
    /* eslint-disable-next-line */
  }, []);

  async function loadInbox() {
    setLoadingList(true); setListErr("");
    const r = await fetch("/api/mail/triage").then((x) => x.json()).catch(() => ({ error: "Network error." }));
    setLoadingList(false);
    if (r.messages) setMsgs(r.messages); else setListErr(r.error || "Could not load inbox.");
  }

  async function openMsg(s: TriagedSummary) {
    setLoadingMsg(true); setOpen(null); setSent(false);
    const r = await fetch(`/api/mail/message?id=${encodeURIComponent(s.id)}`).then((x) => x.json()).catch(() => ({}));
    setLoadingMsg(false);
    if (r.message) {
      const full: Full = { ...s, ...r.message };
      setOpen(full);
      setRTo(full.fromEmail || s.fromEmail);
      setRSub(`Re: ${full.subject || s.subject}`);
      setRText(s.draft || "");
      setAtts([]);
    }
  }

  async function pickFiles(files: FileList) {
    const out: Out[] = [];
    for (const f of Array.from(files)) {
      const b64 = await new Promise<string>((res) => {
        const rd = new FileReader();
        rd.onload = () => res(String(rd.result).split(",")[1] || "");
        rd.readAsDataURL(f);
      });
      out.push({ filename: f.name, content: b64, contentType: f.type });
    }
    setAtts((a) => [...a, ...out]);
  }

  async function sendReply() {
    if (!rTo || !rSub || !open) return;
    setSending(true);
    const r = await fetch("/api/mail/reply", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        id: open.id,
        to: rTo,
        subject: rSub,
        text: rText,
        inReplyTo: open.messageId,
        attachments: atts,
      }),
    }).then((x) => x.json()).catch(() => ({ error: "Network error." }));
    setSending(false);
    if (r.ok) { setSent(true); setRText(""); setAtts([]); } else alert(r.error || "Could not send.");
  }

  async function refreshAccounts() {
    const a = await fetch("/api/mail/accounts").then((x) => x.json()).catch(() => ({}));
    setAccounts(a.accounts || []);
  }

  async function removeAccount(id: string) {
    if (!confirm("Remove this mailbox? You can add it back any time.")) return;
    await fetch(`/api/mail/accounts?id=${encodeURIComponent(id)}`, { method: "DELETE" });
    refreshAccounts();
    loadInbox();
  }

  async function addMailbox() {
    setIbusy(true); setIerr("");
    const r = await fetch("/api/mail/imap/connect", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ provider: ipreset, email: iemail, pass: ipass }),
    }).then((x) => x.json()).catch(() => ({ error: "Network error." }));
    setIbusy(false);
    if (r.ok) {
      setIemail(""); setIpass("");
      refreshAccounts();
      if (status === "out") setStatus("in");
      loadInbox();
    } else setIerr(r.error || "Could not connect.");
  }

  if (status === "loading") return <Shell><div className="muted">Loading…</div></Shell>;

  // ---------- not connected ----------
  if (status === "out") {
    return (
      <Shell>
        <div className="mail-connect fade-up">
          <div className="page-hero" style={{ textAlign: "center", marginBottom: 8 }}>
            <div className="eyebrow">Mail</div>
            <h1>Connect your mailboxes.</h1>
          </div>
          <p className="muted" style={{ marginBottom: 22, maxWidth: 520, textAlign: "center" }}>
            Add a mailbox below. Both Jensen and Info accounts flow into one inbox, sorted into four quadrants.
          </p>
          <ConnectCard
            iemail={iemail} setIemail={setIemail}
            ipass={ipass} setIpass={setIpass}
            ipreset={ipreset} setIpreset={setIpreset}
            busy={ibusy} err={ierr} onAdd={addMailbox}
          />
        </div>
        <style>{`@keyframes spin{to{transform:rotate(360deg)}} .mail-connect{display:flex;flex-direction:column;align-items:center;justify-content:center;min-height:calc(100vh - 230px)}`}</style>
      </Shell>
    );
  }

  // ---------- connected ----------
  const accountLine = accounts.length > 1
    ? `${accounts.length} mailboxes`
    : accounts[0]?.email || "";

  const grouped: Record<1 | 2 | 3 | 4, TriagedSummary[]> = { 1: [], 2: [], 3: [], 4: [] };
  for (const m of msgs) grouped[m.quadrant].push(m);

  return (
    <Shell>
      <div className="page-hero fade-up" style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end" }}>
        <div>
          <div className="eyebrow">Mail · {accountLine}</div>
          <h1>{open ? "Reading" : "Inbox"}</h1>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button className="btn ghost sm" onClick={loadInbox} disabled={loadingList}>
            <RefreshCw size={14} style={{ animation: loadingList ? "spin 1s linear infinite" : "none" }} /> Refresh
          </button>
          <button className="btn ghost sm" onClick={() => setManaging((v) => !v)}>
            <Settings2 size={14} /> Mailboxes
          </button>
        </div>
      </div>

      {managing && (
        <div className="card" style={{ padding: 18, marginBottom: 18 }}>
          <div style={{ fontWeight: 600, marginBottom: 12 }}>Connected mailboxes</div>
          {accounts.length === 0 && <div className="muted" style={{ fontSize: 13 }}>None yet.</div>}
          {accounts.map((a) => (
            <div key={a.id} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, padding: "9px 0", borderTop: "1px solid var(--line)" }}>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 13.5, fontWeight: 500 }}>{a.email}</div>
                <div className="faint" style={{ fontSize: 11.5 }}>
                  {a.provider === "microsoft" ? "Outlook" : a.provider === "zoho" ? "Zoho" : "Email + password"}
                </div>
              </div>
              <button className="pill" style={{ height: 28, cursor: "pointer" }} onClick={() => removeAccount(a.id)}>Remove</button>
            </div>
          ))}
          <div style={{ borderTop: "1px solid var(--line)", margin: "16px 0 12px" }} />
          <div style={{ fontWeight: 600, marginBottom: 10 }}>Add another mailbox</div>
          <ConnectCard
            iemail={iemail} setIemail={setIemail}
            ipass={ipass} setIpass={setIpass}
            ipreset={ipreset} setIpreset={setIpreset}
            busy={ibusy} err={ierr} onAdd={addMailbox}
            inline
          />
        </div>
      )}

      {!open && (
        <div className="mail-quads fade-up">
          {loadingList && msgs.length === 0 && <div className="muted" style={{ padding: 20 }}>Reading both inboxes…</div>}
          {listErr && <div className="err" style={{ padding: 16 }}>{listErr}</div>}
          {!loadingList && !listErr && msgs.length === 0 && <div className="muted" style={{ padding: 20 }}>Both inboxes empty.</div>}
          {msgs.length > 0 && QUADS.map(({ q, title, note, color }) => {
            const items = grouped[q];
            return (
              <div key={q} className="card quad-mail">
                <div className="quad-top">
                  <span className="quad-dot" style={{ background: color }} />
                  <div style={{ flex: 1 }}>
                    <div className="quad-title">{title}</div>
                    <div className="quad-note">{note}</div>
                  </div>
                  <span className="quad-count" style={{ color }}>{items.length}</span>
                </div>
                <div className="quad-list">
                  {items.length === 0 && <div className="muted" style={{ fontSize: 13, padding: "6px 0" }}>Clear.</div>}
                  {items.slice(0, 8).map((m) => (
                    <button key={m.id} onClick={() => openMsg(m)} className="mailrow" style={{ display: "flex", flexDirection: "column", alignItems: "stretch", gap: 4, width: "100%", textAlign: "left", background: "none", border: 0, padding: "10px 8px", borderRadius: 10, color: "var(--ink)", borderTop: "1px solid var(--line)" }}>
                      <div style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 13.5 }}>
                        {!m.seen && <span style={{ width: 6, height: 6, borderRadius: "50%", background: color, flex: "none" }} />}
                        <span style={{ flex: 1, minWidth: 0, fontWeight: m.seen ? 400 : 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{m.from}</span>
                        {m.attachments > 0 && <Paperclip size={12} style={{ color: "var(--muted)" }} />}
                        {m.needsReply && <span className="pill" style={{ height: 18, fontSize: 10, padding: "0 8px" }}>reply</span>}
                        <span className="faint" style={{ fontSize: 11.5, flex: "none" }}>{niceDate(m.date)}</span>
                      </div>
                      <div style={{ fontSize: 12.5, color: "var(--ink-2)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{m.subject}</div>
                      {m.summary && <div className="faint" style={{ fontSize: 11.5, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{m.summary}</div>}
                    </button>
                  ))}
                  {items.length > 8 && <div className="faint" style={{ fontSize: 12, paddingTop: 8 }}>+{items.length - 8} more</div>}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {loadingMsg && <div className="muted">Opening…</div>}

      {open && (
        <div className="fade-up">
          <button className="btn ghost sm" onClick={() => setOpen(null)} style={{ marginBottom: 14 }}><ChevronLeft size={14} /> Inbox</button>
          <div className="card" style={{ padding: 22, marginBottom: 14 }}>
            <div style={{ fontFamily: "var(--font-display)", fontSize: 22 }}>{open.subject}</div>
            <div className="muted" style={{ fontSize: 13, margin: "6px 0 14px" }}>{open.from} · {new Date(open.date).toLocaleString()}</div>
            {(open.attachmentNames || []).length > 0 && (
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 14 }}>
                {(open.attachmentNames || []).map((n, i) => <span key={i} className="pill"><Paperclip size={12} /> {n}</span>)}
              </div>
            )}
            <div style={{ whiteSpace: "pre-wrap", fontSize: 14.5, lineHeight: 1.6, color: "var(--ink-2)" }}>{open.text || "(no text body)"}</div>
          </div>

          <div className="card feature" style={{ padding: 18 }}>
            <div style={{ fontWeight: 600, marginBottom: 12, display: "flex", alignItems: "center", gap: 10 }}>
              Reply
              {open.draft && <span className="faint" style={{ fontSize: 12, fontWeight: 400 }}>· suggested draft loaded</span>}
            </div>
            <input value={rTo} onChange={(e) => setRTo(e.target.value)} placeholder="To" style={{ marginBottom: 10 }} />
            <input value={rSub} onChange={(e) => setRSub(e.target.value)} placeholder="Subject" style={{ marginBottom: 10 }} />
            <textarea className="input" rows={5} value={rText} onChange={(e) => setRText(e.target.value)} placeholder="Write your reply…" />
            {atts.length > 0 && (
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap", margin: "10px 0" }}>
                {atts.map((a, i) => <span key={i} className="pill">{a.filename} <X size={12} style={{ cursor: "pointer" }} onClick={() => setAtts((x) => x.filter((_, j) => j !== i))} /></span>)}
              </div>
            )}
            <div style={{ display: "flex", gap: 10, marginTop: 12, alignItems: "center" }}>
              <button className="btn purple" onClick={sendReply} disabled={sending || !rTo}>
                {sending ? <><Loader2 size={15} style={{ animation: "spin 1s linear infinite" }} /> Sending…</> : <><Send size={15} /> Send reply</>}
              </button>
              <button className="btn ghost" onClick={() => fileRef.current?.click()}><Paperclip size={15} /> Attach</button>
              <input ref={fileRef} type="file" multiple hidden onChange={(e) => { if (e.target.files) pickFiles(e.target.files); e.currentTarget.value = ""; }} />
              {sent && <span style={{ color: "var(--success)", fontSize: 13.5 }}>Sent</span>}
            </div>
          </div>
        </div>
      )}

      <style>{`
        @keyframes spin{to{transform:rotate(360deg)}}
        .mailrow:hover{background:var(--glass-2)!important}
        .mail-quads{display:grid;grid-template-columns:1fr 1fr;gap:14px}
        .quad-mail{padding:16px}
        .quad-mail .quad-top{display:flex;align-items:flex-start;gap:11px;margin-bottom:8px}
        .quad-mail .quad-dot{width:10px;height:10px;border-radius:50%;margin-top:5px;flex:none;box-shadow:0 0 12px currentColor}
        .quad-mail .quad-title{font-size:15px;font-weight:600}
        .quad-mail .quad-note{font-size:11.5px;color:var(--faint);margin-top:1px}
        .quad-mail .quad-count{font-family:var(--font-display);font-size:22px;line-height:1}
        .quad-mail .quad-list{display:flex;flex-direction:column}
        @media(max-width:900px){.mail-quads{grid-template-columns:1fr}}
      `}</style>
    </Shell>
  );
}

function niceDate(d: string): string {
  if (!d) return "";
  const date = new Date(d);
  if (isNaN(date.getTime())) return "";
  const today = new Date();
  const isToday = date.toDateString() === today.toDateString();
  if (isToday) return date.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
  return date.toLocaleDateString("en-GB", { month: "short", day: "numeric" });
}

const PRESETS = [
  { id: "larencontre", l: "larencontre.ae" },
  { id: "outlook", l: "Outlook" },
  { id: "zoho", l: "Zoho" },
  { id: "gmail", l: "Gmail" },
  { id: "custom", l: "Other" },
];

function ConnectCard(props: {
  iemail: string; setIemail: (v: string) => void;
  ipass: string; setIpass: (v: string) => void;
  ipreset: string; setIpreset: (v: string) => void;
  busy: boolean; err: string; onAdd: () => void;
  inline?: boolean;
}) {
  return (
    <div className={props.inline ? "" : "card"} style={{ padding: props.inline ? 0 : 20, width: "100%", maxWidth: 480, textAlign: "left" }}>
      <label>Provider</label>
      <div style={{ display: "flex", gap: 8, margin: "8px 0 12px", flexWrap: "wrap" }}>
        {PRESETS.map((p) => (
          <button key={p.id} className={`pill ${props.ipreset === p.id ? "accent" : ""}`} style={{ cursor: "pointer", height: 30 }} onClick={() => props.setIpreset(p.id)}>{p.l}</button>
        ))}
      </div>
      <input value={props.iemail} onChange={(e) => props.setIemail(e.target.value)} placeholder="jensenmoonien@larencontre.ae" autoComplete="off" style={{ marginBottom: 8 }} />
      <input type="password" value={props.ipass} onChange={(e) => props.setIpass(e.target.value)} placeholder="mailbox password" autoComplete="off" style={{ marginBottom: 10 }} />
      <button className="btn purple" onClick={props.onAdd} disabled={props.busy || !props.iemail || !props.ipass} style={{ justifyContent: "center", width: "100%" }}>
        {props.busy ? <><Loader2 size={15} style={{ animation: "spin 1s linear infinite" }} /> Connecting…</> : <><Plug size={15} /> Connect mailbox</>}
      </button>
      {props.err && <div className="err" style={{ marginTop: 8 }}>{props.err}</div>}
    </div>
  );
}
