"use client";

import { useEffect, useRef, useState } from "react";
import Shell from "@/components/Shell";
import { Mail, Loader2, Paperclip, Send, RefreshCw, X, ChevronLeft, Plug, MessageCircle } from "lucide-react";

type Summary = { uid: number; from: string; fromEmail: string; subject: string; date: string; seen: boolean; attachments: number };
type Full = Summary & { text: string; to: string; messageId?: string; attachmentNames: string[] };
type Out = { filename: string; content: string; contentType?: string };

const PRESETS = [
  { id: "outlook", label: "Outlook / Microsoft 365" },
  { id: "gmail", label: "Gmail / Workspace" },
  { id: "custom", label: "Custom IMAP / SMTP" },
];

export default function MailPage() {
  const [status, setStatus] = useState<"loading" | "out" | "in">("loading");
  const [email, setEmail] = useState("");

  // connect form
  const [provider, setProvider] = useState("outlook");
  const [pass, setPass] = useState("");
  const [imapHost, setImapHost] = useState(""); const [smtpHost, setSmtpHost] = useState("");
  const [connecting, setConnecting] = useState(false);
  const [cErr, setCErr] = useState("");

  // inbox
  const [msgs, setMsgs] = useState<Summary[]>([]);
  const [loadingList, setLoadingList] = useState(false);
  const [listErr, setListErr] = useState("");
  const [open, setOpen] = useState<Full | null>(null);
  const [loadingMsg, setLoadingMsg] = useState(false);

  // reply
  const [rTo, setRTo] = useState(""); const [rSub, setRSub] = useState(""); const [rText, setRText] = useState("");
  const [atts, setAtts] = useState<Out[]>([]); const [sending, setSending] = useState(false); const [sent, setSent] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => { (async () => {
    const r = await fetch("/api/mail/status").then((x) => x.json()).catch(() => ({}));
    if (r.connected) { setStatus("in"); setEmail(r.email); loadList(); } else setStatus("out");
  })(); /* eslint-disable-next-line */ }, []);

  async function connect() {
    setConnecting(true); setCErr("");
    const r = await fetch("/api/mail/connect", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ provider, email, pass, imapHost, smtpHost }),
    }).then((x) => x.json()).catch(() => ({ error: "Network error." }));
    setConnecting(false);
    if (r.ok) { setStatus("in"); setPass(""); loadList(); } else setCErr(r.error || "Could not connect.");
  }

  async function loadList() {
    setLoadingList(true); setListErr("");
    const r = await fetch("/api/mail/list").then((x) => x.json()).catch(() => ({ error: "Network error." }));
    setLoadingList(false);
    if (r.messages) setMsgs(r.messages); else setListErr(r.error || "Could not load inbox.");
  }

  async function openMsg(s: Summary) {
    setLoadingMsg(true); setOpen(null); setSent(false);
    const r = await fetch(`/api/mail/message?uid=${s.uid}`).then((x) => x.json()).catch(() => ({}));
    setLoadingMsg(false);
    if (r.message) {
      setOpen(r.message);
      setRTo(r.message.fromEmail); setRSub(`Re: ${r.message.subject}`); setRText(""); setAtts([]);
    }
  }

  async function pickFiles(files: FileList) {
    const out: Out[] = [];
    for (const f of Array.from(files)) {
      const b64 = await new Promise<string>((res) => { const rd = new FileReader(); rd.onload = () => res(String(rd.result).split(",")[1] || ""); rd.readAsDataURL(f); });
      out.push({ filename: f.name, content: b64, contentType: f.type });
    }
    setAtts((a) => [...a, ...out]);
  }

  async function sendReply() {
    if (!rTo || !rSub) return;
    setSending(true);
    const r = await fetch("/api/mail/reply", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ to: rTo, subject: rSub, text: rText, inReplyTo: open?.messageId, attachments: atts }),
    }).then((x) => x.json()).catch(() => ({ error: "Network error." }));
    setSending(false);
    if (r.ok) { setSent(true); setRText(""); setAtts([]); } else alert(r.error || "Could not send.");
  }

  async function disconnect() {
    await fetch("/api/mail/disconnect", { method: "POST" });
    setStatus("out"); setMsgs([]); setOpen(null);
  }

  if (status === "loading") return <Shell><div className="muted">Loading…</div></Shell>;

  // ---------- not connected ----------
  if (status === "out") {
    return (
      <Shell>
        <div className="page-hero fade-up"><div className="eyebrow">Mail</div><h1>Connect your mailbox.</h1></div>
        <p className="muted" style={{ marginTop: -10, marginBottom: 18, maxWidth: 600 }}>
          Read and reply to your email here and from WhatsApp, with attachments. Use an app password, not your login password. Your credentials are encrypted and never shared.
        </p>
        <div className="card feature" style={{ padding: 22, maxWidth: 520 }}>
          <label>Provider</label>
          <div style={{ display: "flex", gap: 8, margin: "8px 0 14px", flexWrap: "wrap" }}>
            {PRESETS.map((p) => <button key={p.id} className={`pill ${provider === p.id ? "accent" : ""}`} onClick={() => setProvider(p.id)} style={{ cursor: "pointer", height: 32 }}>{p.label}</button>)}
          </div>
          <label>Email address</label>
          <input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@larencontre.ae" style={{ margin: "8px 0 12px" }} />
          <label>App password</label>
          <input type="password" value={pass} onChange={(e) => setPass(e.target.value)} placeholder="app password" style={{ margin: "8px 0 12px" }} />
          {provider === "custom" && (
            <div style={{ display: "flex", gap: 10, marginBottom: 12 }}>
              <div style={{ flex: 1 }}><label>IMAP host</label><input value={imapHost} onChange={(e) => setImapHost(e.target.value)} placeholder="imap.host.com" style={{ marginTop: 6 }} /></div>
              <div style={{ flex: 1 }}><label>SMTP host</label><input value={smtpHost} onChange={(e) => setSmtpHost(e.target.value)} placeholder="smtp.host.com" style={{ marginTop: 6 }} /></div>
            </div>
          )}
          <button className="btn purple" onClick={connect} disabled={connecting || !email || !pass}>
            {connecting ? <><Loader2 size={15} style={{ animation: "spin 1s linear infinite" }} /> Connecting…</> : <><Plug size={15} /> Connect mailbox</>}
          </button>
          {cErr && <div className="err">{cErr}</div>}
          <div className="faint" style={{ fontSize: 11.5, marginTop: 12 }}>
            Outlook and Gmail require an app password from your account security settings. We validate by signing in once.
          </div>
        </div>
        <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
      </Shell>
    );
  }

  // ---------- connected ----------
  return (
    <Shell>
      <div className="page-hero fade-up" style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end" }}>
        <div><div className="eyebrow">Mail · {email}</div><h1>{open ? "Reading" : "Inbox"}</h1></div>
        <div style={{ display: "flex", gap: 8 }}>
          <button className="btn ghost sm" onClick={loadList} disabled={loadingList}><RefreshCw size={14} /> Refresh</button>
          <button className="btn ghost sm" onClick={disconnect}>Disconnect</button>
        </div>
      </div>

      <div className="pill accent" style={{ marginBottom: 16 }}><MessageCircle size={13} /> Read and reply from WhatsApp too. Activate by connecting a WhatsApp Business number.</div>

      {!open && (
        <div className="card" style={{ padding: 8 }}>
          {loadingList && <div className="muted" style={{ padding: 16 }}>Reading your inbox…</div>}
          {listErr && <div className="err" style={{ padding: 16 }}>{listErr}</div>}
          {!loadingList && !listErr && msgs.length === 0 && <div className="muted" style={{ padding: 16 }}>Inbox empty.</div>}
          {msgs.map((m) => (
            <button key={m.uid} onClick={() => openMsg(m)} style={{ display: "flex", gap: 12, alignItems: "center", width: "100%", textAlign: "left", background: "none", border: 0, padding: "12px 12px", borderRadius: 12, color: "var(--ink)" }} className="mailrow">
              {!m.seen && <span style={{ width: 7, height: 7, borderRadius: "50%", background: "var(--purple)", flex: "none" }} />}
              <span style={{ flex: "0 0 180px", fontWeight: m.seen ? 400 : 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{m.from}</span>
              <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: "var(--ink-2)" }}>{m.subject}</span>
              {m.attachments > 0 && <Paperclip size={14} style={{ color: "var(--muted)" }} />}
              <span className="faint" style={{ fontSize: 12, flex: "none" }}>{new Date(m.date).toLocaleDateString("en-US", { month: "short", day: "numeric" })}</span>
            </button>
          ))}
        </div>
      )}

      {loadingMsg && <div className="muted">Opening…</div>}

      {open && (
        <div>
          <button className="btn ghost sm" onClick={() => setOpen(null)} style={{ marginBottom: 14 }}><ChevronLeft size={14} /> Inbox</button>
          <div className="card" style={{ padding: 22, marginBottom: 14 }}>
            <div style={{ fontFamily: "var(--font-display)", fontSize: 22 }}>{open.subject}</div>
            <div className="muted" style={{ fontSize: 13, margin: "6px 0 14px" }}>{open.from} · {new Date(open.date).toLocaleString()}</div>
            {open.attachmentNames.length > 0 && (
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 14 }}>
                {open.attachmentNames.map((n, i) => <span key={i} className="pill"><Paperclip size={12} /> {n}</span>)}
              </div>
            )}
            <div style={{ whiteSpace: "pre-wrap", fontSize: 14.5, lineHeight: 1.6, color: "var(--ink-2)" }}>{open.text || "(no text body)"}</div>
          </div>

          <div className="card feature" style={{ padding: 18 }}>
            <div style={{ fontWeight: 600, marginBottom: 12 }}>Reply</div>
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
      <style>{`@keyframes spin{to{transform:rotate(360deg)}} .mailrow:hover{background:var(--glass-2)!important}`}</style>
    </Shell>
  );
}
