import { useState, useRef, useCallback, useMemo } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { LibraryTrack } from "../components/library";

export interface PlaybackState {
  activeTrack: LibraryTrack | null;
  isPlaying: boolean;
  currentTime: number;
  duration: number;
}

export interface PlaybackActions {
  playTrack: (track: LibraryTrack) => Promise<void>;
  togglePlayPause: () => void;
  seek: (e: React.MouseEvent<HTMLDivElement>) => void;
  formatTime: (secs: number) => string;
  setIsPlaying: (playing: boolean) => void;
  handleTimeUpdate: () => void;
  handleLoadedMetadata: () => void;
}

export interface PlaybackRefs {
  audioRef: React.RefObject<HTMLAudioElement | null>;
  playQueueRef: React.MutableRefObject<LibraryTrack[]>;
}

export interface UsePlaybackReturn {
  state: PlaybackState;
  actions: PlaybackActions;
  refs: PlaybackRefs;
}

export function usePlayback(): UsePlaybackReturn {
  const [activeTrack, setActiveTrack] = useState<LibraryTrack | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const audioRef = useRef<HTMLAudioElement>(null);
  const playQueueRef = useRef<LibraryTrack[]>([]);

  // Refs for stable callbacks — avoids stale closures and unnecessary re-renders
  const isPlayingRef = useRef(isPlaying);
  isPlayingRef.current = isPlaying;
  const activeTrackRef = useRef(activeTrack);
  activeTrackRef.current = activeTrack;
  const durationRef = useRef(duration);
  durationRef.current = duration;

  const playTrack = useCallback(async (track: LibraryTrack) => {
    setActiveTrack(track);

    if (!audioRef.current) return;
    let filePath = track.cachePath;

    // For relay tracks: fetch audio from Blossom CDN, cache it, get local path
    if (!filePath && track.audioUrl && track.hash) {
      const urls = [track.audioUrl];
      const result = await invoke<{ cache_path: string; artist_direct: boolean }>(
        "playback_fetch", { hash: track.hash, urls }
      );
      filePath = result.cache_path;
      track.cachePath = filePath;
    }

    const dataUrl = await invoke<string>("playback_read_audio", { filePath });
    audioRef.current.src = dataUrl;
    audioRef.current.play();
    setIsPlaying(true);
  }, []);

  // Stable reference — reads from refs instead of closing over state
  const togglePlayPause = useCallback(() => {
    if (!audioRef.current || !activeTrackRef.current) return;
    if (isPlayingRef.current) {
      audioRef.current.pause();
      setIsPlaying(false);
      invoke("stream_pause").catch(() => {});
    } else {
      audioRef.current.play();
      setIsPlaying(true);
      invoke("stream_resume").catch(() => {});
    }
  }, []);

  // Stable reference — reads duration from ref
  const seek = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    if (!audioRef.current || !durationRef.current) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const pct = (e.clientX - rect.left) / rect.width;
    audioRef.current.currentTime = pct * durationRef.current;
  }, []);

  const formatTime = useCallback((secs: number): string => {
    const m = Math.floor(secs / 60);
    const s = Math.floor(secs % 60);
    return `${m}:${s.toString().padStart(2, "0")}`;
  }, []);

  const handleTimeUpdate = useCallback(() => {
    setCurrentTime(audioRef.current?.currentTime || 0);
  }, []);

  const handleLoadedMetadata = useCallback(() => {
    setDuration(audioRef.current?.duration || 0);
  }, []);

  // Stable object references so consumers don't re-render from object identity changes
  const actions = useMemo(() => ({
    playTrack, togglePlayPause, seek, formatTime, setIsPlaying, handleTimeUpdate, handleLoadedMetadata,
  }), [playTrack, togglePlayPause, seek, formatTime, handleTimeUpdate, handleLoadedMetadata]);

  const refs = useMemo(() => ({ audioRef, playQueueRef }), []);

  return {
    state: { activeTrack, isPlaying, currentTime, duration },
    actions,
    refs,
  };
}
