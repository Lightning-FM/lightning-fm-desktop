// Artist card — displayed in the artist grid view

import type { ArtistGroup } from "./types";

interface ArtistCardProps {
  artist: ArtistGroup;
  onSelect: (artist: ArtistGroup) => void;
}

export function ArtistCard({ artist, onSelect }: ArtistCardProps) {
  return (
    <div
      className="border border-border cursor-pointer transition-all hover:border-[var(--text-muted)] group"
      onClick={() => onSelect(artist)}
    >
      {/* Artwork */}
      <div className="aspect-square border-b border-border overflow-hidden bg-[var(--bg-secondary)]">
        {artist.artworkDataUrl ? (
          <img
            src={artist.artworkDataUrl}
            alt={artist.name}
            className="w-full h-full object-cover group-hover:opacity-80 transition-opacity"
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center">
            <span className="font-display text-muted-foreground opacity-30">♪</span>
          </div>
        )}
      </div>

      {/* Info */}
      <div className="p-3">
        <div className="font-body-mono text-foreground truncate group-hover:text-amber transition-colors">
          {artist.name}
        </div>
        <div className="font-small text-muted-foreground">
          {artist.trackCount} track{artist.trackCount !== 1 ? "s" : ""}
        </div>
      </div>
    </div>
  );
}
