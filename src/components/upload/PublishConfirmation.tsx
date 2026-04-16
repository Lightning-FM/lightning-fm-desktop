// Post-publish confirmation — shows published track details with Nostr event info.
// Displayed after all tracks in a batch have been successfully published.

import type { UploadTrack } from "./types";

interface PublishConfirmationProps {
  tracks: UploadTrack[];
  onUploadMore: () => void;
}

function truncateHash(hash: string, len = 12): string {
  if (hash.length <= len * 2) return hash;
  return `${hash.slice(0, len)}...${hash.slice(-len)}`;
}

function formatDuration(secs: number): string {
  const m = Math.floor(secs / 60);
  const s = Math.floor(secs % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

export function PublishConfirmation({
  tracks,
  onUploadMore,
}: PublishConfirmationProps) {
  return (
    <div className="flex flex-col flex-1 overflow-y-auto">
      {/* Success banner */}
      <div className="shrink-0 px-6 py-6 border-b border-border text-center">
        <div className="font-heading-2 text-[var(--success)] mb-2">
          {tracks.length === 1
            ? "TRACK PUBLISHED"
            : `${tracks.length} TRACKS PUBLISHED`}
        </div>
        <div className="font-body-mono text-secondary-foreground">
          Your music is live on Nostr relays and available via Blossom CDN.
        </div>
      </div>

      {/* Published tracks list */}
      <div className="flex-1 p-6 flex flex-col gap-4">
        {tracks.map((track) => (
          <div
            key={track.id}
            className="border border-border p-4 flex flex-col gap-3"
          >
            {/* Track header */}
            <div className="flex items-start gap-3">
              {/* Artwork thumbnail */}
              {track.artworkDataUrl && (
                <div className="shrink-0 w-12 h-12 border border-border overflow-hidden">
                  <img
                    src={track.artworkDataUrl}
                    alt=""
                    className="w-full h-full object-cover"
                  />
                </div>
              )}
              <div className="flex-1 min-w-0">
                <div className="font-body-mono text-foreground truncate">
                  {track.title}
                </div>
                {track.artist && (
                  <div className="font-small text-secondary-foreground">
                    {track.artist}
                  </div>
                )}
                <div className="font-small text-muted-foreground">
                  {formatDuration(track.duration)} · {track.format}
                </div>
              </div>
              <div className="shrink-0">
                <span className="font-label-mono text-[var(--success)] text-[11px] uppercase tracking-wider">
                  Live
                </span>
              </div>
            </div>

            {/* Event details */}
            <div className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 pl-0.5">
              {track.eventId && (
                <>
                  <span className="font-label-mono text-muted-foreground uppercase tracking-wider text-[10px]">
                    Event ID
                  </span>
                  <span className="font-small text-secondary-foreground tabular-nums select-all">
                    {truncateHash(track.eventId)}
                  </span>
                </>
              )}
              {track.sha256 && (
                <>
                  <span className="font-label-mono text-muted-foreground uppercase tracking-wider text-[10px]">
                    SHA-256
                  </span>
                  <span className="font-small text-secondary-foreground tabular-nums select-all">
                    {truncateHash(track.sha256)}
                  </span>
                </>
              )}
              {track.audioUrl && (
                <>
                  <span className="font-label-mono text-muted-foreground uppercase tracking-wider text-[10px]">
                    Blossom URL
                  </span>
                  <span className="font-small text-secondary-foreground truncate select-all">
                    {track.audioUrl}
                  </span>
                </>
              )}
              {track.artistNpub && (
                <>
                  <span className="font-label-mono text-muted-foreground uppercase tracking-wider text-[10px]">
                    Artist
                  </span>
                  <span className="font-small text-secondary-foreground tabular-nums select-all">
                    {truncateHash(track.artistNpub, 8)}
                  </span>
                </>
              )}
            </div>

            {/* Nostr event kind note */}
            <div className="font-small text-muted-foreground border-t border-border pt-2">
              Published as Nostr kind 31337 (addressable music event)
            </div>
          </div>
        ))}
      </div>

      {/* Footer */}
      <div className="shrink-0 px-6 py-4 border-t border-border flex items-center justify-center gap-4">
        <button
          className="h-9 px-6 border border-amber text-amber font-label-mono uppercase tracking-wider hover:bg-amber/10 transition-all text-[11px]"
          onClick={onUploadMore}
        >
          Upload More Tracks
        </button>
      </div>
    </div>
  );
}
