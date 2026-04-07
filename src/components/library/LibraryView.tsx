// Library view — browsable catalog with track list and artist grid modes
// Data-agnostic: works with test catalog or relay-fetched tracks.

import { useState, useMemo } from "react";
import type {
  LibraryTrack,
  ArtistGroup,
  LibraryView as LibraryViewType,
  SortField,
  SortDirection,
} from "./types";
import { TrackRow } from "./TrackRow";
import { ArtistCard } from "./ArtistCard";
import { ArtistDetail } from "./ArtistDetail";

interface LibraryViewProps {
  tracks: LibraryTrack[];
  loading: boolean;
  activeTrackHash: string | null;
  isPlaying: boolean;
  onPlay: (track: LibraryTrack) => void;
}

export function LibraryView({
  tracks,
  loading,
  activeTrackHash,
  isPlaying,
  onPlay,
}: LibraryViewProps) {
  const [viewMode, setViewMode] = useState<LibraryViewType>("tracks");
  const [sortField, setSortField] = useState<SortField>("artist");
  const [sortDir, setSortDir] = useState<SortDirection>("asc");
  const [search, setSearch] = useState("");
  const [selectedArtist, setSelectedArtist] = useState<ArtistGroup | null>(
    null
  );

  // Filter tracks by search
  const filtered = useMemo(() => {
    if (!search.trim()) return tracks;
    const q = search.toLowerCase();
    return tracks.filter(
      (t) =>
        t.title.toLowerCase().includes(q) ||
        t.artist.toLowerCase().includes(q) ||
        t.album.toLowerCase().includes(q)
    );
  }, [tracks, search]);

  // Sort tracks
  const sorted = useMemo(() => {
    const arr = [...filtered];
    arr.sort((a, b) => {
      let cmp = 0;
      switch (sortField) {
        case "title":
          cmp = a.title.localeCompare(b.title);
          break;
        case "artist":
          cmp =
            a.artist.localeCompare(b.artist) ||
            a.album.localeCompare(b.album) ||
            a.title.localeCompare(b.title);
          break;
        case "album":
          cmp =
            a.album.localeCompare(b.album) || a.title.localeCompare(b.title);
          break;
        case "duration":
          cmp = a.duration - b.duration;
          break;
      }
      return sortDir === "asc" ? cmp : -cmp;
    });
    return arr;
  }, [filtered, sortField, sortDir]);

  // Group tracks by artist
  const artistGroups = useMemo(() => {
    const groups = new Map<string, ArtistGroup>();
    for (const track of filtered) {
      const existing = groups.get(track.artist);
      if (existing) {
        existing.tracks.push(track);
        existing.trackCount++;
        if (!existing.artworkDataUrl && track.artworkDataUrl) {
          existing.artworkDataUrl = track.artworkDataUrl;
        }
      } else {
        groups.set(track.artist, {
          name: track.artist,
          tracks: [track],
          artworkDataUrl: track.artworkDataUrl,
          trackCount: 1,
        });
      }
    }
    return Array.from(groups.values()).sort((a, b) =>
      a.name.localeCompare(b.name)
    );
  }, [filtered]);

  function toggleSort(field: SortField) {
    if (sortField === field) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortField(field);
      setSortDir("asc");
    }
  }

  function sortIndicator(field: SortField): string {
    if (sortField !== field) return "";
    return sortDir === "asc" ? " ↑" : " ↓";
  }

  // Loading state — skeleton rows that match track list layout
  if (loading) {
    return (
      <div className="h-full flex flex-col">
        {/* Toolbar skeleton */}
        <div className="shrink-0 flex items-center gap-3 px-4 py-2 border-b border-border">
          <div className="h-6 w-32 bg-border/50 animate-pulse" />
          <div className="h-6 flex-1 max-w-xs bg-border/50 animate-pulse" />
        </div>
        {/* Column headers */}
        <div className="shrink-0 flex items-center gap-3 px-3 py-1 border-b border-border">
          <span className="font-label-mono text-muted-foreground uppercase tracking-wider w-8 text-right">#</span>
          <span className="font-label-mono text-muted-foreground uppercase tracking-wider flex-1">Title</span>
          <span className="font-label-mono text-muted-foreground uppercase tracking-wider w-12 text-right">Time</span>
          <span className="font-label-mono text-muted-foreground uppercase tracking-wider w-10 text-right">Fmt</span>
        </div>
        {/* Skeleton rows */}
        <div className="flex-1 overflow-hidden">
          {Array.from({ length: 12 }).map((_, i) => (
            <div key={i} className="flex items-center gap-3 px-3 py-1.5 border-b border-border/50">
              <span className="w-8 text-right font-small text-muted-foreground/30">{i + 1}</span>
              <div className="w-8 h-8 bg-border/30 animate-pulse" />
              <div className="flex-1 flex flex-col gap-1">
                <div className="h-3.5 bg-border/40 animate-pulse" style={{ width: `${40 + Math.random() * 30}%` }} />
                <div className="h-3 bg-border/20 animate-pulse" style={{ width: `${20 + Math.random() * 20}%` }} />
              </div>
              <div className="w-12 h-3.5 bg-border/30 animate-pulse" />
              <div className="w-10 h-3.5 bg-border/20 animate-pulse" />
            </div>
          ))}
        </div>
      </div>
    );
  }

  // Artist detail view (drilled in from artist grid)
  if (selectedArtist) {
    return (
      <ArtistDetail
        artist={selectedArtist}
        activeTrackHash={activeTrackHash}
        isPlaying={isPlaying}
        onPlay={onPlay}
        onBack={() => setSelectedArtist(null)}
      />
    );
  }

  return (
    <div className="h-full flex flex-col">
      {/* Toolbar */}
      <div className="shrink-0 flex items-center gap-3 px-4 py-2 border-b border-border">
        {/* View toggle */}
        <div className="flex border border-border">
          <button
            className={`h-6 px-2 font-label-mono text-[10px] uppercase tracking-wider transition-all ${
              viewMode === "tracks"
                ? "bg-amber/10 text-amber border-r border-border"
                : "text-muted-foreground hover:text-foreground border-r border-border"
            }`}
            onClick={() => setViewMode("tracks")}
          >
            Tracks
          </button>
          <button
            className={`h-6 px-2 font-label-mono text-[10px] uppercase tracking-wider transition-all ${
              viewMode === "artists"
                ? "bg-amber/10 text-amber"
                : "text-muted-foreground hover:text-foreground"
            }`}
            onClick={() => setViewMode("artists")}
          >
            Artists
          </button>
        </div>

        {/* Search */}
        <div className="flex-1 max-w-xs">
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search tracks, artists..."
            className="w-full h-6 px-2 bg-transparent border border-border text-foreground font-small focus:border-amber focus:outline-none transition-colors placeholder:text-muted-foreground"
          />
        </div>

        {/* Track count */}
        <span className="font-small text-muted-foreground ml-auto">
          {filtered.length} track{filtered.length !== 1 ? "s" : ""}
          {search && ` matching "${search}"`}
        </span>
      </div>

      {/* Content */}
      {viewMode === "tracks" ? (
        <div className="flex-1 flex flex-col min-h-0">
          {/* Column headers (sortable) */}
          <div className="shrink-0 flex items-center gap-3 px-3 py-1 border-b border-border">
            <span className="font-label-mono text-muted-foreground uppercase tracking-wider w-8 text-right">
              #
            </span>
            <button
              className="font-label-mono text-muted-foreground uppercase tracking-wider flex-1 text-left hover:text-foreground transition-colors"
              onClick={() => toggleSort("title")}
            >
              Title{sortIndicator("title")}
            </button>
            <button
              className="font-label-mono text-muted-foreground uppercase tracking-wider w-12 text-right hover:text-foreground transition-colors"
              onClick={() => toggleSort("duration")}
            >
              Time{sortIndicator("duration")}
            </button>
            <span className="font-label-mono text-muted-foreground uppercase tracking-wider w-10 text-right">
              Fmt
            </span>
          </div>

          {/* Track list */}
          <div className="flex-1 overflow-y-auto">
            {sorted.length === 0 ? (
              <div className="flex items-center justify-center h-32">
                <span className="font-body-mono text-muted-foreground">
                  {search ? "No matches found" : "No tracks in library"}
                </span>
              </div>
            ) : (
              sorted.map((track, i) => (
                <TrackRow
                  key={track.hash}
                  track={track}
                  index={i}
                  isActive={activeTrackHash === track.hash}
                  isPlaying={isPlaying && activeTrackHash === track.hash}
                  showArtist={true}
                  showArtwork={true}
                  onPlay={onPlay}
                />
              ))
            )}
          </div>
        </div>
      ) : (
        /* Artist grid */
        <div className="flex-1 overflow-y-auto p-4">
          {artistGroups.length === 0 ? (
            <div className="flex items-center justify-center h-32">
              <span className="font-body-mono text-muted-foreground">
                {search ? "No artists found" : "No artists in library"}
              </span>
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
              {artistGroups.map((artist) => (
                <ArtistCard
                  key={artist.name}
                  artist={artist}
                  onSelect={setSelectedArtist}
                />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
