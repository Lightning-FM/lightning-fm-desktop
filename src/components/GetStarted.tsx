// First-run checklist (onboarding phase 3) — sequences a new artist:
// identity → payout address → first upload → first sale listing.
// Renders above the Library until every step is done or it's dismissed;
// dismissal is identity-scoped so a new signer sees it again.

import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { LibraryTrack } from "./library/types";

interface GetStartedProps {
  identity: { npub: string; pubkey_hex: string } | null;
  tracks: LibraryTrack[];
  onNavigate: (view: "upload" | "settings") => void;
}

interface Step {
  done: boolean;
  label: string;
  detail: string;
  action: "upload" | "settings" | null;
}

export function GetStarted({ identity, tracks, onNavigate }: GetStartedProps) {
  const [lud16, setLud16] = useState<string | null>(null);
  const [hasProducts, setHasProducts] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const dismissKey = `lfm_getstarted_dismissed_${identity?.npub ?? "anon"}`;

  useEffect(() => {
    setDismissed(localStorage.getItem(dismissKey) === "1");
    if (!identity) {
      setLud16(null);
      setHasProducts(false);
      return;
    }
    invoke<{ lud16: string | null } | null>("profile_fetch")
      .then((p) => setLud16(p?.lud16?.trim() || null))
      .catch(() => setLud16(null));
    invoke<unknown[]>("product_list_mine")
      .then((products) => setHasProducts(products.length > 0))
      .catch(() => setHasProducts(false));
  }, [identity, dismissKey]);

  const hasTracks =
    !!identity && tracks.some((t) => t.artistPubkey === identity.pubkey_hex);

  const steps: Step[] = [
    {
      done: !!identity,
      label: "Create your identity",
      detail: "Your key is generated here and stays in your Mac's Keychain.",
      action: "settings",
    },
    {
      done: !!lud16,
      label: "Add a Lightning address",
      detail:
        "Where your money goes — Coinos or Alby work best. We check it the moment you save.",
      action: "settings",
    },
    {
      done: hasTracks,
      label: "Upload a track",
      detail: "Publishes as a Nostr event signed by your key. Streaming is free for everyone.",
      action: "upload",
    },
    {
      done: hasProducts,
      label: "Sell something",
      detail: "Enable Sell on an upload — buyers pay your wallet directly. 2 GB hosting included.",
      action: "upload",
    },
  ];

  const remaining = steps.filter((s) => !s.done).length;
  if (dismissed || remaining === 0) return null;

  return (
    <div className="border-b border-border bg-amber/5 px-4 py-3">
      <div className="flex items-center justify-between mb-2">
        <span className="font-label-mono text-amber uppercase tracking-wider text-[10px]">
          Get started — {steps.length - remaining}/{steps.length}
        </span>
        <button
          type="button"
          onClick={() => {
            localStorage.setItem(dismissKey, "1");
            setDismissed(true);
          }}
          className="font-label-mono text-[10px] uppercase tracking-wider text-muted-foreground hover:text-foreground transition-colors"
        >
          dismiss
        </button>
      </div>
      <div className="flex flex-col gap-1">
        {steps.map((step) => (
          <div key={step.label} className="flex items-baseline gap-2 font-body-mono text-[12px]">
            <span className={step.done ? "text-[var(--success)]" : "text-muted-foreground"}>
              {step.done ? "✓" : "○"}
            </span>
            {step.done || !step.action ? (
              <span className={step.done ? "text-muted-foreground line-through" : "text-foreground"}>
                {step.label}
              </span>
            ) : (
              <button
                type="button"
                onClick={() => onNavigate(step.action as "upload" | "settings")}
                className="text-amber hover:underline text-left"
              >
                {step.label}
              </button>
            )}
            {!step.done && (
              <span className="font-small text-muted-foreground">{step.detail}</span>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
