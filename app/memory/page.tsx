"use client";

import { useEffect, useState } from "react";
import Shell from "@/components/Shell";
import { Brain, Trash2, Loader2 } from "lucide-react";

type Item = { id: number; fact: string; kind: string; subject: string | null; created_at: number };

export default function MemoryPage() {
  const [items, setItems] = useState<Item[]>([]);
  const [loading, setLoading] = useState(true);

  async function load() {
    setLoading(true);
    const r = await fetch("/api/memory", { cache: "no-store" }).then((x) => x.json()).catch(() => ({ items: [] }));
    setItems(r.items || []);
    setLoading(false);
  }
  useEffect(() => { load(); }, []);

  async function forget(id: number) {
    setItems((xs) => xs.filter((x) => x.id !== id));
    await fetch(`/api/memory?id=${id}`, { method: "DELETE" }).catch(() => {});
  }

  const directives = items.filter((i) => i.kind === "directive");
  const facts = items.filter((i) => i.kind !== "directive");

  const Row = ({ i }: { i: Item }) => (
    <div className="card" style={{ display: "flex", gap: 12, alignItems: "flex-start", justifyContent: "space-between", padding: 14 }}>
      <div>
        <div>{i.fact}</div>
        {i.subject && <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>about: {i.subject}</div>}
      </div>
      <button onClick={() => forget(i.id)} title="Forget this" style={{ background: "none", border: "none", color: "var(--faint)", cursor: "pointer", flexShrink: 0 }}>
        <Trash2 size={16} />
      </button>
    </div>
  );

  return (
    <Shell>
      <div style={{ maxWidth: 760, margin: "0 auto" }}>
        <h1 style={{ display: "flex", alignItems: "center", gap: 10 }}><Brain size={22} /> What I remember</h1>
        <p className="muted" style={{ marginTop: 6 }}>
          Everything Rencontre holds about you. Standing instructions are always applied; facts are recalled when relevant. Tell me &ldquo;remember &hellip;&rdquo; anytime, or remove anything here.
        </p>

        {loading ? (
          <div className="muted" style={{ marginTop: 24, display: "flex", gap: 8, alignItems: "center" }}><Loader2 className="spin" size={16} /> Loading&hellip;</div>
        ) : (
          <>
            <h3 style={{ marginTop: 28 }}>Standing instructions ({directives.length})</h3>
            <div style={{ display: "grid", gap: 8, marginTop: 10 }}>
              {directives.length ? directives.map((i) => <Row key={i.id} i={i} />) : <p className="muted">None yet. Try telling me &ldquo;from now on, always reply short.&rdquo;</p>}
            </div>

            <h3 style={{ marginTop: 28 }}>Facts ({facts.length})</h3>
            <div style={{ display: "grid", gap: 8, marginTop: 10 }}>
              {facts.length ? facts.map((i) => <Row key={i.id} i={i} />) : <p className="muted">Nothing yet. I learn as we talk.</p>}
            </div>
          </>
        )}
      </div>
    </Shell>
  );
}
