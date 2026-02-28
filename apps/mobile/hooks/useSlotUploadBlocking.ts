/**
 * Slot Upload Blocking Hook
 *
 * Hook for checking if slot uploads should be blocked based on episode status
 * and active jobs. Provides blocking state detection and user-friendly messages.
 *
 * Requirements: 13.1-13.8
 */

import { useMemo } from 'react';
import { useEpisode, EpisodeStatus } from './useEpisodes';
import { useJobs, JobData, calculateAggregateProgress } from './useJobProgress';

/**
 * Blocking statuses for slot uploads
 * Note: cut_plan_ready is NOT blocking - cut plan is ready, user can proceed
 * Requirements: 13.1-13.5
 */
export const SLOT_UPLOAD_BLOCKING_STATUSES: EpisodeStatus[] = [
  'voiceover_uploaded',
  'voiceover_cleaning',
  'chunking_clips',
  'enriching_chunks',
  'matching',
  'rendering',
];

/**
 * Statuses where slot uploads are allowed
 * Requirements: 13.6
 */
export const SLOT_UPLOAD_ALLOWED_STATUSES: EpisodeStatus[] = [
  'voiceover_cleaned',
  'collecting_clips',
  'needs_more_clips',
];

/**
 * B-roll job types that block uploads
 * Requirements: 13.8
 */
export const BROLL_JOB_TYPES = [
  'broll_ingest',
  'broll_chunking',
  'broll_chunk_ingest',
  'slot_clip_enrichment',
  'broll_chunk_enrichment',
  'broll_chunk_embedding',
  'aroll_chunk_transcript',
  'chunk_refinement',
] as const;

/**
 * Blocking messages for each status
 * Requirements: 13.1-13.5
 */
export const SLOT_UPLOAD_BLOCKING_MESSAGES: Record<string, string> = {
  voiceover_uploaded: 'Please wait for voiceover processing to complete',
  voiceover_cleaning: 'Please wait for voiceover processing to complete',
  chunking_clips: 'Processing existing clips. Please wait...',
  enriching_chunks: 'Processing existing clips. Please wait...',
  matching: 'Creating edit plan. Please wait...',
  cut_plan_ready: 'Cut plan is ready. You can start rendering.',
  rendering: 'Rendering video. Please wait...',
};

/**
 * Result interface for useSlotUploadBlocking hook
 */
export interface SlotUploadBlockingResult {
  /** Whether slot uploads are blocked */
  isBlocked: boolean;
  /** Human-readable message explaining why uploads are blocked */
  blockingMessage: string | null;
  /** Current episode status */
  status: EpisodeStatus | null;
  /** Whether there are active B-roll jobs */
  hasActiveBrollJobs: boolean;
  /** Active B-roll job types */
  activeBrollJobTypes: string[];
  /** Estimated time until uploads are available (in seconds) */
  estimatedTimeRemaining: number | null;
  /** Progress percentage of blocking jobs (0-100) */
  blockingProgress: number;
  /** Whether data is still loading */
  isLoading: boolean;
}

/**
 * Check if a job is active (pending or processing)
 */
function isActiveJob(job: JobData): boolean {
  return job.status === 'pending' || job.status === 'processing';
}

/**
 * Check if there are active B-roll jobs
 * Requirements: 13.8
 */
function hasActiveBrollJobs(jobs: JobData[]): boolean {
  return jobs.some(
    (job) => isActiveJob(job) && BROLL_JOB_TYPES.includes(job.type as typeof BROLL_JOB_TYPES[number])
  );
}

/**
 * Get active B-roll job types
 */
function getActiveBrollJobTypes(jobs: JobData[]): string[] {
  return jobs
    .filter((job) => isActiveJob(job) && BROLL_JOB_TYPES.includes(job.type as typeof BROLL_JOB_TYPES[number]))
    .map((job) => job.type);
}

/**
 * Estimate time remaining based on job progress
 * Requirements: 13.8
 */
function estimateTimeRemaining(jobs: JobData[]): number | null {
  const activeJobs = jobs.filter(isActiveJob);
  if (activeJobs.length === 0) return null;

  // Calculate average progress and estimate remaining time
  // Assume average job takes ~30 seconds
  const avgJobDuration = 30; // seconds
  const totalProgress = activeJobs.reduce((sum, job) => sum + job.progress, 0);
  const avgProgress = totalProgress / activeJobs.length;

  if (avgProgress === 0) {
    return avgJobDuration * activeJobs.length;
  }

  // Estimate remaining time based on progress
  const remainingProgress = 100 - avgProgress;
  const estimatedRemaining = (remainingProgress / avgProgress) * avgJobDuration;

  return Math.max(Math.round(estimatedRemaining), 5); // Minimum 5 seconds
}

/**
 * Hook for checking if slot uploads should be blocked
 *
 * Requirements: 13.1-13.8
 *
 * @param episodeId - The episode ID to check blocking state for
 * @returns SlotUploadBlockingResult with blocking state info
 */
export function useSlotUploadBlocking(episodeId: string): SlotUploadBlockingResult {
  const { data: episode, isLoading: episodeLoading } = useEpisode(episodeId);
  const { data: jobs, isLoading: jobsLoading } = useJobs({ episodeId });

  const isLoading = episodeLoading || jobsLoading;

  // Check if episode status is blocking
  // Requirements: 13.1-13.5
  const isStatusBlocking = useMemo(() => {
    if (!episode) return false;
    return SLOT_UPLOAD_BLOCKING_STATUSES.includes(episode.status);
  }, [episode]);

  // Check for active B-roll jobs
  // Requirements: 13.8
  const activeBrollJobs = useMemo(() => {
    if (!jobs) return false;
    return hasActiveBrollJobs(jobs);
  }, [jobs]);

  // Get active B-roll job types
  const activeBrollJobTypes = useMemo(() => {
    if (!jobs) return [];
    return getActiveBrollJobTypes(jobs);
  }, [jobs]);

  // Combined blocking state
  // Requirements: 13.1-13.8
  const isBlocked = isStatusBlocking || activeBrollJobs;

  // Get blocking message
  // Requirements: 13.1-13.6
  const blockingMessage = useMemo(() => {
    if (!episode) return null;
    
    // Check status-based blocking first
    if (isStatusBlocking) {
      return SLOT_UPLOAD_BLOCKING_MESSAGES[episode.status] || 'Processing in progress. Please wait...';
    }
    
    // Check for active B-roll jobs
    if (activeBrollJobs) {
      return 'Processing existing clips. Please wait...';
    }
    
    return null;
  }, [episode, isStatusBlocking, activeBrollJobs]);

  // Calculate estimated time remaining
  // Requirements: 13.8
  const estimatedTimeRemaining = useMemo(() => {
    if (!jobs || !isBlocked) return null;
    return estimateTimeRemaining(jobs);
  }, [jobs, isBlocked]);

  // Calculate blocking progress
  const blockingProgress = useMemo(() => {
    if (!jobs || !isBlocked) return 0;
    const activeJobs = jobs.filter(isActiveJob);
    if (activeJobs.length === 0) return 0;
    
    const totalProgress = activeJobs.reduce((sum, job) => sum + job.progress, 0);
    return Math.round(totalProgress / activeJobs.length);
  }, [jobs, isBlocked]);

  return {
    isBlocked,
    blockingMessage,
    status: episode?.status || null,
    hasActiveBrollJobs: activeBrollJobs,
    activeBrollJobTypes,
    estimatedTimeRemaining,
    blockingProgress,
    isLoading,
  };
}

export default useSlotUploadBlocking;
