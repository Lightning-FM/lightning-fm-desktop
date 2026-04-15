import { useState, useEffect, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { UploadView } from "./components/upload";
import { LibraryView } from "./components/library";
import { PaymentNotification } from "./components/PaymentNotification";
import { DashboardView } from "./components/dashboard";
import { OnboardingView } from "./components/onboarding";
import { StatusBar } from "./components/StatusBar";
import { PlayerBar } from "./components/player/PlayerBar";
import { usePlayback } from "./hooks/usePlayback";
import { useStreaming } from "./hooks/useStreaming";
import type { LibraryTrack } from "./components/library";
import type { IdentityInfo, CatalogItem } from "./types/streaming";
import "./globals.css";

// ─── Views ──────────────────────────────────────────────────

type View = "library" | "upload" | "discover" | "dashboard" | "settings";

// ─── App ────────────────────────────────────────────────────

function App() {
  const [identity, setIdentity] = useState<IdentityInfo | null>(null);
  const [view, setView] = useState<View>("library");
  const [tracks, setTracks] = useState<LibraryTrack[]>([]);
  const [loading, setLoading] = useState(true);

  const { state: playback, actions: playbackActions, refs: playbackRefs } = usePlayback();
  const { state: streaming, actions: streamingActions } = useStreaming(
    playback.isPlaying,
    playbackRefs.audioRef,
    playbackActions.setIsPlaying,
  );

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
      streamingActions.loadCredits();
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

  // Global keyboard shortcuts — togglePlayPause is stable (uses refs internally)
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.metaKey && e.key === "u") {
        e.preventDefault();
        setView((v) => (v === "upload" ? "library" : "upload"));
      }
      // Spacebar to toggle play/pause (when not in an input)
      if (e.key === " " && !(e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLSelectElement)) {
        e.preventDefault();
        playbackActions.togglePlayPause();
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [playbackActions]);

  // Stable callback for LibraryView queue updates
  const handleQueueChange = useCallback((visibleTracks: LibraryTrack[]) => {
    playbackRefs.playQueueRef.current = visibleTracks;
  }, [playbackRefs]);

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
        artworkDataUrl: t.imageUrl || t.artistPicture || null,
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

  // Combined play: starts audio + streaming session in parallel
  const handlePlayTrack = useCallback(async (track: LibraryTrack) => {
    // Start streaming session in parallel — doesn't block playback
    streamingActions.startStreamSession(track, identity);

    try {
      await playbackActions.playTrack(track);
    } catch (e) {
      console.error("Audio play failed:", e);
    }
  }, [identity, playbackActions.playTrack, streamingActions.startStreamSession]);

  // Prev/next track navigation for PlayerBar
  const handlePrevTrack = useCallback(() => {
    if (!playback.activeTrack) return;
    const queue = playbackRefs.playQueueRef.current.length > 0 ? playbackRefs.playQueueRef.current : tracks;
    const idx = queue.findIndex(t => t.hash === playback.activeTrack!.hash);
    if (idx > 0) handlePlayTrack(queue[idx - 1]);
  }, [playback.activeTrack, tracks, handlePlayTrack]);

  const handleNextTrack = useCallback(() => {
    if (!playback.activeTrack) return;
    const queue = playbackRefs.playQueueRef.current.length > 0 ? playbackRefs.playQueueRef.current : tracks;
    const idx = queue.findIndex(t => t.hash === playback.activeTrack!.hash);
    if (idx < queue.length - 1) handlePlayTrack(queue[idx + 1]);
  }, [playback.activeTrack, tracks, handlePlayTrack]);

  // Show onboarding if user explicitly navigates to it
  if (view === "settings" && !identity) {
    return <OnboardingView onComplete={(id) => { setIdentity(id); setView("library"); }} />;
  }

  return (
    <div className="h-screen flex flex-col bg-background overflow-hidden">
      {/* ── Payment Notification (floating) ── */}
      <PaymentNotification event={streaming.paymentEvent} />

      {/* ── Status Bar (pinned top) ── */}
      <StatusBar
        trackCount={tracks.length}
        identity={identity}
        credits={streaming.credits}
        satsPaid={streaming.satsPaid}
        hasSession={!!streaming.session}
        onSignIn={() => setView("settings")}
      />

      {/* ── Main Content (fills between status bar and player bar) ── */}
      <div className="flex flex-1 min-h-0">
        {/* ── Nav (pinned left) ── */}
        <div className="shrink-0 w-48 border-r border-border p-4 flex flex-col gap-1 overflow-y-auto">
          <span className="font-label-mono text-muted-foreground uppercase tracking-wider mb-2">Navigate</span>
          {([
            { id: "library" as View, icon: "\u2261", label: "Library" },
            { id: "upload" as View, icon: "\u2191", label: "Upload", shortcut: "\u2318U" },
            { id: "discover" as View, icon: "\u25CE", label: "Discover" },
            { id: "dashboard" as View, icon: "\u25C9", label: "Dashboard" },
            { id: "settings" as View, icon: "\u2699", label: "Settings" },
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
              activeTrackHash={playback.activeTrack?.hash || null}
              isPlaying={playback.isPlaying}
              onPlay={handlePlayTrack}
              onQueueChange={handleQueueChange}
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
      {playback.activeTrack && (
        <PlayerBar
          activeTrack={playback.activeTrack}
          isPlaying={playback.isPlaying}
          currentTime={playback.currentTime}
          duration={playback.duration}
          session={streaming.session}
          onTogglePlayPause={playbackActions.togglePlayPause}
          onSeek={playbackActions.seek}
          onPrevTrack={handlePrevTrack}
          onNextTrack={handleNextTrack}
          formatTime={playbackActions.formatTime}
        />
      )}

      {/* Hidden audio element */}
      <audio
        ref={playbackRefs.audioRef}
        onTimeUpdate={playbackActions.handleTimeUpdate}
        onLoadedMetadata={playbackActions.handleLoadedMetadata}
        onEnded={() => {
          if (playback.activeTrack) {
            const queue = playbackRefs.playQueueRef.current.length > 0 ? playbackRefs.playQueueRef.current : tracks;
            const idx = queue.findIndex(t => t.hash === playback.activeTrack!.hash);
            if (idx < queue.length - 1) {
              handlePlayTrack(queue[idx + 1]);
            } else {
              playbackActions.setIsPlaying(false);
            }
          }
        }}
      />
    </div>
  );
}

export default App;
