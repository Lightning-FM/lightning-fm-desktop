import { useState, useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { UploadView } from "./components/upload";
import { LibraryView } from "./components/library";
import { PaymentNotification } from "./components/PaymentNotification";
import { DashboardView } from "./components/dashboard";
import type { LibraryTrack } from "./components/library";
import type { PaymentEvent } from "./components/PaymentNotification";
import "./globals.css";

// ─── Views ──────────────────────────────────────────────────

type View = "library" | "upload" | "discover" | "dashboard" | "settings";

// ─── Types ──────────────────────────────────────────────────

interface LocalLoadResult {
  hash: string;
  cache_path: string;
}

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

// Metadata from Rust metadata_read command
interface AudioMetadata {
  title: string | null;
  artist: string | null;
  album: string | null;
  track_number: number | null;
  genre: string | null;
  year: string | null;
  duration_secs: number;
  sample_rate: number | null;
  bit_depth: number | null;
  format: string;
  has_artwork: boolean;
}

// ─── Test catalog (loaded from test-data/) ──────────────────

const TEST_CATALOG = [
  { artist: "Satoshi Sounds", tracks: [
    "21M", "Block Zero", "Cathedrals of Code", "Chancellor's On The Brink",
    "Difficulty Adjustment", "Genesis Clock", "Ledgerly",
    "Pierre Looked This One Over", "Saw Again From The Pier", "Timechain"
  ]},
  { artist: "Keypair", tracks: [
    "dev_null", "Display None", "finite dregs", "Infinite Anticipation",
    "Lost Protocol", "never dull", "Public _ Private",
    "Recursive Writing", "Schnorrd", "When Hashes Collide"
  ]},
  { artist: "The Relay Operators", tracks: [
    "1010001__s390v", "Do-again Ants", "Kind 1", "Packet Light",
    "Propagation", "Protocol Handshake", "Tail Minus",
    "Tippity", "Unicode __ Unicorn", "Websocket Wrench"
  ]},
  { artist: "Lightning Louise", tracks: [
    "Atlas Node", "Circuit Wraith", "Cypherpunk Lullaby", "Gateway Flow",
    "Grounded Clouds", "Keysend", "Open Channel",
    "Signal Path", "The Routing Table", "Voltage Ghost"
  ]},
];

// ─── App ────────────────────────────────────────────────────

function App() {
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

  // Load test tracks on mount
  useEffect(() => {
    loadTestCatalog();
    loadCredits();
  }, []);

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

  async function loadTestCatalog() {
    const loaded: LibraryTrack[] = [];

    for (const artistGroup of TEST_CATALOG) {
      for (const title of artistGroup.tracks) {
        try {
          const filePath = await resolveTestPath(artistGroup.artist, title);
          const result = await invoke<LocalLoadResult>("playback_load_local", { filePath });

          // Read metadata from the file for duration, format, artwork
          let meta: AudioMetadata | null = null;
          let artworkDataUrl: string | null = null;
          try {
            meta = await invoke<AudioMetadata>("metadata_read", { filePath });
          } catch {}
          try {
            const art = await invoke<{ data_url: string } | null>("artwork_extract", { filePath });
            if (art) artworkDataUrl = art.data_url;
          } catch {}

          loaded.push({
            title: meta?.title || title,
            artist: meta?.artist || artistGroup.artist,
            album: meta?.album || "",
            hash: result.hash,
            cachePath: result.cache_path,
            duration: meta?.duration_secs || 0,
            format: meta?.format || "MP3",
            artworkDataUrl,
            eventId: null,
            artistPubkey: null,
            audioUrl: null,
            lightningNodeId: null,
            artistDirect: true,
          });
        } catch (e) {
          console.warn(`Failed to load ${artistGroup.artist} - ${title}:`, e);
        }
      }
    }

    setTracks(loaded);
    setLoading(false);
  }

  async function resolveTestPath(artist: string, title: string): Promise<string> {
    const folderMap: Record<string, string> = {
      "Satoshi Sounds": "satoshi-sounds",
      "Keypair": "keypair",
      "The Relay Operators": "the-relay-operators",
      "Lightning Louise": "lightning-louise",
    };
    const folder = folderMap[artist] || artist.toLowerCase().replace(/\s+/g, "-");
    const base = "/Users/mloseke/Documents/Ephemeral Empire/matt - projects/lightning-fm/app-desktop/test-data";
    return `${base}/${folder}/${title}.mp3`;
  }

  async function playTrack(track: LibraryTrack) {
    if (session) {
      try { await invoke("stream_stop"); } catch {}
    }

    setActiveTrack(track);
    setSatsPaid(0);

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

    if (audioRef.current) {
      try {
        const dataUrl = await invoke<string>("playback_read_audio", {
          filePath: track.cachePath,
        });
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
          <div className="w-44 min-w-0">
            <div className="font-body-mono text-foreground truncate">{activeTrack.title}</div>
            <div className="font-small text-secondary-foreground truncate">
              {activeTrack.artist}
              {session && (
                <span className="text-amber ml-2">⚡ {Math.round(100 / 60)} sats/min</span>
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
