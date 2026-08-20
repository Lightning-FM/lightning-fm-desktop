// Artist detail view — shows when you click into an artist from the grid

import { useState } from "react";
import type { ArtistGroup, LibraryTrack } from "./types";
import { TrackRow } from "./TrackRow";
import { TrackDetails } from "./TrackDetails";

interface ArtistDetailProps {
  artist: ArtistGroup;
  activeTrackHash: string | null;
  isPlaying: boolean;
  onPlay: (track: LibraryTrack) => void;
  onBuy?: (track: LibraryTrack) => void;
  onBack: () => void;
}

export function ArtistDetail({
  artist,
  activeTrackHash,
  isPlaying,
  onPlay,
  onBuy,
  onBack,
}: ArtistDetailProps) {
  const [expandedHash, setExpandedHash] = useState<string | null>(null);

  return (
    <div className="h-full flex flex-col">
      {/* Artist header */}
      <div className="shrink-0 border-b border-border">
        <div className="flex items-start gap-4 p-4">
          {/* Back button */}
          <button
            className="font-body-mono text-secondary-foreground hover:text-foreground transition-colors shrink-0 mt-1"
            onClick={onBack}
          >
            ← Back
          </button>

          {/* Artwork */}
          <div className="w-24 h-24 shrink-0 border border-border overflow-hidden bg-[var(--bg-secondary)]">
            {artist.artworkDataUrl ? (
              <img
                src={artist.artworkDataUrl}
                alt={artist.name}
                className="w-full h-full object-cover"
              />
            ) : (
              <div className="w-full h-full flex items-center justify-center">
                <span className="font-display text-muted-foreground opacity-30">♪</span>
              </div>
            )}
          </div>

          {/* Info */}
          <div className="flex-1 min-w-0">
            <div className="font-heading-1 text-foreground truncate">
              {artist.name}
            </div>
            <div className="font-body-mono text-secondary-foreground mt-1">
              {artist.trackCount} track{artist.trackCount !== 1 ? "s" : ""}
            </div>

            {/* Bio — the artist's kind-0 about text */}
            {artist.about && (
              <p className="font-small text-secondary-foreground mt-2 max-w-xl whitespace-pre-line">
                {artist.about}
              </p>
            )}

            {/* Play all button */}
            <button
              className="h-7 px-4 mt-3 border border-amber text-amber font-label-mono uppercase tracking-wider hover:bg-amber/10 transition-all text-[11px]"
              onClick={() => {
                if (artist.tracks.length > 0) onPlay(artist.tracks[0]);
              }}
            >
              ▶ Play All
            </button>
          </div>
        </div>
      </div>

      {/* Track list header */}
      <div className="shrink-0 flex items-center gap-3 px-3 py-1 border-b border-border">
        <span className="font-label-mono text-muted-foreground uppercase tracking-wider w-8 text-right">#</span>
        <span className="font-label-mono text-muted-foreground uppercase tracking-wider flex-1">Title</span>
        <span className="font-label-mono text-muted-foreground uppercase tracking-wider w-12 text-right">Time</span>
        <span className="font-label-mono text-muted-foreground uppercase tracking-wider w-10 text-right">Fmt</span>
        <span className="w-5" />
      </div>

      {/* Track list */}
      <div className="flex-1 overflow-y-auto">
        {artist.tracks.map((track, i) => (
          <div key={track.hash}>
            <TrackRow
              track={track}
              index={i}
              isActive={activeTrackHash === track.hash}
              isPlaying={isPlaying && activeTrackHash === track.hash}
              showArtist={false}
              showArtwork={false}
              onPlay={onPlay}
              onBuy={onBuy}
              expanded={expandedHash === track.hash}
              onToggleExpand={(t) =>
                setExpandedHash((h) => (h === t.hash ? null : t.hash))
              }
            />
            {expandedHash === track.hash && (
              <TrackDetails track={track} onBuy={onBuy} />
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
