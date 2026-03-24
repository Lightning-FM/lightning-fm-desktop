// Drop zone for audio files and folders
// Supports drag-and-drop + browse buttons

import { useCallback, useRef } from "react";

interface DropZoneProps {
  isDraggingOver: boolean;
  onDragOver: () => void;
  onDragLeave: () => void;
  onFilesSelected: (files: FileList) => void;
}

const ACCEPTED_MIME =
  "audio/wav,audio/flac,audio/aiff,audio/mpeg,audio/ogg,audio/mp4,audio/aac,audio/opus";

export function DropZone({
  isDraggingOver,
  onDragOver,
  onDragLeave,
  onFilesSelected,
}: DropZoneProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const folderInputRef = useRef<HTMLInputElement>(null);

  const handleDragOver = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      onDragOver();
    },
    [onDragOver]
  );

  const handleDragLeave = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      onDragLeave();
    },
    [onDragLeave]
  );

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      onDragLeave();

      if (e.dataTransfer.files.length > 0) {
        onFilesSelected(e.dataTransfer.files);
      }
    },
    [onDragLeave, onFilesSelected]
  );

  return (
    <div className="flex flex-col items-center justify-center flex-1 p-8">
      {/* Drop target */}
      <div
        className={`w-full max-w-2xl border-2 border-dashed transition-all flex flex-col items-center justify-center py-16 px-8 gap-6 ${
          isDraggingOver
            ? "border-amber bg-[rgba(232,169,23,0.08)]"
            : "border-border hover:border-[var(--text-muted)]"
        }`}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
      >
        {/* Icon */}
        <div className="font-display text-amber opacity-60">↑</div>

        {/* Heading */}
        <div className="text-center">
          <div className="font-heading-2 text-foreground mb-2">
            DROP AUDIO FILES OR FOLDER HERE
          </div>
          <div className="font-body-mono text-secondary-foreground">
            WAV · FLAC · AIFF · MP3 · OGG · M4A · AAC · OPUS
          </div>
          <div className="font-small text-muted-foreground mt-2">
            ID3 tags will auto-populate metadata
          </div>
        </div>

        {/* Buttons */}
        <div className="flex gap-4">
          <button
            className="h-8 px-4 border border-amber text-amber font-label-mono uppercase tracking-wider hover:bg-amber/10 transition-all"
            onClick={() => fileInputRef.current?.click()}
          >
            Browse Files
          </button>
          <button
            className="h-8 px-4 border border-border text-secondary-foreground font-label-mono uppercase tracking-wider hover:border-[var(--text-muted)] hover:text-foreground transition-all"
            onClick={() => folderInputRef.current?.click()}
          >
            Browse Folder
          </button>
        </div>

        {/* Keyboard hint */}
        <div className="font-small text-muted-foreground">
          <span className="border border-border px-1">⌘O</span> files
          <span className="mx-2">·</span>
          <span className="border border-border px-1">⌘⇧O</span> folder
        </div>
      </div>

      {/* Hidden file inputs */}
      <input
        ref={fileInputRef}
        type="file"
        multiple
        accept={ACCEPTED_MIME}
        className="hidden"
        onChange={(e) => e.target.files && onFilesSelected(e.target.files)}
      />
      <input
        ref={folderInputRef}
        type="file"
        // @ts-expect-error — webkitdirectory is not in TS types
        webkitdirectory=""
        className="hidden"
        onChange={(e) => e.target.files && onFilesSelected(e.target.files)}
      />
    </div>
  );
}
