import { memo } from "react";
import type { LibraryTrack } from "../library";
import type { StreamSession } from "../../types/streaming";

interface PlayerBarProps {
  activeTrack: LibraryTrack;
  isPlaying: boolean;
  currentTime: number;
  duration: number;
  session: StreamSession | null;
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
  session,
  onTogglePlayPause,
  onSeek,
  onPrevTrack,
  onNextTrack,
  formatTime,
}: PlayerBarProps) {
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
          {session && (
            <span className="text-amber ml-2">&#9889; 100 sats/min</span>
          )}
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
          {isPlaying ? "\u25AE\u25AE" : "\u25B6"}
        </button>
        <button
          className="font-body-mono text-secondary-foreground hover:text-foreground"
          onClick={onNextTrack}
        >&#9656;&#9656;</button>
      </div>

      {/* Progress bar */}
      <div className="flex-1 flex items-center gap-2">
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

      {/* Boost button */}
      <button className="h-8 px-3 border border-amber text-amber font-label-mono uppercase tracking-wider hover:bg-amber/10 transition-all">
        &#9889; Boost
      </button>
    </div>
  );
});
