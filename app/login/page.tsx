"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import Logo from "@/components/Logo";

type Mode = "signin" | "register";

export default function LoginPage() {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>("signin");
  const [canRegister, setCanRegister] = useState(false);

  const [identifier, setIdentifier] = useState("");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    fetch("/api/auth")
      .then((r) => r.json())
      .then((d) => setCanRegister(!!d.canRegister))
      .catch(() => {});
  }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    const payload =
      mode === "register"
        ? { action: "register", name, email, password }
        : { action: "login", identifier, password };
    const res = await fetch("/api/auth", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = await res.json().catch(() => ({}));
    if (data.ok) {
      router.push("/");
      router.refresh();
    } else {
      setError(data.error || "Something went wrong.");
      setBusy(false);
    }
  }

  return (
    <div className="lr-login">
      <video className="bg" autoPlay muted loop playsInline poster="/login-bg-poster.jpg">
        <source src="/login-bg.mp4" type="video/mp4" />
      </video>
      <div className="veil" />

      <motion.div
        className="stage"
        initial={{ opacity: 0, y: 18 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.9, ease: [0.16, 1, 0.3, 1] }}
      >
        <motion.div
          className="mark"
          initial={{ opacity: 0, scale: 0.96 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 1, delay: 0.1, ease: [0.16, 1, 0.3, 1] }}
        >
          <Logo variant="lockup" size={52} />
        </motion.div>
        <div className="portal">PORTAL</div>
        <div className="tag">Your private concierge. Run the whole house from one place.</div>

        <form onSubmit={submit} className="card">
          {canRegister && (
            <div className="tabs">
              <button type="button" className={mode === "signin" ? "on" : ""} onClick={() => { setMode("signin"); setError(""); }}>
                Sign in
              </button>
              <button type="button" className={mode === "register" ? "on" : ""} onClick={() => { setMode("register"); setError(""); }}>
                Create account
              </button>
            </div>
          )}

          {mode === "register" ? (
            <>
              <label>Your name</label>
              <input value={name} autoFocus onChange={(e) => setName(e.target.value)} placeholder="Jensen" autoComplete="name" />
              <label>Email</label>
              <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@larencontre.ae" autoComplete="email" />
              <label>Choose a password</label>
              <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="At least 8 characters" autoComplete="new-password" />
            </>
          ) : (
            <>
              <label>Email or name</label>
              <input value={identifier} autoFocus onChange={(e) => setIdentifier(e.target.value)} placeholder="you@larencontre.ae" autoComplete="username" />
              <label>Password</label>
              <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="••••••••" autoComplete="current-password" />
            </>
          )}

          <button type="submit" className="go" disabled={busy}>
            {busy ? (mode === "register" ? "Creating…" : "Opening…") : mode === "register" ? "Create account" : "Enter"}
          </button>
          {error && <div className="err">{error}</div>}
        </form>
        <div className="foot">Private workspace · La Rencontre</div>
      </motion.div>

      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Cormorant+Garamond:wght@500;600&display=swap');
        .lr-login{position:fixed;inset:0;overflow:hidden;display:grid;place-items:center;background:#08070a;color:#fff;font-family:var(--font-body,system-ui)}
        .bg{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;object-position:center;filter:saturate(118%) brightness(1.14);z-index:0}
        .veil{position:absolute;inset:0;z-index:1;background:radial-gradient(42% 46% at 50% 46%,rgba(8,7,10,.74),rgba(8,7,10,.32) 70%,rgba(8,7,10,.12))}
        .stage{position:relative;z-index:2;text-align:center;width:min(420px,90vw)}
        .mark{display:inline-flex;margin-bottom:14px;filter:drop-shadow(0 10px 34px rgba(167,139,250,.30))}
        .portal{font-size:clamp(13px,2vw,15px);letter-spacing:.55em;font-weight:500;color:#b3aac6;font-family:-apple-system,system-ui,sans-serif;text-indent:.55em}
        .tag{margin-top:14px;color:#a9a2b6;font-size:13.5px;letter-spacing:.02em}
        .card{margin-top:30px;text-align:left;background:rgba(20,18,26,.55);border:1px solid rgba(255,255,255,.1);border-radius:18px;padding:22px;backdrop-filter:blur(16px)}
        .tabs{display:grid;grid-template-columns:1fr 1fr;gap:6px;background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.08);border-radius:12px;padding:4px;margin-bottom:18px}
        .tabs button{height:34px;border:0;border-radius:9px;background:transparent;color:#9a93a8;font-size:13px;font-weight:600;cursor:pointer;transition:all .18s}
        .tabs button.on{background:rgba(255,255,255,.10);color:#fff}
        .card label{display:block;font-size:12px;color:#9a93a8;letter-spacing:.04em;text-transform:uppercase;margin-top:14px}
        .card label:first-of-type{margin-top:0}
        .card input{width:100%;margin-top:8px;background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.12);border-radius:12px;color:#fff;padding:13px 14px;font-size:15px;outline:none;transition:border-color .2s,box-shadow .2s}
        .card input:focus{border-color:rgba(167,139,250,.6);box-shadow:0 0 0 3px rgba(167,139,250,.16)}
        .card .go{width:100%;margin-top:18px;height:48px;border:0;border-radius:12px;color:#fff;font-weight:600;font-size:15px;cursor:pointer;
          background:linear-gradient(135deg,#7c6bb0,#5b4b8a);box-shadow:0 14px 34px rgba(124,107,176,.35);transition:transform .18s,box-shadow .18s}
        .card .go:hover{transform:translateY(-1px);box-shadow:0 18px 44px rgba(124,107,176,.5)}
        .card .go:disabled{opacity:.7;cursor:default;transform:none}
        .err{margin-top:12px;color:#f3a5a5;font-size:13px}
        .foot{margin-top:20px;font-size:11.5px;color:#6f6880;letter-spacing:.04em}
      `}</style>
    </div>
  );
}
