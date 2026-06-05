"use client";

import Shell from "@/components/Shell";
import { useState } from "react";
import {
  FileText,
  Download,
  Loader2,
  FileSignature,
  ChefHat,
  ClipboardList,
  Coins,
  Mail,
  Lightbulb,
} from "lucide-react";

type DocTypeId = "proposal" | "concept" | "menu" | "sop" | "cost" | "letter";

type DocType = {
  id: DocTypeId;
  label: string;
  description: string;
  icon: React.ReactNode;
};

const DOC_TYPES: DocType[] = [
  {
    id: "proposal",
    label: "Consulting proposal",
    description: "A client-ready proposal with scope, phases, and pricing",
    icon: <FileSignature size={20} />,
  },
  {
    id: "concept",
    label: "Venue concept",
    description: "Positioning, experience, target guest, signature ideas",
    icon: <Lightbulb size={20} />,
  },
  {
    id: "menu",
    label: "Menu engineering",
    description: "Structure, signature dishes, pricing logic, margins",
    icon: <ChefHat size={20} />,
  },
  {
    id: "sop",
    label: "SOP outline",
    description: "Standard operating procedures for a venue",
    icon: <ClipboardList size={20} />,
  },
  {
    id: "cost",
    label: "Cost strategy",
    description: "Cost and margin optimization brief",
    icon: <Coins size={20} />,
  },
  {
    id: "letter",
    label: "Formal letter",
    description: "A professional letter or note",
    icon: <Mail size={20} />,
  },
];

export default function GeneratePage() {
  const [selectedType, setSelectedType] = useState<string>("proposal");
  const [title, setTitle] = useState<string>("");
  const [details, setDetails] = useState<string>("");
  const [busy, setBusy] = useState<boolean>(false);
  const [err, setErr] = useState<string>("");

  async function handleGenerate(): Promise<void> {
    if (!title.trim() || !details.trim()) return;
    setBusy(true);
    setErr("");
    try {
      const res = await fetch("/api/generate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ type: selectedType, title: title.trim(), details: details.trim() }),
      });

      const ct = res.headers.get("content-type");

      if (ct?.includes("application/json")) {
        const j = await res.json();
        setErr(j.error ?? "Something went wrong.");
        return;
      }

      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      if (ct?.includes("pdf")) {
        a.download = `${title.trim()}.pdf`;
        a.style.display = "none";
        document.body.appendChild(a);
        a.click();
        a.remove();
      } else {
        window.open(url, "_blank");
      }
      // Defer revoke: revoking synchronously kills the opened tab / races the download.
      setTimeout(() => URL.revokeObjectURL(url), 60000);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Network error. Please try again.";
      setErr(msg);
    } finally {
      setBusy(false);
    }
  }

  const canGenerate = title.trim().length > 0 && details.trim().length > 0 && !busy;

  return (
    <Shell>
      <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>

      {/* Page hero */}
      <div className="page-hero fade-up">
        <div className="eyebrow">Generate</div>
        <h1>Draft it in minutes, not weeks.</h1>
        <p
          className="muted"
          style={{ marginTop: 8, fontSize: 14, lineHeight: 1.65, maxWidth: 560 }}
        >
          Tell me the document and the details. I produce a branded La Rencontre PDF you can
          send.
        </p>
      </div>

      {/* Doc type grid */}
      <div className="grid cols-3 fade-up" style={{ marginBottom: 24 }}>
        {DOC_TYPES.map((doc) => {
          const isSelected = selectedType === doc.id;
          return (
            <div
              key={doc.id}
              className={isSelected ? "card feature" : "card"}
              style={{
                padding: 20,
                cursor: "pointer",
                position: "relative",
                userSelect: "none",
              }}
              onClick={() => setSelectedType(doc.id)}
              role="button"
              tabIndex={0}
              onKeyDown={(e: React.KeyboardEvent<HTMLDivElement>) => {
                if (e.key === "Enter" || e.key === " ") setSelectedType(doc.id);
              }}
            >
              {/* Check indicator */}
              {isSelected && (
                <div
                  style={{
                    position: "absolute",
                    top: 14,
                    right: 14,
                    width: 18,
                    height: 18,
                    borderRadius: "50%",
                    background: "var(--purple)",
                    display: "grid",
                    placeItems: "center",
                  }}
                >
                  <svg
                    width="10"
                    height="10"
                    viewBox="0 0 10 10"
                    fill="none"
                    style={{ display: "block" }}
                  >
                    <path
                      d="M2 5l2 2 4-4"
                      stroke="#fff"
                      strokeWidth="1.5"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                </div>
              )}

              <div
                style={{
                  color: isSelected ? "var(--purple-2)" : "var(--muted)",
                  marginBottom: 10,
                  transition: "color 0.2s",
                }}
              >
                {doc.icon}
              </div>

              <div
                style={{
                  fontWeight: 700,
                  fontSize: 14,
                  marginBottom: 5,
                  paddingRight: isSelected ? 24 : 0,
                  color: isSelected ? "var(--ink)" : "var(--ink-2)",
                }}
              >
                {doc.label}
              </div>

              <div
                className="muted"
                style={{ fontSize: 12.5, lineHeight: 1.5 }}
              >
                {doc.description}
              </div>
            </div>
          );
        })}
      </div>

      {/* Form card */}
      <div className="card fade-up" style={{ padding: 28, marginBottom: 8 }}>
        <div style={{ marginBottom: 18 }}>
          <label htmlFor="gen-title" style={{ display: "block", marginBottom: 6 }}>
            Document title
          </label>
          <input
            id="gen-title"
            className="input"
            type="text"
            placeholder="e.g. Al Manara Concept Proposal"
            value={title}
            disabled={busy}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => setTitle(e.target.value)}
          />
        </div>

        <div style={{ marginBottom: 22 }}>
          <label htmlFor="gen-details" style={{ display: "block", marginBottom: 6 }}>
            Brief and details
          </label>
          <textarea
            id="gen-details"
            className="input"
            rows={7}
            placeholder="Client name, cuisine, location, target market, budget, anything relevant."
            value={details}
            disabled={busy}
            onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setDetails(e.target.value)}
            style={{ resize: "vertical", lineHeight: 1.6 }}
          />
        </div>

        <button
          className="btn purple"
          onClick={handleGenerate}
          disabled={!canGenerate}
          style={{
            minWidth: 180,
            opacity: canGenerate ? 1 : 0.45,
            cursor: canGenerate ? "pointer" : "not-allowed",
            gap: 10,
          }}
        >
          {busy ? (
            <>
              <Loader2
                size={16}
                style={{ animation: "spin 0.9s linear infinite", flexShrink: 0 }}
              />
              Drafting your document…
            </>
          ) : (
            <>
              <FileText size={16} />
              Generate
              <Download size={14} style={{ opacity: 0.7 }} />
            </>
          )}
        </button>

        {err && <div className="err">{err}</div>}

        <div
          className="faint"
          style={{ marginTop: 14, fontSize: 12.5, lineHeight: 1.5 }}
        >
          Produced by your mentor, grounded in La Rencontre house style.
        </div>
      </div>
    </Shell>
  );
}
