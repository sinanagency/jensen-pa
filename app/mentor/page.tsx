"use client";

import { useEffect, useRef, useState } from "react";
import Shell from "@/components/Shell";
import { useDB } from "@/components/useDB";
import { DB } from "@/lib/store";
import { searchDocs } from "@/lib/idb";
import { Send } from "lucide-react";

const SUGGESTIONS = [
  "What should I focus on today, and why?",
  "Draft the angle for the Khalifa Hospitality proposal.",
  "How are my finances looking this period?",
  "What am I forgetting?",
];

function entitySummary(db: DB): string {
  const ents = db.entities.map((e) => `${e.kind}: ${e.name}${e.status ? ` (${e.status})` : ""}`).join("\n");
  const p = db.prefs || {};
  const prefs = [
    p.workStyle && `How he works: ${p.workStyle}`,
    p.tone && `Tone he prefers: ${p.tone}`,
    p.hours && `Working hours / focus: ${p.hours}`,
    p.extra && `Always honour: ${p.extra}`,
  ].filter(Boolean).join("\n");
  return [prefs && `HIS PREFERENCES:\n${prefs}`, ents && `ENTITIES:\n${ents}`].filter(Boolean).join("\n\n");
}

export default function Mentor() {
  const { db, mutate } = useDB();
  const [msgs, setMsgs] = useState<{ role: "user" | "assistant"; content: string }[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => { if (db && msgs.length === 0) setMsgs(db.chat.map((c) => ({ role: c.role, content: c.content }))); /* eslint-disable-next-line */ }, [!!db]);
  useEffect(() => { scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" }); }, [msgs]);
  // Handoff from the command palette ("Ask the mentor: …").
  useEffect(() => {
    if (!db) return;
    const ask = sessionStorage.getItem("lr-ask");
    if (ask) { sessionStorage.removeItem("lr-ask"); send(ask); }
    /* eslint-disable-next-line */
  }, [!!db]);

  async function ragContext(query: string): Promise<string> {
    try {
      const res = await fetch("/api/brain", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ mode: "query", text: query }),
      });
      const { embedding } = await res.json();
      if (!embedding) return "";
      const hits = (await searchDocs(embedding, 5)).filter((h) => h.score > 0.2);
      return hits.map((h) => `[${h.title}] ${h.text}`).join("\n\n");
    } catch { return ""; }
  }

  async function send(text: string) {
    if (!text.trim() || busy || !db) return;
    const userMsg = { role: "user" as const, content: text.trim() };
    const next = [...msgs, userMsg];
    setMsgs(next); setInput(""); setBusy(true);
    mutate((d) => { d.chat.push({ role: "user", content: userMsg.content, ts: Date.now() }); });

    const docs = await ragContext(text);
    const brief = sessionStorage.getItem("lr-brief") || "";

    setMsgs((m) => [...m, { role: "assistant", content: "" }]);
    try {
      const res = await fetch("/api/chat", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ messages: next, brief, entities: entitySummary(db), docs }),
      });
      if (!res.body) throw new Error("no stream");
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let acc = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        acc += dec.decode(value, { stream: true });
        setMsgs((m) => { const c = [...m]; c[c.length - 1] = { role: "assistant", content: acc }; return c; });
      }
      mutate((d) => { d.chat.push({ role: "assistant", content: acc, ts: Date.now() }); });
    } catch (e: any) {
      setMsgs((m) => { const c = [...m]; c[c.length - 1] = { role: "assistant", content: `I could not reach my reasoning just now. ${e?.message || ""}` }; return c; });
    } finally { setBusy(false); }
  }

  if (!db) return <Shell><div className="muted">Loading…</div></Shell>;

  return (
    <Shell>
      <div style={{ display: "flex", flexDirection: "column", height: "calc(100vh - 150px)", minHeight: 420, maxWidth: 860, margin: "0 auto", width: "100%" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12, paddingBottom: 14, borderBottom: "1px solid var(--line)" }}>
          <div className="orb sm" />
          <div>
            <div style={{ fontWeight: 600 }}>Rencontre</div>
            <div style={{ fontSize: 12, color: "var(--muted)" }}>Your chief of staff and mentor</div>
          </div>
        </div>

        <div ref={scrollRef} style={{ flex: 1, overflowY: "auto", padding: "20px 2px" }}>
          {msgs.length === 0 && (
            <div className="fade-up" style={{ maxWidth: 560, margin: "8vh auto 0", textAlign: "center" }}>
              <div className="orb" style={{ width: 64, height: 64, margin: "0 auto 18px" }} />
              <h1 style={{ fontSize: 26 }}>What is on your mind?</h1>
              <p className="muted" style={{ marginTop: 8 }}>I hold your venues, clients, events, and numbers. Ask me anything, or pick a place to start.</p>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 8, justifyContent: "center", marginTop: 22 }}>
                {SUGGESTIONS.map((s) => (
                  <button key={s} className="pill" onClick={() => send(s)} style={{ cursor: "pointer", height: 34 }}>{s}</button>
                ))}
              </div>
            </div>
          )}
          {msgs.map((m, i) => (
            <div key={i} style={{ display: "flex", gap: 12, margin: "16px 0", flexDirection: m.role === "user" ? "row-reverse" : "row" }}>
              {m.role === "assistant" && <div className="orb sm" style={{ marginTop: 2 }} />}
              <div style={{
                maxWidth: "76%", padding: "12px 16px", borderRadius: 16, fontSize: 14.5, lineHeight: 1.6, whiteSpace: "pre-wrap",
                background: m.role === "user" ? "var(--purple)" : "var(--glass-2)",
                color: m.role === "user" ? "#fff" : "var(--ink)",
                border: m.role === "user" ? "none" : "1px solid var(--line)",
              }}>
                {m.content || <span className="muted">…</span>}
              </div>
            </div>
          ))}
        </div>

        <form onSubmit={(e) => { e.preventDefault(); send(input); }} style={{ display: "flex", gap: 10, paddingTop: 14, borderTop: "1px solid var(--line)", alignItems: "center" }}>
          <input value={input} onChange={(e) => setInput(e.target.value)} placeholder="Message your mentor…" autoFocus disabled={busy} style={{ flex: 1, minWidth: 0, height: 48 }} />
          <button className="btn purple" type="submit" disabled={busy || !input.trim()} style={{ width: 48, height: 48, padding: 0, flex: "none", borderRadius: 14 }}><Send size={18} /></button>
        </form>
      </div>
    </Shell>
  );
}
