"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";

export default function LoginPage() {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setError("");
    const res = await fetch("/api/auth", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ password }),
    });
    const data = await res.json().catch(() => ({}));
    if (data.ok) { router.push("/"); router.refresh(); }
    else { setError(data.error || "Something went wrong."); setBusy(false); }
  }

  return (
    <div className="lr-login">
      <img className="bg" src="/login-3d.png" alt="" />
      <div className="veil" />

      <motion.div
        className="stage"
        initial={{ opacity: 0, y: 18 }} animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.9, ease: [0.16, 1, 0.3, 1] }}
      >
        <motion.img
          src="/larencontre-mark.png" alt="" className="mark"
          initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 1, delay: 0.1, ease: [0.16, 1, 0.3, 1] }}
        />
        <div className="word"><span>LA RENCONTRE</span><span className="portal">PORTAL</span></div>
        <div className="tag">Your chief of staff. Run the whole house from one place.</div>

        <form onSubmit={submit} className="card">
          <label>Passphrase</label>
          <input
            type="password" value={password} autoFocus autoComplete="current-password"
            onChange={(e) => setPassword(e.target.value)} placeholder="••••••••••"
          />
          <button type="submit" disabled={busy}>{busy ? "Opening…" : "Enter"}</button>
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
        .mark{width:74px;height:74px;object-fit:contain;filter:drop-shadow(0 8px 30px rgba(167,139,250,.4));margin-bottom:20px}
        .word{display:flex;flex-direction:column;align-items:center;line-height:1.0;font-family:'Cormorant Garamond',Georgia,serif;font-weight:600;letter-spacing:.16em;font-size:clamp(44px,7vw,72px);color:#f6f4fa}
        .word .portal{font-size:clamp(15px,2.2vw,20px);letter-spacing:.55em;font-weight:500;color:#b3aac6;margin-top:10px;font-family:-apple-system,system-ui,sans-serif;text-indent:.55em}
        .tag{margin-top:16px;color:#a9a2b6;font-size:13.5px;letter-spacing:.02em}
        .card{margin-top:34px;text-align:left;background:rgba(20,18,26,.55);border:1px solid rgba(255,255,255,.1);border-radius:18px;padding:22px;backdrop-filter:blur(16px)}
        .card label{font-size:12px;color:#9a93a8;letter-spacing:.04em;text-transform:uppercase}
        .card input{width:100%;margin-top:9px;background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.12);border-radius:12px;color:#fff;padding:13px 14px;font-size:15px;outline:none;transition:border-color .2s,box-shadow .2s}
        .card input:focus{border-color:rgba(167,139,250,.6);box-shadow:0 0 0 3px rgba(167,139,250,.16)}
        .card button{width:100%;margin-top:16px;height:48px;border:0;border-radius:12px;color:#fff;font-weight:600;font-size:15px;cursor:pointer;
          background:linear-gradient(135deg,#7c6bb0,#5b4b8a);box-shadow:0 14px 34px rgba(124,107,176,.35);transition:transform .18s,box-shadow .18s}
        .card button:hover{transform:translateY(-1px);box-shadow:0 18px 44px rgba(124,107,176,.5)}
        .err{margin-top:12px;color:#f3a5a5;font-size:13px}
        .foot{margin-top:20px;font-size:11.5px;color:#6f6880;letter-spacing:.04em}
      `}</style>
    </div>
  );
}
