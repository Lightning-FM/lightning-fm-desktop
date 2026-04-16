// Identity gate — prompts artist to create or import a Nostr identity before publishing.
// Keys are stored in macOS Keychain via the Rust identity module.

import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";

interface IdentityInfo {
  npub: string;
  pubkey_hex: string;
  has_nsec: boolean;
  display_name: string | null;
}

interface IdentityGateProps {
  onIdentityReady: (info: IdentityInfo) => void;
  onCancel: () => void;
}

type GateMode = "choose" | "create" | "import";

export function IdentityGate({ onIdentityReady, onCancel }: IdentityGateProps) {
  const [mode, setMode] = useState<GateMode>("choose");
  const [displayName, setDisplayName] = useState("");
  const [nsecInput, setNsecInput] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleCreate() {
    setLoading(true);
    setError(null);
    try {
      const info = await invoke<IdentityInfo>("identity_create", {
        displayName: displayName.trim() || null,
      });
      onIdentityReady(info);
    } catch (err) {
      setError(String(err));
    } finally {
      setLoading(false);
    }
  }

  async function handleImport() {
    if (!nsecInput.trim()) {
      setError("Paste your nsec key");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const info = await invoke<IdentityInfo>("identity_import", {
        nsec: nsecInput.trim(),
      });
      onIdentityReady(info);
    } catch (err) {
      setError(String(err));
    } finally {
      setLoading(false);
    }
  }

  if (mode === "choose") {
    return (
      <div className="flex flex-col items-center justify-center flex-1 p-8">
        <div className="w-full max-w-md flex flex-col gap-6">
          {/* Heading */}
          <div className="text-center">
            <div className="font-heading-2 text-foreground mb-2">
              NOSTR IDENTITY REQUIRED
            </div>
            <div className="font-body-mono text-secondary-foreground">
              Publishing tracks requires a Nostr identity to sign events
              and authenticate with Blossom servers.
            </div>
          </div>

          {/* Options */}
          <div className="flex flex-col gap-3">
            <button
              className="w-full h-12 border border-amber text-amber font-label-mono uppercase tracking-wider hover:bg-amber/10 transition-all"
              onClick={() => setMode("create")}
            >
              Create New Identity
            </button>
            <button
              className="w-full h-12 border border-border text-secondary-foreground font-label-mono uppercase tracking-wider hover:border-[var(--text-muted)] hover:text-foreground transition-all"
              onClick={() => setMode("import")}
            >
              Import Existing (nsec)
            </button>
          </div>

          {/* Info */}
          <div className="font-small text-muted-foreground text-center">
            Keys are stored in your macOS Keychain -- never sent over the network.
          </div>

          {/* Cancel */}
          <button
            className="font-small text-muted-foreground hover:text-foreground transition-colors mx-auto"
            onClick={onCancel}
          >
            Cancel
          </button>
        </div>
      </div>
    );
  }

  if (mode === "create") {
    return (
      <div className="flex flex-col items-center justify-center flex-1 p-8">
        <div className="w-full max-w-md flex flex-col gap-6">
          <div className="text-center">
            <div className="font-heading-2 text-foreground mb-2">
              CREATE IDENTITY
            </div>
            <div className="font-body-mono text-secondary-foreground">
              Generate a new Nostr keypair. Your private key will be stored
              securely in macOS Keychain.
            </div>
          </div>

          <div className="flex flex-col gap-1">
            <label className="font-label-mono text-muted-foreground uppercase tracking-wider">
              Display Name (optional)
            </label>
            <input
              type="text"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              placeholder="Your artist name"
              className="w-full h-8 px-2 bg-transparent border border-border text-foreground font-body-mono focus:border-amber focus:outline-none transition-colors"
              disabled={loading}
              autoFocus
              onKeyDown={(e) => {
                if (e.key === "Enter") handleCreate();
              }}
            />
          </div>

          {error && (
            <div className="font-small text-error border border-error/30 px-3 py-2">
              {error}
            </div>
          )}

          <div className="flex gap-3">
            <button
              className="flex-1 h-10 border border-amber text-amber font-label-mono uppercase tracking-wider hover:bg-amber/10 transition-all disabled:opacity-40 disabled:cursor-wait"
              onClick={handleCreate}
              disabled={loading}
            >
              {loading ? "Generating..." : "Create"}
            </button>
            <button
              className="h-10 px-4 border border-border text-secondary-foreground font-label-mono uppercase tracking-wider hover:border-[var(--text-muted)] hover:text-foreground transition-all"
              onClick={() => {
                setMode("choose");
                setError(null);
              }}
              disabled={loading}
            >
              Back
            </button>
          </div>
        </div>
      </div>
    );
  }

  // mode === "import"
  return (
    <div className="flex flex-col items-center justify-center flex-1 p-8">
      <div className="w-full max-w-md flex flex-col gap-6">
        <div className="text-center">
          <div className="font-heading-2 text-foreground mb-2">
            IMPORT IDENTITY
          </div>
          <div className="font-body-mono text-secondary-foreground">
            Paste your Nostr private key (nsec1...). It will be stored
            securely in macOS Keychain.
          </div>
        </div>

        <div className="flex flex-col gap-1">
          <label className="font-label-mono text-muted-foreground uppercase tracking-wider">
            Private Key
          </label>
          <input
            type="password"
            value={nsecInput}
            onChange={(e) => setNsecInput(e.target.value)}
            placeholder="nsec1..."
            className="w-full h-8 px-2 bg-transparent border border-border text-foreground font-body-mono focus:border-amber focus:outline-none transition-colors"
            disabled={loading}
            autoFocus
            onKeyDown={(e) => {
              if (e.key === "Enter") handleImport();
            }}
          />
          <span className="font-small text-muted-foreground mt-1">
            Never share your nsec. This field is masked for your safety.
          </span>
        </div>

        {error && (
          <div className="font-small text-error border border-error/30 px-3 py-2">
            {error}
          </div>
        )}

        <div className="flex gap-3">
          <button
            className="flex-1 h-10 border border-amber text-amber font-label-mono uppercase tracking-wider hover:bg-amber/10 transition-all disabled:opacity-40 disabled:cursor-wait"
            onClick={handleImport}
            disabled={loading}
          >
            {loading ? "Importing..." : "Import"}
          </button>
          <button
            className="h-10 px-4 border border-border text-secondary-foreground font-label-mono uppercase tracking-wider hover:border-[var(--text-muted)] hover:text-foreground transition-all"
            onClick={() => {
              setMode("choose");
              setError(null);
              setNsecInput("");
            }}
            disabled={loading}
          >
            Back
          </button>
        </div>
      </div>
    </div>
  );
}
