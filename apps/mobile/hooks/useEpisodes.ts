/**
 * Episodes Hooks
 *
 * React Query hooks for episode CRUD operations.
 * Requirements: 7.1, 7.5
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useApiClient, CreateEpisodeInput, UpdateEpisodeInput } from '../lib/api';
import { seriesKeys } from './useSeries';
import { useAuthReady } from './useAuthReady';
import { jobKeys } from './useJobProgress';

// Types - Updated to match new Phase 1-5 pipeline statuses
export type EpisodeStatus =
  | 'draft'
  | 'voiceover_uploaded'
  | 'voiceover_cleaning'
  | 'voiceover_cleaned'
  | 'collecting_clips'
  | 'needs_more_clips'
  | 'chunking_clips'
  | 'enriching_chunks'
  | 'matching'
  | 'cut_plan_ready'
  | 'rendering'
  | 'ready'
  | 'published'
  | 'failed';

export interface ScriptBeat {
  beatType: string;
  text: string;
  duration: number;
  startTime: number;
  endTime: number;
}

export interface TranscriptWord {
  word: string;
  startMs: number;
  endMs: number;
  confidence?: number;
}

export interface Episode {
  id: string;
  title: string;
  scriptContent: string | null;
  scriptBeats: ScriptBeat[] | null;
  status: EpisodeStatus;
  voiceoverPath: string | null;
  rawClipPaths: string[];
  proxyPaths: string[];
  finalVideoPath: string | null;
  thumbnailPath: string | null;
  editPlan: unknown | null;
  duration: number | null;
  publishedAt: string | null;
  createdAt: string;
  updatedAt: string;
  seriesId: string | null;
  userId: string;
  templateId: string | null;
  // Phase 6: Render orchestration fields
  revision?: number;
  renderRequested?: boolean;
  renderRequestedAt?: string;
  renderJobId?: string;
}

export interface EpisodeWithSeries extends Episode {
  series: {
    name: string;
  } | null;
}

export interface TemplateSlotRequirements {
  slots: Array<{
    slotId: string;
    slotType: string;
    priority: 'required' | 'optional';
    duration: { min: number; target: number; max: number };
    allowedSources: ('recorded' | 'uploaded')[];
    description: string;
    examples: string[];
    layoutUsage: {
      beatIndices: number[];
      position: string;
    };
  }>;
}

export interface SlotClipSummary {
  id: string;
  slotId: string;
  slotType: string;
  source: 'recorded' | 'uploaded';
  duration?: number;
  muxPlaybackId?: string;
  moderationStatus?: string;
}

export interface TemplateCompile {
  slotPlan?: unknown;
  beatPlan?: unknown;
  complianceScore?: number;
}

export interface EpisodeWithDetails extends Episode {
  series: {
    id: string;
    name: string;
  } | null;
  template: {
    id: string;
    name: string;
    platform: string;
    durationTarget?: number;
    slotRequirements?: TemplateSlotRequirements;
  } | null;
  jobs: Array<{
    id: string;
    type: string;
    status: string;
    progress: number;
    stage?: string | null | undefined;
    errorMessage?: string | null | undefined;
    estimatedTimeRemaining?: number | null | undefined;
  }>;
  // Slot clips for template-driven capture
  slotClips?: SlotClipSummary[];
  slotProgress?: {
    requiredTotal: number;
    requiredCompleted: number;
    optionalTotal: number;
    optionalCompleted: number;
    isComplete: boolean;
  };
  // Template compilation data
  templateCompile?: TemplateCompile;
  // Mux playback references
  muxVoiceoverAssetId?: string;
  muxFinalAssetId?: string;
  muxFinalPlaybackId?: string;
  // Raw voiceover (original recording)
  rawVoiceoverMuxAssetId?: string | null;
  rawVoiceoverPlaybackId?: string | null;
  rawVoiceoverDuration?: number | null;
  cleanVoiceoverMuxAssetId?: string;
  cleanVoiceoverPlaybackId?: string;
  // S3 keys
  finalS3Key?: string;
  cleanVoiceoverS3Key?: string;
  cleanVoiceoverDuration?: number;
  activeVoiceoverPlaybackId?: string | null;
  arollCleanPreviewS3Key?: string | null;
  arollCleanPreviewMuxAssetId?: string | null;
  arollCleanPreviewPlaybackId?: string | null;
  arollCleanPreviewDuration?: number | null;
  wordTranscript?: TranscriptWord[] | null;
  correctedWordTranscript?: TranscriptWord[] | null;
  rawDeepgramResponse?: unknown;
  // Video metadata (available when finalVideoPath exists)
  videoMetadata?: VideoMetadata;
  // Signed URLs from API (generated on request)
  finalVideoUrl?: string | null;
  thumbnailUrl?: string | null;
  // Mux playback URL for streaming
  muxPlaybackUrl?: string | null;
  // Phase-specific data
  voiceoverSegments?: Array<{
    id: string;
    text: string;
    startTime: number;
    endTime: number;
  }>;
  brollChunks?: Array<{
    id: string;
    slotId: string;
    startTime: number;
    endTime: number;
  }>;
  cutPlan?: {
    version: number;
    cuts: Array<{
      chunkId: string;
      timelineStart: number;
      timelineEnd: number;
    }>;
  };
  renderSpec?: unknown;
}

export interface VideoMetadata {
  duration: number;
  width: number;
  height: number;
  fileSize: number;
  format: string;
  bitrate?: number;
  fps?: number;
}

export interface EpisodeDownloadUrlResponse {
  url: string;
  filename: string;
  fallbackUrls?: string[];
}

export interface EpisodeScript {
  content: string | null;
  beats: ScriptBeat[] | null;
}

export interface RegenerateScriptInput {
  topic?: string;
}

export interface UpdateScriptInput {
  scriptContent: string;
}

export interface GeneratedScript {
  content: string;
  beats: ScriptBeat[];
}

export interface ResumeEpisodeResponse {
  success: boolean;
  resumed: boolean;
  recommendedAction: string;
  nextRoute?: string;
  message?: string;
  jobId?: string;
  details?: Record<string, unknown>;
}

// Query keys
export const episodeKeys = {
  all: ['episodes'] as const,
  lists: () => [...episodeKeys.all, 'list'] as const,
  list: (filters?: { seriesId?: string; status?: EpisodeStatus }) =>
    [...episodeKeys.lists(), filters] as const,
  details: () => [...episodeKeys.all, 'detail'] as const,
  detail: (id: string) => [...episodeKeys.details(), id] as const,
  scripts: () => [...episodeKeys.all, 'script'] as const,
  script: (id: string) => [...episodeKeys.scripts(), id] as const,
};

/**
 * Hook to fetch all user's episodes
 * Requirements: 7.5
 */
export function useEpisodes(filters?: { seriesId?: string; status?: EpisodeStatus }) {
  const apiClient = useApiClient();
  const authReady = useAuthReady();

  return useQuery({
    queryKey: episodeKeys.list(filters),
    queryFn: async (): Promise<EpisodeWithSeries[]> => {
      const params = new URLSearchParams();
      if (filters?.seriesId) params.append('seriesId', filters.seriesId);
      if (filters?.status) params.append('status', filters.status);

      const queryString = params.toString();
      const url = queryString ? `/episodes?${queryString}` : '/episodes';
      const response = await apiClient.get<EpisodeWithSeries[]>(url);
      return response.data;
    },
    enabled: authReady,
  });
}

/**
 * Hook to fetch a single episode with full details
 * Requirements: 7.5
 */
export function useEpisode(id: string) {
  const apiClient = useApiClient();
  const authReady = useAuthReady();

  return useQuery({
    queryKey: episodeKeys.detail(id),
    queryFn: async (): Promise<EpisodeWithDetails> => {
      const response = await apiClient.get<EpisodeWithDetails>(`/episodes/${id}`);
      return response.data;
    },
    enabled: authReady && !!id,
  });
}

/**
 * Hook to fetch episode script
 * Requirements: 7.3
 */
export function useEpisodeScript(id: string) {
  const apiClient = useApiClient();
  const authReady = useAuthReady();

  return useQuery({
    queryKey: episodeKeys.script(id),
    queryFn: async (): Promise<EpisodeScript> => {
      const response = await apiClient.get<EpisodeScript>(`/episodes/${id}/script`);
      return response.data;
    },
    enabled: authReady && !!id,
  });
}

/**
 * Hook to create a new episode
 * Requirements: 7.1
 */
export function useCreateEpisode() {
  const apiClient = useApiClient();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (data: CreateEpisodeInput): Promise<Episode> => {
      const response = await apiClient.post<Episode>('/episodes', data);
      return response.data;
    },
    onSuccess: (episode) => {
      // Invalidate episode lists
      queryClient.invalidateQueries({ queryKey: episodeKeys.lists() });
      // If episode belongs to a series, invalidate series detail
      if (episode.seriesId) {
        queryClient.invalidateQueries({ queryKey: seriesKeys.detail(episode.seriesId) });
      }
    },
  });
}

/**
 * Hook to update an episode
 */
export function useUpdateEpisode() {
  const apiClient = useApiClient();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      id,
      data,
    }: {
      id: string;
      data: UpdateEpisodeInput;
    }): Promise<void> => {
      await apiClient.put(`/episodes/${id}`, data);
    },
    onSuccess: (_, { id }) => {
      // Invalidate both list and detail queries
      queryClient.invalidateQueries({ queryKey: episodeKeys.lists() });
      queryClient.invalidateQueries({ queryKey: episodeKeys.detail(id) });
    },
  });
}

/**
 * Hook to delete an episode
 * Requirements: 7.6
 */
export function useDeleteEpisode() {
  const apiClient = useApiClient();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (id: string): Promise<void> => {
      await apiClient.delete(`/episodes/${id}`);
    },
    onSuccess: (_, id) => {
      // Remove from cache and invalidate lists
      queryClient.removeQueries({ queryKey: episodeKeys.detail(id) });
      queryClient.invalidateQueries({ queryKey: episodeKeys.lists() });
      // Also invalidate series details since episode counts may change
      queryClient.invalidateQueries({ queryKey: seriesKeys.details() });
    },
  });
}

/**
 * Hook to regenerate episode script
 * Requirements: 7.4
 */
export function useRegenerateScript() {
  const apiClient = useApiClient();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      id,
      data,
    }: {
      id: string;
      data?: RegenerateScriptInput;
    }): Promise<GeneratedScript> => {
      const response = await apiClient.post<GeneratedScript>(
        `/episodes/${id}/regenerate-script`,
        data || {}
      );
      return response.data;
    },
    onSuccess: (_, { id }) => {
      // Invalidate episode detail and script queries
      queryClient.invalidateQueries({ queryKey: episodeKeys.detail(id) });
      queryClient.invalidateQueries({ queryKey: episodeKeys.script(id) });
    },
  });
}

/**
 * Hook to update episode script manually
 */
export function useUpdateScript() {
  const apiClient = useApiClient();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      id,
      data,
    }: {
      id: string;
      data: UpdateScriptInput;
    }): Promise<GeneratedScript> => {
      const response = await apiClient.post<GeneratedScript>(
        `/episodes/${id}/update-script`,
        data
      );
      return response.data;
    },
    onSuccess: (_, { id }) => {
      // Invalidate episode detail and script queries
      queryClient.invalidateQueries({ queryKey: episodeKeys.detail(id) });
      queryClient.invalidateQueries({ queryKey: episodeKeys.script(id) });
    },
  });
}

/**
 * Variation request input
 * Requirements: 12.5
 */
export interface VariationRequestInput {
  hook?: 'question' | 'statement' | 'story' | 'statistic';
  speed?: 'slow' | 'normal' | 'fast' | 'dynamic';
  captions?: 'minimal' | 'bold' | 'karaoke' | 'animated';
}

/**
 * Hook to request a video variation
 * Requirements: 12.5
 */
export function useRequestVariation() {
  const apiClient = useApiClient();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      id,
      variations,
    }: {
      id: string;
      variations: VariationRequestInput;
    }): Promise<{ jobId: string }> => {
      const response = await apiClient.post<{ jobId: string }>(
        `/episodes/${id}/request-variation`,
        { variations }
      );
      return response.data;
    },
    onSuccess: (_, { id }) => {
      // Invalidate episode detail to show new job
      queryClient.invalidateQueries({ queryKey: episodeKeys.detail(id) });
    },
  });
}

/**
 * Hook to start final render (Phase 5)
 */
export function useStartRender() {
  const apiClient = useApiClient();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (id: string): Promise<{ success: boolean; jobId?: string }> => {
      const response = await apiClient.post<{ success: boolean; jobId?: string }>(
        `/episodes/${id}/render`
      );
      return response.data;
    },
    onSuccess: (_, id) => {
      queryClient.invalidateQueries({ queryKey: episodeKeys.detail(id) });
      queryClient.invalidateQueries({ queryKey: episodeKeys.lists() });
      queryClient.invalidateQueries({ queryKey: jobKeys.lists() });
    },
  });
}

/**
 * Hook to start processing pipeline (NEW - Phase 1-5 pipeline)
 * Triggers semantic matching after voiceover and B-roll pipelines complete
 */
export function useStartProcessing() {
  const apiClient = useApiClient();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (id: string): Promise<{ jobId: string }> => {
      const response = await apiClient.post<{ jobId: string }>(
        `/episodes/${id}/process`
      );
      return response.data;
    },
    onSuccess: (_, id) => {
      queryClient.invalidateQueries({ queryKey: episodeKeys.detail(id) });
      queryClient.invalidateQueries({ queryKey: episodeKeys.lists() });
      queryClient.invalidateQueries({ queryKey: jobKeys.lists() });
    },
  });
}

/**
 * Resume episode progression from current backend status.
 * If execute=true, backend attempts to trigger the next actionable phase.
 */
export function useResumeEpisode() {
  const apiClient = useApiClient();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      id,
      execute = false,
    }: {
      id: string;
      execute?: boolean;
    }): Promise<ResumeEpisodeResponse> => {
      const response = await apiClient.post<ResumeEpisodeResponse>(
        `/episodes/${id}/resume`,
        { execute }
      );
      return response.data;
    },
    onSuccess: (_, { id }) => {
      queryClient.invalidateQueries({ queryKey: episodeKeys.detail(id) });
      queryClient.invalidateQueries({ queryKey: episodeKeys.lists() });
    },
  });
}

/**
 * Hook to start slot planning (LEGACY - template mode only)
 * Requirements: Phase 7 - Slot Planning
 */
export function useStartSlotPlanning() {
  const apiClient = useApiClient();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (id: string): Promise<{ jobId: string }> => {
      const response = await apiClient.post<{ jobId: string }>(
        `/episodes/${id}/start-slot-planning`
      );
      return response.data;
    },
    onSuccess: (_, id) => {
      queryClient.invalidateQueries({ queryKey: episodeKeys.detail(id) });
    },
  });
}

/**
 * Hook to request a fresh signed download URL for final export.
 */
export function useEpisodeDownloadUrl() {
  const apiClient = useApiClient();

  return useMutation({
    mutationFn: async (id: string): Promise<EpisodeDownloadUrlResponse> => {
      const response = await apiClient.get<EpisodeDownloadUrlResponse>(`/episodes/${id}/download-url`);
      return response.data;
    },
  });
}
