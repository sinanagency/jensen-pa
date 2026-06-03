// La Rencontre brand mark — serif emblem (blueprint pick C). Inline SVG so it is
// crisp at any size and inherits the loaded serif (--font-serif, Cormorant).
// variant "mark" = the emblem alone (nav); "lockup" = emblem + wordmark (login).

export default function Logo({
  variant = "mark",
  size = 30,
}: {
  variant?: "mark" | "lockup";
  size?: number;
}) {
  const id = "lrg"; // gradient id
  const emblem = (
    <svg width={size} height={size} viewBox="0 0 44 44" fill="none" aria-hidden style={{ flex: "none" }}>
      <defs>
        <linearGradient id={id} x1="6" y1="6" x2="38" y2="40" gradientUnits="userSpaceOnUse">
          <stop stopColor="#efeaf8" />
          <stop offset="0.55" stopColor="#cdc3e6" />
          <stop offset="1" stopColor="#a99fd0" />
        </linearGradient>
      </defs>
      {/* hairline ring */}
      <circle cx="22" cy="22" r="20.5" stroke="rgba(169,159,208,0.5)" strokeWidth="1" />
      <circle cx="22" cy="22" r="17" stroke="rgba(255,255,255,0.08)" strokeWidth="1" />
      {/* serif initials */}
      <text
        x="22" y="29.5" textAnchor="middle"
        fontFamily="var(--font-serif), 'Cormorant Garamond', Georgia, serif"
        fontSize="20" fontWeight={600} letterSpacing="0.5"
        fill={`url(#${id})`}
      >
        LR
      </text>
    </svg>
  );

  if (variant === "mark") return emblem;

  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 14 }}>
      <svg width={92} height={92} viewBox="0 0 44 44" fill="none" aria-hidden style={{ filter: "drop-shadow(0 8px 30px rgba(167,139,250,0.35))" }}>
        <defs>
          <linearGradient id="lrg-lg" x1="6" y1="6" x2="38" y2="40" gradientUnits="userSpaceOnUse">
            <stop stopColor="#f6f2ff" />
            <stop offset="0.55" stopColor="#d4cbeb" />
            <stop offset="1" stopColor="#a99fd0" />
          </linearGradient>
        </defs>
        <circle cx="22" cy="22" r="20.5" stroke="rgba(169,159,208,0.55)" strokeWidth="0.9" />
        <circle cx="22" cy="22" r="17" stroke="rgba(255,255,255,0.1)" strokeWidth="0.9" />
        <text x="22" y="29.5" textAnchor="middle" fontFamily="var(--font-serif), 'Cormorant Garamond', Georgia, serif" fontSize="20" fontWeight={600} letterSpacing="0.5" fill="url(#lrg-lg)">LR</text>
      </svg>
    </div>
  );
}
