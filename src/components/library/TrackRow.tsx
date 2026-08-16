// Single track row — used in both flat track list and artist detail views

import type { LibraryTrack } from "./types";

interface TrackRowProps {
  track: LibraryTrack;
  index: number;
  isActive: boolean;
  isPlaying: boolean;
  showArtist?: boolean;
  showArtwork?: boolean;
  onPlay: (track: LibraryTrack) => void;
  onBuy?: (track: LibraryTrack) => void;
  /** When set, the row grows an expand toggle for a details panel */
  expanded?: boolean;
  onToggleExpand?: (track: LibraryTrack) => void;
}

function formatDuration(secs: number): string {
  if (secs <= 0) return "—:——";
  const m = Math.floor(secs / 60);
  const s = Math.floor(secs % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

// Mime type → short codec label so the column never overflows the row
const FORMAT_LABELS: Record<string, string> = {
  "audio/mpeg": "MP3",
  "audio/mp3": "MP3",
  "audio/mp4": "AAC",
  "audio/aac": "AAC",
  "audio/x-m4a": "M4A",
  "audio/flac": "FLAC",
  "audio/x-flac": "FLAC",
  "audio/wav": "WAV",
  "audio/x-wav": "WAV",
  "audio/ogg": "OGG",
  "audio/opus": "OPUS",
};

export function formatLabel(mime: string): string {
  const key = mime.toLowerCase().split(";")[0].trim();
  if (FORMAT_LABELS[key]) return FORMAT_LABELS[key];
  // Fall back to the mime subtype, clipped to fit the column
  const subtype = key.split("/")[1] ?? key;
  return subtype.toUpperCase().slice(0, 4);
}

export function TrackRow({
  track,
  index,
  isActive,
  isPlaying,
  showArtist = true,
  showArtwork = false,
  onPlay,
  onBuy,
  expanded,
  onToggleExpand,
}: TrackRowProps) {
  return (
    <div
      className={`flex items-center gap-3 px-3 py-2 cursor-pointer transition-all border-b border-border group ${
        isActive ? "bg-amber/10" : "hover:bg-amber/5"
      }`}
      onClick={() => onPlay(track)}
    >
      {/* Track number / play indicator */}
      <span className="font-label-mono text-muted-foreground tabular-nums w-8 text-right shrink-0">
        {isActive && isPlaying ? (
          <span className="text-amber">▶</span>
        ) : isActive ? (
          <span className="text-amber">▮▮</span>
        ) : (
          <span className="group-hover:hidden">{index + 1}</span>
        )}
        {!isActive && (
          <span className="hidden group-hover:inline text-secondary-foreground">▶</span>
        )}
      </span>

      {/* Artwork thumbnail */}
      {showArtwork && (
        <div className="w-8 h-8 shrink-0 border border-border overflow-hidden bg-[var(--bg-secondary)]">
          {track.artworkDataUrl ? (
            <img
              src={track.artworkDataUrl}
              alt=""
              className="w-full h-full object-cover"
            />
          ) : (
            <div className="w-full h-full flex items-center justify-center">
              <span className="font-small text-muted-foreground">♪</span>
            </div>
          )}
        </div>
      )}

      {/* Title + Artist */}
      <div className="flex-1 min-w-0">
        <div className={`font-body-mono truncate ${isActive ? "text-amber" : "text-foreground"}`}>
          {track.title}
        </div>
        {showArtist && (
          <div className="font-small text-secondary-foreground truncate">
            {track.artist}
            {track.album && (
              <span className="text-muted-foreground"> · {track.album}</span>
            )}
          </div>
        )}
      </div>

      {/* Buy chip — present only when the artist sells this track */}
      {track.product && onBuy && (
        <button
          className="h-6 px-2 border border-amber/60 text-amber font-label-mono text-[10px] uppercase tracking-wider hover:bg-amber/10 hover:border-amber transition-all tabular-nums shrink-0"
          onClick={(e) => {
            e.stopPropagation();
            onBuy(track);
          }}
        >
          {track.product.price_sats.toLocaleString()} sats
        </button>
      )}

      {/* Duration */}
      <span className="font-small text-muted-foreground tabular-nums shrink-0">
        {formatDuration(track.duration)}
      </span>

      {/* Format badge */}
      <span className="font-small text-muted-foreground shrink-0 w-10 text-right">
        {formatLabel(track.format)}
      </span>

      {/* Expand toggle */}
      {onToggleExpand && (
        <button
          className={`shrink-0 w-5 font-small transition-colors ${
            expanded ? "text-amber" : "text-muted-foreground hover:text-foreground"
          }`}
          onClick={(e) => {
            e.stopPropagation();
            onToggleExpand(track);
          }}
          aria-label={expanded ? "Collapse track details" : "Expand track details"}
        >
          {expanded ? "▾" : "▸"}
        </button>
      )}
    </div>
  );
}
