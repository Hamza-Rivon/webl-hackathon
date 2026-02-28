/**
 * Active Job Types Hook
 *
 * Hook for checking active job types for an episode.
 * Provides Phase 1-5 job type detection for button enable/disable logic.
 *
 * Requirements: 6.1-6.4
 */

import { useMemo } from 'react';
import { useJobs, JobData } from './useJobProgress';

/**
 * Phase 1 job types (voiceover processing)
 * Requirements: 6.1, 6.2
 */
export const PHASE_1_JOB_TYPES = [
  'voiceover_ingest',
  'voiceover_transcript',
  'voiceover_transcript_correction',
  'voiceover_take_selection',
  'voiceover_silence_detection',
  'voiceover_cleaning',
  'voiceover_segmentation',
] as const;

/**
 * Phase 2 job types (B-roll processing)
 * Requirements: 6.3, 6.4
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
] as const;

/**
 * Phase 3 job types (semantic matching)
 */
export const PHASE_3_JOB_TYPES = ['semantic_matching'] as const;

/**
 * Phase 4 job types (cut plan generation)
 */
export const PHASE_4_JOB_TYPES = [
  'creative_edit_plan',
  'cut_plan_generation',
  'cut_plan_validation',
] as const;

/**
 * Phase 5 job types (rendering)
 */
export const PHASE_5_JOB_TYPES = ['ffmpeg_render_microcut_v2', 'mux_publish'] as const;

/**
 * All job types by phase
 */
export const JOB_TYPES_BY_PHASE = {
  1: PHASE_1_JOB_TYPES,
  2: PHASE_2_JOB_TYPES,
  3: PHASE_3_JOB_TYPES,
  4: PHASE_4_JOB_TYPES,
  5: PHASE_5_JOB_TYPES,
} as const;

/**
 * Result interface for useActiveJobTypes hook
 */
export interface ActiveJobTypesResult {
  /** All active jobs for the episode */
  activeJobs: JobData[];
  /** Active job types currently running */
  activeJobTypes: string[];
  /** Whether there are any active jobs */
  hasActiveJobs: boolean;
  /** Whether there are active Phase 1 jobs (voiceover processing) */
  hasActivePhase1Jobs: boolean;
  /** Whether there are active Phase 2 jobs (B-roll processing) */
  hasActivePhase2Jobs: boolean;
  /** Whether there are active Phase 3 jobs (semantic matching) */
  hasActivePhase3Jobs: boolean;
  /** Whether there are active Phase 4 jobs (cut plan) */
  hasActivePhase4Jobs: boolean;
  /** Whether there are active Phase 5 jobs (rendering) */
  hasActivePhase5Jobs: boolean;
  /** Get active jobs for a specific phase */
  getActiveJobsForPhase: (phase: 1 | 2 | 3 | 4 | 5) => JobData[];
  /** Check if a specific job type is active */
  isJobTypeActive: (jobType: string) => boolean;
  /** Loading state */
  isLoading: boolean;
}

/**
 * Check if a job is active (pending or processing)
 */
function isActiveJob(job: JobData): boolean {
  return job.status === 'pending' || job.status === 'processing';
}

/**
 * Check if jobs array has active jobs of specified types
 */
function hasActiveJobsOfTypes(jobs: JobData[], types: readonly string[]): boolean {
  return jobs.some((job) => isActiveJob(job) && types.includes(job.type));
}

/**
 * Get active jobs of specified types
 */
function getActiveJobsOfTypes(jobs: JobData[], types: readonly string[]): JobData[] {
  return jobs.filter((job) => isActiveJob(job) && types.includes(job.type));
}

/**
 * Hook for checking active job types for an episode
 *
 * Requirements: 6.1-6.4
 *
 * @param episodeId - The episode ID to check active jobs for
 * @returns ActiveJobTypesResult with active job information
 */
export function useActiveJobTypes(episodeId: string): ActiveJobTypesResult {
  const { data: jobs, isLoading } = useJobs({ episodeId });

  // Get all active jobs
  const activeJobs = useMemo(() => {
    return jobs?.filter(isActiveJob) || [];
  }, [jobs]);

  // Get active job types
  const activeJobTypes = useMemo(() => {
    return activeJobs.map((job) => job.type);
  }, [activeJobs]);

  // Check for active Phase 1 jobs (voiceover processing)
  // Requirements: 6.1, 6.2
  const hasActivePhase1Jobs = useMemo(() => {
    return hasActiveJobsOfTypes(activeJobs, PHASE_1_JOB_TYPES);
  }, [activeJobs]);

  // Check for active Phase 2 jobs (B-roll processing)
  // Requirements: 6.3, 6.4
  const hasActivePhase2Jobs = useMemo(() => {
    return hasActiveJobsOfTypes(activeJobs, PHASE_2_JOB_TYPES);
  }, [activeJobs]);

  // Check for active Phase 3 jobs (semantic matching)
  const hasActivePhase3Jobs = useMemo(() => {
    return hasActiveJobsOfTypes(activeJobs, PHASE_3_JOB_TYPES);
  }, [activeJobs]);

  // Check for active Phase 4 jobs (cut plan)
  const hasActivePhase4Jobs = useMemo(() => {
    return hasActiveJobsOfTypes(activeJobs, PHASE_4_JOB_TYPES);
  }, [activeJobs]);

  // Check for active Phase 5 jobs (rendering)
  const hasActivePhase5Jobs = useMemo(() => {
    return hasActiveJobsOfTypes(activeJobs, PHASE_5_JOB_TYPES);
  }, [activeJobs]);

  // Get active jobs for a specific phase
  const getActiveJobsForPhase = useMemo(() => {
    return (phase: 1 | 2 | 3 | 4 | 5): JobData[] => {
      const types = JOB_TYPES_BY_PHASE[phase];
      return getActiveJobsOfTypes(activeJobs, types);
    };
  }, [activeJobs]);

  // Check if a specific job type is active
  const isJobTypeActive = useMemo(() => {
    return (jobType: string): boolean => {
      return activeJobTypes.includes(jobType);
    };
  }, [activeJobTypes]);

  return {
    activeJobs,
    activeJobTypes,
    hasActiveJobs: activeJobs.length > 0,
    hasActivePhase1Jobs,
    hasActivePhase2Jobs,
    hasActivePhase3Jobs,
    hasActivePhase4Jobs,
    hasActivePhase5Jobs,
    getActiveJobsForPhase,
    isJobTypeActive,
    isLoading,
  };
}

export default useActiveJobTypes;
