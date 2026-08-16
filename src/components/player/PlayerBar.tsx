import { memo, useEffect, useRef, useState } from "react";
import type { LibraryTrack } from "../library";
import { PlayerWaveform } from "./PlayerWaveform";

interface PlayerBarProps {
  activeTrack: LibraryTrack;
  isPlaying: boolean;
  currentTime: number;
  duration: number;
  onTogglePlayPause: () => void;
  onSeek: (e: React.MouseEvent<HTMLDivElement>) => void;
  onPrevTrack: () => void;
  onNextTrack: () => void;
  formatTime: (secs: number) => string;
}

export const PlayerBar = memo(function PlayerBar({
  activeTrack,
  isPlaying,
  currentTime,
  duration,
  onTogglePlayPause,
  onSeek,
  onPrevTrack,
  onNextTrack,
  formatTime,
}: PlayerBarProps) {
  const [boostTipOpen, setBoostTipOpen] = useState(false);
  const boostRef = useRef<HTMLDivElement>(null);

  // Dismiss the boost tooltip on outside click or after a beat
  useEffect(() => {
    if (!boostTipOpen) return;
    function handleClickOutside(e: MouseEvent) {
      if (boostRef.current && !boostRef.current.contains(e.target as Node)) {
        setBoostTipOpen(false);
      }
    }
    const timer = window.setTimeout(() => setBoostTipOpen(false), 8000);
    document.addEventListener("mousedown", handleClickOutside);
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [boostTipOpen]);

  return (
    <div className="shrink-0 h-16 border-t border-border bg-card flex items-center px-4 gap-4">
      {/* Artwork thumbnail */}
      <div className="w-10 h-10 shrink-0 border border-border overflow-hidden bg-[var(--bg-secondary)]">
        {activeTrack.artworkDataUrl ? (
          <img src={activeTrack.artworkDataUrl} alt="" className="w-full h-full object-cover" />
        ) : (
          <div className="w-full h-full flex items-center justify-center">
            <span className="font-small text-muted-foreground">&#9835;</span>
          </div>
        )}
      </div>

      {/* Track info */}
      <div className="w-64 min-w-0">
        <div className="font-body-mono text-foreground truncate">{activeTrack.title}</div>
        <div className="font-small text-secondary-foreground truncate">
          {activeTrack.artist}
        </div>
      </div>

      {/* Transport controls */}
      <div className="flex items-center gap-3">
        <button
          className="font-body-mono text-secondary-foreground hover:text-foreground"
          onClick={onPrevTrack}
        >&#9666;&#9666;</button>
        <button
          className="w-8 h-8 flex items-center justify-center bg-primary text-primary-foreground font-body-mono"
          onClick={onTogglePlayPause}
        >
          {isPlaying ? "▮▮" : "▶"}
        </button>
        <button
          className="font-body-mono text-secondary-foreground hover:text-foreground"
          onClick={onNextTrack}
        >&#9656;&#9656;</button>
      </div>

      {/* Progress bar */}
      <div className="flex-1 flex items-center gap-2 min-w-0">
        <span className="font-small text-muted-foreground tabular-nums w-10 text-right">
          {formatTime(currentTime)}
        </span>
        <div
          className="flex-1 h-1 bg-border cursor-pointer relative"
          onClick={onSeek}
        >
          <div
            className="h-full bg-amber absolute left-0 top-0"
            style={{ width: `${duration ? (currentTime / duration) * 100 : 0}%` }}
          />
        </div>
        <span className="font-small text-muted-foreground tabular-nums w-10">
          {formatTime(duration)}
        </span>
      </div>

      {/* Waveform — true peaks of the playing track, seekable */}
      <PlayerWaveform
        cachePath={activeTrack.cachePath}
        trackHash={activeTrack.hash}
        currentTime={currentTime}
        duration={duration}
        onSeek={onSeek}
      />

      {/* Boost button — zaps, coming soon */}
      <div className="relative shrink-0" ref={boostRef}>
        {boostTipOpen && (
          <div className="absolute bottom-full right-0 mb-2 w-72 border border-amber/60 bg-card p-3 z-50 amber-glow-subtle">
            <div className="font-label-mono text-amber uppercase tracking-wider text-[10px] mb-1">
              Boost — coming soon
            </div>
            <p className="font-small text-secondary-foreground leading-relaxed">
              Send an instant Lightning tip (a zap) to the artist while you
              listen. It goes straight from your wallet to theirs — we
              can&apos;t take a cut even if we wanted to. Boosts tell an
              artist, in money, that this track matters.
            </p>
          </div>
        )}
        <button
          className="h-8 px-3 border border-amber text-amber font-label-mono uppercase tracking-wider hover:bg-amber/10 transition-all"
          onClick={() => setBoostTipOpen((v) => !v)}
        >
          &#9889; Boost
        </button>
      </div>
    </div>
  );
});
