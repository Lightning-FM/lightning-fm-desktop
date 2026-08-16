// Masked secret-key display — used by the onboarding backup step and
// Settings → Identity. The nsec is fetched from the Keychain-backed backend
// only on an explicit Reveal or Copy; the mask itself is decorative
// fixed-length bullets, so rendering costs nothing sensitive. The
// `onInteract` callback fires on the first real interaction with the key,
// which lets callers gate on "actually saw or copied it" instead of a
// checkbox attestation (pattern from document:lfm_buzz_onboarding_ux_study).

import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";

interface MaskedNsecProps {
  onInteract?: () => void;
}

// nsec1 bech32 keys are 63 characters
const MASK = "•".repeat(63);

export function MaskedNsec({ onInteract }: MaskedNsecProps) {
  const [nsec, setNsec] = useState<string | null>(null);
  const [revealed, setRevealed] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function getKey(): Promise<string | null> {
    if (nsec) return nsec;
    try {
      const key = await invoke<string>("identity_export_nsec");
      setNsec(key);
      setError(null);
      return key;
    } catch (e) {
      setError(String(e));
      return null;
    }
  }

  async function handleReveal() {
    if (revealed) {
      setRevealed(false);
      return;
    }
    const key = await getKey();
    if (key) {
      setRevealed(true);
      onInteract?.();
    }
  }

  async function handleCopy() {
    const key = await getKey();
    if (!key) return;
    try {
      await navigator.clipboard.writeText(key);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
      onInteract?.();
    } catch (e) {
      setError(`Couldn't copy: ${String(e)}`);
    }
  }

  return (
    <div>
      <div
        className={`px-2 py-1.5 border font-small break-all ${
          revealed && nsec
            ? "border-error/30 bg-error/5 text-foreground select-all cursor-text"
            : "border-border bg-[var(--bg-secondary)] text-muted-foreground select-none"
        }`}
      >
        {revealed && nsec ? nsec : MASK}
      </div>
      <div className="flex gap-2 mt-2">
        <button
          type="button"
          className="h-7 px-3 border border-border text-secondary-foreground font-label-mono text-[10px] uppercase tracking-wider hover:text-foreground transition-all"
          onClick={handleReveal}
        >
          {revealed ? "Hide" : "Reveal"}
        </button>
        <button
          type="button"
          className="h-7 px-3 border border-border text-secondary-foreground font-label-mono text-[10px] uppercase tracking-wider hover:text-foreground transition-all"
          onClick={handleCopy}
        >
          {copied ? "Copied ✓" : "Copy"}
        </button>
      </div>
      {error && <p className="font-small text-[var(--error)] mt-1">{error}</p>}
    </div>
  );
}
