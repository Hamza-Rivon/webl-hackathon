/**
 * Recording Store
 *
 * Zustand store for managing voiceover recording state.
 * Requirements: 9.5, 9.6
 */

import { create } from 'zustand';

export interface SegmentRecording {
  beatIndex: number;
  uri: string;
  duration: number;
  createdAt: Date;
}

export type RecordingMode = 'full' | 'segment';
export type RecordingStatus = 'idle' | 'recording' | 'paused' | 'completed';

interface RecordingState {
  // Episode context
  episodeId: string | null;
  totalBeats: number;
  
  // Recording mode and status
  mode: RecordingMode;
  status: RecordingStatus;
  
  // Current recording
  currentBeatIndex: number;
  recordingDuration: number;
  
  // Completed segments
  segments: SegmentRecording[];
  
  // Teleprompter settings
  speed: number;
  textSize: number;
  isPlaying: boolean;
}

interface RecordingActions {
  // Initialize for an episode
  initializeForEpisode: (episodeId: string, totalBeats: number) => void;
  
  // Mode and status
  setMode: (mode: RecordingMode) => void;
  setStatus: (status: RecordingStatus) => void;
  
  // Recording progress
  setCurrentBeatIndex: (index: number) => void;
  incrementDuration: () => void;
  resetDuration: () => void;
  
  // Segment management
  addSegment: (segment: Omit<SegmentRecording, 'createdAt'>) => void;
  removeSegment: (beatIndex: number) => void;
  clearSegments: () => void;
  
  // Teleprompter settings
  setSpeed: (speed: number) => void;
  setTextSize: (size: number) => void;
  setIsPlaying: (playing: boolean) => void;
  
  // Computed helpers
  getSegmentForBeat: (beatIndex: number) => SegmentRecording | undefined;
  getRecordedBeatIndices: () => number[];
  getProgress: () => number;
  isAllBeatsRecorded: () => boolean;
  
  // Reset
  reset: () => void;
}

type RecordingStore = RecordingState & RecordingActions;

const initialState: RecordingState = {
  episodeId: null,
  totalBeats: 0,
  mode: 'segment',
  status: 'idle',
  currentBeatIndex: 0,
  recordingDuration: 0,
  segments: [],
  speed: 1.0,
  textSize: 1.0,
  isPlaying: false,
};

export const useRecordingStore = create<RecordingStore>((set, get) => ({
  ...initialState,

  initializeForEpisode: (episodeId, totalBeats) =>
    set({
      ...initialState,
      episodeId,
      totalBeats,
    }),

  setMode: (mode) => set({ mode }),

  setStatus: (status) => set({ status }),

  setCurrentBeatIndex: (index) => set({ currentBeatIndex: index }),

  incrementDuration: () =>
    set((state) => ({ recordingDuration: state.recordingDuration + 1 })),

  resetDuration: () => set({ recordingDuration: 0 }),

  addSegment: (segment) =>
    set((state) => {
      // Remove existing segment for this beat if any
      const filtered = state.segments.filter((s) => s.beatIndex !== segment.beatIndex);
      const newSegment: SegmentRecording = {
        ...segment,
        createdAt: new Date(),
      };
      // Sort by beat index
      const sorted = [...filtered, newSegment].sort((a, b) => a.beatIndex - b.beatIndex);
      return { segments: sorted };
    }),

  removeSegment: (beatIndex) =>
    set((state) => ({
      segments: state.segments.filter((s) => s.beatIndex !== beatIndex),
    })),

  clearSegments: () => set({ segments: [] }),

  setSpeed: (speed) => set({ speed }),

  setTextSize: (textSize) => set({ textSize }),

  setIsPlaying: (isPlaying) => set({ isPlaying }),

  getSegmentForBeat: (beatIndex) => {
    return get().segments.find((s) => s.beatIndex === beatIndex);
  },

  getRecordedBeatIndices: () => {
    return get().segments.map((s) => s.beatIndex);
  },

  getProgress: () => {
    const { segments, totalBeats, mode } = get();
    if (mode === 'full') {
      return segments.length > 0 ? 100 : 0;
    }
    if (totalBeats === 0) return 0;
    return (segments.length / totalBeats) * 100;
  },

  isAllBeatsRecorded: () => {
    const { segments, totalBeats, mode } = get();
    if (mode === 'full') {
      return segments.length > 0;
    }
    return segments.length >= totalBeats;
  },

  reset: () => set(initialState),
}));

/**
 * Hook to get recording progress info
 */
export function useRecordingProgress() {
  const segments = useRecordingStore((state) => state.segments);
  const totalBeats = useRecordingStore((state) => state.totalBeats);
  const mode = useRecordingStore((state) => state.mode);
  const status = useRecordingStore((state) => state.status);

  const recordedCount = segments.length;
  const progress = totalBeats > 0 ? (recordedCount / totalBeats) * 100 : 0;
  const isComplete = mode === 'full' 
    ? segments.length > 0 
    : recordedCount >= totalBeats;

  return {
    recordedCount,
    totalBeats,
    progress,
    isComplete,
    isRecording: status === 'recording',
    segments,
  };
}

/**
 * Hook to check if a specific beat is recorded
 */
export function useBeatRecordingStatus(beatIndex: number) {
  const segments = useRecordingStore((state) => state.segments);
  const currentBeatIndex = useRecordingStore((state) => state.currentBeatIndex);

  const segment = segments.find((s) => s.beatIndex === beatIndex);
  const isRecorded = !!segment;
  const isCurrent = beatIndex === currentBeatIndex;

  return {
    isRecorded,
    isCurrent,
    segment,
  };
}
