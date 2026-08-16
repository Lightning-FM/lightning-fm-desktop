// Upload view — orchestrates the 3-pane upload experience
// Drop zone (initial) → Track list | Detail | Preview (after files added)

import { useReducer, useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { open } from "@tauri-apps/plugin-dialog";
import type { UploadTrack } from "./types";
import { uploadReducer, initialUploadState } from "./reducer";
import { DropZone } from "./DropZone";
import { TrackList } from "./TrackList";
import { TrackDetail } from "./TrackDetail";
import { PreviewPane } from "./PreviewPane";
import { IdentityGate } from "./IdentityGate";
import { PublishConfirmation } from "./PublishConfirmation";

// Result from upload_track Tauri command — matches Rust TrackInfo struct
interface TrackInfo {
  event_id: string;
  artist_pubkey: string;
  artist_npub: string;
  title: string;
  slug: string;
  duration_secs: number | null;
  audio_hash: string | null;
  audio_url: string | null;
  fallback_url: string | null;
  mime_type: string | null;
  file_size: number | null;
  preview_secs: number | null;
  lightning_node_id: string | null;
  image_url: string | null;
  created_at: number;
}

// Result from identity_check Tauri command
interface IdentityInfo {
  npub: string;
  pubkey_hex: string;
  has_nsec: boolean;
  display_name: string | null;
}

let nextId = 1;
function genId(): string {
  return `upload-${nextId++}-${Date.now()}`;
}

function slugify(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

function extensionToFormat(ext: string): string {
  const map: Record<string, string> = {
    wav: "WAV",
    flac: "FLAC",
    aiff: "AIFF",
    aif: "AIFF",
    mp3: "MP3",
    ogg: "OGG",
    m4a: "M4A",
    aac: "AAC",
    opus: "OPUS",
  };
  return map[ext.toLowerCase()] || ext.toUpperCase();
}

interface UploadViewProps {
  /** The artist's track count in the catalog as of app load — 0 means the
      next successful publish is their first, which earns the kickoff moment */
  ownTrackCount?: number;
}

export function UploadView({ ownTrackCount = 0 }: UploadViewProps) {
  const [state, dispatch] = useReducer(uploadReducer, initialUploadState);
  const [identity, setIdentity] = useState<IdentityInfo | null | undefined>(undefined);
  const [showIdentityGate, setShowIdentityGate] = useState(false);
  const [publishingInProgress, setPublishingInProgress] = useState(false);
  // Seller endpoint (artist's always-on daemon) — shared across tracks,
  // persisted locally until it moves to proper settings
  const [sellerEndpoint, setSellerEndpoint] = useState(
    () => localStorage.getItem("lfm_seller_endpoint") || ""
  );
  // How to sell: the hosted gate (free tier, no node) or the artist's own
  // daemon. Gate is the default — running a node is the opt-in.
  const [sellVia, setSellVia] = useState<"gate" | "node">(
    () => (localStorage.getItem("lfm_sell_via") === "node" ? "node" : "gate")
  );

  function handleSellerEndpointChange(value: string) {
    setSellerEndpoint(value);
    localStorage.setItem("lfm_seller_endpoint", value);
  }

  // Wallet pre-check feedback for the gate sell path (Phase 4)
  const [walletNotice, setWalletNotice] = useState<{
    kind: "checking" | "error";
    text: string;
  } | null>(null);

  // Real per-stage progress from the Rust upload pipeline. Track stages
  // move the per-track bar; artifact stages (post-publish sale upload)
  // surface in the footer notice since the track already reads "live".
  const tracksRef = useRef(state.tracks);
  tracksRef.current = state.tracks;
  useEffect(() => {
    const stageMap: Record<string, "uploading" | "publishing"> = {
      audio: "uploading",
      artwork: "uploading",
      publish: "publishing",
    };
    const artifactLabels: Record<string, string> = {
      artifact_hash: "hashing the sale file",
      artifact_presign: "reserving hosted storage",
      artifact_upload: "uploading the sale file",
      artifact_register: "registering the listing",
    };
    const unlisten = listen<{ slug: string; stage: string; progress: number }>(
      "upload-progress",
      (event) => {
        const { slug, stage, progress } = event.payload;
        const mapped = stageMap[stage];
        if (mapped) {
          const track = tracksRef.current.find(
            (t) => slugify(t.title) === slug
          );
          if (track) {
            dispatch({ type: "SET_STAGE", id: track.id, stage: mapped, progress });
          }
        } else if (artifactLabels[stage]) {
          setWalletNotice({
            kind: "checking",
            text: `Sale listing: ${artifactLabels[stage]}…`,
          });
        }
      }
    );
    return () => {
      unlisten.then((fn) => fn());
    };
  }, []);

  function handleSellViaChange(value: "gate" | "node") {
    setSellVia(value);
    localStorage.setItem("lfm_sell_via", value);
  }

  const selectedTrack = state.tracks.find((t) =>
    state.selectedTrackIds.includes(t.id)
  );

  // Check identity on mount
  useEffect(() => {
    checkIdentity();
  }, []);

  async function checkIdentity() {
    try {
      const info = await invoke<IdentityInfo | null>("identity_check");
      setIdentity(info);
    } catch {
      setIdentity(null);
    }
  }

  // Keyboard shortcuts
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      // cmd+S -- save draft
      if (e.metaKey && e.key === "s") {
        e.preventDefault();
        // TODO: persist draft state to disk
      }
      // cmd+Enter -- publish
      if (e.metaKey && e.key === "Enter") {
        e.preventDefault();
        handlePublish();
      }
      // cmd+A -- select all (when in upload view)
      if (e.metaKey && e.key === "a" && state.tracks.length > 0) {
        e.preventDefault();
        dispatch({ type: "SELECT_ALL" });
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [state.selectedTrackIds, state.tracks]);

  // Handle files selected via drop or browse.
  // Paths come from the Tauri dialog / drag-drop event — real filesystem
  // paths, since the Rust side reads the file directly.
  const handleFilesSelected = useCallback(async (paths: string[]) => {
    // Directories are expanded to the audio files they contain
    const expanded = await invoke<string[]>("expand_audio_paths", { paths });
    if (expanded.length === 0) return;

    const newTracks: UploadTrack[] = expanded.map((filePath, index) => {
      const fileName = filePath.split("/").pop() || filePath;
      const ext = fileName.split(".").pop() || "";
      const nameWithoutExt = fileName.replace(/\.[^.]+$/, "");

      return {
        id: genId(),
        filePath,
        fileName,

        // Defaults — will be overwritten by ID3 tag reading
        title: nameWithoutExt,
        artist: "",
        album: "",
        trackNumber: index + 1,
        genre: "",
        tags: [],
        year: "",
        lyrics: "",
        credits: "",
        description: "",
        isExplicit: false,
        isrc: "",

        // Audio info from File API (approximate -- Rust will give exact values)
        duration: 0,
        format: extensionToFormat(ext),
        bitDepth: null,
        sampleRate: null,
        fileSize: 0, // filled in by metadata_read

        // Artwork
        artworkPath: null,
        artworkDataUrl: null,
        embeddedArtwork: false,

        // Waveform
        waveform: null,

        // Sale — off by default; artist opts in per track
        sellEnabled: false,
        priceSats: 5000,
        nameYourPrice: false,
        floorSats: 0,

        // State
        stage: "draft",
        progress: 0,
        error: null,

        // Post-publish
        sha256: null,
        audioUrl: null,
        eventId: null,
        artistNpub: null,
        relayPublished: false,
      };
    });

    dispatch({ type: "ADD_FILES", tracks: newTracks });

    // For each file, read metadata + artwork + waveform in parallel via Rust
    for (const track of newTracks) {
      enrichTrack(track.id, track.filePath);
    }
  }, []);

  // Read ID3/Vorbis tags, extract artwork, generate waveform for a track
  async function enrichTrack(trackId: string, filePath: string) {
    // 1. Read metadata (tags + audio properties)
    try {
      const meta = await invoke<{
        title: string | null;
        artist: string | null;
        album: string | null;
        track_number: number | null;
        genre: string | null;
        year: string | null;
        lyrics: string | null;
        has_artwork: boolean;
        duration_secs: number;
        sample_rate: number | null;
        bit_depth: number | null;
        channels: number | null;
        format: string;
      }>("metadata_read", { filePath });

      dispatch({
        type: "UPDATE_TRACK",
        id: trackId,
        updates: {
          title: meta.title || undefined,
          artist: meta.artist || undefined,
          album: meta.album || undefined,
          trackNumber: meta.track_number || undefined,
          genre: meta.genre || undefined,
          year: meta.year || undefined,
          lyrics: meta.lyrics || undefined,
          duration: meta.duration_secs,
          sampleRate: meta.sample_rate,
          bitDepth: meta.bit_depth,
          format: meta.format,
        } as Partial<UploadTrack>,
      });
    } catch (e) {
      console.warn(`Failed to read metadata for ${filePath}:`, e);
    }

    // 2. Extract embedded artwork
    try {
      const artwork = await invoke<{
        data_url: string;
        mime_type: string;
      } | null>("artwork_extract", { filePath });

      if (artwork) {
        dispatch({
          type: "UPDATE_TRACK",
          id: trackId,
          updates: {
            artworkDataUrl: artwork.data_url,
            embeddedArtwork: true,
          },
        });
        dispatch({
          type: "SET_ALBUM_ARTWORK",
          path: null,
          dataUrl: artwork.data_url,
        });
      }
    } catch (e) {
      console.warn(`Failed to extract artwork for ${filePath}:`, e);
    }

    // 3. Generate waveform peaks
    try {
      const waveform = await invoke<{
        peaks: number[];
        duration_secs: number;
      }>("waveform_generate", { filePath });

      dispatch({
        type: "UPDATE_TRACK",
        id: trackId,
        updates: {
          waveform: waveform.peaks,
          duration: waveform.duration_secs,
        },
      });
    } catch (e) {
      console.warn(`Failed to generate waveform for ${filePath}:`, e);
    }
  }

  // Handle artwork selected for album/selected track
  const handleArtworkSelected = useCallback(
    (file: File) => {
      const reader = new FileReader();
      reader.onload = () => {
        const dataUrl = reader.result as string;
        dispatch({
          type: "SET_ALBUM_ARTWORK",
          path: (file as File & { path?: string }).path || file.name,
          dataUrl,
        });
      };
      reader.readAsDataURL(file);
    },
    []
  );

  // Publish all draft tracks
  async function handlePublish() {
    // Check identity first -- required for Blossom auth + Nostr signing
    if (!identity) {
      setShowIdentityGate(true);
      return;
    }

    const drafts = state.tracks.filter(
      (t) => t.stage === "draft" || t.stage === "error"
    );
    if (drafts.length === 0) return;

    // Selling through the gate? Prove the payout address works BEFORE any
    // artifact leaves this machine (Phase 4) — one check for the whole
    // batch, not one per track. The gate re-enforces server-side; this
    // exists so a broken wallet fails in seconds, not after a 500MB upload.
    setWalletNotice(null);
    if (sellVia === "gate" && drafts.some((t) => t.sellEnabled)) {
      setWalletNotice({
        kind: "checking",
        text: "Checking your wallet: we request a test invoice to confirm it works. It is never paid and expires on its own.",
      });
      try {
        const profile = await invoke<{ lud16: string | null } | null>(
          "profile_fetch"
        );
        const lud16 = profile?.lud16?.trim();
        if (!lud16) {
          setWalletNotice({
            kind: "error",
            text: "Set a Lightning address in Settings first — that is where your money goes.",
          });
          return;
        }
        const check = await invoke<{
          ok: boolean;
          lud16: string;
          verify_supported: boolean;
          error: string | null;
        }>("wallet_check", { lud16 });
        if (!check.ok) {
          setWalletNotice({
            kind: "error",
            text: `Your Lightning address (${check.lud16}) didn't return an invoice: ${check.error ?? "unknown error"}. Fix it in Settings, then publish again.`,
          });
          return;
        }
        if (!check.verify_supported) {
          setWalletNotice({
            kind: "error",
            text: `Your wallet (${check.lud16}) can't confirm payments (no LUD-21 support), so buyers couldn't unlock downloads. Switch to a wallet like Coinos or Alby, update Settings, then publish again.`,
          });
          return;
        }
        setWalletNotice(null);
      } catch {
        // The check itself failed (offline, gate unreachable) — don't
        // block publishing on it; the gate enforces at registration.
        setWalletNotice(null);
      }
    }

    setPublishingInProgress(true);

    for (const track of drafts) {
      // Validate required fields
      if (!track.title.trim()) {
        dispatch({
          type: "SET_STAGE",
          id: track.id,
          stage: "error",
          error: "Title is required",
        });
        continue;
      }

      try {
        // Stage: processing -- writing metadata back to file before hashing
        dispatch({
          type: "SET_STAGE",
          id: track.id,
          stage: "processing",
          progress: 0,
        });

        await invoke("metadata_write", {
          filePath: track.filePath,
          title: track.title || null,
          artist: track.artist || null,
          album: track.album || null,
          trackNumber: track.trackNumber || null,
          genre: track.genre || null,
          year: track.year || null,
          lyrics: track.lyrics || null,
        });

        // Stage: uploading -- Blossom upload + Nostr event publish
        dispatch({
          type: "SET_STAGE",
          id: track.id,
          stage: "uploading",
          progress: 10,
        });

        // upload_track handles: Blossom upload, kind 31337 event creation, relay publish
        const result = await invoke<TrackInfo>("upload_track", {
          filePath: track.filePath,
          title: track.title,
          slug: slugify(track.title),
          durationSecs: track.duration > 0 ? Math.round(track.duration) : undefined,
          // Descriptive metadata rides into the 31337 event — tags become
          // Nostr t tags, description becomes the event content.
          extras: {
            description: track.description || null,
            album: track.album || null,
            genre: track.genre || null,
            year: track.year || null,
            track_number: track.trackNumber || null,
            tags: track.tags,
            credits: track.credits || null,
            isrc: track.isrc || null,
            lyrics: track.lyrics || null,
            explicit: track.isExplicit || null,
          },
        });

        // Stage: publishing -- event was signed and sent to relays
        dispatch({
          type: "SET_STAGE",
          id: track.id,
          stage: "publishing",
          progress: 90,
        });

        // Mark as live with all result data
        dispatch({
          type: "MARK_PUBLISHED",
          id: track.id,
          sha256: result.audio_hash || "",
          audioUrl: result.audio_url || "",
          eventId: result.event_id,
          artistNpub: result.artist_npub,
        });

        // Publish the product listing (kind 30402) when selling is enabled.
        // The track is live either way — a listing failure is surfaced but
        // doesn't roll back the publish.
        if (track.sellEnabled) {
          try {
            // Artifact first: the listing must never point at a product the
            // seller can't deliver
            let productEndpoint: string;
            if (sellVia === "gate") {
              productEndpoint = await invoke<string>(
                "product_upload_artifact_gate",
                {
                  filePath: track.filePath,
                  product: {
                    slug: slugify(track.title),
                    title: track.title,
                    priceSats: track.priceSats,
                    floorSats: track.nameYourPrice ? track.floorSats : null,
                    format: track.format.toLowerCase(),
                  },
                }
              );
            } else {
              if (!sellerEndpoint.trim()) {
                throw new Error(
                  "Seller endpoint not set — add your node URL in the Sell section"
                );
              }
              productEndpoint = sellerEndpoint.trim();
              await invoke("product_upload_artifact", {
                filePath: track.filePath,
                slug: slugify(track.title),
                title: track.title,
                priceSats: track.priceSats,
                floorSats: track.nameYourPrice ? track.floorSats : null,
                format: track.format.toLowerCase(),
                endpoint: productEndpoint,
              });
            }
            await invoke<string>("product_publish", {
              draft: {
                slug: slugify(track.title),
                title: track.title,
                summary: `${track.format} download`,
                description: track.description || null,
                price_sats: track.nameYourPrice ? track.priceSats : track.priceSats,
                floor_sats: track.nameYourPrice ? track.floorSats : null,
                product_type: "track",
                format: track.format.toLowerCase(),
                image_url: null,
                track_refs: [
                  `31337:${result.artist_pubkey}:${slugify(track.title)}`,
                ],
                endpoint: productEndpoint,
              },
            });
            setWalletNotice(null);
          } catch (err) {
            setWalletNotice(null);
            dispatch({
              type: "SET_STAGE",
              id: track.id,
              stage: "error",
              error: `Track published, but sale listing failed: ${String(err)}`,
            });
            continue;
          }
        }
      } catch (err) {
        dispatch({
          type: "SET_STAGE",
          id: track.id,
          stage: "error",
          error: String(err),
        });
      }
    }

    setPublishingInProgress(false);
  }

  // Handle identity created/imported from the gate
  function handleIdentityReady(info: IdentityInfo) {
    setIdentity(info);
    setShowIdentityGate(false);
  }

  // Count by stage for the footer
  const stageCounts = state.tracks.reduce(
    (acc, t) => {
      acc[t.stage] = (acc[t.stage] || 0) + 1;
      return acc;
    },
    {} as Record<string, number>
  );

  const uploading =
    (stageCounts["uploading"] || 0) +
    (stageCounts["processing"] || 0) +
    (stageCounts["mirroring"] || 0) +
    (stageCounts["publishing"] || 0);
  const drafts = stageCounts["draft"] || 0;
  const live = stageCounts["live"] || 0;
  const errors = stageCounts["error"] || 0;

  // All tracks published -- show confirmation
  const allPublished = state.tracks.length > 0 && state.tracks.every((t) => t.stage === "live");

  // Identity gate overlay
  if (showIdentityGate) {
    return (
      <div className="flex flex-col h-full">
        <div className="shrink-0 h-8 flex items-center px-4 border-b border-border">
          <span className="font-label-mono text-amber uppercase tracking-wider">
            Upload
          </span>
          <span className="font-small text-muted-foreground ml-4">
            Identity required
          </span>
        </div>
        <IdentityGate
          onIdentityReady={handleIdentityReady}
          onCancel={() => setShowIdentityGate(false)}
        />
      </div>
    );
  }

  // Show drop zone if no tracks yet
  if (state.tracks.length === 0) {
    return (
      <div className="flex flex-col h-full">
        {/* Header */}
        <div className="shrink-0 h-8 flex items-center px-4 border-b border-border">
          <span className="font-label-mono text-amber uppercase tracking-wider">
            Upload
          </span>
          <span className="font-small text-muted-foreground ml-4">
            <span className="border border-border px-1">cmd+U</span>
          </span>
        </div>

        <DropZone
          isDraggingOver={state.isDraggingOver}
          onDragOver={() => dispatch({ type: "SET_DRAGGING", isDragging: true })}
          onDragLeave={() =>
            dispatch({ type: "SET_DRAGGING", isDragging: false })
          }
          onFilesSelected={handleFilesSelected}
        />
      </div>
    );
  }

  // Post-publish confirmation view
  if (allPublished) {
    return (
      <div className="flex flex-col h-full">
        <div className="shrink-0 h-8 flex items-center px-4 border-b border-border">
          <span className="font-label-mono text-amber uppercase tracking-wider">
            Upload
          </span>
          <span className="font-small text-[var(--success)] ml-4">
            All tracks published
          </span>
        </div>

        <PublishConfirmation
          tracks={state.tracks}
          onUploadMore={() => dispatch({ type: "CLEAR_PUBLISHED" })}
          firstUpload={ownTrackCount === 0}
          npub={identity?.npub ?? null}
        />
      </div>
    );
  }

  // 3-pane layout after files are added
  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="shrink-0 h-8 flex items-center px-4 border-b border-border">
        <span className="font-label-mono text-amber uppercase tracking-wider">
          Upload
        </span>
        <span className="font-small text-muted-foreground ml-4">
          {state.albumName && (
            <span className="text-secondary-foreground mr-3">
              {state.albumName}
            </span>
          )}
          {state.tracks.length} track{state.tracks.length !== 1 ? "s" : ""}
        </span>
        {/* Identity indicator */}
        {identity && (
          <span className="font-small text-muted-foreground ml-auto tabular-nums">
            {identity.display_name || identity.npub.slice(0, 16) + "..."}
          </span>
        )}
      </div>

      {/* 3-pane content */}
      <div className="flex flex-1 min-h-0">
        {/* Left: Track list */}
        <div className="shrink-0 w-56 border-r border-border">
          <TrackList
            tracks={state.tracks}
            selectedTrackIds={state.selectedTrackIds}
            onSelectTrack={(id) => dispatch({ type: "SELECT_TRACK", id })}
            onSelectAll={() => dispatch({ type: "SELECT_ALL" })}
            onReorder={(from, to) =>
              dispatch({ type: "REORDER_TRACKS", fromIndex: from, toIndex: to })
            }
            onRemoveTrack={(id) => dispatch({ type: "REMOVE_TRACK", id })}
          />
        </div>

        {/* Center: Track detail */}
        <div className="flex-1 min-w-0 border-r border-border">
          {selectedTrack ? (
            <TrackDetail
              track={selectedTrack}
              onUpdate={(updates) =>
                dispatch({
                  type: "UPDATE_TRACK",
                  id: selectedTrack.id,
                  updates,
                })
              }
              sellVia={sellVia}
              onSellViaChange={handleSellViaChange}
              sellerEndpoint={sellerEndpoint}
              onSellerEndpointChange={handleSellerEndpointChange}
            />
          ) : (
            <div className="flex items-center justify-center h-full">
              <span className="font-body-mono text-muted-foreground">
                Select a track to edit
              </span>
            </div>
          )}
        </div>

        {/* Right: Preview */}
        <div className="shrink-0 w-56">
          {selectedTrack ? (
            <PreviewPane
              track={selectedTrack}
              albumArtworkDataUrl={state.albumArtworkDataUrl}
              onArtworkSelected={handleArtworkSelected}
            />
          ) : (
            <div className="flex items-center justify-center h-full">
              <span className="font-body-mono text-muted-foreground">
                No track selected
              </span>
            </div>
          )}
        </div>
      </div>

      {/* Wallet pre-check notice (gate sell path) */}
      {walletNotice && (
        <div
          className={`shrink-0 px-4 py-2 border-t border-border font-small ${
            walletNotice.kind === "error"
              ? "text-[var(--error)]"
              : "text-muted-foreground animate-pulse"
          }`}
        >
          {walletNotice.text}
        </div>
      )}

      {/* Footer -- status bar + actions */}
      <div className="shrink-0 h-10 flex items-center px-4 border-t border-border gap-4">
        {/* Status summary */}
        <span className="font-small text-secondary-foreground">
          {state.tracks.length} track{state.tracks.length !== 1 ? "s" : ""}
          {uploading > 0 && (
            <span className="text-amber ml-2">
              · {uploading} uploading
            </span>
          )}
          {drafts > 0 && (
            <span className="text-muted-foreground ml-2">
              · {drafts} draft{drafts !== 1 ? "s" : ""}
            </span>
          )}
          {live > 0 && (
            <span className="text-[var(--success)] ml-2">
              · {live} live
            </span>
          )}
          {errors > 0 && (
            <span className="text-error ml-2">
              · {errors} error{errors !== 1 ? "s" : ""}
            </span>
          )}
        </span>

        <div className="flex-1" />

        {/* Identity status */}
        {!identity && (
          <button
            className="h-7 px-3 border border-warning text-warning font-label-mono uppercase tracking-wider hover:bg-warning/10 transition-all text-[11px]"
            onClick={() => setShowIdentityGate(true)}
          >
            No Identity
          </button>
        )}

        {/* Add more files */}
        <button
          className="h-7 px-3 border border-border text-secondary-foreground font-label-mono uppercase tracking-wider hover:border-[var(--text-muted)] hover:text-foreground transition-all text-[11px]"
          disabled={publishingInProgress}
          onClick={() => {
            open({
              multiple: true,
              directory: false,
              filters: [
                {
                  name: "Audio",
                  extensions: [
                    "wav",
                    "flac",
                    "aiff",
                    "aif",
                    "mp3",
                    "ogg",
                    "m4a",
                    "aac",
                    "opus",
                  ],
                },
              ],
            }).then((selected) => {
              if (!selected) return;
              handleFilesSelected(
                Array.isArray(selected) ? selected : [selected]
              );
            });
          }}
        >
          + Add Files
        </button>

        {/* Publish */}
        <button
          className={`h-7 px-4 border font-label-mono uppercase tracking-wider transition-all text-[11px] ${
            publishingInProgress
              ? "border-amber/40 text-amber/40 cursor-wait"
              : drafts === 0
              ? "border-border text-muted-foreground cursor-not-allowed"
              : "border-amber text-amber hover:bg-amber/10"
          }`}
          onClick={handlePublish}
          disabled={drafts === 0 || publishingInProgress}
        >
          {publishingInProgress
            ? "Publishing..."
            : `Publish${drafts > 0 ? ` (${drafts})` : ""}`}
        </button>
      </div>
    </div>
  );
}
