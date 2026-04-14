import { useState, useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { UploadView } from "./components/upload";
import { LibraryView } from "./components/library";
import { PaymentNotification } from "./components/PaymentNotification";
import { DashboardView } from "./components/dashboard";
import { OnboardingView } from "./components/onboarding";
import type { LibraryTrack } from "./components/library";
import type { PaymentEvent } from "./components/PaymentNotification";
import "./globals.css";

// ─── Views ──────────────────────────────────────────────────

type View = "library" | "upload" | "discover" | "dashboard" | "settings";

// ─── Types ──────────────────────────────────────────────────

interface CreditsInfo {
  remaining_sats: number;
  total_granted: number;
  is_active: boolean;
  can_stream: boolean;
}

interface StreamSession {
  track_id: string;
  artist_pubkey: string;
  artist_direct: boolean;
  is_playing: boolean;
  intervals_paid: number;
  total_artist_sats: number;
  total_platform_sats: number;
  total_listener_sats: number;
}

interface IntervalResult {
  session: StreamSession;
  artist_sats: number;
  platform_sats: number;
  listener_sats: number;
  credits_remaining: number;
  credits_depleted: boolean;
}

// ─── Catalog item type (from load_catalog command) ──────────

interface CatalogItem {
  eventId: string;
  artistPubkey: string;
  artistNpub: string;
  artistName: string | null;
  artistPicture: string | null;
  title: string;
  slug: string;
  durationSecs: number | null;
  audioHash: string | null;
  audioUrl: string | null;
  fallbackUrl: string | null;
  mimeType: string | null;
  fileSize: number | null;
  previewSecs: number | null;
  lightningNodeId: string | null;
  createdAt: number;
}

// ─── Identity ───────────────────────────────────────────────

interface IdentityInfo {
  npub: string;
  pubkey_hex: string;
  has_nsec: boolean;
  display_name: string | null;
}

// ─── App ────────────────────────────────────────────────────

function App() {
  const [identity, setIdentity] = useState<IdentityInfo | null>(null);
  const [view, setView] = useState<View>("library");
  const [tracks, setTracks] = useState<LibraryTrack[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTrack, setActiveTrack] = useState<LibraryTrack | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [credits, setCredits] = useState<CreditsInfo | null>(null);
  const [session, setSession] = useState<StreamSession | null>(null);
  const [satsPaid, setSatsPaid] = useState(0);
  const [paymentEvent, setPaymentEvent] = useState<PaymentEvent | null>(null);
  const audioRef = useRef<HTMLAudioElement>(null);
  const intervalRef = useRef<number | null>(null);

  // On mount: check identity, then connect relays and load catalog (always)
  useEffect(() => {
    async function startup() {
      // Check for existing identity (non-blocking)
      try {
        const existing = await invoke<IdentityInfo | null>("identity_check");
        if (existing) {
          setIdentity(existing);
        }
      } catch (e) {
        console.warn("Identity check failed:", e);
      }

      // Always connect relays and load catalog — works with or without identity
      loadCatalog();
    }
    startup();
  }, []);

  // When identity becomes available: activate authenticated features
  useEffect(() => {
    if (identity) {
      loadCredits();
      startLdkNode();
    }
  }, [identity]);

  // Start the LDK node in the background (non-blocking)
  async function startLdkNode() {
    try {
      await invoke("ldk_start", { artistMode: true });
      console.log("LDK node started (Signet, artist mode)");
    } catch (e) {
      // "Node is already running" is expected on hot reload
      const msg = String(e);
      if (!msg.includes("already running")) {
        console.error("Failed to start LDK node:", e);
      }
    }
  }

  // Listen for LDK payment events from the Rust backend
  useEffect(() => {
    const unlisten = listen<{
      event_type: string;
      payment_hash: string | null;
      amount_msat: number | null;
      fee_paid_msat: number | null;
      close_reason: string | null;
    }>("ldk-event", (event) => {
      const payload = event.payload;
      const amountSats = payload.amount_msat ? Math.round(payload.amount_msat / 1000) : 0;

      switch (payload.event_type) {
        case "payment_successful":
          setPaymentEvent({
            type: "sent",
            amount_sats: amountSats,
            message: payload.fee_paid_msat
              ? `Fee: ${payload.fee_paid_msat} msat`
              : "Keysend confirmed",
            timestamp: Date.now(),
          });
          break;

        case "payment_failed":
          setPaymentEvent({
            type: "failed",
            amount_sats: 0,
            message: payload.close_reason || "Routing or channel error",
            timestamp: Date.now(),
          });
          break;

        case "payment_received":
          setPaymentEvent({
            type: "received",
            amount_sats: amountSats,
            message: "Incoming payment",
            timestamp: Date.now(),
          });
          break;
      }
    });

    return () => {
      unlisten.then((fn) => fn());
    };
  }, []);

  // Global keyboard shortcuts
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.metaKey && e.key === "u") {
        e.preventDefault();
        setView((v) => (v === "upload" ? "library" : "upload"));
      }
      // Spacebar to toggle play/pause (when not in an input)
      if (e.key === " " && !(e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLSelectElement)) {
        e.preventDefault();
        togglePlayPause();
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isPlaying, activeTrack]);

  // Streaming payment timer — tick every 60 seconds while playing
  useEffect(() => {
    if (isPlaying && session) {
      intervalRef.current = window.setInterval(async () => {
        try {
          const result = await invoke<IntervalResult>("stream_tick");
          setSession(result.session);
          setSatsPaid(result.session.total_listener_sats);
          setCredits(prev => prev ? { ...prev, remaining_sats: result.credits_remaining, can_stream: !result.credits_depleted } : null);

          if (result.credits_depleted) {
            audioRef.current?.pause();
            setIsPlaying(false);
          }
        } catch (e) {
          console.error("Stream tick failed:", e);
        }
      }, 60000);
    }

    return () => {
      if (intervalRef.current) {
        window.clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
  }, [isPlaying, session]);

  async function loadCredits() {
    try {
      const info = await invoke<CreditsInfo>("credits_info");
      setCredits(info);
    } catch {}
  }

  async function loadCatalog() {
    try {
      // Single call: connects to relays, fetches tracks + profiles, returns merged result
      const catalog = await invoke<CatalogItem[]>("load_catalog");
      console.log(`Catalog loaded: ${catalog.length} tracks`);

      setTracks(catalog.map(t => ({
        title: t.title,
        artist: t.artistName || t.artistNpub.slice(0, 12) + "...",
        album: "",
        hash: t.audioHash || t.eventId,
        cachePath: "",
        duration: t.durationSecs || 0,
        format: t.mimeType || "audio/mpeg",
        artworkDataUrl: t.artistPicture || null,
        eventId: t.eventId,
        artistPubkey: t.artistPubkey,
        audioUrl: t.audioUrl,
        lightningNodeId: t.lightningNodeId,
        artistDirect: true,
      })));
    } catch (e) {
      console.error("Catalog load failed:", e);
    }
    setLoading(false);
  }

  async function playTrack(track: LibraryTrack) {
    if (session) {
      try { await invoke("stream_stop"); } catch {}
    }

    setActiveTrack(track);
    setSatsPaid(0);

    // Start streaming payment session only if identity exists
    if (identity) {
      try {
        const newSession = await invoke<StreamSession>("stream_start", {
          trackId: track.hash,
          artistPubkey: track.artistPubkey || "test-artist-" + track.artist.toLowerCase().replace(/\s+/g, "-"),
          lightningNodeId: track.lightningNodeId || undefined,
          artistDirect: track.artistDirect,
        });
        setSession(newSession);
      } catch (e) {
        console.error("Failed to start stream:", e);
      }
    }

    if (audioRef.current) {
      try {
        let filePath = track.cachePath;

        // For relay tracks: fetch audio from Blossom CDN, cache it, get local path
        if (!filePath && track.audioUrl && track.hash) {
          const urls = [track.audioUrl];
          const result = await invoke<{ cache_path: string; artist_direct: boolean }>(
            "playback_fetch", { hash: track.hash, urls }
          );
          filePath = result.cache_path;
          // Update the track's cachePath so subsequent plays skip the fetch
          track.cachePath = filePath;
        }

        const dataUrl = await invoke<string>("playback_read_audio", { filePath });
        audioRef.current.src = dataUrl;
        audioRef.current.play();
        setIsPlaying(true);
      } catch (e) {
        console.error("Audio play failed:", e);
      }
    }
  }

  function togglePlayPause() {
    if (!audioRef.current || !activeTrack) return;
    if (isPlaying) {
      audioRef.current.pause();
      setIsPlaying(false);
      invoke("stream_pause").catch(() => {});
    } else {
      audioRef.current.play();
      setIsPlaying(true);
      invoke("stream_resume").catch(() => {});
    }
  }

  function formatTime(secs: number): string {
    const m = Math.floor(secs / 60);
    const s = Math.floor(secs % 60);
    return `${m}:${s.toString().padStart(2, "0")}`;
  }

  function seek(e: React.MouseEvent<HTMLDivElement>) {
    if (!audioRef.current || !duration) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const pct = (e.clientX - rect.left) / rect.width;
    audioRef.current.currentTime = pct * duration;
  }

  // Show onboarding if user explicitly navigates to it
  if (view === "settings" && !identity) {
    return <OnboardingView onComplete={(id) => { setIdentity(id); setView("library"); }} />;
  }

  return (
    <div className="h-screen flex flex-col bg-background overflow-hidden">
      {/* ── Payment Notification (floating) ── */}
      <PaymentNotification event={paymentEvent} />

      {/* ── Status Bar (pinned top) ── */}
      <div className="shrink-0 h-8 flex items-center px-4 gap-4 border-b border-border bg-background">
        <span className="font-label-mono text-amber">⚡ Lightning FM</span>
        <span className="font-small text-muted-foreground">
          {tracks.length} tracks
        </span>
        {identity ? (
          <span className="font-small text-muted-foreground">
            · {identity.npub.slice(0, 12)}...
          </span>
        ) : (
          <span
            className="font-small text-amber cursor-pointer hover:underline"
            onClick={() => setView("settings")}
          >
            Sign In
          </span>
        )}
        {credits && (
          <span className="font-small text-muted-foreground ml-auto">
            ⚡ {credits.remaining_sats.toLocaleString()} sats
          </span>
        )}
        {session && (
          <span className="font-small text-amber">
            ⚡ {satsPaid} sats paid
          </span>
        )}
      </div>

      {/* ── Main Content (fills between status bar and player bar) ── */}
      <div className="flex flex-1 min-h-0">
        {/* ── Nav (pinned left) ── */}
        <div className="shrink-0 w-48 border-r border-border p-4 flex flex-col gap-1 overflow-y-auto">
          <span className="font-label-mono text-muted-foreground uppercase tracking-wider mb-2">Navigate</span>
          {([
            { id: "library" as View, icon: "≡", label: "Library" },
            { id: "upload" as View, icon: "↑", label: "Upload", shortcut: "⌘U" },
            { id: "discover" as View, icon: "◎", label: "Discover" },
            { id: "dashboard" as View, icon: "◉", label: "Dashboard" },
            { id: "settings" as View, icon: "⚙", label: "Settings" },
          ]).map((item) => (
            <span
              key={item.id}
              className={`font-body-mono px-2 py-1 cursor-pointer transition-all ${
                view === item.id
                  ? "text-amber bg-amber/10 border border-amber"
                  : "text-secondary-foreground hover:text-foreground border border-transparent"
              }`}
              onClick={() => setView(item.id)}
            >
              {item.icon} {item.label}
              {item.shortcut && (
                <span className="font-small text-muted-foreground ml-1">{item.shortcut}</span>
              )}
            </span>
          ))}
        </div>

        {/* ── Main View ── */}
        <div className="flex-1 min-h-0">
          {view === "upload" ? (
            <UploadView />
          ) : view === "library" ? (
            <LibraryView
              tracks={tracks}
              loading={loading}
              activeTrackHash={activeTrack?.hash || null}
              isPlaying={isPlaying}
              onPlay={playTrack}
            />
          ) : view === "dashboard" ? (
            <DashboardView />
          ) : (
            <div className="flex items-center justify-center h-full">
              <span className="font-body-mono text-muted-foreground">
                {view.charAt(0).toUpperCase() + view.slice(1)} — coming soon
              </span>
            </div>
          )}
        </div>
      </div>

      {/* ── Player Bar (pinned bottom) ── */}
      {activeTrack && (
        <div className="shrink-0 h-16 border-t border-border bg-card flex items-center px-4 gap-4">
          {/* Artwork thumbnail */}
          <div className="w-10 h-10 shrink-0 border border-border overflow-hidden bg-[var(--bg-secondary)]">
            {activeTrack.artworkDataUrl ? (
              <img src={activeTrack.artworkDataUrl} alt="" className="w-full h-full object-cover" />
            ) : (
              <div className="w-full h-full flex items-center justify-center">
                <span className="font-small text-muted-foreground">♪</span>
              </div>
            )}
          </div>

          {/* Track info */}
          <div className="w-64 min-w-0">
            <div className="font-body-mono text-foreground truncate">{activeTrack.title}</div>
            <div className="font-small text-secondary-foreground truncate">
              {activeTrack.artist}
              {session && (
                <span className="text-amber ml-2">⚡ 100 sats/min</span>
              )}
            </div>
          </div>

          {/* Transport controls */}
          <div className="flex items-center gap-3">
            <button
              className="font-body-mono text-secondary-foreground hover:text-foreground"
              onClick={() => {
                const idx = tracks.findIndex(t => t.hash === activeTrack.hash);
                if (idx > 0) playTrack(tracks[idx - 1]);
              }}
            >◂◂</button>
            <button
              className="w-8 h-8 flex items-center justify-center bg-primary text-primary-foreground font-body-mono"
              onClick={togglePlayPause}
            >
              {isPlaying ? "▮▮" : "▶"}
            </button>
            <button
              className="font-body-mono text-secondary-foreground hover:text-foreground"
              onClick={() => {
                const idx = tracks.findIndex(t => t.hash === activeTrack.hash);
                if (idx < tracks.length - 1) playTrack(tracks[idx + 1]);
              }}
            >▸▸</button>
          </div>

          {/* Progress bar */}
          <div className="flex-1 flex items-center gap-2">
            <span className="font-small text-muted-foreground tabular-nums w-10 text-right">
              {formatTime(currentTime)}
            </span>
            <div
              className="flex-1 h-1 bg-border cursor-pointer relative"
              onClick={seek}
            >
              <div
                className="h-full bg-amber absolute left-0 top-0"
                style={{ width: `${duration ? (currentTime / duration) * 100 : 0}%` }}
              />
            </div>
            <span className="font-small text-muted-foreground tabular-nums w-10">
              {formatTime(duration)}
            </span>
          </div>

          {/* Boost button */}
          <button className="h-8 px-3 border border-amber text-amber font-label-mono uppercase tracking-wider hover:bg-amber/10 transition-all">
            ⚡ Boost
          </button>
        </div>
      )}

      {/* Hidden audio element */}
      <audio
        ref={audioRef}
        onTimeUpdate={() => setCurrentTime(audioRef.current?.currentTime || 0)}
        onLoadedMetadata={() => setDuration(audioRef.current?.duration || 0)}
        onEnded={() => {
          if (activeTrack) {
            const idx = tracks.findIndex(t => t.hash === activeTrack.hash);
            if (idx < tracks.length - 1) {
              playTrack(tracks[idx + 1]);
            } else {
              setIsPlaying(false);
            }
          }
        }}
      />
    </div>
  );
}

export default App;
