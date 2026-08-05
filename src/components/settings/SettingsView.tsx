// Settings — artist profile editor.
// Publishes the Nostr kind 0 that storefronts and the artist directory read.
// The backend merges into any existing profile, so fields left blank here
// don't clobber values set by other clients.

import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";

interface ProfileData {
  name: string | null;
  display_name: string | null;
  about: string | null;
  picture: string | null;
  lud16: string | null;
  nip05: string | null;
}

interface SettingsViewProps {
  npub: string;
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="mb-4">
      <label className="font-label-mono text-muted-foreground uppercase tracking-wider text-[10px] block mb-1">
        {label}
        {hint && <span className="ml-2 normal-case text-[10px]">{hint}</span>}
      </label>
      {children}
    </div>
  );
}

const inputClass =
  "w-full h-8 px-2 bg-transparent border border-border text-foreground font-body-mono text-sm focus:border-amber focus:outline-none transition-colors";

export function SettingsView({ npub }: SettingsViewProps) {
  const [displayName, setDisplayName] = useState("");
  const [about, setAbout] = useState("");
  const [picture, setPicture] = useState("");
  const [lud16, setLud16] = useState("");
  const [nip05, setNip05] = useState("");

  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState<"idle" | "saving" | "saved" | "error">(
    "idle"
  );
  const [message, setMessage] = useState("");
  const [signOutArmed, setSignOutArmed] = useState(false);

  async function handleSignOut() {
    try {
      await invoke("identity_delete");
      // Identity-scoped view state must not leak to the next signer
      localStorage.removeItem("lfm_seller_endpoint");
      localStorage.removeItem("lfm_sell_via");
      // Back to onboarding — App re-checks identity on load
      window.location.reload();
    } catch (err) {
      setStatus("error");
      setMessage(String(err));
      setSignOutArmed(false);
    }
  }

  // Load whatever is already published for this identity
  useEffect(() => {
    invoke<ProfileData | null>("profile_fetch")
      .then((p) => {
        if (p) {
          setDisplayName(p.display_name || p.name || "");
          setAbout(p.about || "");
          setPicture(p.picture || "");
          setLud16(p.lud16 || "");
          setNip05(p.nip05 || "");
        }
      })
      .catch(() => {
        /* no profile published yet — start blank */
      })
      .finally(() => setLoading(false));
  }, [npub]);

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    if (!displayName.trim()) {
      setStatus("error");
      setMessage("Display name is required");
      return;
    }

    setStatus("saving");
    setMessage("");
    try {
      await invoke("profile_set", {
        displayName: displayName.trim(),
        name: displayName.trim().toLowerCase(),
        about: about.trim() || null,
        picture: picture.trim() || null,
        lud16: lud16.trim() || null,
        nip05: nip05.trim() || null,
      });
      setStatus("saved");
      setMessage("Profile published to relays");
    } catch (err) {
      setStatus("error");
      setMessage(String(err));
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <span className="font-body-mono text-muted-foreground animate-pulse">
          loading profile…
        </span>
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto">
      <div className="max-w-xl mx-auto p-6">
        <h1 className="font-heading-2 text-foreground mb-1">Artist Profile</h1>
        <p className="font-small text-muted-foreground mb-6">
          Published as a Nostr profile — this is what listeners see on your
          storefront.
        </p>

        <form onSubmit={handleSave}>
          <Field label="Display Name" hint="required">
            <input
              type="text"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              placeholder="Your artist name"
              className={inputClass}
            />
          </Field>

          <Field label="Bio">
            <textarea
              value={about}
              onChange={(e) => setAbout(e.target.value)}
              placeholder="A line or two about you"
              rows={3}
              className={`${inputClass} h-auto py-2 resize-y`}
            />
          </Field>

          <Field label="Picture URL">
            <input
              type="url"
              value={picture}
              onChange={(e) => setPicture(e.target.value)}
              placeholder="https://…"
              className={inputClass}
            />
          </Field>

          <Field label="Lightning Address" hint="for zaps — lud16">
            <input
              type="text"
              value={lud16}
              onChange={(e) => setLud16(e.target.value)}
              placeholder="you@lightning.fm"
              className={inputClass}
            />
          </Field>

          <Field label="NIP-05" hint="verifies your name against a domain">
            <input
              type="text"
              value={nip05}
              onChange={(e) => setNip05(e.target.value)}
              placeholder="you@lightning.fm"
              className={inputClass}
            />
          </Field>

          {picture && (
            <div className="mb-4 flex items-center gap-3">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={picture}
                alt=""
                className="w-14 h-14 border border-border object-cover"
                onError={(e) => {
                  (e.target as HTMLImageElement).style.opacity = "0.2";
                }}
              />
              <span className="font-small text-muted-foreground">
                picture preview
              </span>
            </div>
          )}

          <div className="flex items-center gap-3 mt-6">
            <button
              type="submit"
              disabled={status === "saving"}
              className="h-8 px-4 border border-amber text-amber font-label-mono uppercase tracking-wider text-[11px] hover:bg-amber/10 transition-all disabled:opacity-50"
            >
              {status === "saving" ? "Publishing…" : "[ Publish Profile ]"}
            </button>
            {message && (
              <span
                className={`font-small ${
                  status === "error" ? "text-[var(--error)]" : "text-amber"
                }`}
              >
                {message}
              </span>
            )}
          </div>
        </form>

        <div className="mt-8 pt-4 border-t border-border">
          <div className="font-label-mono text-muted-foreground uppercase tracking-wider text-[10px] mb-1">
            Identity
          </div>
          <div className="font-mono text-[11px] text-secondary-foreground break-all mb-3">
            {npub}
          </div>

          {!signOutArmed ? (
            <button
              type="button"
              onClick={() => setSignOutArmed(true)}
              className="h-8 px-4 border border-border text-secondary-foreground font-label-mono uppercase tracking-wider text-[11px] hover:border-[var(--error)] hover:text-[var(--error)] transition-all"
            >
              Sign out
            </button>
          ) : (
            <div className="flex flex-col gap-2">
              <p className="font-small text-[var(--error)]">
                Signing out removes this key from your Mac&apos;s Keychain. If
                the nsec isn&apos;t backed up somewhere else, this identity is
                gone forever — export it first.
              </p>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={handleSignOut}
                  className="h-8 px-4 border border-[var(--error)] text-[var(--error)] font-label-mono uppercase tracking-wider text-[11px] hover:bg-[var(--error)]/10 transition-all"
                >
                  Sign out &amp; forget key
                </button>
                <button
                  type="button"
                  onClick={() => setSignOutArmed(false)}
                  className="h-8 px-4 border border-border text-secondary-foreground font-label-mono uppercase tracking-wider text-[11px] hover:text-foreground transition-all"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
