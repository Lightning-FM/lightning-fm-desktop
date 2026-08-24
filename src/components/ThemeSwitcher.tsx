import { useId, useState, useSyncExternalStore } from "react";

// Daylight / moonlight / system cycling icon button, ported from the web
// repo's src/components/ThemeSwitcher.tsx (spec: design-system/COMPONENTS.md
// § ThemeSwitcher, DECISIONS.md § Theme). One 44px borderless button whose
// glyph names the state you are ON (not the destination), clicking advances
// daylight → moonlight → system. The accessible name carries both halves:
// "Theme: moonlight. Change to system."
//
// Storage: `lfm-theme` holds the SELECTED value ("daylight" | "moonlight"
// | "system"; absent = system) — never the resolved one, or a system
// user's choice silently freezes at whatever the OS said that day. The
// html class holds the RESOLVED theme; the pre-paint script in index.html
// owns resolving system. In the Tauri WKWebView, prefers-color-scheme is
// backed by the macOS system appearance API, so "system" follows the OS
// live, including flips while the app is open.

export type ThemeChoice = "daylight" | "moonlight" | "system";

const THEME_EVENT = "lfm-theme-change";
const ORDER: ThemeChoice[] = ["daylight", "moonlight", "system"];

export function readSelected(): ThemeChoice {
  try {
    const v = localStorage.getItem("lfm-theme");
    return v === "daylight" || v === "moonlight" ? v : "system";
  } catch {
    return "system";
  }
}

export function subscribe(callback: () => void) {
  window.addEventListener(THEME_EVENT, callback);
  return () => window.removeEventListener(THEME_EVENT, callback);
}

function apply(value: ThemeChoice) {
  try {
    localStorage.setItem("lfm-theme", value);
  } catch {
    // storage unavailable: the theme still switches for this session
  }
  const dark =
    value === "moonlight" ||
    (value === "system" &&
      window.matchMedia("(prefers-color-scheme: dark)").matches);
  // Instant swap — no icon morph or crossfade on top of a palette change
  document.documentElement.classList.toggle("moonlight", dark);
  window.dispatchEvent(new Event(THEME_EVENT));
}

// Glyph geometry is canonical (copied from the reference file, not
// redrawn): three circles, never sun/moon/monitor. fill follows
// currentColor; never amber — amber reads as a selected state here.
function ThemeGlyph({ theme, size, maskId }: { theme: ThemeChoice; size: number; maskId: string }) {
  if (theme === "daylight") {
    return (
      <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
        <circle cx="12" cy="12" r="5.5" fill="currentColor" />
        <rect x="11" y="0" width="2" height="3.5" fill="currentColor" />
        <rect x="11" y="20.5" width="2" height="3.5" fill="currentColor" />
        <rect x="0" y="11" width="3.5" height="2" fill="currentColor" />
        <rect x="20.5" y="11" width="3.5" height="2" fill="currentColor" />
        <rect x="4" y="4" width="2.5" height="2.5" fill="currentColor" />
        <rect x="17.5" y="4" width="2.5" height="2.5" fill="currentColor" />
        <rect x="4" y="17.5" width="2.5" height="2.5" fill="currentColor" />
        <rect x="17.5" y="17.5" width="2.5" height="2.5" fill="currentColor" />
      </svg>
    );
  }
  if (theme === "moonlight") {
    return (
      <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
        <mask id={maskId}>
          <rect width="24" height="24" fill="#fff" />
          <circle cx="18" cy="7" r="8.5" fill="#000" />
        </mask>
        <circle cx="12" cy="12" r="9" fill="currentColor" mask={`url(#${maskId})`} />
      </svg>
    );
  }
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="12" cy="12" r="8" fill="none" stroke="currentColor" strokeWidth="2" />
      <path d="M12 3 A9 9 0 0 0 12 21 Z" fill="currentColor" />
    </svg>
  );
}

export function ThemeSwitcher({ size = 18 }: { size?: number }) {
  const selected = useSyncExternalStore<ThemeChoice>(
    subscribe,
    readSelected,
    () => "system"
  );
  const [announce, setAnnounce] = useState("");
  const maskId = useId();

  const next = ORDER[(ORDER.indexOf(selected) + 1) % ORDER.length];
  const label = `Theme: ${selected}. Change to ${next}.`;

  // Read the live value rather than the render snapshot, so rapid clicks
  // can't advance from a stale state before React re-renders
  function cycle() {
    const target =
      ORDER[(ORDER.indexOf(readSelected()) + 1) % ORDER.length];
    apply(target);
    setAnnounce(`Theme: ${target}.`);
  }

  return (
    <button
      type="button"
      onClick={cycle}
      aria-label={label}
      title={label}
      className="w-11 h-11 flex items-center justify-center cursor-pointer text-[var(--theme-icon)] hover:text-foreground"
    >
      <ThemeGlyph theme={selected} size={size} maskId={maskId} />
      <span aria-live="polite" className="sr-only">
        {announce}
      </span>
    </button>
  );
}
