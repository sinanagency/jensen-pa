"use client";

import { useEffect, useRef, useState } from "react";
import Shell from "@/components/Shell";
import { useDB } from "@/components/useDB";
import { uid as taskUid } from "@/lib/store";
import { Doc, addDoc, allDocs, deleteDoc, searchDocs, uid } from "@/lib/docs-client";
import { Mic, Square, Loader2, Search, Trash2, CheckCircle2, ListChecks, Pencil, FileEdit, Sparkles } from "lucide-react";

type MeetingResult = { summary: string; decisions: string[]; tasks: { title: string; quadrant: number }[] };
const QLABEL: Record<number, string> = { 1: "Do first", 2: "Schedule", 3: "Delegate", 4: "Drop" };
const QCOLOR: Record<number, string> = { 1: "var(--q1)", 2: "var(--q2)", 3: "var(--q3)", 4: "var(--q4)" };

export default function Meetings() {
  const { db, mutate } = useDB();
  const [title, setTitle] = useState("");
  const [transcript, setTranscript] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<MeetingResult | null>(null);
  const [added, setAdded] = useState(false);
  const [recording, setRecording] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const rec = useRef<MediaRecorder | null>(null);
  const chunks = useRef<Blob[]>([]);
  const topRef = useRef<HTMLDivElement>(null);

  const [docs, setDocs] = useState<Doc[]>([]);
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<{ title: string; text: string; score: number }[] | null>(null);
  const [searching, setSearching] = useState(false);

  async function refresh() { setDocs((await allDocs()).filter((d) => d.kind === "meeting")); }
  useEffect(() => { refresh(); const on = () => refresh(); window.addEventListener("lr-docs-change", on); return () => window.removeEventListener("lr-docs-change", on); }, []);

  async function record() {
    if (rec.current && rec.current.state === "recording") { rec.current.stop(); return; }
    try {
      const s = await navigator.mediaDevices.getUserMedia({ audio: true });
      rec.current = new MediaRecorder(s); chunks.current = [];
      rec.current.ondataavailable = (e) => chunks.current.push(e.data);
      rec.current.onstop = async () => {
        setRecording(false); setBusy(true);
        const blob = new Blob(chunks.current, { type: "audio/webm" });
        const b64 = await new Promise<string>((res) => { const r = new FileReader(); r.onload = () => res(String(r.result).split(",")[1] || ""); r.readAsDataURL(blob); });
        const r = await fetch("/api/voice", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ audioBase64: b64, mime: "audio/webm", filename: "meeting.webm" }) }).then((x) => x.json());
        setBusy(false);
        if (r.transcript) setTranscript((t) => (t ? t + "\n" : "") + r.transcript);
      };
      rec.current.start(); setRecording(true);
    } catch { alert("Microphone permission needed."); }
  }

  async function process() {
    if (!transcript.trim()) return;
    setBusy(true); setResult(null); setAdded(false);
    try {
      const notes: MeetingResult = await fetch("/api/meeting-notes", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ transcript, title }) }).then((x) => x.json());
      setResult(notes);
      let chunksOut: any[] = [];
      try { const ing = await fetch("/api/brain", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ mode: "ingest", text: transcript }) }).then((x) => x.json()); chunksOut = ing.chunks || []; } catch {}
      const id = editingId || uid();
      await addDoc({ id, title: title || "Meeting", fileName: title || "meeting", mime: "text/plain", kind: "meeting", text: `${notes.summary || ""}\n\n${transcript}`, chunks: chunksOut, size: transcript.length, createdAt: Date.now() });
      setEditingId(id);
    } catch {} finally { setBusy(false); }
  }

  function addTasks() {
    if (!result?.tasks?.length) return;
    mutate((d) => { result.tasks.forEach((t) => d.tasks.push({ id: taskUid(), title: t.title, quadrant: (t.quadrant >= 1 && t.quadrant <= 4 ? t.quadrant : 2) as any, done: false, createdAt: Date.now() })); });
    setAdded(true);
  }

  function openMeeting(d: Doc) {
    // load it back into the editor so Jensen can edit notes / re-run / rename
    const body = d.text || "";
    const idx = body.indexOf("\n\n");
    const transcriptPart = idx >= 0 ? body.slice(idx + 2) : body;
    setTitle(d.title); setTranscript(transcriptPart); setEditingId(d.id); setResult(null); setAdded(false);
    topRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  async function rename(d: Doc) {
    const next = window.prompt("Rename meeting", d.title);
    if (next && next.trim() && next !== d.title) {
      await addDoc({ ...d, title: next.trim(), fileName: next.trim() });
    }
  }

  function newMeeting() { setTitle(""); setTranscript(""); setResult(null); setEditingId(null); setAdded(false); }

  async function search() {
    if (!q.trim()) return;
    setSearching(true); setHits(null);
    try {
      const { embedding } = await fetch("/api/brain", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ mode: "query", text: q }) }).then((x) => x.json());
      if (embedding) setHits((await searchDocs(embedding, 6)).filter((h) => h.score > 0.15));
    } finally { setSearching(false); }
  }

  if (!db) return <Shell><div className="muted">Loading…</div></Shell>;

  return (
    <Shell>
      <div ref={topRef} className="page-hero fade-up" style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", gap: 16 }}>
        <div>
          <div className="eyebrow" style={{ display: "flex", alignItems: "center", gap: 8 }}>Meetings <span className="u-badge">U</span> powered by Digital U</div>
          <h1>{editingId ? "Editing a meeting." : "Every meeting, captured."}</h1>
        </div>
        {editingId && <button className="btn ghost sm" onClick={newMeeting}>New meeting</button>}
      </div>
      <p className="muted" style={{ marginTop: -8, marginBottom: 18, maxWidth: 660 }}>
        Digital U joins your Zoom and Meet calls, records, and transcribes. Paste or record here too. I write the notes and route every action item into the right quadrant on your board.
      </p>

      <div className="grid cols-2">
        <div className="card" style={{ padding: 20 }}>
          <label>Meeting title</label>
          <input className="input" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Khalifa Hospitality kickoff" style={{ marginBottom: 14 }} />
          <label>Transcript</label>
          <textarea className="input" rows={7} value={transcript} onChange={(e) => setTranscript(e.target.value)} placeholder="Paste the transcript, or record below." />
          <div style={{ display: "flex", gap: 10, marginTop: 12 }}>
            <button className="btn purple" onClick={process} disabled={busy || !transcript.trim()}>{busy ? <><Loader2 size={15} style={{ animation: "spin 1s linear infinite" }} /> Working…</> : <><ListChecks size={15} /> {editingId ? "Update notes" : "Make notes"}</>}</button>
            <button className="btn ghost" onClick={record}>{recording ? <><Square size={14} /> Stop</> : <><Mic size={15} /> Record</>}</button>
          </div>
        </div>

        <div className="card feature" style={{ padding: 20 }}>
          {!result && <div className="muted" style={{ fontSize: 14 }}>Notes and action items appear here.</div>}
          {result && (
            <div>
              <div style={{ fontWeight: 600, marginBottom: 8 }}>Summary</div>
              <div style={{ fontSize: 14, lineHeight: 1.6, color: "var(--ink-2)" }}>{result.summary}</div>
              {result.decisions?.length > 0 && <>
                <div style={{ fontWeight: 600, margin: "14px 0 6px" }}>Decisions</div>
                <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13.5, color: "var(--ink-2)" }}>{result.decisions.map((d, i) => <li key={i}>{d}</li>)}</ul>
              </>}
              {result.tasks?.length > 0 && <>
                <div style={{ fontWeight: 600, margin: "14px 0 8px" }}>Action items</div>
                {result.tasks.map((t, i) => (
                  <div key={i} style={{ display: "flex", alignItems: "center", gap: 10, padding: "6px 0", fontSize: 13.5 }}>
                    <span className="pill" style={{ height: 22, color: QCOLOR[t.quadrant], borderColor: QCOLOR[t.quadrant] }}>{QLABEL[t.quadrant] || "Schedule"}</span>
                    <span>{t.title}</span>
                  </div>
                ))}
                <button className="btn purple sm" onClick={addTasks} disabled={added} style={{ marginTop: 12 }}>{added ? <><CheckCircle2 size={14} /> Added to board</> : `Add ${result.tasks.length} to the board`}</button>
              </>}
            </div>
          )}
        </div>
      </div>

      <div className="card feature" style={{ padding: 18, margin: "14px 0" }}>
        <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
          <input className="input" value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === "Enter" && search()} placeholder="Search your meetings, e.g. what did we decide on the rooftop concept" style={{ flex: 1 }} />
          <button className="btn purple" onClick={search} disabled={searching} style={{ width: 48, padding: 0, flex: "none" }}>{searching ? <Loader2 size={16} style={{ animation: "spin 1s linear infinite" }} /> : <Search size={16} />}</button>
        </div>
        {hits && <div style={{ marginTop: 12 }}>{hits.length === 0 ? <div className="muted" style={{ fontSize: 13.5 }}>Nothing close yet.</div> : hits.map((h, i) => (
          <div key={i} style={{ padding: "9px 0", borderTop: "1px solid var(--line)" }}><span className="accent" style={{ fontSize: 13.5, fontWeight: 600 }}>{h.title}</span><div className="muted" style={{ fontSize: 13, marginTop: 3 }}>{h.text.slice(0, 160)}</div></div>
        ))}</div>}
      </div>

      <div className="card" style={{ padding: 18 }}>
        <div style={{ fontWeight: 600, marginBottom: 8 }}>Past meetings</div>
        {docs.length === 0 && <div className="muted" style={{ fontSize: 14 }}>No meetings yet. Digital U will drop them here, or capture one above.</div>}
        {docs.map((d) => (
          <div key={d.id} className="meeting-row" style={{ display: "flex", alignItems: "center", gap: 12, padding: "11px 0", borderTop: "1px solid var(--line)" }}>
            <span className="u-badge sm">U</span>
            <button onClick={() => openMeeting(d)} style={{ flex: 1, minWidth: 0, textAlign: "left", background: "none", border: 0, cursor: "pointer", color: "inherit" }}>
              <div style={{ fontSize: 14, fontWeight: 500, color: "var(--ink)" }}>{d.title}</div>
              <div className="faint" style={{ fontSize: 12 }}>{new Date(d.createdAt).toLocaleString()}</div>
            </button>
            <button className="iconbtn" title="Open and edit" onClick={() => openMeeting(d)}><FileEdit size={15} /></button>
            <button className="iconbtn" title="Rename" onClick={() => rename(d)}><Pencil size={14} /></button>
            <button className="iconbtn" title="Delete" onClick={() => deleteDoc(d.id)}><Trash2 size={15} /></button>
          </div>
        ))}
      </div>
      <style>{`
        @keyframes spin{to{transform:rotate(360deg)}}
        .u-badge{display:inline-grid;place-items:center;width:20px;height:20px;border-radius:6px;background:linear-gradient(135deg,var(--purple-2),#5b4b8a);color:#fff;font-family:var(--font-display);font-weight:700;font-size:11px;flex:none}
        .u-badge.sm{width:24px;height:24px;font-size:12px;border-radius:7px}
        .card .iconbtn{background:rgba(18,20,28,0.05);border:1px solid rgba(18,20,28,0.12);color:var(--ink-2)}
        .card .iconbtn:hover{color:var(--ink);border-color:rgba(18,20,28,0.22)}
      `}</style>
    </Shell>
  );
}
