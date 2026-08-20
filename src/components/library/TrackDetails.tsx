// Expanded track details — description, video, purchase-vs-free clarity,
// and file facts. Shared by the flat track list and the artist detail view.

import type { LibraryTrack } from "./types";
import { formatLabel } from "./TrackRow";

function formatFileSize(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${bytes} B`;
}

/** What a purchase delivers, from the product listing. */
function purchaseContents(track: LibraryTrack): string | null {
  const product = track.product;
  if (!product) return null;
  if (product.summary) return product.summary;
  if (product.format) return `${product.format.toUpperCase()} download`;
  return "download";
}

/** The extra file facts a track can reveal, beyond what its row already shows */
function trackFacts(track: LibraryTrack): { label: string; value: string }[] {
  const details: { label: string; value: string }[] = [];
  details.push({ label: "Format", value: formatLabel(track.format) });
  if (track.fileSize) details.push({ label: "Size", value: formatFileSize(track.fileSize) });
  if (track.eventId) details.push({ label: "Event", value: track.eventId.slice(0, 16) + "…" });
  if (track.hash) details.push({ label: "Audio hash", value: track.hash.slice(0, 16) + "…" });
  return details;
}

interface TrackDetailsProps {
  track: LibraryTrack;
  onBuy?: (track: LibraryTrack) => void;
}

export function TrackDetails({ track, onBuy }: TrackDetailsProps) {
  const includes = purchaseContents(track);
  // Track description, falling back to the listing's long-form description
  // when the track event has none
  const description = track.description || track.product?.description || null;

  return (
    <div className="px-14 py-3 border-b border-border bg-amber/5 flex flex-col gap-3">
      {/* The artist's description of the track */}
      {description && (
        <p className="font-small text-secondary-foreground max-w-xl whitespace-pre-line">
          {description}
        </p>
      )}

      {/* Music video, when the track publishes one */}
      {track.videoUrl && (
        <div className="max-w-xl">
          <div className="font-label-mono text-muted-foreground uppercase tracking-wider text-[10px] mb-1">
            Music video
          </div>
          <video
            src={track.videoUrl}
            controls
            preload="metadata"
            playsInline
            className="w-full border border-border bg-black"
          />
        </div>
      )}

      {/* Free stream vs paid download */}
      <div className="font-small text-secondary-foreground max-w-xl">
        {track.product && includes ? (
          <>
            <span>
              Streaming is free for everyone. Buying this track gets you the{" "}
              {includes}, paid straight to the artist over Lightning.
            </span>
            {onBuy && (
              <button
                className="ml-3 h-6 px-2 border border-amber/60 text-amber font-label-mono text-[10px] uppercase tracking-wider hover:bg-amber/10 hover:border-amber transition-all tabular-nums align-middle"
                onClick={(e) => {
                  e.stopPropagation();
                  onBuy(track);
                }}
              >
                Buy · {track.product.price_sats.toLocaleString()} sats
              </button>
            )}
          </>
        ) : (
          <span className="text-muted-foreground">
            Streaming is free. No download is for sale for this track.
          </span>
        )}
      </div>

      {/* File facts */}
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-0.5">
        {trackFacts(track).map(({ label, value }) => (
          <div key={label} className="contents">
            <dt className="font-label-mono text-muted-foreground uppercase tracking-wider text-[10px] pt-0.5">
              {label}
            </dt>
            <dd className="font-small text-secondary-foreground tabular-nums">
              {value}
            </dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
