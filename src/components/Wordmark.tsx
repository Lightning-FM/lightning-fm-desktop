// The Slash mark + lockup (see design-system/BRAND.md). Ported from the
// web repo's src/components/Wordmark.tsx — keep the two in step.
// Inlined rather than loaded from a file so the fill follows currentColor
// and both themes are handled without a second asset. Geometry is
// canonical — never rotate, stretch, or equalise the two widths.

interface SlashMarkProps {
  /** Mark box in px. Lockup rule: wordmark font size × 1.2. */
  box: number;
  className?: string;
}

export function SlashMark({ box, className }: SlashMarkProps) {
  return (
    <svg
      width={box}
      height={box}
      viewBox="0 0 100 100"
      aria-hidden="true"
      className={className}
    >
      <polygon points="7,92 37,8 59,8 29,92" fill="currentColor" />
      <polygon points="45,92 75,8 93,8 63,92" fill="currentColor" />
    </svg>
  );
}

interface WordmarkProps {
  /** Wordmark font size in px; mark box and gap derive from it. */
  size?: number;
  className?: string;
}

// Lockup: mark box = size × 1.2, gap = box × 0.35. The mark's visible left
// edge sits 7 viewBox units in, so the box shifts left by 0.07 × box to
// align the ink — not the bounding box — with the text column below it.
export function Wordmark({ size = 18, className }: WordmarkProps) {
  const box = Math.round(size * 1.2);
  const gap = Math.round(box * 0.35);
  return (
    <span
      className={`inline-flex items-center ${className ?? ""}`}
      style={{ gap, marginLeft: -(box * 0.07) }}
    >
      <SlashMark box={box} />
      <span
        className="font-bold lowercase leading-none"
        style={{
          fontFamily: "var(--font-jetbrains), ui-monospace, monospace",
          fontSize: size,
          letterSpacing: "-0.02em",
        }}
      >
        lightning.fm
      </span>
    </span>
  );
}
