// Scheduled-maintenance page served while MAINTENANCE_MODE=1. White editorial
// luxury per JENSEN-DOCTRINE Law 4 and feedback_white_editorial_over_dark.md.
// The portal middleware redirects anonymous traffic here. The WhatsApp bot has
// its own allowlist gate in app/api/whatsapp/route.ts.

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Scheduled upgrade · La Rencontre",
  robots: { index: false, follow: false },
};

export default function MaintenancePage() {
  return (
    <main
      style={{
        minHeight: "100vh",
        background: "#FBF9F4",
        color: "#1A1814",
        display: "grid",
        placeItems: "center",
        padding: "48px 24px",
        fontFamily: "'Inter', system-ui, sans-serif",
      }}
    >
      <link href="https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,400;9..144,500;9..144,600&family=Inter:wght@400;500;600&display=swap" rel="stylesheet" />
      <div
        style={{
          width: "100%",
          maxWidth: 520,
          textAlign: "center",
        }}
      >
        <div
          style={{
            fontFamily: "'Fraunces', Georgia, serif",
            fontWeight: 500,
            fontStyle: "italic",
            fontSize: 22,
            letterSpacing: "0.04em",
            color: "#1A1814",
            marginBottom: 56,
          }}
        >
          La Rencontre
        </div>

        <div
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 8,
            padding: "6px 14px",
            borderRadius: 999,
            border: "1px solid rgba(176,141,87,0.32)",
            background: "rgba(176,141,87,0.07)",
            color: "#7A5C2C",
            fontSize: 11,
            fontWeight: 600,
            letterSpacing: "0.18em",
            textTransform: "uppercase",
          }}
        >
          <span
            aria-hidden
            style={{
              display: "inline-block",
              width: 6,
              height: 6,
              borderRadius: 999,
              background: "#B08D57",
            }}
          />
          Scheduled upgrade
        </div>

        <h1
          style={{
            fontFamily: "'Fraunces', Georgia, serif",
            fontWeight: 500,
            fontSize: "clamp(34px, 5vw, 46px)",
            lineHeight: 1.12,
            letterSpacing: "-0.012em",
            color: "#1A1814",
            margin: "26px 0 18px",
          }}
        >
          Your concierge is being polished.
        </h1>

        <p
          style={{
            fontSize: 16,
            lineHeight: 1.65,
            color: "#4A453E",
            maxWidth: 460,
            margin: "0 auto 36px",
          }}
        >
          Rencontre is in a short training and upgrade window. The portal and the
          WhatsApp line are quiet while we ship a quality pass. Your data is safe,
          your board state is preserved, nothing is lost. We will be back shortly.
        </p>

        <div
          style={{
            display: "grid",
            gap: 10,
            maxWidth: 420,
            margin: "0 auto 32px",
            textAlign: "left",
          }}
        >
          <StatusRow tone="warn" label="Portal" value="Locked, returning when training completes." />
          <StatusRow tone="warn" label="WhatsApp" value="Paused, replying with this notice if you reach out." />
          <StatusRow tone="ok" label="Data" value="Untouched, read and write paused safely." />
        </div>

        <div
          style={{
            fontSize: 13,
            color: "#7A746A",
            paddingTop: 24,
            borderTop: "1px solid rgba(26,24,20,0.08)",
            lineHeight: 1.6,
          }}
        >
          You will receive a note from me the moment we are back online.
          <br />
          For anything urgent in the meantime, please message zanii directly.
        </div>
      </div>
    </main>
  );
}

function StatusRow({ tone, label, value }: { tone: "ok" | "warn"; label: string; value: string }) {
  const dot = tone === "ok" ? "#3F8265" : "#B08D57";
  return (
    <div
      style={{
        display: "flex",
        alignItems: "flex-start",
        gap: 12,
        padding: "12px 14px",
        borderRadius: 14,
        border: "1px solid rgba(26,24,20,0.08)",
        background: "#FFFFFF",
      }}
    >
      <span
        aria-hidden
        style={{
          display: "inline-block",
          width: 7,
          height: 7,
          borderRadius: 999,
          background: dot,
          marginTop: 8,
          flex: "none",
        }}
      />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div
          style={{
            fontSize: 10.5,
            fontWeight: 700,
            letterSpacing: "0.12em",
            textTransform: "uppercase",
            color: "#7A746A",
          }}
        >
          {label}
        </div>
        <div style={{ marginTop: 3, fontSize: 14, lineHeight: 1.45, color: "#1A1814" }}>
          {value}
        </div>
      </div>
    </div>
  );
}
