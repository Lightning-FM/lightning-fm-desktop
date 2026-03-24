// 5-stage upload pipeline indicator

import type { UploadStage } from "./types";

const STAGES: { key: UploadStage; label: string }[] = [
  { key: "uploading", label: "Uploading" },
  { key: "processing", label: "Processing" },
  { key: "mirroring", label: "Mirroring" },
  { key: "publishing", label: "Publishing" },
  { key: "live", label: "Live" },
];

// Map stages to their ordinal position for comparison
const STAGE_ORDER: Record<string, number> = {
  queued: -1,
  draft: -1,
  error: -1,
  uploading: 0,
  processing: 1,
  mirroring: 2,
  publishing: 3,
  live: 4,
};

interface UploadStageIndicatorProps {
  stage: UploadStage;
  progress: number;
  error: string | null;
}

export function UploadStageIndicator({
  stage,
  progress,
  error,
}: UploadStageIndicatorProps) {
  if (stage === "draft") {
    return (
      <div className="flex flex-col gap-1">
        <span className="font-label-mono text-muted-foreground uppercase tracking-wider">
          Status
        </span>
        <span className="font-body-mono text-secondary-foreground">
          Draft — not published
        </span>
      </div>
    );
  }

  if (stage === "error") {
    return (
      <div className="flex flex-col gap-1">
        <span className="font-label-mono text-muted-foreground uppercase tracking-wider">
          Status
        </span>
        <span className="font-body-mono text-error">{error || "Upload failed"}</span>
      </div>
    );
  }

  const currentOrder = STAGE_ORDER[stage] ?? -1;

  return (
    <div className="flex flex-col gap-2">
      <span className="font-label-mono text-muted-foreground uppercase tracking-wider">
        Status
      </span>
      {STAGES.map(({ key, label }) => {
        const order = STAGE_ORDER[key];
        const isComplete = currentOrder > order;
        const isCurrent = stage === key;
        return (
          <div key={key} className="flex items-center gap-2">
            {/* Indicator dot */}
            <span
              className={`inline-block w-2 h-2 ${
                isComplete
                  ? "bg-[var(--success)]"
                  : isCurrent
                  ? "bg-amber"
                  : "bg-[var(--bg-tertiary)] border border-border"
              }`}
            />
            {/* Label */}
            <span
              className={`font-small ${
                isComplete
                  ? "text-[var(--success)]"
                  : isCurrent
                  ? "text-amber"
                  : "text-muted-foreground"
              }`}
            >
              {label}
            </span>
            {/* Progress percentage for uploading stage */}
            {isCurrent && key === "uploading" && (
              <span className="font-small text-amber tabular-nums ml-auto">
                {progress}%
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
}
