// Upload state reducer

import type { UploadState, UploadAction } from "./types";

export const initialUploadState: UploadState = {
  tracks: [],
  selectedTrackIds: [],
  albumArtworkPath: null,
  albumArtworkDataUrl: null,
  albumName: "",
  isDraggingOver: false,
};

export function uploadReducer(state: UploadState, action: UploadAction): UploadState {
  switch (action.type) {
    case "ADD_FILES": {
      const newTracks = action.tracks.map((t, i) => ({
        ...t,
        trackNumber: t.trackNumber || state.tracks.length + i + 1,
      }));
      return {
        ...state,
        tracks: [...state.tracks, ...newTracks],
        // Auto-select first track if none selected
        selectedTrackIds:
          state.selectedTrackIds.length === 0 && newTracks.length > 0
            ? [newTracks[0].id]
            : state.selectedTrackIds,
        // Auto-fill album name from first track if empty
        albumName:
          state.albumName || newTracks.find((t) => t.album)?.album || "",
      };
    }

    case "SELECT_TRACK":
      return { ...state, selectedTrackIds: [action.id] };

    case "SELECT_TRACKS":
      return { ...state, selectedTrackIds: action.ids };

    case "SELECT_ALL":
      return { ...state, selectedTrackIds: state.tracks.map((t) => t.id) };

    case "DESELECT_ALL":
      return { ...state, selectedTrackIds: [] };

    case "UPDATE_TRACK":
      return {
        ...state,
        tracks: state.tracks.map((t) =>
          t.id === action.id ? { ...t, ...action.updates } : t
        ),
      };

    case "UPDATE_SELECTED":
      return {
        ...state,
        tracks: state.tracks.map((t) =>
          state.selectedTrackIds.includes(t.id)
            ? { ...t, ...action.updates }
            : t
        ),
      };

    case "REORDER_TRACKS": {
      const tracks = [...state.tracks];
      const [moved] = tracks.splice(action.fromIndex, 1);
      tracks.splice(action.toIndex, 0, moved);
      // Renumber
      return {
        ...state,
        tracks: tracks.map((t, i) => ({ ...t, trackNumber: i + 1 })),
      };
    }

    case "REMOVE_TRACK":
      return {
        ...state,
        tracks: state.tracks
          .filter((t) => t.id !== action.id)
          .map((t, i) => ({ ...t, trackNumber: i + 1 })),
        selectedTrackIds: state.selectedTrackIds.filter(
          (id) => id !== action.id
        ),
      };

    case "SET_ALBUM_ARTWORK":
      return {
        ...state,
        albumArtworkPath: action.path,
        albumArtworkDataUrl: action.dataUrl,
      };

    case "SET_ALBUM_NAME":
      return { ...state, albumName: action.name };

    case "SET_DRAGGING":
      return { ...state, isDraggingOver: action.isDragging };

    case "SET_STAGE":
      return {
        ...state,
        tracks: state.tracks.map((t) =>
          t.id === action.id
            ? {
                ...t,
                stage: action.stage,
                progress: action.progress ?? t.progress,
                error: action.error ?? null,
              }
            : t
        ),
      };

    case "MARK_PUBLISHED":
      return {
        ...state,
        tracks: state.tracks.map((t) =>
          t.id === action.id
            ? {
                ...t,
                stage: "live",
                progress: 100,
                sha256: action.sha256,
                audioUrl: action.audioUrl,
                eventId: action.eventId,
              }
            : t
        ),
      };

    default:
      return state;
  }
}
