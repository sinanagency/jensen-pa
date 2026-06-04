"use client";

import { useEffect, useRef, useState } from "react";
import Shell from "@/components/Shell";
import { useDB } from "@/components/useDB";
import { Note, NoteKind, uid } from "@/lib/store";
import {
  StickyNote,
  Plus,
  Trash2,
  Pin,
  Mic,
  Square,
  Loader2,
  Link as LinkIcon,
} from "lucide-react";

type VoiceResponse = {
  transcript?: string;
  summary?: string;
  tasks?: string[];
  error?: string;
};

const KIND_LABELS: Record<NoteKind, string> = {
  note: "Note",
  idea: "Idea",
  link: "Link",
  journal: "Journal",
};

function KindPill({ kind }: { kind: NoteKind }) {
  const colors: Record<NoteKind, string> = {
    note: "var(--ink-2)",
    idea: "var(--purple-2)",
    link: "var(--purple)",
    journal: "var(--muted)",
  };
  return (
    <span
      className="pill"
      style={{ background: colors[kind], color: "#fff", border: "none", fontSize: 11, padding: "2px 8px" }}
    >
      {KIND_LABELS[kind]}
    </span>
  );
}

function fmtDate(ts: number): string {
  const d = new Date(ts);
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

export default function NotesPage() {
  const { db, mutate } = useDB();

  // --- capture form ---
  const [kind, setKind] = useState<NoteKind>("note");
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [url, setUrl] = useState("");
  const [entityId, setEntityId] = useState("");
  const bodyRef = useRef<HTMLTextAreaElement>(null);

  // --- voice ---
  const rec = useRef<MediaRecorder | null>(null);
  const chunks = useRef<Blob[]>([]);
  const [recording, setRecording] = useState(false);
  const [transcribing, setTranscribing] = useState(false);
  const [voiceError, setVoiceError] = useState<string | null>(null);
  const [pendingTasks, setPendingTasks] = useState<string[]>([]);

  // autofocus when ?new=1
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("new") === "1") {
      bodyRef.current?.focus();
    }
  }, []);

  function addNote() {
    if (!body.trim()) return;
    mutate((d) =>
      d.notes.push({
        id: uid(),
        kind,
        title: title.trim() || undefined,
        body: body.trim(),
        url: kind === "link" && url.trim() ? url.trim() : undefined,
        entityId: entityId || undefined,
        pinned: false,
        createdAt: Date.now(),
      })
    );
    setTitle("");
    setBody("");
    setUrl("");
    setEntityId("");
  }

  function deleteNote(id: string) {
    mutate((d) => {
      d.notes = d.notes.filter((n) => n.id !== id);
    });
  }

  function togglePin(id: string) {
    mutate((d) => {
      const n = d.notes.find((x) => x.id === id);
      if (n) n.pinned = !n.pinned;
    });
  }

  async function startRecording() {
    setVoiceError(null);
    setPendingTasks([]);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mr = new MediaRecorder(stream);
      chunks.current = [];
      mr.ondataavailable = (e) => {
        if (e.data.size > 0) chunks.current.push(e.data);
      };
      mr.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        setTranscribing(true);
        try {
          const blob = new Blob(chunks.current, { type: "audio/webm" });
          const base64: string = await new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve((reader.result as string).split(",")[1] || "");
            reader.onerror = () => reject(reader.error);
            reader.readAsDataURL(blob);
          });
          const res = await fetch("/api/voice", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ audioBase64: base64, mime: "audio/webm", filename: "note.webm" }),
          });
          const data: VoiceResponse = await res.json();
          if (data.error) {
            setVoiceError(data.error);
          } else {
            const transcript = data.transcript ?? "";
            const summary = data.summary ?? "";
            const noteBody = summary ? `${summary}\n\n${transcript}` : transcript;
            if (noteBody.trim()) {
              mutate((d) =>
                d.notes.push({
                  id: uid(),
                  kind: "journal",
                  body: noteBody.trim(),
                  pinned: false,
                  createdAt: Date.now(),
                })
              );
            }
            if (data.tasks && data.tasks.length > 0) {
              setPendingTasks(data.tasks);
            }
          }
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : "Transcription failed.";
          setVoiceError(msg);
        } finally {
          setTranscribing(false);
        }
      };
      mr.start();
      rec.current = mr;
      setRecording(true);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Microphone access denied.";
      setVoiceError(msg);
    }
  }

  function stopRecording() {
    if (rec.current && rec.current.state !== "inactive") {
      rec.current.stop();
    }
    setRecording(false);
  }

  function addPendingTasks() {
    mutate((d) => {
      for (const t of pendingTasks) {
        d.tasks.push({ id: uid(), title: t, quadrant: 2, done: false, createdAt: Date.now() });
      }
    });
    setPendingTasks([]);
  }

  if (!db) {
    return (
      <Shell>
        <div className="muted">Loading...</div>
      </Shell>
    );
  }

  const sorted = [...db.notes].sort((a, b) => {
    if (!!a.pinned !== !!b.pinned) return a.pinned ? -1 : 1;
    return b.createdAt - a.createdAt;
  });

  return (
    <Shell>
      <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>

      <div className="page-hero fade-up">
        <div className="eyebrow">Capture</div>
        <h1>Get it out of your head.</h1>
      </div>

      {/* Quick capture card */}
      <div className="card feature" style={{ padding: 22, marginBottom: 14 }}>
        {/* Kind selector */}
        <div style={{ display: "flex", gap: 8, marginBottom: 14, flexWrap: "wrap" }}>
          {(["note", "idea", "link", "journal"] as NoteKind[]).map((k) => (
            <button
              key={k}
              onClick={() => setKind(k)}
              className={kind === k ? "btn purple sm" : "btn ghost sm"}
              style={{ textTransform: "capitalize" }}
            >
              {KIND_LABELS[k]}
            </button>
          ))}
        </div>

        {/* Title */}
        <input
          className="input"
          placeholder="Title (optional)"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          style={{ marginBottom: 10 }}
        />

        {/* Body */}
        <textarea
          ref={bodyRef}
          className="input"
          rows={4}
          placeholder={
            kind === "idea"
              ? "Describe the idea..."
              : kind === "journal"
              ? "What happened today..."
              : kind === "link"
              ? "Notes about this link..."
              : "Write something..."
          }
          value={body}
          onChange={(e) => setBody(e.target.value)}
          style={{ marginBottom: 10, resize: "vertical" }}
        />

        {/* URL, shown only for link kind */}
        {kind === "link" && (
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
            <LinkIcon size={15} style={{ color: "var(--purple-2)", flexShrink: 0 }} />
            <input
              className="input"
              placeholder="https://"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              style={{ flex: 1 }}
            />
          </div>
        )}

        {/* Entity selector */}
        {db.entities.length > 0 && (
          <select
            className="input"
            value={entityId}
            onChange={(e) => setEntityId(e.target.value)}
            style={{ marginBottom: 14 }}
          >
            <option value="">No entity</option>
            {db.entities.map((e) => (
              <option key={e.id} value={e.id}>
                {e.name}
              </option>
            ))}
          </select>
        )}

        {/* Actions row */}
        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <button
            className="btn purple sm"
            onClick={addNote}
            disabled={!body.trim()}
            style={{ display: "flex", alignItems: "center", gap: 6 }}
          >
            <Plus size={15} /> Add
          </button>

          {/* Voice capture */}
          {!recording && !transcribing && (
            <button
              className="btn ghost sm"
              onClick={startRecording}
              style={{ display: "flex", alignItems: "center", gap: 6 }}
            >
              <Mic size={15} /> Record
            </button>
          )}
          {recording && (
            <button
              className="btn ghost sm"
              onClick={stopRecording}
              style={{ display: "flex", alignItems: "center", gap: 6, color: "var(--danger)" }}
            >
              <span
                style={{
                  width: 8,
                  height: 8,
                  borderRadius: "50%",
                  background: "var(--danger)",
                  display: "inline-block",
                  animation: "spin 1.5s ease-in-out infinite",
                }}
              />
              <Square size={14} /> Stop
            </button>
          )}
          {transcribing && (
            <span className="muted" style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13 }}>
              <Loader2 size={14} style={{ animation: "spin 1s linear infinite" }} /> Transcribing...
            </span>
          )}
        </div>

        {voiceError && (
          <div className="err" style={{ marginTop: 10, fontSize: 13 }}>
            {voiceError}
          </div>
        )}

        {pendingTasks.length > 0 && (
          <div
            style={{
              marginTop: 14,
              padding: 14,
              background: "rgba(var(--purple-rgb, 139,92,246),0.08)",
              borderRadius: 8,
              border: "1px solid var(--line)",
            }}
          >
            <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 8 }}>
              Tasks extracted from recording:
            </div>
            <ul style={{ margin: 0, padding: "0 0 0 16px" }}>
              {pendingTasks.map((t, i) => (
                <li key={i} className="muted" style={{ fontSize: 13, marginBottom: 4 }}>
                  {t}
                </li>
              ))}
            </ul>
            <button
              className="btn purple sm"
              onClick={addPendingTasks}
              style={{ marginTop: 10, display: "flex", alignItems: "center", gap: 6 }}
            >
              <Plus size={14} /> Add these {pendingTasks.length} task{pendingTasks.length === 1 ? "" : "s"}
            </button>
          </div>
        )}
      </div>

      {/* Notes list */}
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {sorted.length === 0 && (
          <div className="card" style={{ padding: 28, textAlign: "center" }}>
            <StickyNote size={28} style={{ color: "var(--faint)", margin: "0 auto 10px" }} />
            <div className="muted" style={{ fontSize: 14 }}>
              No notes yet. Write something or record your voice above.
            </div>
          </div>
        )}

        {sorted.map((note) => {
          const entity = note.entityId ? db.entities.find((e) => e.id === note.entityId) : undefined;
          return (
            <div
              key={note.id}
              className="card"
              style={{ padding: "16px 18px", borderLeft: note.pinned ? "2px solid var(--purple)" : undefined }}
            >
              <div style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  {/* Header row */}
                  <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6, flexWrap: "wrap" }}>
                    <KindPill kind={note.kind} />
                    {note.kind === "journal" && (
                      <span className="accent" style={{ fontSize: 12.5, fontWeight: 600 }}>
                        {fmtDate(note.createdAt)}
                      </span>
                    )}
                    {entity && (
                      <span className="pill accent" style={{ fontSize: 11, padding: "2px 8px" }}>
                        {entity.name}
                      </span>
                    )}
                    <span className="faint" style={{ fontSize: 11.5, marginLeft: "auto" }}>
                      {note.kind !== "journal" && fmtDate(note.createdAt)}
                    </span>
                  </div>

                  {/* Title */}
                  {note.title && (
                    <div style={{ fontWeight: 600, fontSize: 14.5, marginBottom: 4 }}>{note.title}</div>
                  )}

                  {/* Body */}
                  <div
                    className="muted"
                    style={{
                      fontSize: 13.5,
                      whiteSpace: "pre-wrap",
                      display: "-webkit-box",
                      WebkitLineClamp: 4,
                      WebkitBoxOrient: "vertical",
                      overflow: "hidden",
                    }}
                  >
                    {note.body}
                  </div>

                  {/* URL for link kind */}
                  {note.kind === "link" && note.url && (
                    <a
                      href={note.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      style={{
                        display: "inline-flex",
                        alignItems: "center",
                        gap: 5,
                        marginTop: 6,
                        fontSize: 12.5,
                        color: "var(--purple-2)",
                        textDecoration: "none",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                        maxWidth: "100%",
                      }}
                    >
                      <LinkIcon size={12} /> {note.url}
                    </a>
                  )}
                </div>

                {/* Actions */}
                <div style={{ display: "flex", flexDirection: "column", gap: 6, flexShrink: 0 }}>
                  <button
                    className="iconbtn"
                    title={note.pinned ? "Unpin" : "Pin"}
                    onClick={() => togglePin(note.id)}
                    style={{ color: note.pinned ? "var(--purple)" : undefined }}
                  >
                    <Pin size={15} />
                  </button>
                  <button
                    className="iconbtn"
                    title="Delete"
                    onClick={() => deleteNote(note.id)}
                    style={{ color: "var(--danger)" }}
                  >
                    <Trash2 size={15} />
                  </button>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </Shell>
  );
}
