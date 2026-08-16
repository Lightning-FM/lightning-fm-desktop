// Encrypted key backup (NIP-49) — "locked in a file" option, used by the
// onboarding backup step and Settings → Identity. Rust encrypts and writes
// the file, so the secret never transits the frontend. Includes the
// drop-it-back verify flow: re-pick the file you just saved, enter the
// password, and get a definitive "this backup restores this identity".
// Pattern from document:lfm_buzz_onboarding_ux_study.

import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { save, open } from "@tauri-apps/plugin-dialog";

interface EncryptedBackupProps {
  npub: string;
  /** Fires when a backup file is actually written (a real key interaction) */
  onInteract?: () => void;
}

type Phase = "collapsed" | "form" | "saving" | "saved";

const buttonClass =
  "h-7 px-3 border border-border text-secondary-foreground font-label-mono text-[10px] uppercase tracking-wider hover:text-foreground transition-all disabled:opacity-50";
const inputClass =
  "w-full h-8 px-2 bg-transparent border border-border text-foreground font-body-mono text-sm focus:border-amber focus:outline-none transition-colors";

export function EncryptedBackup({ npub, onInteract }: EncryptedBackupProps) {
  const [phase, setPhase] = useState<Phase>("collapsed");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [savedPath, setSavedPath] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Verify flow
  const [verifyPassword, setVerifyPassword] = useState("");
  const [verifyState, setVerifyState] = useState<
    "idle" | "checking" | "verified" | "failed"
  >("idle");
  const [verifyMessage, setVerifyMessage] = useState("");

  async function handleSave() {
    setError(null);
    if (password.length < 8) {
      setError("Password must be at least 8 characters");
      return;
    }
    if (password !== confirm) {
      setError("Passwords don't match");
      return;
    }

    const path = await save({
      defaultPath: `lightning-fm-key-${npub.slice(0, 13)}.ncryptsec`,
    });
    if (!path) return; // user cancelled the dialog

    setPhase("saving");
    try {
      await invoke("identity_backup_encrypted", { path, password });
      setSavedPath(path);
      setPhase("saved");
      onInteract?.();
    } catch (e) {
      setError(String(e));
      setPhase("form");
    }
  }

  async function handleVerify() {
    setVerifyMessage("");
    const path = await open({
      multiple: false,
      filters: [{ name: "Encrypted key backup", extensions: ["ncryptsec"] }],
    });
    if (!path || typeof path !== "string") return;

    setVerifyState("checking");
    try {
      const matches = await invoke<boolean>("identity_verify_backup", {
        path,
        password: verifyPassword,
      });
      if (matches) {
        setVerifyState("verified");
        setVerifyMessage("Your backup is verified — it restores this identity.");
      } else {
        setVerifyState("failed");
        setVerifyMessage(
          "That backup decrypts fine but holds a different identity."
        );
      }
    } catch (e) {
      setVerifyState("failed");
      setVerifyMessage(String(e));
    }
  }

  if (phase === "collapsed") {
    return (
      <button type="button" className={buttonClass} onClick={() => setPhase("form")}>
        Save encrypted backup file
      </button>
    );
  }

  return (
    <div className="border border-border p-3 flex flex-col gap-3">
      <div className="font-label-mono text-amber uppercase tracking-wider text-[10px]">
        Encrypted backup file
      </div>

      {phase !== "saved" && (
        <>
          <p className="font-small text-secondary-foreground">
            Your key, locked with a password (NIP-49). The file is useless
            without the password — safe to keep in cloud storage or on a USB
            stick. Don&apos;t lose the password; it can&apos;t be reset.
          </p>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Password (8+ characters)"
            className={inputClass}
          />
          <input
            type="password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            placeholder="Confirm password"
            className={inputClass}
          />
          {error && <p className="font-small text-[var(--error)]">{error}</p>}
          <div className="flex gap-2">
            <button
              type="button"
              className={buttonClass}
              onClick={() => {
                setPhase("collapsed");
                setPassword("");
                setConfirm("");
                setError(null);
              }}
            >
              Cancel
            </button>
            <button
              type="button"
              className="h-7 px-3 border border-amber text-amber font-label-mono text-[10px] uppercase tracking-wider hover:bg-amber/10 transition-all disabled:opacity-50"
              onClick={handleSave}
              disabled={phase === "saving" || !password || !confirm}
            >
              {phase === "saving" ? "Encrypting…" : "Choose where to save"}
            </button>
          </div>
        </>
      )}

      {phase === "saved" && (
        <>
          <p className="font-small text-amber">
            Backup saved{savedPath ? ` to ${savedPath}` : ""}.
          </p>
          <p className="font-small text-secondary-foreground">
            Test it now: pick the file you just saved and re-enter the
            password. Thirty seconds today beats finding out it doesn&apos;t
            work the day this Mac dies.
          </p>
          <input
            type="password"
            value={verifyPassword}
            onChange={(e) => {
              setVerifyPassword(e.target.value);
              setVerifyState("idle");
              setVerifyMessage("");
            }}
            placeholder="Backup password"
            className={inputClass}
          />
          <div className="flex gap-2 items-center">
            <button
              type="button"
              className={buttonClass}
              onClick={handleVerify}
              disabled={verifyState === "checking" || !verifyPassword}
            >
              {verifyState === "checking" ? "Checking…" : "Test your backup"}
            </button>
            {verifyState === "verified" && (
              <span className="font-small text-[var(--success)]">✓</span>
            )}
          </div>
          {verifyMessage && (
            <p
              className={`font-small ${
                verifyState === "verified"
                  ? "text-[var(--success)]"
                  : "text-[var(--error)]"
              }`}
            >
              {verifyMessage}
            </p>
          )}
        </>
      )}
    </div>
  );
}
