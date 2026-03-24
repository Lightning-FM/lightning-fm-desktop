// Left pane — track list with upload status and drag-to-reorder

import type { UploadTrack, UploadStage } from "./types";
import { useCallback, useState } from "react";

interface TrackListProps {
  tracks: UploadTrack[];
  selectedTrackIds: string[];
  onSelectTrack: (id: string) => void;
  onSelectAll: () => void;
  onReorder: (fromIndex: number, toIndex: number) => void;
  onRemoveTrack?: (id: string) => void;
}

function stageIcon(stage: UploadStage, _progress: number): string {
  switch (stage) {
    case "queued":
      return "░";
    case "uploading":
      return "█";
    case "processing":
      return "◐";
    case "mirroring":
      return "◑";
    case "publishing":
      return "◒";
    case "live":
      return "●";
    case "draft":
      return "○";
    case "error":
      return "✕";
  }
}

function stageColor(stage: UploadStage): string {
  switch (stage) {
    case "live":
      return "text-[var(--success)]";
    case "error":
      return "text-error";
    case "queued":
    case "draft":
      return "text-muted-foreground";
    default:
      return "text-amber";
  }
}

function stageLabel(stage: UploadStage, progress: number): string {
  switch (stage) {
    case "queued":
      return "queued";
    case "uploading":
      return `uploading ${progress}%`;
    case "processing":
      return "processing";
    case "mirroring":
      return "mirroring";
    case "publishing":
      return "publishing";
    case "live":
      return "live";
    case "draft":
      return "draft";
    case "error":
      return "error";
  }
}

// Simple progress bar for uploading tracks
function MiniProgress({ progress }: { progress: number }) {
  return (
    <div className="w-full h-[2px] bg-border mt-1">
      <div
        className="h-full bg-amber transition-all duration-300"
        style={{ width: `${progress}%` }}
      />
    </div>
  );
}

export function TrackList({
  tracks,
  selectedTrackIds,
  onSelectTrack,
  onSelectAll,
  onReorder,
  onRemoveTrack: _onRemoveTrack,
}: TrackListProps) {
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [overIndex, setOverIndex] = useState<number | null>(null);

  const handleDragStart = useCallback(
    (e: React.DragEvent, index: number) => {
      setDragIndex(index);
      e.dataTransfer.effectAllowed = "move";
    },
    []
  );

  const handleDragOver = useCallback(
    (e: React.DragEvent, index: number) => {
      e.preventDefault();
      setOverIndex(index);
    },
    []
  );

  const handleDrop = useCallback(
    (e: React.DragEvent, toIndex: number) => {
      e.preventDefault();
      if (dragIndex !== null && dragIndex !== toIndex) {
        onReorder(dragIndex, toIndex);
      }
      setDragIndex(null);
      setOverIndex(null);
    },
    [dragIndex, onReorder]
  );

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="shrink-0 px-3 py-2 border-b border-border">
        <span className="font-label-mono text-muted-foreground uppercase tracking-wider">
          Tracks ({tracks.length})
        </span>
      </div>

      {/* Track list */}
      <div
        className="flex-1 overflow-y-auto min-h-0"
        role="listbox"
        aria-label="Upload tracks"
      >
        {tracks.map((track, index) => {
          const isSelected = selectedTrackIds.includes(track.id);
          const isDragOver = overIndex === index && dragIndex !== index;

          return (
            <div
              key={track.id}
              role="option"
              aria-selected={isSelected}
              className={`px-3 py-2 cursor-pointer border-b border-border transition-all ${
                isSelected
                  ? "bg-amber/10 border-l-2 border-l-amber"
                  : "border-l-2 border-l-transparent hover:bg-amber/5"
              } ${isDragOver ? "border-t-2 border-t-amber" : ""}`}
              onClick={() => onSelectTrack(track.id)}
              draggable
              onDragStart={(e) => handleDragStart(e, index)}
              onDragOver={(e) => handleDragOver(e, index)}
              onDrop={(e) => handleDrop(e, index)}
              onDragEnd={() => {
                setDragIndex(null);
                setOverIndex(null);
              }}
            >
              {/* Track number + drag handle */}
              <div className="flex items-center gap-2">
                <span className="font-label-mono text-muted-foreground tabular-nums w-5 cursor-grab">
                  {track.trackNumber}
                </span>
                <span className="font-body-mono text-foreground truncate flex-1">
                  {track.title || track.fileName}
                </span>
              </div>

              {/* Status line */}
              <div className="flex items-center gap-1 ml-7 mt-0.5">
                <span className={`font-small ${stageColor(track.stage)}`}>
                  {stageIcon(track.stage, track.progress)}
                </span>
                <span className={`font-small ${stageColor(track.stage)}`}>
                  {stageLabel(track.stage, track.progress)}
                </span>
              </div>

              {/* Upload progress bar */}
              {track.stage === "uploading" && (
                <div className="ml-7">
                  <MiniProgress progress={track.progress} />
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Footer actions */}
      <div className="shrink-0 px-3 py-2 border-t border-border">
        <button
          className="font-small text-secondary-foreground hover:text-foreground transition-all"
          onClick={onSelectAll}
        >
          [ SELECT ALL ]
        </button>
      </div>
    </div>
  );
}
