/**
 * Blocking State Hook
 *
 * Centralized hook for detecting and managing blocking states during
 * video processing pipeline. Provides blocking detection, reasons,
 * and confirmation dialogs for navigation during blocking states.
 *
 * Requirements: 2.8, 2.9
 */

import { useCallback, useMemo } from 'react';
import { Alert } from 'react-native';
import { useEpisode, EpisodeStatus } from './useEpisodes';
import { useJobs, JobData } from './useJobProgress';
import {
  BLOCKING_STATUSES,
  BLOCKING_REASONS,
  isBlockingStatus,
  getBlockingReason,
  EpisodeStatus as StoreEpisodeStatus,
} from '../stores/episodeJourney';

/**
 * Result interface for useBlockingState hook
 */
export interface BlockingStateResult {
  /** Whether the episode is currently in a blocking state */
  isBlocking: boolean;
  /** Human-readable reason for the blocking state */
  blockingReason: string | null;
  /** Whether user can navigate away (inverse of isBlocking) */
  canNavigateAway: boolean;
  /** Current episode status */
  status: EpisodeStatus | null;
  /** Whether there are active jobs (pending or processing) */
  hasActiveJobs: boolean;
  /** Active job types currently running */
  activeJobTypes: string[];
  /** Show confirmation dialog for navigation during blocking states */
  showConfirmation: () => Promise<boolean>;
  /** Show confirmation dialog with custom message */
  showConfirmationWithMessage: (title: string, message: string) => Promise<boolean>;
}

/**
 * Phase 1 job types (voiceover processing)
 */
export const PHASE_1_JOB_TYPES = [
  'voiceover_ingest',
  'voiceover_transcript',
  'voiceover_transcript_correction',
  'voiceover_take_selection',
  'voiceover_silence_detection',
  'voiceover_cleaning',
  'voiceover_segmentation',
];

/**
 * Phase 2 job types (B-roll processing)
 */
export const PHASE_2_JOB_TYPES = [
  'broll_ingest',
  'broll_chunking',
  'broll_chunk_ingest',
  'slot_clip_enrichment',
  'broll_chunk_enrichment',
  'broll_chunk_embedding',
  'aroll_chunk_transcript',
  'chunk_refinement',
];

/**
 * Phase 3 job types (semantic matching)
 */
export const PHASE_3_JOB_TYPES = ['semantic_matching', 'creative_edit_plan'];

/**
 * Phase 4 job types (cut plan)
 */
export const PHASE_4_JOB_TYPES = ['cut_plan_generation', 'cut_plan_validation'];

/**
 * Phase 5 job types (rendering)
 */
export const PHASE_5_JOB_TYPES = ['ffmpeg_render_microcut_v2', 'mux_publish'];

/**
 * All blocking job types
 */
export const ALL_BLOCKING_JOB_TYPES = [
  ...PHASE_1_JOB_TYPES,
  ...PHASE_2_JOB_TYPES,
  ...PHASE_3_JOB_TYPES,
  // Note: Phase 4 jobs don't block (cut_plan_ready is NOT blocking)
  ...PHASE_5_JOB_TYPES,
];

/**
 * Check if a job is active (pending or processing)
 */
function isActiveJob(job: JobData): boolean {
  return job.status === 'pending' || job.status === 'processing';
}

/**
 * Check if there are active Phase 1 jobs
 */
export function hasActivePhase1Jobs(jobs: JobData[]): boolean {
  return jobs.some(
    (job) => isActiveJob(job) && PHASE_1_JOB_TYPES.includes(job.type)
  );
}

/**
 * Check if there are active Phase 2 jobs
 */
export function hasActivePhase2Jobs(jobs: JobData[]): boolean {
  return jobs.some(
    (job) => isActiveJob(job) && PHASE_2_JOB_TYPES.includes(job.type)
  );
}

/**
 * Check if there are active Phase 3 jobs
 */
export function hasActivePhase3Jobs(jobs: JobData[]): boolean {
  return jobs.some(
    (job) => isActiveJob(job) && PHASE_3_JOB_TYPES.includes(job.type)
  );
}

/**
 * Check if there are active Phase 5 jobs (rendering)
 */
export function hasActivePhase5Jobs(jobs: JobData[]): boolean {
  return jobs.some(
    (job) => isActiveJob(job) && PHASE_5_JOB_TYPES.includes(job.type)
  );
}

/**
 * Hook for managing blocking states during video processing
 *
 * Requirements: 2.8, 2.9
 *
 * @param episodeId - The episode ID to check blocking state for
 * @returns BlockingStateResult with blocking state info and confirmation dialog
 */
export function useBlockingState(episodeId: string): BlockingStateResult {
  const { data: episode } = useEpisode(episodeId);
  const { data: jobs } = useJobs({ episodeId });

  // Get active jobs
  const activeJobs = useMemo(() => {
    return jobs?.filter(isActiveJob) || [];
  }, [jobs]);

  // Get active job types
  const activeJobTypes = useMemo(() => {
    return activeJobs.map((job) => job.type);
  }, [activeJobs]);

  // Check if episode status is blocking
  // Note: cut_plan_ready is NOT blocking - cut plan is ready, user can proceed
  const isStatusBlocking = useMemo(() => {
    if (!episode) return false;
    return isBlockingStatus(episode.status);
  }, [episode]);

  // Check if there are active blocking jobs
  const hasBlockingJobs = useMemo(() => {
    return activeJobs.some((job) => ALL_BLOCKING_JOB_TYPES.includes(job.type));
  }, [activeJobs]);

  // Combined blocking state
  const isBlocking = isStatusBlocking || hasBlockingJobs;

  // Get blocking reason
  const blockingReason = useMemo(() => {
    if (!episode) return null;
    if (isStatusBlocking) {
      return getBlockingReason(episode.status);
    }
    if (hasBlockingJobs) {
      // Return reason based on active job types
      if (hasActivePhase1Jobs(activeJobs)) {
        return 'Processing your voiceover...';
      }
      if (hasActivePhase2Jobs(activeJobs)) {
        return 'Processing your video clips...';
      }
      if (hasActivePhase3Jobs(activeJobs)) {
        return 'Matching audio to video...';
      }
      if (hasActivePhase5Jobs(activeJobs)) {
        return 'Rendering your final video...';
      }
      return 'Processing in progress...';
    }
    return null;
  }, [episode, isStatusBlocking, hasBlockingJobs, activeJobs]);

  /**
   * Show confirmation dialog for navigation during blocking states
   * Requirements: 2.9
   */
  const showConfirmation = useCallback((): Promise<boolean> => {
    if (!isBlocking) return Promise.resolve(true);

    return new Promise((resolve) => {
      Alert.alert(
        'Processing in Progress',
        blockingReason || 'Your video is being processed. Are you sure you want to leave?',
        [
          {
            text: 'Stay',
            style: 'cancel',
            onPress: () => resolve(false),
          },
          {
            text: 'Leave',
            style: 'destructive',
            onPress: () => resolve(true),
          },
        ],
        { cancelable: false }
      );
    });
  }, [isBlocking, blockingReason]);

  /**
   * Show confirmation dialog with custom message
   */
  const showConfirmationWithMessage = useCallback(
    (title: string, message: string): Promise<boolean> => {
      return new Promise((resolve) => {
        Alert.alert(
          title,
          message,
          [
            {
              text: 'Stay',
              style: 'cancel',
              onPress: () => resolve(false),
            },
            {
              text: 'Leave',
              style: 'destructive',
              onPress: () => resolve(true),
            },
          ],
          { cancelable: false }
        );
      });
    },
    []
  );

  return {
    isBlocking,
    blockingReason,
    canNavigateAway: !isBlocking,
    status: episode?.status || null,
    hasActiveJobs: activeJobs.length > 0,
    activeJobTypes,
    showConfirmation,
    showConfirmationWithMessage,
  };
}

export default useBlockingState;
