// Terminal-style earnings activity feed

import type { EarningsEntry } from "./types";

interface EarningsFeedProps {
  entries: EarningsEntry[];
}

function formatTime(ts: number): string {
  const d = new Date(ts);
  const h = d.getHours().toString().padStart(2, "0");
  const m = d.getMinutes().toString().padStart(2, "0");
  const s = d.getSeconds().toString().padStart(2, "0");
  return `${h}:${m}:${s}`;
}

export function EarningsFeed({ entries }: EarningsFeedProps) {
  if (entries.length === 0) {
    return (
      <div className="border border-border p-4 flex-1 min-h-0">
        <div className="font-label-mono text-muted-foreground uppercase tracking-wider mb-3">
          Activity
        </div>
        <div className="font-body-mono text-muted-foreground">
          No payments yet — earnings will appear here as listeners stream your
          music.
        </div>
      </div>
    );
  }

  return (
    <div className="border border-border flex-1 min-h-0 flex flex-col">
      <div className="shrink-0 px-3 py-2 border-b border-border">
        <span className="font-label-mono text-muted-foreground uppercase tracking-wider">
          Activity ({entries.length})
        </span>
      </div>
      <div className="flex-1 overflow-y-auto">
        {entries.map((entry, i) => (
          <div
            key={`${entry.timestamp}-${i}`}
            className="flex items-center gap-3 px-3 py-1.5 border-b border-border"
          >
            {/* Timestamp */}
            <span className="font-small text-muted-foreground tabular-nums w-16 shrink-0">
              {formatTime(entry.timestamp)}
            </span>

            {/* Direction indicator */}
            <span
              className={`font-small shrink-0 ${
                entry.type === "received" ? "text-[var(--success)]" : "text-amber"
              }`}
            >
              {entry.type === "received" ? "IN " : "OUT"}
            </span>

            {/* Amount */}
            <span
              className={`font-body-mono tabular-nums ${
                entry.type === "received" ? "text-[var(--success)]" : "text-amber"
              }`}
            >
              {entry.type === "received" ? "+" : "-"}
              {entry.amount_sats.toLocaleString()} sats
            </span>

            {/* Payment hash (truncated) */}
            {entry.payment_hash && (
              <span className="font-small text-muted-foreground ml-auto truncate max-w-[120px]">
                {entry.payment_hash.slice(0, 12)}...
              </span>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
