// Identity onboarding — shown on first launch or when no identity exists.
// Two paths: create new identity or import existing nsec.
// UX patterns from document:lfm_buzz_onboarding_ux_study: the nsec stays
// masked until an explicit reveal/copy, Continue gates on that interaction
// (not a checkbox), an imported key gets a bounded profile check so
// returning artists skip straight into the app, and the create path ends
// with an optional, skippable wallet step so artists exit sale-ready.

import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";
import { MaskedNsec } from "../MaskedNsec";
import { EncryptedBackup } from "../EncryptedBackup";

interface IdentityInfo {
  npub: string;
  pubkey_hex: string;
  has_nsec: boolean;
  display_name: string | null;
}

interface WalletCheck {
  ok: boolean;
  lud16: string;
  provider: string | null;
  verify_supported: boolean;
  error: string | null;
}

type OnboardingStep = "choice" | "create" | "import" | "backup" | "wallet";

/** Where the app should land after onboarding finishes */
export type OnboardingLanding = "library" | "upload" | "settings";

interface OnboardingViewProps {
  onComplete: (identity: IdentityInfo, landing: OnboardingLanding) => void;
  onCancel?: () => void;
}

// The create path's ceremony sequence, for the progress dots
const CREATE_PATH: OnboardingStep[] = ["create", "backup", "wallet"];
const CREATE_PATH_LABELS = ["Identity", "Backup", "Wallet"];

function StepDots({ step }: { step: OnboardingStep }) {
  const index = CREATE_PATH.indexOf(step);
  if (index === -1) return null;
  return (
    <div className="flex items-center justify-center gap-2 mt-4">
      {CREATE_PATH.map((s, i) => (
        <span
          key={s}
          title={CREATE_PATH_LABELS[i]}
          className={`inline-block h-1 transition-all ${
            i === index
              ? "w-6 bg-amber"
              : i < index
                ? "w-2 bg-amber/50"
                : "w-2 bg-border"
          }`}
        />
      ))}
    </div>
  );
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
  // Wallet step
  const [lud16, setLud16] = useState("");
  const [walletCheck, setWalletCheck] = useState<WalletCheck | "checking" | null>(null);
  const [finishing, setFinishing] = useState(false);

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

  async function handleWalletCheck() {
    const address = lud16.trim();
    if (!address) return;
    setWalletCheck("checking");
    try {
      setWalletCheck(await invoke<WalletCheck>("wallet_check", { lud16: address }));
    } catch (e) {
      setWalletCheck({
        ok: false,
        lud16: address,
        provider: null,
        verify_supported: false,
        error: String(e),
      });
    }
  }

  // Finish the create path: publish the kind 0 once, with the lud16 riding
  // along when the artist provided one. Non-blocking — onboarding completes
  // even if the relay publish fails; Settings can republish later.
  async function handleFinish(withAddress: boolean) {
    if (!createdIdentity) return;
    setFinishing(true);
    const address = withAddress ? lud16.trim() : "";
    if (createdIdentity.display_name) {
      try {
        await invoke("profile_set", {
          displayName: createdIdentity.display_name,
          lud16: address || null,
        });
      } catch (e) {
        console.warn("Could not publish profile during onboarding:", e);
      }
    }
    setFinishing(false);
    // A brand-new artist lands on Upload — the thing they came to do
    onComplete(createdIdentity, "upload");
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
            {step === "wallet" && "Where should the money go?"}
          </div>
          <StepDots step={step} />
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
              Your identity has been created. <span className="text-amber">Save your secret key</span> — it's the only way to recover your identity if you lose access to this device.
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

            {/* Third option: password-encrypted file. Writing one counts as
                a key interaction, same as reveal/copy. */}
            {createdIdentity && (
              <EncryptedBackup
                npub={createdIdentity.npub}
                onInteract={() => setKeyInteracted(true)}
              />
            )}

            <button
              className="h-8 px-4 border border-amber text-amber font-label-mono uppercase tracking-wider text-[11px] hover:bg-amber/10 transition-all disabled:opacity-50"
              onClick={() => setStep("wallet")}
              disabled={!keyInteracted}
              title={keyInteracted ? undefined : "Reveal, copy, or back up your key first"}
            >
              Continue
            </button>
          </div>
        )}

        {/* ── Step: Wallet (optional, skippable) ── */}
        {step === "wallet" && (
          <div className="flex flex-col gap-4">
            <div className="font-body-mono text-foreground">
              When someone buys your music, they pay{" "}
              <span className="text-amber">your wallet directly</span> — the
              money never touches Lightning FM. Add a Lightning address now, or
              skip and add it later.
            </div>

            <div>
              <label className="font-label-mono text-muted-foreground uppercase tracking-wider text-[10px]">
                Lightning Address
              </label>
              <input
                type="text"
                value={lud16}
                onChange={(e) => {
                  setLud16(e.target.value);
                  setWalletCheck(null);
                }}
                placeholder="you@coinos.io"
                autoFocus
                className="w-full h-8 px-2 mt-1 bg-transparent border border-border text-foreground font-body-mono focus:border-amber focus:outline-none transition-colors"
                onKeyDown={(e) => e.key === "Enter" && handleWalletCheck()}
              />
            </div>

            {walletCheck === "checking" && (
              <p className="font-small text-muted-foreground animate-pulse">
                Checking your wallet: we request a test invoice to confirm it
                works. It is never paid and expires on its own.
              </p>
            )}
            {walletCheck !== null && walletCheck !== "checking" && (
              <p
                className={`font-small ${
                  walletCheck.ok && walletCheck.verify_supported
                    ? "text-amber"
                    : "text-[var(--error)]"
                }`}
              >
                {!walletCheck.ok
                  ? `This address didn't return an invoice: ${walletCheck.error ?? "unknown error"}`
                  : walletCheck.verify_supported
                    ? `Wallet check passed — ${walletCheck.provider ?? "your provider"} issues invoices and confirms payments (LUD-21). You can sell downloads.`
                    : `This wallet issues invoices but can't confirm payments (no LUD-21 support), so selling downloads won't work. Zaps are fine. Coinos and Alby support it.`}
              </p>
            )}

            <div className="font-small text-muted-foreground">
              No wallet yet?{" "}
              <button
                className="text-amber hover:underline"
                onClick={() => openUrl("https://coinos.io")}
              >
                Coinos
              </button>{" "}
              and{" "}
              <button
                className="text-amber hover:underline"
                onClick={() => openUrl("https://getalby.com")}
              >
                Alby
              </button>{" "}
              are free and take a minute — create one in your browser, then
              paste the address here and check it.
            </div>

            <div className="flex gap-3">
              <button
                className="h-8 px-4 border border-border text-secondary-foreground font-label-mono uppercase tracking-wider text-[11px] hover:text-foreground transition-all"
                onClick={() => setStep("backup")}
              >
                Back
              </button>
              <button
                className="h-8 px-4 border border-border text-secondary-foreground font-label-mono uppercase tracking-wider text-[11px] hover:text-foreground transition-all disabled:opacity-50"
                onClick={handleWalletCheck}
                disabled={!lud16.trim() || walletCheck === "checking"}
              >
                {walletCheck !== null && walletCheck !== "checking" ? "Check again" : "Check"}
              </button>
              <button
                className="h-8 px-4 flex-1 border border-amber text-amber font-label-mono uppercase tracking-wider text-[11px] hover:bg-amber/10 transition-all disabled:opacity-50"
                onClick={() => handleFinish(!!lud16.trim())}
                disabled={finishing}
              >
                {finishing
                  ? "Finishing..."
                  : lud16.trim()
                    ? "Save & Finish"
                    : "Skip for now"}
              </button>
            </div>

            <div className="font-small text-muted-foreground">
              Skipping is fine — the Get Started checklist will remind you, and
              it lives in Settings → Profile whenever you're ready.
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
