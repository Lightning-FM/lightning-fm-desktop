// Desktop checkout — same terminal-log language as the web BuyPanel, but
// the embedded node pays, so the whole flow is one confirm click. Stages
// stream in from the backend's "purchase-progress" events.

import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { revealItemInDir } from "@tauri-apps/plugin-opener";
import type { ProductInfo, PurchaseRecord } from "../../types/streaming";

interface LogLine {
  label: string;
  detail: string;
  tone: "muted" | "normal" | "amber" | "success" | "error";
}

interface BuyModalProps {
  product: ProductInfo;
  artistName: string;
  onClose: () => void;
  onPurchased: (record: PurchaseRecord) => void;
}

type Phase = "confirm" | "executing" | "done" | "failed";

const STAGE_LABELS: Record<string, string> = {
  request: "REQUEST",
  invoice: "INVOICE",
  settled: "SETTLED",
  delivered: "DELIVER",
};

export function BuyModal({ product, artistName, onClose, onPurchased }: BuyModalProps) {
  const [phase, setPhase] = useState<Phase>("confirm");
  const [log, setLog] = useState<LogLine[]>([]);
  const [record, setRecord] = useState<PurchaseRecord | null>(null);

  useEffect(() => {
    const unlisten = listen<{ stage: string; detail: string }>(
      "purchase-progress",
      (event) => {
        const { stage, detail } = event.payload;
        setLog((prev) => [
          ...prev,
          {
            label: STAGE_LABELS[stage] || stage.toUpperCase(),
            detail,
            tone: stage === "settled" ? "success" : stage === "delivered" ? "amber" : "normal",
          },
        ]);
      }
    );
    return () => {
      unlisten.then((fn) => fn());
    };
  }, []);

  async function executePurchase() {
    setPhase("executing");
    try {
      const result = await invoke<PurchaseRecord>("purchase_execute", {
        endpoint: product.endpoint,
        slug: product.slug,
        title: product.title,
        artistPubkey: product.artist_pubkey,
        format: product.format,
      });
      setRecord(result);
      setPhase("done");
      onPurchased(result);
    } catch (e) {
      setLog((prev) => [
        ...prev,
        { label: "ERROR", detail: String(e), tone: "error" },
      ]);
      setPhase("failed");
    }
  }

  const toneClass: Record<LogLine["tone"], string> = {
    muted: "text-muted-foreground",
    normal: "text-foreground",
    amber: "text-amber",
    success: "text-[var(--success)]",
    error: "text-error",
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
      role="dialog"
      aria-modal="true"
      aria-label={`Buy ${product.title}`}
      onClick={(e) => {
        if (e.target === e.currentTarget && phase !== "executing") onClose();
      }}
    >
      <div className="w-full max-w-md border border-amber bg-[var(--bg-primary)] p-4">
        <div className="flex items-baseline justify-between mb-3">
          <span className="font-label-mono text-amber uppercase tracking-wider text-[11px]">
            Buy · {product.slug}
          </span>
          <span className="font-label-mono text-muted-foreground text-[10px] uppercase tracking-wider">
            {product.format?.toUpperCase() || "download"}
          </span>
        </div>

        {/* Confirm state */}
        {phase === "confirm" && (
          <div className="flex flex-col gap-4">
            <div>
              <p className="font-body-mono text-foreground">{product.title}</p>
              <p className="font-small text-secondary-foreground">{artistName}</p>
              <p className="font-small text-muted-foreground mt-2">
                Buying gets you the{" "}
                {product.summary ||
                  (product.format
                    ? `${product.format.toUpperCase()} download`
                    : "download")}
                . Streaming stays free for everyone.
              </p>
            </div>
            <button
              className="w-full h-9 border border-amber text-amber font-label-mono uppercase tracking-wider text-[12px] hover:bg-amber/10 transition-all tabular-nums"
              onClick={executePurchase}
            >
              Pay {product.price_sats.toLocaleString()} sats from balance
            </button>
            <p className="font-small text-muted-foreground">
              Paid directly to the artist&apos;s node — no platform custody.
            </p>
          </div>
        )}

        {/* Transaction log */}
        {phase !== "confirm" && (
          <div className="font-body-mono text-[12px] leading-6 mb-3" aria-live="polite">
            {log.map((line, i) => (
              <div key={i} className="flex gap-3">
                <span className={`w-16 shrink-0 ${toneClass[line.tone]}`}>
                  {line.label}
                </span>
                <span className="text-secondary-foreground break-all">{line.detail}</span>
              </div>
            ))}
            {phase === "executing" && (
              <span className="text-amber animate-pulse">▊</span>
            )}
          </div>
        )}

        {/* Done */}
        {phase === "done" && record && (
          <button
            className="w-full h-9 border border-[var(--success)] text-[var(--success)] font-label-mono uppercase tracking-wider text-[12px] hover:bg-[var(--success)]/10 transition-all"
            onClick={() => revealItemInDir(record.file_path)}
          >
            Show file in Finder
          </button>
        )}

        {/* Footer */}
        <div className="mt-4 flex justify-end">
          <button
            className="font-label-mono text-[11px] text-secondary-foreground uppercase tracking-wider hover:text-foreground transition-colors disabled:opacity-40"
            onClick={onClose}
            disabled={phase === "executing"}
          >
            {phase === "done" ? "Done" : "Close"}
          </button>
        </div>
      </div>
    </div>
  );
}
