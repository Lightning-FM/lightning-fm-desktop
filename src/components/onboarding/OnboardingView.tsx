// Identity onboarding — shown on first launch or when no identity exists.
// Two paths: create new identity or import existing nsec.
// UX patterns from document:lfm_buzz_onboarding_ux_study: the nsec stays
// masked until an explicit reveal/copy, Continue gates on that interaction
// (not a checkbox), and an imported key gets a bounded profile check so
// returning artists skip straight into the app.

import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { MaskedNsec } from "../MaskedNsec";

interface IdentityInfo {
  npub: string;
  pubkey_hex: string;
  has_nsec: boolean;
  display_name: string | null;
}

type OnboardingStep = "choice" | "create" | "import" | "backup";

/** Where the app should land after onboarding finishes */
export type OnboardingLanding = "library" | "upload" | "settings";

interface OnboardingViewProps {
  onComplete: (identity: IdentityInfo, landing: OnboardingLanding) => void;
  onCancel?: () => void;
}

export function OnboardingView({ onComplete, onCancel }: OnboardingViewProps) {
  const [step, setStep] = useState<OnboardingStep>("choice");
  const [displayName, setDisplayName] = useState("");
  const [nsecInput, setNsecInput] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [importPhase, setImportPhase] = useState<"idle" | "importing" | "checking">("idle");
  const [createdIdentity, setCreatedIdentity] = useState<IdentityInfo | null>(null);
  // Interaction gate: flips when the user reveals or copies the key.
  // Strictly more honest than a checkbox at the same friction.
  const [keyInteracted, setKeyInteracted] = useState(false);

  async function handleCreate() {
    if (!displayName.trim()) {
      setError("Display name is required");
      return;
    }

    setLoading(true);
    setError("");

    try {
      const identity = await invoke<IdentityInfo>("identity_create", {
        displayName: displayName.trim(),
      });
      setCreatedIdentity(identity);
      setStep("backup");
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }

  async function handleImport() {
    if (!nsecInput.trim()) {
      setError("Paste your nsec or hex secret key");
      return;
    }

    setLoading(true);
    setImportPhase("importing");
    setError("");

    try {
      const identity = await invoke<IdentityInfo>("identity_import", {
        nsec: nsecInput.trim(),
      });

      // Returning-artist check: a published kind 0 means this key has been
      // here (or on some Nostr client) before — land straight in the app.
      // No profile → route to Settings to publish one. Any error fails
      // open to the profile path; the check must never strand onboarding.
      setImportPhase("checking");
      let hasProfile = false;
      try {
        const profile = await invoke<{ display_name: string | null } | null>(
          "profile_fetch"
        );
        hasProfile = profile !== null;
      } catch (e) {
        console.warn("Profile check failed (continuing to settings):", e);
      }

      onComplete(identity, hasProfile ? "library" : "settings");
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
      setImportPhase("idle");
    }
  }

  async function handleBackupComplete() {
    if (createdIdentity) {
      // Publish display name to Nostr profile if relays are connected.
      // Non-blocking: onboarding completes even if relay publish fails.
      if (createdIdentity.display_name) {
        try {
          await invoke("profile_set", {
            displayName: createdIdentity.display_name,
          });
        } catch (e) {
          console.warn("Could not publish profile during onboarding:", e);
        }
      }
      // A brand-new artist lands on Upload — the thing they came to do
      onComplete(createdIdentity, "upload");
    }
  }

  return (
    <div className="h-screen flex items-center justify-center bg-background">
      <div className="w-full max-w-md p-8">
        {/* Logo / Title */}
        <div className="text-center mb-8">
          <div className="font-display text-amber mb-2">⚡ Lightning FM</div>
          <div className="font-body-mono text-secondary-foreground">
            {step === "choice" && "The music channel nobody can shut down."}
            {step === "create" && "Create your identity"}
            {step === "import" && "Import existing identity"}
            {step === "backup" && "Back up your key"}
          </div>
        </div>

        {/* ── Step: Choice ── */}
        {step === "choice" && (
          <div className="flex flex-col gap-3">
            <button
              className="h-12 border border-amber text-amber font-body-mono hover:bg-amber/10 transition-all text-left px-4"
              onClick={() => setStep("create")}
            >
              <div className="font-body-mono">Create new identity</div>
              <div className="font-small text-secondary-foreground">
                New to Nostr? Start here.
              </div>
            </button>

            <button
              className="h-12 border border-border text-foreground font-body-mono hover:border-[var(--text-muted)] transition-all text-left px-4"
              onClick={() => setStep("import")}
            >
              <div className="font-body-mono">Import existing key</div>
              <div className="font-small text-secondary-foreground">
                Have an nsec? Paste it here.
              </div>
            </button>

            {onCancel && (
              <button
                className="h-8 px-4 border border-border text-secondary-foreground font-label-mono uppercase tracking-wider text-[11px] hover:text-foreground transition-all"
                onClick={onCancel}
              >
                Back to Library
              </button>
            )}
          </div>
        )}

        {/* ── Step: Create ── */}
        {step === "create" && (
          <div className="flex flex-col gap-4">
            <div>
              <label className="font-label-mono text-muted-foreground uppercase tracking-wider text-[10px]">
                Display Name
              </label>
              <input
                type="text"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                placeholder="How listeners will see you"
                autoFocus
                className="w-full h-8 px-2 mt-1 bg-transparent border border-border text-foreground font-body-mono focus:border-amber focus:outline-none transition-colors"
                onKeyDown={(e) => e.key === "Enter" && handleCreate()}
              />
            </div>

            {error && (
              <div className="font-small text-error border border-error/30 px-2 py-1">
                {error}
              </div>
            )}

            <div className="flex gap-3">
              <button
                className="h-8 px-4 border border-border text-secondary-foreground font-label-mono uppercase tracking-wider text-[11px] hover:text-foreground transition-all"
                onClick={() => {
                  setStep("choice");
                  setError("");
                }}
              >
                Back
              </button>
              <button
                className="h-8 px-4 flex-1 border border-amber text-amber font-label-mono uppercase tracking-wider text-[11px] hover:bg-amber/10 transition-all disabled:opacity-50"
                onClick={handleCreate}
                disabled={loading}
              >
                {loading ? "Creating..." : "Create Identity"}
              </button>
            </div>

            <div className="font-small text-muted-foreground mt-2">
              This generates a Nostr keypair stored in your macOS Keychain.
              Your keys never leave your device.
            </div>
          </div>
        )}

        {/* ── Step: Import ── */}
        {step === "import" && (
          <div className="flex flex-col gap-4">
            <div>
              <label className="font-label-mono text-muted-foreground uppercase tracking-wider text-[10px]">
                Secret Key
              </label>
              <input
                type="password"
                value={nsecInput}
                onChange={(e) => setNsecInput(e.target.value)}
                placeholder="nsec1... or hex"
                autoFocus
                className="w-full h-8 px-2 mt-1 bg-transparent border border-border text-foreground font-body-mono focus:border-amber focus:outline-none transition-colors"
                onKeyDown={(e) => e.key === "Enter" && handleImport()}
              />
            </div>

            {error && (
              <div className="font-small text-error border border-error/30 px-2 py-1">
                {error}
              </div>
            )}

            <div className="flex gap-3">
              <button
                className="h-8 px-4 border border-border text-secondary-foreground font-label-mono uppercase tracking-wider text-[11px] hover:text-foreground transition-all"
                onClick={() => {
                  setStep("choice");
                  setError("");
                  setNsecInput("");
                }}
              >
                Back
              </button>
              <button
                className="h-8 px-4 flex-1 border border-amber text-amber font-label-mono uppercase tracking-wider text-[11px] hover:bg-amber/10 transition-all disabled:opacity-50"
                onClick={handleImport}
                disabled={loading}
              >
                {importPhase === "importing"
                  ? "Importing..."
                  : importPhase === "checking"
                    ? "Looking for your profile..."
                    : "Import Key"}
              </button>
            </div>

            <div className="font-small text-muted-foreground mt-2">
              Your key is stored in macOS Keychain and never sent to any server.
              Supports nsec (bech32) or raw hex format.
            </div>
          </div>
        )}

        {/* ── Step: Backup ── */}
        {step === "backup" && (
          <div className="flex flex-col gap-4">
            <div className="font-body-mono text-foreground">
              Your identity has been created. <span className="text-amber">Write down your secret key</span> — it's the only way to recover your identity if you lose access to this device.
            </div>

            {/* npub (public, shareable) */}
            <div>
              <label className="font-label-mono text-muted-foreground uppercase tracking-wider text-[10px]">
                Your Public Key (shareable)
              </label>
              <div className="mt-1 px-2 py-1.5 border border-border bg-[var(--bg-secondary)] font-small text-secondary-foreground break-all select-all cursor-text">
                {createdIdentity?.npub}
              </div>
            </div>

            {/* nsec (secret, backup) — masked until reveal/copy */}
            <div>
              <label className="font-label-mono text-error uppercase tracking-wider text-[10px]">
                Your Secret Key (keep private)
              </label>
              <div className="mt-1">
                <MaskedNsec onInteract={() => setKeyInteracted(true)} />
              </div>
            </div>

            <div className="font-small text-muted-foreground">
              Never share this key. Anyone who has it can impersonate you and
              take your payouts. Copy it into a password manager — and you can
              always view it again in Settings → Identity.
            </div>

            <button
              className="h-8 px-4 border border-amber text-amber font-label-mono uppercase tracking-wider text-[11px] hover:bg-amber/10 transition-all disabled:opacity-50"
              onClick={handleBackupComplete}
              disabled={!keyInteracted}
              title={keyInteracted ? undefined : "Reveal or copy your key first"}
            >
              Continue to Lightning FM
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
