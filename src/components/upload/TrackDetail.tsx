// Center pane — metadata editing form for the selected track

import { useState } from "react";
import type { UploadTrack } from "./types";
import { Waveform } from "./Waveform";

interface TrackDetailProps {
  track: UploadTrack;
  onUpdate: (updates: Partial<UploadTrack>) => void;
}

// Genres matching common music platform taxonomies
const GENRES = [
  "Alternative",
  "Ambient",
  "Blues",
  "Classical",
  "Country",
  "Electronic",
  "Experimental",
  "Folk",
  "Funk",
  "Hip-Hop/Rap",
  "Indie",
  "Jazz",
  "Metal",
  "Pop",
  "Punk",
  "R&B/Soul",
  "Reggae",
  "Rock",
  "World",
  "Other",
];

export function TrackDetail({ track, onUpdate }: TrackDetailProps) {
  const [showCredits, setShowCredits] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);

  return (
    <div className="flex flex-col h-full overflow-y-auto">
      {/* Header */}
      <div className="shrink-0 px-4 py-2 border-b border-border">
        <span className="font-label-mono text-muted-foreground uppercase tracking-wider">
          Track Detail
        </span>
      </div>

      <div className="flex-1 p-4 flex flex-col gap-4">
        {/* Title */}
        <Field label="Title">
          <input
            type="text"
            value={track.title}
            onChange={(e) => onUpdate({ title: e.target.value })}
            placeholder="Track title"
            className="w-full h-8 px-2 bg-transparent border border-border text-foreground font-body-mono focus:border-amber focus:outline-none transition-colors"
          />
        </Field>

        {/* Artist */}
        <Field label="Artist">
          <input
            type="text"
            value={track.artist}
            onChange={(e) => onUpdate({ artist: e.target.value })}
            placeholder="Artist name"
            className="w-full h-8 px-2 bg-transparent border border-border text-foreground font-body-mono focus:border-amber focus:outline-none transition-colors"
          />
        </Field>

        {/* Album + Track # row */}
        <div className="flex gap-3">
          <Field label="Album" className="flex-1">
            <input
              type="text"
              value={track.album}
              onChange={(e) => onUpdate({ album: e.target.value })}
              placeholder="Album name"
              className="w-full h-8 px-2 bg-transparent border border-border text-foreground font-body-mono focus:border-amber focus:outline-none transition-colors"
            />
          </Field>
          <Field label="Track #" className="w-16">
            <input
              type="number"
              min={1}
              value={track.trackNumber}
              onChange={(e) =>
                onUpdate({ trackNumber: parseInt(e.target.value) || 1 })
              }
              className="w-full h-8 px-2 bg-transparent border border-border text-foreground font-body-mono focus:border-amber focus:outline-none transition-colors tabular-nums"
            />
          </Field>
        </div>

        {/* Genre */}
        <Field label="Genre">
          <select
            value={track.genre}
            onChange={(e) => onUpdate({ genre: e.target.value })}
            className="w-full h-8 px-2 bg-transparent border border-border text-foreground font-body-mono focus:border-amber focus:outline-none transition-colors appearance-none cursor-pointer"
          >
            <option value="">Select genre...</option>
            {GENRES.map((g) => (
              <option key={g} value={g}>
                {g}
              </option>
            ))}
          </select>
        </Field>

        {/* Tags */}
        <Field label="Tags" hint="Comma-separated — drives discovery">
          <input
            type="text"
            value={track.tags.join(", ")}
            onChange={(e) =>
              onUpdate({
                tags: e.target.value
                  .split(",")
                  .map((t) => t.trim())
                  .filter(Boolean),
              })
            }
            placeholder="ambient, drone, dark, instrumental..."
            className="w-full h-8 px-2 bg-transparent border border-border text-foreground font-body-mono focus:border-amber focus:outline-none transition-colors"
          />
        </Field>

        {/* Waveform */}
        <div className="border border-border p-2 bg-[var(--bg-secondary)]">
          <Waveform peaks={track.waveform} width={460} height={48} />
        </div>

        {/* Credits & Lyrics — collapsible */}
        <button
          className="flex items-center gap-2 font-label-mono text-secondary-foreground hover:text-foreground transition-colors"
          onClick={() => setShowCredits(!showCredits)}
        >
          <span>{showCredits ? "▾" : "▸"}</span>
          <span className="uppercase tracking-wider">Credits & Lyrics</span>
        </button>

        {showCredits && (
          <div className="flex flex-col gap-3 pl-4 border-l border-border">
            <Field label="Lyrics">
              <textarea
                value={track.lyrics}
                onChange={(e) => onUpdate({ lyrics: e.target.value })}
                placeholder="Paste lyrics here..."
                rows={6}
                className="w-full px-2 py-1 bg-transparent border border-border text-foreground font-body-mono focus:border-amber focus:outline-none transition-colors resize-y"
              />
            </Field>
            <Field label="Credits">
              <textarea
                value={track.credits}
                onChange={(e) => onUpdate({ credits: e.target.value })}
                placeholder="Written by..., Produced by..., Mixed by..."
                rows={3}
                className="w-full px-2 py-1 bg-transparent border border-border text-foreground font-body-mono focus:border-amber focus:outline-none transition-colors resize-y"
              />
            </Field>
          </div>
        )}

        {/* Advanced — collapsible */}
        <button
          className="flex items-center gap-2 font-label-mono text-secondary-foreground hover:text-foreground transition-colors"
          onClick={() => setShowAdvanced(!showAdvanced)}
        >
          <span>{showAdvanced ? "▾" : "▸"}</span>
          <span className="uppercase tracking-wider">Advanced</span>
        </button>

        {showAdvanced && (
          <div className="flex flex-col gap-3 pl-4 border-l border-border">
            <Field label="ISRC" hint="Auto-generated if left blank">
              <input
                type="text"
                value={track.isrc}
                onChange={(e) => onUpdate({ isrc: e.target.value })}
                placeholder="CC-XXX-YY-NNNNN"
                className="w-full h-8 px-2 bg-transparent border border-border text-foreground font-body-mono focus:border-amber focus:outline-none transition-colors"
              />
            </Field>
            <Field label="Description">
              <textarea
                value={track.description}
                onChange={(e) => onUpdate({ description: e.target.value })}
                placeholder="About this track..."
                rows={3}
                className="w-full px-2 py-1 bg-transparent border border-border text-foreground font-body-mono focus:border-amber focus:outline-none transition-colors resize-y"
              />
            </Field>
            <Field label="Year">
              <input
                type="text"
                value={track.year}
                onChange={(e) => onUpdate({ year: e.target.value })}
                placeholder="2026"
                className="w-24 h-8 px-2 bg-transparent border border-border text-foreground font-body-mono focus:border-amber focus:outline-none transition-colors tabular-nums"
              />
            </Field>
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={track.isExplicit}
                onChange={(e) => onUpdate({ isExplicit: e.target.checked })}
                className="w-4 h-4 accent-amber"
              />
              <span className="font-body-mono text-secondary-foreground">
                Explicit content
              </span>
            </label>
          </div>
        )}
      </div>
    </div>
  );
}

// Reusable form field wrapper
function Field({
  label,
  hint,
  className = "",
  children,
}: {
  label: string;
  hint?: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={className}>
      <div className="flex items-baseline gap-2 mb-1">
        <label className="font-label-mono text-muted-foreground uppercase tracking-wider">
          {label}
        </label>
        {hint && (
          <span className="font-small text-muted-foreground">{hint}</span>
        )}
      </div>
      {children}
    </div>
  );
}
