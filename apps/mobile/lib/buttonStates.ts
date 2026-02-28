/**
 * Button States Utility
 *
 * Centralized logic for determining button enable/disable states
 * based on episode status, script presence, slot progress, active jobs,
 * and final playback ID.
 *
 * Requirements: 6.1-6.10
 */

import { EpisodeStatus } from '../hooks/useEpisodes';
import { JobData } from '../hooks/useJobProgress';
import {
  PHASE_1_JOB_TYPES,
  PHASE_2_JOB_TYPES,
  PHASE_5_JOB_TYPES,
} from '../hooks/useActiveJobTypes';

/**
 * Button states for all primary action buttons
 */
export interface ButtonStates {
  /** Record Voiceover button - Requirements: 6.1 */
  recordVoiceover: ButtonState;
  /** Generate Voiceover (ElevenLabs) button - Requirements: 6.2 */
  generateVoiceover: ButtonState;
  /** Add Video Clips button - Requirements: 6.3 */
  addVideoClips: ButtonState;
  /** Start Processing button - Requirements: 6.4 */
  startProcessing: ButtonState;
  /** Render Video button - Requirements: 6.5 */
  requestRender: ButtonState;
  /** View Video button - Requirements: 6.6 */
  viewVideo: ButtonState;
}

/**
 * Individual button state with enabled flag and reason
 */
export interface ButtonState {
  /** Whether the button is enabled */
  enabled: boolean;
  /** Reason why button is disabled (for tooltip/helper text) - Requirements: 6.10 */
  disabledReason: string | null;
  /** Whether button should be visible */
  visible: boolean;
}

/**
 * Input parameters for getButtonStates
 */
export interface GetButtonStatesInput {
  /** Current episode status */
  status: EpisodeStatus;
  /** Whether episode has a script */
  hasScript: boolean;
  /** Slot progress (completed/total) */
  slotProgress: { completed: number; total: number } | null;
  /** List of active jobs for the episode */
  activeJobs: JobData[];
  /** Whether episode has a final playback ID */
  hasFinalPlaybackId: boolean;
  /** Whether episode has a cut plan */
  hasCutPlan?: boolean;
}

/**
 * Check if a job is active (pending or processing)
 */
function isActiveJob(job: JobData): boolean {
  return job.status === 'pending' || job.status === 'processing';
}

/**
 * Check if there are active Phase 1 jobs (voiceover processing)
 * Requirements: 6.1, 6.2
 */
export function hasActivePhase1Jobs(jobs: JobData[]): boolean {
  const phase1Types: readonly string[] = PHASE_1_JOB_TYPES;
  return jobs.some(
    (job) => isActiveJob(job) && phase1Types.includes(job.type)
  );
}

/**
 * Check if there are active Phase 2 jobs (B-roll processing)
 * Requirements: 6.3, 6.4
 */
export function hasActivePhase2Jobs(jobs: JobData[]): boolean {
  const phase2Types: readonly string[] = PHASE_2_JOB_TYPES;
  return jobs.some(
    (job) => isActiveJob(job) && phase2Types.includes(job.type)
  );
}

/**
 * Check if there are active Phase 5 jobs (rendering)
 * Requirements: 6.5
 */
export function hasActivePhase5Jobs(jobs: JobData[]): boolean {
  const phase5Types: readonly string[] = PHASE_5_JOB_TYPES;
  return jobs.some(
    (job) => isActiveJob(job) && phase5Types.includes(job.type)
  );
}

/**
 * Check if there are any active jobs
 */
export function hasAnyActiveJobs(jobs: JobData[]): boolean {
  return jobs.some(isActiveJob);
}

/**
 * Get button states for all primary action buttons
 *
 * Requirements: 6.1-6.10
 *
 * @param input - Input parameters including status, script, slots, jobs, playback ID
 * @returns ButtonStates object with enabled/disabled state and reasons for each button
 */
export function getButtonStates(input: GetButtonStatesInput): ButtonStates {
  const {
    status,
    hasScript,
    slotProgress,
    activeJobs,
    hasFinalPlaybackId,
    hasCutPlan = false,
  } = input;

  // Check for active jobs by phase
  const phase1Active = hasActivePhase1Jobs(activeJobs);
  const phase2Active = hasActivePhase2Jobs(activeJobs);
  const phase5Active = hasActivePhase5Jobs(activeJobs);
  const anyJobsActive = hasAnyActiveJobs(activeJobs);

  // Check slot completion
  const allSlotsComplete =
    slotProgress !== null && slotProgress.completed >= slotProgress.total;

  return {
    /**
     * Record Voiceover button
     * Requirements: 6.1
     * Enabled only when:
     * - Episode status is `draft`
     * - Script exists (script field is not null/empty)
     * - No active Phase 1 jobs
     */
    recordVoiceover: getRecordVoiceoverState(status, hasScript, phase1Active),

    /**
     * Generate Voiceover (ElevenLabs) button
     * Requirements: 6.2
     * Enabled only when:
     * - Episode status is `draft`
     * - Script exists
     * - No active Phase 1 jobs
     */
    generateVoiceover: getGenerateVoiceoverState(status, hasScript, phase1Active),

    /**
     * Add Video Clips button
     * Requirements: 6.3
     * Enabled only when:
     * - Episode status is `voiceover_cleaned` or `collecting_clips`
     * - No active Phase 1 jobs
     * - No active Phase 2 jobs
     */
    addVideoClips: getAddVideoClipsState(status, phase1Active, phase2Active),

    /**
     * Start Processing button
     * Requirements: 6.4
     * Enabled only when:
     * - Episode status is `collecting_clips`
     * - All required slots have at least one clip uploaded
     * - No active jobs of any type
     */
    startProcessing: getStartProcessingState(status, allSlotsComplete, anyJobsActive),

    /**
     * Render Video button
     * Requirements: 6.5
     * Enabled only when:
     * - Episode status is `cut_plan_ready`
     * - No active Phase 5 jobs (ffmpeg_render_microcut_v2, mux_publish)
     * - Cut plan exists and is valid
     */
    requestRender: getRequestRenderState(status, phase5Active, hasCutPlan),

    /**
     * View Video button
     * Requirements: 6.6
     * Enabled only when:
     * - Episode status is `ready` or `published`
     * - Final video playback ID exists
     */
    viewVideo: getViewVideoState(status, hasFinalPlaybackId),
  };
}

/**
 * Get Record Voiceover button state
 * Requirements: 6.1
 */
function getRecordVoiceoverState(
  status: EpisodeStatus,
  hasScript: boolean,
  phase1Active: boolean
): ButtonState {
  // Only visible in draft status
  const visible = status === 'draft';

  if (!visible) {
    return { enabled: false, disabledReason: null, visible: false };
  }

  if (!hasScript) {
    return {
      enabled: false,
      disabledReason: 'Generate a script first',
      visible: true,
    };
  }

  if (phase1Active) {
    return {
      enabled: false,
      disabledReason: 'Voiceover processing in progress',
      visible: true,
    };
  }

  return { enabled: true, disabledReason: null, visible: true };
}

/**
 * Get Generate Voiceover (ElevenLabs) button state
 * Requirements: 6.2
 */
function getGenerateVoiceoverState(
  status: EpisodeStatus,
  hasScript: boolean,
  phase1Active: boolean
): ButtonState {
  // Only visible in draft status
  const visible = status === 'draft';

  if (!visible) {
    return { enabled: false, disabledReason: null, visible: false };
  }

  if (!hasScript) {
    return {
      enabled: false,
      disabledReason: 'Generate a script first',
      visible: true,
    };
  }

  if (phase1Active) {
    return {
      enabled: false,
      disabledReason: 'Voiceover processing in progress',
      visible: true,
    };
  }

  return { enabled: true, disabledReason: null, visible: true };
}

/**
 * Get Add Video Clips button state
 * Requirements: 6.3
 */
function getAddVideoClipsState(
  status: EpisodeStatus,
  phase1Active: boolean,
  phase2Active: boolean
): ButtonState {
  // Only visible when voiceover is cleaned or collecting clips
  const visible =
    status === 'voiceover_cleaned' ||
    status === 'collecting_clips' ||
    status === 'needs_more_clips';

  if (!visible) {
    return { enabled: false, disabledReason: null, visible: false };
  }

  if (phase1Active) {
    return {
      enabled: false,
      disabledReason: 'Voiceover processing in progress',
      visible: true,
    };
  }

  if (phase2Active) {
    return {
      enabled: false,
      disabledReason: 'Video clips are being processed',
      visible: true,
    };
  }

  return { enabled: true, disabledReason: null, visible: true };
}

/**
 * Get Start Processing button state
 * Requirements: 6.4
 */
function getStartProcessingState(
  status: EpisodeStatus,
  allSlotsComplete: boolean,
  anyJobsActive: boolean
): ButtonState {
  // Only visible when collecting clips
  const visible =
    status === 'collecting_clips' ||
    status === 'needs_more_clips' ||
    status === 'chunking_clips' ||
    status === 'enriching_chunks';

  if (!visible) {
    return { enabled: false, disabledReason: null, visible: false };
  }

  if (!allSlotsComplete) {
    return {
      enabled: false,
      disabledReason: 'Upload clips for all required slots first',
      visible: true,
    };
  }

  if (anyJobsActive) {
    return {
      enabled: false,
      disabledReason: 'Processing in progress',
      visible: true,
    };
  }

  return { enabled: true, disabledReason: null, visible: true };
}

/**
 * Get Render Video button state
 * Requirements: 6.5
 */
function getRequestRenderState(
  status: EpisodeStatus,
  phase5Active: boolean,
  hasCutPlan: boolean
): ButtonState {
  // Only visible when cut plan is ready
  const visible = status === 'cut_plan_ready';

  if (!visible) {
    return { enabled: false, disabledReason: null, visible: false };
  }

  if (phase5Active) {
    return {
      enabled: false,
      disabledReason: 'Rendering in progress',
      visible: true,
    };
  }

  if (!hasCutPlan) {
    return {
      enabled: false,
      disabledReason: 'Waiting for edit plan to be generated',
      visible: true,
    };
  }

  return { enabled: true, disabledReason: null, visible: true };
}

/**
 * Get View Video button state
 * Requirements: 6.6
 */
function getViewVideoState(
  status: EpisodeStatus,
  hasFinalPlaybackId: boolean
): ButtonState {
  // Only visible when ready or published
  const visible = status === 'ready' || status === 'published';

  if (!visible) {
    return { enabled: false, disabledReason: null, visible: false };
  }

  if (!hasFinalPlaybackId) {
    return {
      enabled: false,
      disabledReason: 'Video is still being prepared',
      visible: true,
    };
  }

  return { enabled: true, disabledReason: null, visible: true };
}

/**
 * Check if episode is in a blocking state where all buttons should be disabled
 * Requirements: 6.9
 */
export function isBlockingState(status: EpisodeStatus): boolean {
  const blockingStatuses: EpisodeStatus[] = [
    'voiceover_uploaded',
    'voiceover_cleaning',
    'chunking_clips',
    'enriching_chunks',
    'matching',
    'rendering',
  ];
  // Note: cut_plan_ready is NOT blocking - cut plan is ready, user can proceed
  return blockingStatuses.includes(status);
}

/**
 * Get disabled reason for blocking state
 * Requirements: 6.9
 */
export function getBlockingStateReason(status: EpisodeStatus): string | null {
  const reasons: Partial<Record<EpisodeStatus, string>> = {
    voiceover_uploaded: 'Preparing your voiceover...',
    voiceover_cleaning: 'Cleaning your audio...',
    chunking_clips: 'Processing your video clips...',
    enriching_chunks: 'AI is analyzing your footage...',
    matching: 'Matching audio to video...',
    rendering: 'Rendering your final video...',
  };
  return reasons[status] || null;
}
