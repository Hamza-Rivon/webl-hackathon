/* eslint-disable max-lines */
/**
 * Job Progress Hook
 *
 * SSE-based hook for real-time job progress updates.
 * Requirements: 5.1-5.5, 5.9, 5.10, 11.2, 11.4
 */

import { useEffect, useRef, useCallback, useState } from 'react';
import { useQuery, useQueryClient, useMutation } from '@tanstack/react-query';
import { useApiClient, useApiUrl, useAuthToken } from '../lib/api';
import { useJobStore, Job } from '../stores/jobs';
import { showJobCompletionNotification, showVideoReadyNotification } from '../lib/notifications';
import { useAuthReady } from './useAuthReady';

// Types
export type JobStatus = 'pending' | 'processing' | 'done' | 'error' | 'cancelled';

// Job stage types
export type JobStage = 
  | 'starting' 
  | 'downloading' 
  | 'uploading' 
  | 'processing' 
  | 'analyzing' 
  | 'building' 
  | 'rendering' 
  | 'publishing' 
  | 'done';

/**
 * Phase 1-5 Job Type Labels
 * Requirements: 5.1-5.5
 */
export interface JobTypeInfo {
  phase: number;
  label: string;
  emoji: string;
  description: string;
}

/**
 * Job type to phase/label mapping per Requirements 5.1-5.5
 */
export const JOB_TYPE_INFO: Record<string, JobTypeInfo> = {
  // Phase 1: Voiceover Processing (Requirement 5.1)
  voiceover_ingest: { phase: 1, label: 'Voiceover', emoji: '📤', description: 'Uploading your audio' },
  voiceover_transcript: { phase: 1, label: 'Voiceover', emoji: '📝', description: 'Transcribing audio' },
  voiceover_transcript_correction: { phase: 1, label: 'Voiceover', emoji: '🧠', description: 'Correcting transcript' },
  voiceover_take_selection: { phase: 1, label: 'Voiceover', emoji: '🎯', description: 'Selecting best takes' },
  voiceover_silence_detection: { phase: 1, label: 'Voiceover', emoji: '🔇', description: 'Detecting silence and fillers' },
  voiceover_cleaning: { phase: 1, label: 'Voiceover', emoji: '✨', description: 'Removing silence and fillers' },
  voiceover_segmentation: { phase: 1, label: 'Voiceover', emoji: '✂️', description: 'Creating audio segments' },
  
  // Phase 2: B-roll Processing (Requirement 5.2)
  broll_ingest: { phase: 2, label: 'Footage', emoji: '📤', description: 'Uploading video clips' },
  broll_chunking: { phase: 2, label: 'Footage', emoji: '🎬', description: 'Chunking video clips' },
  broll_chunk_ingest: { phase: 2, label: 'Footage', emoji: '📦', description: 'Processing chunks' },
  slot_clip_enrichment: { phase: 2, label: 'Footage', emoji: '🤖', description: 'Analyzing clips' },
  broll_chunk_enrichment: { phase: 2, label: 'Footage', emoji: '🤖', description: 'Analyzing video content' },
  broll_chunk_embedding: { phase: 2, label: 'Footage', emoji: '🧠', description: 'Creating searchable embeddings' },
  aroll_chunk_transcript: { phase: 2, label: 'Footage', emoji: '📝', description: 'Transcribing A-roll' },
  chunk_refinement: { phase: 2, label: 'Footage', emoji: '🧹', description: 'Refining chunks' },
  
  // Phase 3: Semantic Matching (Requirement 5.3)
  semantic_matching: { phase: 3, label: 'Matching', emoji: '🎯', description: 'Matching footage to audio' },
  
  // Phase 4: Cut Plan (Requirement 5.4)
  creative_edit_plan: { phase: 4, label: 'Edit Plan', emoji: '🎬', description: 'Creating creative edit brief' },
  cut_plan_generation: { phase: 4, label: 'Edit Plan', emoji: '📋', description: 'Generating edit plan' },
  cut_plan_validation: { phase: 4, label: 'Edit Plan', emoji: '✅', description: 'Validating edit plan' },
  
  // Phase 5: Rendering (Requirement 5.5)
  ffmpeg_render_microcut_v2: { phase: 5, label: 'Rendering', emoji: '🎬', description: 'Rendering final video' },
  mux_publish: { phase: 5, label: 'Rendering', emoji: '🚀', description: 'Publishing video' },
};

/**
 * Job stage to user-friendly message mapping
 * Requirement 5.9: Map job stages to user-friendly messages
 */
export const JOB_STAGE_LABELS: Record<JobStage, string> = {
  starting: 'Starting...',
  downloading: 'Downloading...',
  uploading: 'Uploading...',
  processing: 'Processing...',
  analyzing: 'Analyzing...',
  building: 'Building...',
  rendering: 'Rendering...',
  publishing: 'Publishing...',
  done: 'Complete',
};

/**
 * Get job type info with fallback
 */
export function getJobTypeInfo(jobType: string): JobTypeInfo {
  return JOB_TYPE_INFO[jobType] || {
    phase: 0,
    label: 'Processing',
    emoji: '⚙️',
    description: 'Working...',
  };
}

/**
 * Get user-friendly stage label
 */
export function getStageLabel(stage: string | null | undefined): string {
  if (!stage) return 'Starting...';
  return JOB_STAGE_LABELS[stage as JobStage] || stage;
}

/**
 * Get full job description combining type and stage
 */
export function getJobDescription(jobType: string, stage: string | null | undefined): string {
  const typeInfo = getJobTypeInfo(jobType);
  const stageLabel = getStageLabel(stage);
  
  // For specific stages, use the type description
  if (stage === 'processing' || stage === 'analyzing' || !stage) {
    return typeInfo.description;
  }
  
  return `${typeInfo.description} - ${stageLabel}`;
}

/**
 * Get phase label
 */
export function getPhaseLabel(phase: number): string {
  const labels: Record<number, string> = {
    1: 'Voiceover Processing',
    2: 'Footage Analysis',
    3: 'Audio-Video Matching',
    4: 'Edit Plan Generation',
    5: 'Final Rendering',
  };
  return labels[phase] || `Phase ${phase}`;
}

export interface JobProgress {
  jobId: string;
  status: JobStatus;
  stage?: string;
  progress: number;
  estimatedTimeRemaining?: number;
  error?: string;
  timestamp: number;
}

export interface JobData {
  id: string;
  type: string;
  status: JobStatus;
  stage: string | null;
  progress: number;
  errorMessage: string | null;
  episodeId: string;
  userId: string;
  createdAt: string;
  updatedAt: string;
}

interface UseJobsOptions {
  enabled?: boolean;
  staleTime?: number;
}

// Query keys
export const jobKeys = {
  all: ['jobs'] as const,
  lists: () => [...jobKeys.all, 'list'] as const,
  list: (filters?: { episodeId?: string; status?: JobStatus }) =>
    [...jobKeys.lists(), filters] as const,
  details: () => [...jobKeys.all, 'detail'] as const,
  detail: (id: string) => [...jobKeys.details(), id] as const,
};

/**
 * Hook to fetch all user's jobs
 */
export function useJobs(
  filters?: { episodeId?: string; status?: JobStatus },
  options?: UseJobsOptions
) {
  const apiClient = useApiClient();
  const authReady = useAuthReady();

  return useQuery({
    queryKey: jobKeys.list(filters),
    queryFn: async (): Promise<JobData[]> => {
      const params = new URLSearchParams();
      if (filters?.episodeId) params.append('episodeId', filters.episodeId);
      if (filters?.status) params.append('status', filters.status);

      const queryString = params.toString();
      const url = queryString ? `/jobs?${queryString}` : '/jobs';
      try {
        const response = await apiClient.get<JobData[]>(url);
        return response.data;
      } catch (error: any) {
        const isNotFound = error?.response?.status === 404;
        if (!isNotFound) {
          throw error;
        }

        if (filters?.episodeId) {
          const legacyResponse = await apiClient.get<{ jobs: JobData[] }>(
            `/jobs/episode/${filters.episodeId}`
          );
          const jobs = Array.isArray(legacyResponse.data?.jobs) ? legacyResponse.data.jobs : [];
          return filters.status ? jobs.filter((job) => job.status === filters.status) : jobs;
        }

        const fallbackResponse = await apiClient.get<JobData[]>('/jobs');
        return filters?.status
          ? fallbackResponse.data.filter((job) => job.status === filters.status)
          : fallbackResponse.data;
      }
    },
    enabled: Boolean(authReady && (options?.enabled ?? true)),
    staleTime: options?.staleTime ?? 10_000,
  });
}

/**
 * Hook to fetch a single job
 */
export function useJob(id: string) {
  const apiClient = useApiClient();
  const authReady = useAuthReady();

  return useQuery({
    queryKey: jobKeys.detail(id),
    queryFn: async (): Promise<JobData> => {
      const response = await apiClient.get<JobData>(`/jobs/${id}`);
      return response.data;
    },
    enabled: authReady && !!id,
  });
}

/**
 * Hook to retry a failed job
 */
export function useRetryJob() {
  const apiClient = useApiClient();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (id: string): Promise<void> => {
      await apiClient.post(`/jobs/${id}/retry`);
    },
    onSuccess: (_, id) => {
      queryClient.invalidateQueries({ queryKey: jobKeys.detail(id) });
      queryClient.invalidateQueries({ queryKey: jobKeys.lists() });
    },
  });
}

/**
 * Hook to cancel a running job
 */
export function useCancelJob() {
  const apiClient = useApiClient();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (id: string): Promise<void> => {
      await apiClient.post(`/jobs/${id}/cancel`);
    },
    onSuccess: (_, id) => {
      queryClient.invalidateQueries({ queryKey: jobKeys.detail(id) });
      queryClient.invalidateQueries({ queryKey: jobKeys.lists() });
    },
  });
}

/**
 * Retry all failed jobs for an episode.
 */
export function useRetryFailedEpisodeJobs() {
  const apiClient = useApiClient();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (episodeId: string): Promise<{ retriedCount: number }> => {
      const response = await apiClient.get<JobData[]>(`/jobs?episodeId=${episodeId}&status=error`);
      const failedJobs = response.data || [];

      let retriedCount = 0;
      for (const job of failedJobs) {
        try {
          await apiClient.post(`/jobs/${job.id}/retry`);
          retriedCount += 1;
        } catch {
          // Best-effort: continue retrying the rest.
        }
      }

      return { retriedCount };
    },
    onSuccess: (_, episodeId) => {
      queryClient.invalidateQueries({ queryKey: jobKeys.lists() });
      queryClient.invalidateQueries({ queryKey: ['episodes', 'detail', episodeId] });
    },
  });
}

/**
 * Hook for real-time job progress via SSE
 * Requirements: 11.2
 *
 * Connects to the SSE endpoint and updates local state with progress.
 * Automatically handles connection lifecycle and cleanup.
 */
export function useJobProgress(jobId: string | null) {
  const apiUrl = useApiUrl();
  const getToken = useAuthToken();
  const queryClient = useQueryClient();
  const { updateJob, addJob, getJobById } = useJobStore();

  const [progress, setProgress] = useState<JobProgress | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const eventSourceRef = useRef<EventSource | null>(null);
  const reconnectTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reconnectAttemptsRef = useRef(0);
  const maxReconnectAttempts = 5;

  const cleanup = useCallback(() => {
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
      eventSourceRef.current = null;
    }
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = null;
    }
    setIsConnected(false);
  }, []);

  const connect = useCallback(async () => {
    if (!jobId) return;

    cleanup();

    try {
      const token = await getToken();
      if (!token) {
        setError('Authentication required');
        return;
      }

      // Note: React Native doesn't have native EventSource support
      // We use a polyfill or fetch-based approach
      // For now, we'll use a polling fallback with the SSE URL
      const url = `${apiUrl}/api/jobs/${jobId}/progress`;

      // Create EventSource with auth header
      // Note: Standard EventSource doesn't support custom headers
      // In production, you'd use a library like react-native-sse
      // or implement a fetch-based SSE client
      const eventSource = new EventSource(url);

      eventSource.onopen = () => {
        setIsConnected(true);
        setError(null);
        reconnectAttemptsRef.current = 0;
      };

      eventSource.onmessage = (event) => {
        try {
          const data: JobProgress = JSON.parse(event.data);
          setProgress(data);

          // Update Zustand store
          const existingJob = getJobById(jobId);
          if (existingJob) {
            updateJob(jobId, {
              status: mapJobStatus(data.status),
              progress: data.progress,
              stage: data.stage,
              estimatedTimeRemaining: data.estimatedTimeRemaining,
              error: data.error,
            });
          } else {
            addJob({
              id: jobId,
              type: 'unknown',
              status: mapJobStatus(data.status),
              progress: data.progress,
              stage: data.stage,
              estimatedTimeRemaining: data.estimatedTimeRemaining,
              error: data.error,
              createdAt: new Date(),
              updatedAt: new Date(),
            });
          }

          // If job is complete, invalidate queries and close connection
          if (isTerminalStatus(data.status)) {
            queryClient.invalidateQueries({ queryKey: jobKeys.detail(jobId) });
            queryClient.invalidateQueries({ queryKey: jobKeys.lists() });
            cleanup();
          }
        } catch (err) {
          console.error('Failed to parse SSE message:', err);
        }
      };

      eventSource.onerror = () => {
        setIsConnected(false);

        // Attempt reconnection with exponential backoff
        if (reconnectAttemptsRef.current < maxReconnectAttempts) {
          const delay = Math.min(1000 * Math.pow(2, reconnectAttemptsRef.current), 30000);
          reconnectAttemptsRef.current++;

          reconnectTimeoutRef.current = setTimeout(() => {
            connect();
          }, delay);
        } else {
          setError('Connection lost. Please refresh.');
        }
      };

      eventSourceRef.current = eventSource;
    } catch (err) {
      setError('Failed to connect to progress stream');
      console.error('SSE connection error:', err);
    }
  }, [jobId, apiUrl, getToken, cleanup, updateJob, addJob, getJobById, queryClient]);

  // Connect when jobId changes
  useEffect(() => {
    if (jobId) {
      connect();
    }

    return cleanup;
  }, [jobId, connect, cleanup]);

  // Manual reconnect function
  const reconnect = useCallback(() => {
    reconnectAttemptsRef.current = 0;
    setError(null);
    connect();
  }, [connect]);

  return {
    progress,
    isConnected,
    error,
    reconnect,
    disconnect: cleanup,
  };
}

/**
 * Hook for polling-based job progress (fallback for environments without SSE)
 * Requirements: 11.2, 11.4
 */
export function useJobProgressPolling(
  jobId: string | null,
  intervalMs = 2000,
  options?: { enableNotifications?: boolean; episodeTitle?: string }
) {
  const apiClient = useApiClient();
  const authReady = useAuthReady();
  const { updateJob, addJob, getJobById } = useJobStore();
  const previousStatusRef = useRef<JobStatus | null>(null);
  const { enableNotifications = true, episodeTitle } = options || {};

  const query = useQuery({
    queryKey: ['job-progress-poll', jobId],
    queryFn: async (): Promise<JobData> => {
      const response = await apiClient.get<JobData>(`/jobs/${jobId}`);
      return response.data;
    },
    enabled: authReady && !!jobId,
    refetchInterval: (query) => {
      // Stop polling when job is complete
      const data = query.state.data;
      if (data && isTerminalStatus(data.status as JobStatus)) {
        return false;
      }
      return intervalMs;
    },
  });

  // Update Zustand store and trigger notifications when data changes
  useEffect(() => {
    if (query.data && jobId) {
      const data = query.data;
      const currentStatus = data.status as JobStatus;
      const existingJob = getJobById(jobId);

      if (existingJob) {
        updateJob(jobId, {
          status: mapJobStatus(data.status),
          progress: data.progress,
          stage: data.stage || undefined,
          error: data.errorMessage || undefined,
        });
      } else {
        addJob({
          id: jobId,
          type: data.type,
          status: mapJobStatus(data.status),
          progress: data.progress,
          stage: data.stage || undefined,
          error: data.errorMessage || undefined,
          createdAt: new Date(data.createdAt),
          updatedAt: new Date(data.updatedAt),
        });
      }

      // Trigger completion notification when job transitions to terminal state
      // Requirements: 11.4
      if (
        enableNotifications &&
        previousStatusRef.current &&
        !isTerminalStatus(previousStatusRef.current) &&
        isTerminalStatus(currentStatus)
      ) {
        const success = currentStatus === 'done';
        
        // Special notification for render completion
        if ((data.type === 'ffmpeg_render_microcut_v2' || data.type === 'mux_publish') && success && episodeTitle) {
          showVideoReadyNotification(episodeTitle, data.episodeId ? `/(main)/episode/${data.episodeId}/preview` : undefined, {
            episodeId: data.episodeId,
            jobId: data.id,
            jobType: data.type,
          });
        } else {
          showJobCompletionNotification(
            data.type,
            success,
            episodeTitle,
            data.episodeId ? `/(main)/episode/${data.episodeId}/processing` : undefined,
            { episodeId: data.episodeId, jobId: data.id, status: data.status }
          );
        }
      }

      previousStatusRef.current = currentStatus;
    }
  }, [query.data, jobId, updateJob, addJob, getJobById, enableNotifications, episodeTitle]);

  return {
    progress: query.data
      ? {
          jobId: query.data.id,
          status: query.data.status as JobStatus,
          stage: query.data.stage || undefined,
          progress: query.data.progress,
          error: query.data.errorMessage || undefined,
          timestamp: new Date(query.data.updatedAt).getTime(),
        }
      : null,
    isLoading: query.isLoading,
    error: query.error?.message || null,
    refetch: query.refetch,
  };
}

// Helper functions
function isTerminalStatus(status: JobStatus): boolean {
  return status === 'done' || status === 'error' || status === 'cancelled';
}

function mapJobStatus(status: JobStatus): Job['status'] {
  switch (status) {
    case 'pending':
      return 'pending';
    case 'processing':
      return 'processing';
    case 'done':
      return 'completed';
    case 'error':
      return 'failed';
    case 'cancelled':
      return 'cancelled';
    default:
      return 'pending';
  }
}


/**
 * Hook for tracking all active jobs with completion notifications
 * Requirements: 11.2, 11.4
 */
export function useActiveJobsWithNotifications() {
  const { data: jobs, isLoading, refetch } = useJobs();
  const queryClient = useQueryClient();
  const previousJobsRef = useRef<Map<string, JobStatus>>(new Map());

  // Track job status changes and trigger notifications
  useEffect(() => {
    if (jobs) {
      const currentJobs = new Map<string, JobStatus>();

      jobs.forEach((job) => {
        const currentStatus = job.status as JobStatus;
        currentJobs.set(job.id, currentStatus);

        const previousStatus = previousJobsRef.current.get(job.id);

        // Trigger notification when job transitions to terminal state
        if (
          previousStatus &&
          !isTerminalStatus(previousStatus) &&
          isTerminalStatus(currentStatus)
        ) {
          const success = currentStatus === 'done';

          if ((job.type === 'ffmpeg_render_microcut_v2' || job.type === 'mux_publish') && success) {
            showVideoReadyNotification(job.episodeId, `/(main)/episode/${job.episodeId}/preview`, {
              episodeId: job.episodeId,
              jobId: job.id,
              jobType: job.type,
            });
          } else {
            showJobCompletionNotification(
              job.type,
              success,
              undefined,
              `/(main)/episode/${job.episodeId}/processing`,
              { episodeId: job.episodeId, jobId: job.id, status: job.status }
            );
          }
        }
      });

      previousJobsRef.current = currentJobs;
    }
  }, [jobs]);

  // Separate jobs by status
  const activeJobs = jobs?.filter(
    (j) => j.status === 'pending' || j.status === 'processing'
  ) || [];
  const completedJobs = jobs?.filter((j) => j.status === 'done') || [];
  const failedJobs = jobs?.filter(
    (j) => j.status === 'error' || j.status === 'cancelled'
  ) || [];

  return {
    jobs,
    activeJobs,
    completedJobs,
    failedJobs,
    isLoading,
    refetch,
    invalidate: () => queryClient.invalidateQueries({ queryKey: jobKeys.all }),
  };
}

/**
 * Aggregate Progress Result
 * Requirement 5.10: Show aggregate progress for parallel jobs
 */
export interface AggregateProgressResult {
  /** Total number of items (e.g., chunks) */
  totalItems: number;
  /** Number of completed items */
  completedItems: number;
  /** Number of items in progress */
  inProgressItems: number;
  /** Number of pending items */
  pendingItems: number;
  /** Number of failed items */
  failedItems: number;
  /** Overall progress percentage (0-100) */
  overallProgress: number;
  /** Human-readable progress message (e.g., "Processing 5 of 23 chunks") */
  progressMessage: string;
  /** Current phase (1-5) */
  currentPhase: number;
  /** Phase label */
  phaseLabel: string;
  /** Active job types */
  activeJobTypes: string[];
  /** Whether all jobs are complete */
  isComplete: boolean;
  /** Whether any jobs have failed */
  hasFailed: boolean;
}

/**
 * Calculate aggregate progress for parallel jobs
 * Requirement 5.10: Show aggregate progress for parallel jobs
 * 
 * @param jobs - Array of jobs to aggregate
 * @param phase - Optional phase filter (1-5)
 * @returns Aggregate progress information
 */
export function calculateAggregateProgress(
  jobs: JobData[],
  phase?: number
): AggregateProgressResult {
  // Filter jobs by phase if specified
  const filteredJobs = phase
    ? jobs.filter((job) => getJobTypeInfo(job.type).phase === phase)
    : jobs;

  const totalItems = filteredJobs.length;
  const completedItems = filteredJobs.filter((j) => j.status === 'done').length;
  const inProgressItems = filteredJobs.filter((j) => j.status === 'processing').length;
  const pendingItems = filteredJobs.filter((j) => j.status === 'pending').length;
  const failedItems = filteredJobs.filter((j) => j.status === 'error' || j.status === 'cancelled').length;

  // Calculate overall progress
  // Each completed job contributes 100%, in-progress jobs contribute their individual progress
  let totalProgress = completedItems * 100;
  filteredJobs
    .filter((j) => j.status === 'processing')
    .forEach((j) => {
      totalProgress += j.progress;
    });
  
  const overallProgress = totalItems > 0 
    ? Math.round(totalProgress / totalItems) 
    : 0;

  // Determine current phase from active jobs
  const activeJobs = filteredJobs.filter(
    (j) => j.status === 'pending' || j.status === 'processing'
  );
  const activeJobTypes = [...new Set(activeJobs.map((j) => j.type))];
  
  // Get the phase from the first active job, or from completed jobs
  let currentPhase = 0;
  if (activeJobs.length > 0) {
    currentPhase = getJobTypeInfo(activeJobs[0].type).phase;
  } else if (filteredJobs.length > 0) {
    currentPhase = getJobTypeInfo(filteredJobs[0].type).phase;
  }

  // Generate progress message based on phase
  let progressMessage = '';
  if (phase === 2 || currentPhase === 2) {
    // Phase 2: Show chunk progress
    progressMessage = `Processing ${completedItems} of ${totalItems} chunks`;
  } else if (phase === 3 || currentPhase === 3) {
    // Phase 3: Show matching progress
    progressMessage = `Matching segments to chunks`;
  } else if (phase === 5 || currentPhase === 5) {
    // Phase 5: Show rendering progress
    const renderJob = filteredJobs.find(
      (j) => j.type === 'ffmpeg_render_microcut_v2'
    );
    if (renderJob && renderJob.status === 'processing') {
      progressMessage = `Rendering video (${renderJob.progress}%)`;
    } else {
      progressMessage = `Rendering ${completedItems} of ${totalItems} steps`;
    }
  } else {
    progressMessage = `Processing ${completedItems} of ${totalItems} items`;
  }

  return {
    totalItems,
    completedItems,
    inProgressItems,
    pendingItems,
    failedItems,
    overallProgress,
    progressMessage,
    currentPhase,
    phaseLabel: getPhaseLabel(currentPhase),
    activeJobTypes,
    isComplete: completedItems === totalItems && totalItems > 0,
    hasFailed: failedItems > 0,
  };
}

/**
 * Hook for aggregate progress of episode jobs
 * Requirement 5.10: Show aggregate progress for parallel jobs
 * 
 * @param episodeId - Episode ID to track
 * @param phase - Optional phase filter (1-5)
 * @returns Aggregate progress information
 */
export function useAggregateProgress(episodeId: string, phase?: number) {
  const { data: jobs, isLoading, refetch } = useJobs({ episodeId });

  const aggregateProgress = jobs 
    ? calculateAggregateProgress(jobs, phase)
    : {
        totalItems: 0,
        completedItems: 0,
        inProgressItems: 0,
        pendingItems: 0,
        failedItems: 0,
        overallProgress: 0,
        progressMessage: 'Loading...',
        currentPhase: 0,
        phaseLabel: '',
        activeJobTypes: [],
        isComplete: false,
        hasFailed: false,
      };

  return {
    ...aggregateProgress,
    jobs: jobs || [],
    isLoading,
    refetch,
  };
}

/**
 * Get Phase 2 chunk progress message
 * Requirement 5.10: Show "Processing X of Y chunks" for Phase 2
 */
export function getPhase2ProgressMessage(jobs: JobData[]): string {
  const phase2Jobs = jobs.filter((j) => getJobTypeInfo(j.type).phase === 2);
  const chunkJobs = phase2Jobs.filter(
    (j) => j.type === 'broll_chunk_ingest' || 
           j.type === 'broll_chunk_enrichment' || 
           j.type === 'broll_chunk_embedding'
  );
  
  if (chunkJobs.length === 0) {
    // Check for chunking jobs
    const chunkingJobs = phase2Jobs.filter((j) => j.type === 'broll_chunking');
    if (chunkingJobs.length > 0) {
      const completed = chunkingJobs.filter((j) => j.status === 'done').length;
      return `Chunking ${completed} of ${chunkingJobs.length} clips`;
    }
    return 'Preparing footage...';
  }

  const completed = chunkJobs.filter((j) => j.status === 'done').length;
  const total = chunkJobs.length;
  
  return `Processing ${completed} of ${total} chunks`;
}

/**
 * Get Phase 3 matching progress message
 * Requirement 5.3: Show segment and chunk counts
 */
export function getPhase3ProgressMessage(
  jobs: JobData[],
  segmentCount?: number,
  chunkCount?: number
): string {
  const matchingJob = jobs.find((j) => j.type === 'semantic_matching');
  
  if (!matchingJob) {
    return 'Preparing to match...';
  }

  if (matchingJob.status === 'done') {
    return 'Matching complete';
  }

  if (segmentCount && chunkCount) {
    return `Matching ${segmentCount} segments to ${chunkCount} chunks`;
  }

  return `Matching audio to video (${matchingJob.progress}%)`;
}

/**
 * Get Phase 5 rendering progress message
 * Requirement 5.5: Show frame progress for ffmpeg_render_microcut_v2
 */
export function getPhase5ProgressMessage(
  jobs: JobData[],
  frameProgress?: { current: number; total: number }
): string {
  const renderJob = jobs.find(
    (j) => j.type === 'ffmpeg_render_microcut_v2'
  );
  const publishJob = jobs.find((j) => j.type === 'mux_publish');

  if (publishJob?.status === 'processing') {
    return 'Publishing video...';
  }

  if (publishJob?.status === 'done') {
    return 'Video published!';
  }

  if (renderJob?.status === 'processing') {
    if (frameProgress) {
      return `Rendering frame ${frameProgress.current} of ${frameProgress.total}`;
    }
    return `Rendering video (${renderJob.progress}%)`;
  }

  if (renderJob?.status === 'done') {
    return 'Render complete, publishing...';
  }

  return 'Preparing to render...';
}
