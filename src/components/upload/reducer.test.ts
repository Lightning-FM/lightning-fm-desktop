// Tests for the upload state reducer

import { describe, it, expect } from "vitest";
import { uploadReducer, initialUploadState } from "./reducer";
import type { UploadTrack, UploadState } from "./types";

// Helper to create a minimal test track
function makeTrack(overrides: Partial<UploadTrack> = {}): UploadTrack {
  return {
    id: overrides.id || `track-${Math.random().toString(36).slice(2)}`,
    filePath: "/test/song.mp3",
    fileName: "song.mp3",
    title: "Test Song",
    artist: "Test Artist",
    album: "Test Album",
    trackNumber: 1,
    genre: "Electronic",
    tags: [],
    year: "2026",
    lyrics: "",
    credits: "",
    description: "",
    isExplicit: false,
    isrc: "",
    duration: 180,
    format: "MP3",
    bitDepth: null,
    sampleRate: 44100,
    fileSize: 5000000,
    artworkPath: null,
    artworkDataUrl: null,
    embeddedArtwork: false,
    waveform: null,
    stage: "draft",
    progress: 0,
    error: null,
    sha256: null,
    audioUrl: null,
    eventId: null,
    ...overrides,
  };
}

// ─── ADD_FILES ─────────────────────────────────────────────────

describe("ADD_FILES", () => {
  it("adds tracks to empty state", () => {
    const tracks = [makeTrack({ id: "t1" }), makeTrack({ id: "t2" })];
    const state = uploadReducer(initialUploadState, {
      type: "ADD_FILES",
      tracks,
    });

    expect(state.tracks).toHaveLength(2);
    expect(state.tracks[0].id).toBe("t1");
    expect(state.tracks[1].id).toBe("t2");
  });

  it("auto-selects first track when none selected", () => {
    const tracks = [makeTrack({ id: "t1" })];
    const state = uploadReducer(initialUploadState, {
      type: "ADD_FILES",
      tracks,
    });

    expect(state.selectedTrackIds).toEqual(["t1"]);
  });

  it("preserves existing selection when adding more files", () => {
    const initial: UploadState = {
      ...initialUploadState,
      tracks: [makeTrack({ id: "t1" })],
      selectedTrackIds: ["t1"],
    };
    const state = uploadReducer(initial, {
      type: "ADD_FILES",
      tracks: [makeTrack({ id: "t2" })],
    });

    expect(state.selectedTrackIds).toEqual(["t1"]);
    expect(state.tracks).toHaveLength(2);
  });

  it("assigns track numbers sequentially from existing count", () => {
    const initial: UploadState = {
      ...initialUploadState,
      tracks: [makeTrack({ id: "t1", trackNumber: 1 })],
      selectedTrackIds: ["t1"],
    };
    const state = uploadReducer(initial, {
      type: "ADD_FILES",
      tracks: [makeTrack({ id: "t2", trackNumber: 0 })],
    });

    expect(state.tracks[1].trackNumber).toBe(2);
  });

  it("auto-fills album name from first track with album tag", () => {
    const tracks = [makeTrack({ album: "My Album" })];
    const state = uploadReducer(initialUploadState, {
      type: "ADD_FILES",
      tracks,
    });

    expect(state.albumName).toBe("My Album");
  });
});

// ─── SELECT ────────────────────────────────────────────────────

describe("SELECT_TRACK", () => {
  it("selects a single track", () => {
    const initial: UploadState = {
      ...initialUploadState,
      tracks: [makeTrack({ id: "t1" }), makeTrack({ id: "t2" })],
      selectedTrackIds: ["t1"],
    };
    const state = uploadReducer(initial, {
      type: "SELECT_TRACK",
      id: "t2",
    });

    expect(state.selectedTrackIds).toEqual(["t2"]);
  });
});

describe("SELECT_ALL", () => {
  it("selects all tracks", () => {
    const initial: UploadState = {
      ...initialUploadState,
      tracks: [makeTrack({ id: "t1" }), makeTrack({ id: "t2" }), makeTrack({ id: "t3" })],
      selectedTrackIds: ["t1"],
    };
    const state = uploadReducer(initial, { type: "SELECT_ALL" });

    expect(state.selectedTrackIds).toEqual(["t1", "t2", "t3"]);
  });
});

describe("DESELECT_ALL", () => {
  it("clears selection", () => {
    const initial: UploadState = {
      ...initialUploadState,
      tracks: [makeTrack({ id: "t1" })],
      selectedTrackIds: ["t1"],
    };
    const state = uploadReducer(initial, { type: "DESELECT_ALL" });

    expect(state.selectedTrackIds).toEqual([]);
  });
});

// ─── UPDATE_TRACK ──────────────────────────────────────────────

describe("UPDATE_TRACK", () => {
  it("updates a specific track's metadata", () => {
    const initial: UploadState = {
      ...initialUploadState,
      tracks: [makeTrack({ id: "t1", title: "Old Title" })],
      selectedTrackIds: [],
    };
    const state = uploadReducer(initial, {
      type: "UPDATE_TRACK",
      id: "t1",
      updates: { title: "New Title" },
    });

    expect(state.tracks[0].title).toBe("New Title");
  });

  it("does not affect other tracks", () => {
    const initial: UploadState = {
      ...initialUploadState,
      tracks: [
        makeTrack({ id: "t1", title: "Song A" }),
        makeTrack({ id: "t2", title: "Song B" }),
      ],
      selectedTrackIds: [],
    };
    const state = uploadReducer(initial, {
      type: "UPDATE_TRACK",
      id: "t1",
      updates: { title: "Changed" },
    });

    expect(state.tracks[0].title).toBe("Changed");
    expect(state.tracks[1].title).toBe("Song B");
  });
});

// ─── UPDATE_SELECTED ───────────────────────────────────────────

describe("UPDATE_SELECTED", () => {
  it("updates all selected tracks (batch edit)", () => {
    const initial: UploadState = {
      ...initialUploadState,
      tracks: [
        makeTrack({ id: "t1", genre: "" }),
        makeTrack({ id: "t2", genre: "" }),
        makeTrack({ id: "t3", genre: "" }),
      ],
      selectedTrackIds: ["t1", "t3"],
    };
    const state = uploadReducer(initial, {
      type: "UPDATE_SELECTED",
      updates: { genre: "Electronic" },
    });

    expect(state.tracks[0].genre).toBe("Electronic");
    expect(state.tracks[1].genre).toBe(""); // not selected
    expect(state.tracks[2].genre).toBe("Electronic");
  });
});

// ─── REORDER_TRACKS ────────────────────────────────────────────

describe("REORDER_TRACKS", () => {
  it("moves a track and renumbers", () => {
    const initial: UploadState = {
      ...initialUploadState,
      tracks: [
        makeTrack({ id: "t1", trackNumber: 1 }),
        makeTrack({ id: "t2", trackNumber: 2 }),
        makeTrack({ id: "t3", trackNumber: 3 }),
      ],
      selectedTrackIds: [],
    };
    const state = uploadReducer(initial, {
      type: "REORDER_TRACKS",
      fromIndex: 2,
      toIndex: 0,
    });

    expect(state.tracks[0].id).toBe("t3");
    expect(state.tracks[1].id).toBe("t1");
    expect(state.tracks[2].id).toBe("t2");
    // Track numbers renumbered
    expect(state.tracks[0].trackNumber).toBe(1);
    expect(state.tracks[1].trackNumber).toBe(2);
    expect(state.tracks[2].trackNumber).toBe(3);
  });
});

// ─── REMOVE_TRACK ──────────────────────────────────────────────

describe("REMOVE_TRACK", () => {
  it("removes a track and renumbers", () => {
    const initial: UploadState = {
      ...initialUploadState,
      tracks: [
        makeTrack({ id: "t1", trackNumber: 1 }),
        makeTrack({ id: "t2", trackNumber: 2 }),
        makeTrack({ id: "t3", trackNumber: 3 }),
      ],
      selectedTrackIds: ["t2"],
    };
    const state = uploadReducer(initial, { type: "REMOVE_TRACK", id: "t2" });

    expect(state.tracks).toHaveLength(2);
    expect(state.tracks[0].id).toBe("t1");
    expect(state.tracks[1].id).toBe("t3");
    expect(state.tracks[1].trackNumber).toBe(2); // renumbered
    expect(state.selectedTrackIds).toEqual([]); // removed from selection
  });
});

// ─── SET_STAGE ─────────────────────────────────────────────────

describe("SET_STAGE", () => {
  it("transitions upload stage", () => {
    const initial: UploadState = {
      ...initialUploadState,
      tracks: [makeTrack({ id: "t1", stage: "draft" })],
      selectedTrackIds: [],
    };
    const state = uploadReducer(initial, {
      type: "SET_STAGE",
      id: "t1",
      stage: "uploading",
      progress: 25,
    });

    expect(state.tracks[0].stage).toBe("uploading");
    expect(state.tracks[0].progress).toBe(25);
    expect(state.tracks[0].error).toBeNull();
  });

  it("sets error message on error stage", () => {
    const initial: UploadState = {
      ...initialUploadState,
      tracks: [makeTrack({ id: "t1", stage: "uploading" })],
      selectedTrackIds: [],
    };
    const state = uploadReducer(initial, {
      type: "SET_STAGE",
      id: "t1",
      stage: "error",
      error: "Network timeout",
    });

    expect(state.tracks[0].stage).toBe("error");
    expect(state.tracks[0].error).toBe("Network timeout");
  });
});

// ─── MARK_PUBLISHED ────────────────────────────────────────────

describe("MARK_PUBLISHED", () => {
  it("sets track to live with publish data", () => {
    const initial: UploadState = {
      ...initialUploadState,
      tracks: [makeTrack({ id: "t1", stage: "publishing" })],
      selectedTrackIds: [],
    };
    const state = uploadReducer(initial, {
      type: "MARK_PUBLISHED",
      id: "t1",
      sha256: "abc123",
      audioUrl: "https://media.lightning.fm/abc123",
      eventId: "event-xyz",
    });

    expect(state.tracks[0].stage).toBe("live");
    expect(state.tracks[0].progress).toBe(100);
    expect(state.tracks[0].sha256).toBe("abc123");
    expect(state.tracks[0].audioUrl).toBe("https://media.lightning.fm/abc123");
    expect(state.tracks[0].eventId).toBe("event-xyz");
  });
});

// ─── SET_ALBUM_ARTWORK ─────────────────────────────────────────

describe("SET_ALBUM_ARTWORK", () => {
  it("sets album artwork", () => {
    const state = uploadReducer(initialUploadState, {
      type: "SET_ALBUM_ARTWORK",
      path: "/art.jpg",
      dataUrl: "data:image/jpeg;base64,abc",
    });

    expect(state.albumArtworkPath).toBe("/art.jpg");
    expect(state.albumArtworkDataUrl).toBe("data:image/jpeg;base64,abc");
  });
});

// ─── SET_DRAGGING ──────────────────────────────────────────────

describe("SET_DRAGGING", () => {
  it("toggles drag state", () => {
    const on = uploadReducer(initialUploadState, {
      type: "SET_DRAGGING",
      isDragging: true,
    });
    expect(on.isDraggingOver).toBe(true);

    const off = uploadReducer(on, {
      type: "SET_DRAGGING",
      isDragging: false,
    });
    expect(off.isDraggingOver).toBe(false);
  });
});
