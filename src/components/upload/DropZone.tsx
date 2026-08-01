// Drop zone for audio files and folders
// Selection goes through the Tauri dialog plugin and the webview drag-drop
// event — both yield real filesystem paths. The browser File API does not
// expose paths under Tauri v2, and the Rust side needs a path to read.

import { useCallback, useEffect } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { getCurrentWebview } from "@tauri-apps/api/webview";

interface DropZoneProps {
  isDraggingOver: boolean;
  onDragOver: () => void;
  onDragLeave: () => void;
  onFilesSelected: (paths: string[]) => void;
}

const AUDIO_EXTENSIONS = [
  "wav",
  "flac",
  "aiff",
  "aif",
  "mp3",
  "ogg",
  "m4a",
  "aac",
  "opus",
];

export function DropZone({
  isDraggingOver,
  onDragOver,
  onDragLeave,
  onFilesSelected,
}: DropZoneProps) {
  const browseFiles = useCallback(async () => {
    const selected = await open({
      multiple: true,
      directory: false,
      filters: [{ name: "Audio", extensions: AUDIO_EXTENSIONS }],
    });
    if (!selected) return;
    onFilesSelected(Array.isArray(selected) ? selected : [selected]);
  }, [onFilesSelected]);

  const browseFolder = useCallback(async () => {
    const selected = await open({ multiple: false, directory: true });
    if (typeof selected === "string") onFilesSelected([selected]);
  }, [onFilesSelected]);

  // Native drag-drop — the DOM drop event carries no paths under Tauri v2
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    getCurrentWebview()
      .onDragDropEvent((event) => {
        if (event.payload.type === "over") {
          onDragOver();
        } else if (event.payload.type === "drop") {
          onDragLeave();
          if (event.payload.paths.length > 0) {
            onFilesSelected(event.payload.paths);
          }
        } else {
          onDragLeave();
        }
      })
      .then((fn) => {
        unlisten = fn;
      });
    return () => unlisten?.();
  }, [onDragOver, onDragLeave, onFilesSelected]);

  return (
    <div className="flex flex-col items-center justify-center flex-1 p-8">
      {/* Drop target */}
      <div
        className={`w-full max-w-2xl border-2 border-dashed transition-all flex flex-col items-center justify-center py-16 px-8 gap-6 ${
          isDraggingOver
            ? "border-amber bg-[rgba(232,169,23,0.08)]"
            : "border-border hover:border-[var(--text-muted)]"
        }`}
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
            onClick={browseFiles}
          >
            Browse Files
          </button>
          <button
            className="h-8 px-4 border border-border text-secondary-foreground font-label-mono uppercase tracking-wider hover:border-[var(--text-muted)] hover:text-foreground transition-all"
            onClick={browseFolder}
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
    </div>
  );
}
