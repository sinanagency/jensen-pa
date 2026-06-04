// La Rencontre brand mark — official logo (Vivek). The artwork is pure black on a
// transparent canvas, so on the dark portal surfaces we invert it to white.
// variant "mark" = the brush emblem alone (nav, compact); "lockup" = emblem + wordmark (login).
// `size` is the rendered HEIGHT in px; width derives from the artwork aspect ratio.

export default function Logo({
  variant = "mark",
  size = 30,
}: {
  variant?: "mark" | "lockup";
  size?: number;
}) {
  const src = variant === "lockup" ? "/lr-lockup.png" : "/lr-emblem.png";
  return (
    <img
      src={src}
      alt="La Rencontre"
      style={{
        height: size,
        width: "auto",
        display: "block",
        objectFit: "contain",
        filter: "invert(1)",
        flex: "none",
      }}
    />
  );
}
