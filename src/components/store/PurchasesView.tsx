// Purchases library — everything bought, newest first, with re-open.
// The preimage column is the buyer's cryptographic receipt; the file is
// already on disk under ~/.lightning-fm/purchases/.

import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { revealItemInDir } from "@tauri-apps/plugin-opener";
import type { PurchaseRecord } from "../../types/streaming";

function formatDate(secs: number): string {
  return new Date(secs * 1000).toISOString().slice(0, 10);
}

export function PurchasesView() {
  const [purchases, setPurchases] = useState<PurchaseRecord[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    invoke<PurchaseRecord[]>("purchases_list")
      .then(setPurchases)
      .catch((e) => setError(String(e)));
  }, []);

  if (error) {
    return (
      <p className="p-4 font-body-mono text-error text-[12px]">{error}</p>
    );
  }
  if (!purchases) {
    return (
      <p className="p-4 font-body-mono text-muted-foreground text-[12px] animate-pulse">
        loading purchases…
      </p>
    );
  }
  if (purchases.length === 0) {
    return (
      <div className="p-6">
        <p className="font-body-mono text-secondary-foreground text-[13px]">
          Nothing purchased yet.
        </p>
        <p className="font-small text-muted-foreground mt-1">
          Tracks with a sats price in the library are downloadable — bought
          files land here with their payment receipts.
        </p>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto">
      {purchases.map((p) => (
        <div
          key={p.payment_hash}
          className="flex items-center gap-3 px-3 py-2 border-b border-border"
        >
          <div className="flex-1 min-w-0">
            <div className="font-body-mono text-foreground truncate">
              {p.title}
            </div>
            <div className="font-small text-muted-foreground truncate">
              {formatDate(p.purchased_at)} · {p.amount_sats.toLocaleString()} sats ·
              receipt {p.preimage.slice(0, 12)}…
            </div>
          </div>
          <span className="font-small text-muted-foreground shrink-0 w-10 text-right uppercase">
            {p.format || ""}
          </span>
          <button
            className="h-7 px-2 border border-border text-secondary-foreground font-label-mono text-[10px] uppercase tracking-wider hover:border-amber hover:text-amber transition-all shrink-0"
            onClick={() => revealItemInDir(p.file_path)}
          >
            Show file
          </button>
        </div>
      ))}
    </div>
  );
}
