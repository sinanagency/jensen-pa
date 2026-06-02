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
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ password }),
    });
    const data = await res.json().catch(() => ({}));
    if (data.ok) { router.push("/"); router.refresh(); }
    else { setError(data.error || "Something went wrong."); setBusy(false); }
  }

  return (
    <div className="login">
      <div className="login-stage">
        <div className="aura a1" /><div className="aura a2" />
        <motion.div
          className="orb stage-orb"
          animate={{ scale: [1, 1.05, 1], opacity: [0.9, 1, 0.9] }}
          transition={{ duration: 6, repeat: Infinity, ease: "easeInOut" }}
        />
        <motion.div
          initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8, ease: [0.22, 1, 0.36, 1] }}
          className="stage-copy"
        >
          <img src="/wordmark.svg" alt="La Rencontre" className="stage-word" />
          <h2>Good to see you.<br /><span className="accent">Let us run today.</span></h2>
          <p>Your chief of staff has been keeping watch. Sign in and I will show you what matters.</p>
        </motion.div>
        <div className="stage-foot">Private workspace · La Rencontre Hospitality</div>
      </div>

      <div className="login-aside">
        <motion.form
          onSubmit={submit} className="login-card card"
          initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, delay: 0.15, ease: [0.22, 1, 0.36, 1] }}
        >
          <img src="/monogram.svg" alt="" width={44} height={44} />
          <h1>Welcome back</h1>
          <p className="muted" style={{ marginTop: 6, fontSize: 14 }}>Enter your passphrase to continue.</p>
          <label style={{ display: "block", margin: "22px 0 8px" }}>Passphrase</label>
          <input
            type="password" value={password} autoFocus autoComplete="current-password"
            onChange={(e) => setPassword(e.target.value)} placeholder="••••••••••"
          />
          <button className="btn purple full" type="submit" disabled={busy} style={{ marginTop: 18 }}>
            {busy ? "Opening…" : "Enter"}
          </button>
          {error && <div className="err">{error}</div>}
          <div className="login-foot">Holds confidential business data. Do not share access.</div>
        </motion.form>
      </div>

      <style>{`
        .login { display: grid; grid-template-columns: 1.15fr 1fr; min-height: 100vh; }
        .login-stage { position: relative; overflow: hidden; display: flex; flex-direction: column;
          justify-content: center; padding: 64px; background: radial-gradient(120% 120% at 20% 10%, #16121f 0%, #0a0a0c 55%); }
        .aura { position: absolute; border-radius: 50%; filter: blur(80px); opacity: 0.5; }
        .a1 { width: 460px; height: 460px; background: rgba(139,92,246,0.35); top: -120px; left: -80px; }
        .a2 { width: 380px; height: 380px; background: rgba(109,40,217,0.30); bottom: -120px; right: -60px; }
        .stage-orb { width: 86px; height: 86px; margin-bottom: 30px; }
        .stage-copy { position: relative; z-index: 2; max-width: 460px; }
        .stage-word { width: 320px; max-width: 70%; margin-bottom: 30px; opacity: 0.96; }
        .stage-copy h2 { font-family: var(--font-display); font-size: 38px; line-height: 1.08; letter-spacing: -0.02em; }
        .stage-copy p { color: var(--ink-2); margin-top: 16px; font-size: 16px; line-height: 1.6; max-width: 400px; }
        .stage-foot { position: absolute; bottom: 36px; left: 64px; font-size: 12px; color: var(--faint); letter-spacing: 0.04em; z-index: 2; }
        .login-aside { display: flex; align-items: center; justify-content: center; padding: 40px; background: var(--bg); }
        .login-card { width: 100%; max-width: 380px; padding: 36px 32px; }
        .login-card h1 { font-size: 28px; margin-top: 18px; }
        .login-foot { margin-top: 18px; font-size: 11.5px; color: var(--faint); }
        @media (max-width: 900px) { .login { grid-template-columns: 1fr; } .login-stage { display: none; } }
      `}</style>
    </div>
  );
}
