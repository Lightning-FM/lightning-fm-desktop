import { useState, useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { convertFileSrc } from "@tauri-apps/api/core";
import "./globals.css";

// ─── Types ──────────────────────────────────────────────────

interface LocalLoadResult {
  hash: string;
  cache_path: string;
}

interface Track {
  title: string;
  artist: string;
  hash: string;
  cachePath: string;
  audioSrc: string;
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
  const [tracks, setTracks] = useState<Track[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTrack, setActiveTrack] = useState<Track | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [credits, setCredits] = useState<CreditsInfo | null>(null);
  const [session, setSession] = useState<StreamSession | null>(null);
  const [satsPaid, setSatsPaid] = useState(0);
  const audioRef = useRef<HTMLAudioElement>(null);
  const intervalRef = useRef<number | null>(null);

  // Load test tracks on mount
  useEffect(() => {
    loadTestCatalog();
    loadCredits();
  }, []);

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
            // Credits ran out — pause playback
            audioRef.current?.pause();
            setIsPlaying(false);
          }
        } catch (e) {
          console.error("Stream tick failed:", e);
        }
      }, 60000); // 60 seconds
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
    const loaded: Track[] = [];

    for (const artistGroup of TEST_CATALOG) {
      for (const title of artistGroup.tracks) {
        try {
          // Resolve the absolute path to the test file
          const filePath = await resolveTestPath(artistGroup.artist, title);
          const result = await invoke<LocalLoadResult>("playback_load_local", { filePath });
          loaded.push({
            title,
            artist: artistGroup.artist,
            hash: result.hash,
            cachePath: result.cache_path,
            audioSrc: convertFileSrc(result.cache_path),
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
    // Map artist name to folder name
    const folderMap: Record<string, string> = {
      "Satoshi Sounds": "satoshi-sounds",
      "Keypair": "keypair",
      "The Relay Operators": "the-relay-operators",
      "Lightning Louise": "lightning-louise",
    };
    const folder = folderMap[artist] || artist.toLowerCase().replace(/\s+/g, "-");

    // Get the app's resource directory (or use absolute path for dev)
    // In dev, test-data is relative to the project root
    const base = "/Users/mloseke/Documents/Ephemeral Empire/matt - projects/lightning-fm/app-desktop/test-data";
    return `${base}/${folder}/${title}.mp3`;
  }

  async function playTrack(track: Track) {
    // Stop current session if any
    if (session) {
      try { await invoke("stream_stop"); } catch {}
    }

    setActiveTrack(track);
    setSatsPaid(0);

    // Start streaming session
    try {
      const newSession = await invoke<StreamSession>("stream_start", {
        trackId: track.hash,
        artistPubkey: "test-artist-" + track.artist.toLowerCase().replace(/\s+/g, "-"),
        artistDirect: true,
      });
      setSession(newSession);
    } catch (e) {
      console.error("Failed to start stream:", e);
    }

    // Play audio
    if (audioRef.current) {
      audioRef.current.src = track.audioSrc;
      audioRef.current.play();
      setIsPlaying(true);
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
    <div className="min-h-screen flex flex-col bg-background">
      {/* ── Status Bar ── */}
      <div className="h-8 flex items-center px-4 gap-4 border-b border-border bg-background">
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

      {/* ── Main Content ── */}
      <div className="flex flex-1 overflow-hidden">
        {/* ── Nav ── */}
        <div className="w-48 border-r border-border p-4 flex flex-col gap-1">
          <span className="font-label-mono text-muted-foreground uppercase tracking-wider mb-2">Navigate</span>
          <span className="font-body-mono text-amber px-2 py-1 bg-amber/10 border border-amber">≡ Library</span>
          <span className="font-body-mono text-secondary-foreground px-2 py-1 hover:text-foreground cursor-pointer">◎ Discover</span>
          <span className="font-body-mono text-secondary-foreground px-2 py-1 hover:text-foreground cursor-pointer">◉ Dashboard</span>
          <span className="font-body-mono text-secondary-foreground px-2 py-1 hover:text-foreground cursor-pointer">⚙ Settings</span>
        </div>

        {/* ── Track Table ── */}
        <div className="flex-1 overflow-y-auto">
          {loading ? (
            <div className="flex items-center justify-center h-full">
              <div className="text-center">
                <div className="w-5 h-5 border-2 border-border border-t-amber rounded-full animate-spin mx-auto mb-3" />
                <span className="font-body-mono text-muted-foreground">Loading catalog...</span>
              </div>
            </div>
          ) : (
            <div className="p-4">
              <div className="font-label-mono text-muted-foreground uppercase tracking-wider mb-3">
                Top Tracks
              </div>
              <table className="w-full">
                <thead>
                  <tr className="border-b border-border">
                    <th className="font-label-mono text-muted-foreground uppercase tracking-wider text-left py-2 px-2">#</th>
                    <th className="font-label-mono text-muted-foreground uppercase tracking-wider text-left py-2 px-2">Track</th>
                    <th className="font-label-mono text-muted-foreground uppercase tracking-wider text-left py-2 px-2">Artist</th>
                  </tr>
                </thead>
                <tbody>
                  {tracks.map((track, i) => (
                    <tr
                      key={track.hash}
                      className={`border-b border-border cursor-pointer transition-all hover:bg-amber/5 ${
                        activeTrack?.hash === track.hash ? "bg-amber/10" : ""
                      }`}
                      onClick={() => playTrack(track)}
                    >
                      <td className="font-label-mono text-muted-foreground py-2 px-2 w-10 tabular-nums">
                        {activeTrack?.hash === track.hash && isPlaying ? (
                          <span className="text-amber">▶</span>
                        ) : (
                          i + 1
                        )}
                      </td>
                      <td className="font-body-mono text-foreground py-2 px-2">
                        {track.title}
                      </td>
                      <td className="font-body-mono text-secondary-foreground py-2 px-2">
                        {track.artist}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {/* ── Player Bar ── */}
      {activeTrack && (
        <div className="h-16 border-t border-border bg-card flex items-center px-4 gap-4">
          {/* Track info */}
          <div className="w-48 min-w-0">
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
                // Previous track
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
          // Auto-advance to next track
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
