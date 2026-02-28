/**
 * Episode Journey Store
 *
 * Manages the state and progression of the episode creation journey.
 * Tracks current step, sub-states, blocking states, and guides user flow.
 * 
 * Requirements: 1.1-1.13, 2.1-2.10
 */

import { create } from 'zustand';

// Journey step definitions
export type JourneyStep =
  | 'template_selection'
  | 'script_generation'
  | 'voiceover_recording'
  | 'slot_collection'
  | 'processing'
  | 'final_video';

// Sub-state definitions for granular progress tracking
// Requirements: 1.2, 1.3, 1.6-1.11
export type JourneySubState =
  | 'idle'
  | 'uploading'        // voiceover_uploaded - Phase 1 starting
  | 'cleaning'         // voiceover_cleaning - Phase 1 in progress
  | 'phase_1'          // Generic Phase 1 state
  | 'phase_2'          // chunking_clips, enriching_chunks
  | 'phase_3'          // matching
  | 'phase_4'          // cut_plan_ready (NOT blocking - cut plan is ready)
  | 'phase_5'          // rendering
  | 'rendering'        // Alias for phase_5
  | 'error';           // failed status

// Episode status type (matching backend)
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

export interface JourneyStepConfig {
  id: JourneyStep;
  label: string;
  emoji: string;
  description: string;
  completedMessage: string;
}

export const JOURNEY_STEPS: JourneyStepConfig[] = [
  {
    id: 'template_selection',
    label: 'Template',
    emoji: '📺',
    description: 'Choose a video template',
    completedMessage: 'Template selected',
  },
  {
    id: 'script_generation',
    label: 'Script',
    emoji: '📝',
    description: 'Generate your script',
    completedMessage: 'Script ready',
  },
  {
    id: 'voiceover_recording',
    label: 'Voiceover',
    emoji: '🎙️',
    description: 'Record your voiceover',
    completedMessage: 'Voiceover recorded',
  },
  {
    id: 'slot_collection',
    label: 'Footage',
    emoji: '🎬',
    description: 'Record or upload clips',
    completedMessage: 'All clips collected',
  },
  {
    id: 'processing',
    label: 'Processing',
    emoji: '⚙️',
    description: 'AI is editing your video',
    completedMessage: 'Processing complete',
  },
  {
    id: 'final_video',
    label: 'Done',
    emoji: '✅',
    description: 'Your video is ready',
    completedMessage: 'Video complete!',
  },
];

// Blocking statuses - user actions should be disabled during these states
// Requirements: 2.1-2.7
// Note: cut_plan_ready is NOT blocking - cut plan is ready, user can proceed
export const BLOCKING_STATUSES: EpisodeStatus[] = [
  'voiceover_uploaded',
  'voiceover_cleaning',
  'chunking_clips',
  'enriching_chunks',
  'matching',
  'rendering',
];

// Blocking reasons for each status
// Requirements: 2.1-2.7
export const BLOCKING_REASONS: Record<string, string> = {
  voiceover_uploaded: 'Your voiceover is being prepared...',
  voiceover_cleaning: 'Cleaning your audio (removing silences and fillers)...',
  chunking_clips: 'Processing your video clips...',
  enriching_chunks: 'AI is analyzing your footage...',
  matching: 'Matching audio to video...',
  rendering: 'Rendering your final video...',
};

// Status to journey step mapping result
export interface StatusMappingResult {
  step: JourneyStep;
  subState: JourneySubState;
  isBlocking: boolean;
  blockingReason: string | null;
}

/**
 * Map episode status to journey step with sub-state and blocking flag
 * Requirements: 1.1-1.13
 * 
 * @param status - Current episode status from database
 * @param hasTemplate - Whether episode has a template assigned
 * @param hasScript - Whether episode has a script generated
 * @returns Journey step, sub-state, and blocking information
 */
export function statusToJourneyStep(
  status: EpisodeStatus | string,
  hasTemplate: boolean = false,
  hasScript: boolean = false
): StatusMappingResult {
  switch (status) {
    // Requirement 1.1: draft status
    case 'draft':
      return {
        step: hasTemplate ? (hasScript ? 'voiceover_recording' : 'script_generation') : 'template_selection',
        subState: 'idle',
        isBlocking: false,
        blockingReason: null,
      };

    // Requirement 1.2: voiceover_uploaded - Phase 1 starting
    case 'voiceover_uploaded':
      return {
        step: 'voiceover_recording',
        subState: 'uploading',
        isBlocking: true,
        blockingReason: BLOCKING_REASONS.voiceover_uploaded,
      };

    // Requirement 1.3: voiceover_cleaning - Phase 1 in progress
    case 'voiceover_cleaning':
      return {
        step: 'voiceover_recording',
        subState: 'cleaning',
        isBlocking: true,
        blockingReason: BLOCKING_REASONS.voiceover_cleaning,
      };

    // Requirement 1.4: voiceover_cleaned - Phase 1 complete
    case 'voiceover_cleaned':
      return {
        step: 'slot_collection',
        subState: 'idle',
        isBlocking: false,
        blockingReason: null,
      };

    // Requirement 1.5: collecting_clips
    case 'collecting_clips':
      return {
        step: 'slot_collection',
        subState: 'idle',
        isBlocking: false,
        blockingReason: null,
      };

    case 'needs_more_clips':
      return {
        step: 'slot_collection',
        subState: 'idle',
        isBlocking: false,
        blockingReason: null,
      };

    // Requirement 1.6: chunking_clips - Phase 2 starting
    case 'chunking_clips':
      return {
        step: 'processing',
        subState: 'phase_2',
        isBlocking: true,
        blockingReason: BLOCKING_REASONS.chunking_clips,
      };

    // Requirement 1.7: enriching_chunks - Phase 2 in progress
    case 'enriching_chunks':
      return {
        step: 'processing',
        subState: 'phase_2',
        isBlocking: true,
        blockingReason: BLOCKING_REASONS.enriching_chunks,
      };

    // Requirement 1.8: matching - Phase 3
    case 'matching':
      return {
        step: 'processing',
        subState: 'phase_3',
        isBlocking: true,
        blockingReason: BLOCKING_REASONS.matching,
      };

    // Requirement 1.9: cut_plan_ready - Phase 4 complete
    // Note: cut_plan_ready remains in processing step and is NOT blocking
    case 'cut_plan_ready':
      return {
        step: 'processing',
        subState: 'phase_4',
        isBlocking: false,
        blockingReason: null,
      };

    // Requirement 1.11: rendering - Phase 5
    case 'rendering':
      return {
        step: 'processing',
        subState: 'rendering',
        isBlocking: true,
        blockingReason: BLOCKING_REASONS.rendering,
      };

    // Requirement 1.12: ready or published
    case 'ready':
    case 'published':
      return {
        step: 'final_video',
        subState: 'idle',
        isBlocking: false,
        blockingReason: null,
      };

    // Requirement 1.13: failed - preserve last step, show error
    case 'failed':
      return {
        step: 'processing',
        subState: 'error',
        isBlocking: false,
        blockingReason: null,
      };

    default:
      return {
        step: 'template_selection',
        subState: 'idle',
        isBlocking: false,
        blockingReason: null,
      };
  }
}

/**
 * Check if a status is a blocking state
 * Requirements: 2.1-2.7
 */
export function isBlockingStatus(status: EpisodeStatus | string): boolean {
  return BLOCKING_STATUSES.includes(status as EpisodeStatus);
}

/**
 * Get blocking reason for a status
 * Requirements: 2.1-2.7
 */
export function getBlockingReason(status: EpisodeStatus | string): string | null {
  return BLOCKING_REASONS[status] || null;
}

// Get step index for progress calculation
export function getStepIndex(step: JourneyStep): number {
  return JOURNEY_STEPS.findIndex((s) => s.id === step);
}

// Get step config
export function getStepConfig(step: JourneyStep): JourneyStepConfig | undefined {
  return JOURNEY_STEPS.find((s) => s.id === step);
}

// Calculate progress percentage
export function calculateJourneyProgress(step: JourneyStep): number {
  const index = getStepIndex(step);
  if (index < 0) return 0;
  return Math.round((index / (JOURNEY_STEPS.length - 1)) * 100);
}

// Check if a step is complete based on current step
export function isStepComplete(currentStep: JourneyStep, checkStep: JourneyStep): boolean {
  const currentIndex = getStepIndex(currentStep);
  const checkIndex = getStepIndex(checkStep);
  return checkIndex < currentIndex;
}

// Check if a step is the current step
export function isCurrentStep(currentStep: JourneyStep, checkStep: JourneyStep): boolean {
  return currentStep === checkStep;
}

// Check if a step is upcoming (not yet reached)
export function isUpcomingStep(currentStep: JourneyStep, checkStep: JourneyStep): boolean {
  const currentIndex = getStepIndex(currentStep);
  const checkIndex = getStepIndex(checkStep);
  return checkIndex > currentIndex;
}

// Enhanced store state interface
// Requirements: 1.1-1.13, 2.1-2.10, 10.5
interface EpisodeJourneyState {
  // Current episode being tracked
  currentEpisodeId: string | null;
  // Current journey step
  currentStep: JourneyStep;
  // Sub-state for granular progress tracking
  subState: JourneySubState;
  // Steps that are completed
  completedSteps: JourneyStep[];
  // Whether the journey overlay is visible
  showJourneyOverlay: boolean;
  // Blocking state tracking
  isBlocking: boolean;
  blockingReason: string | null;
  // Last successful step (for error recovery) - Requirement 10.5
  lastSuccessfulStep: JourneyStep | null;
  // Last successful sub-state (for error recovery context)
  lastSuccessfulSubState: JourneySubState | null;
  // Error state
  error: string | null;
  // Failed job info for error context
  failedJobInfo: {
    jobId: string | null;
    jobType: string | null;
    errorMessage: string | null;
    timestamp: Date | null;
  } | null;

  // Actions
  setCurrentEpisode: (
    episodeId: string,
    status: EpisodeStatus | string,
    hasTemplate?: boolean,
    hasScript?: boolean
  ) => void;
  updateStep: (
    status: EpisodeStatus | string,
    hasTemplate?: boolean,
    hasScript?: boolean
  ) => void;
  markStepComplete: (step: JourneyStep) => void;
  setShowJourneyOverlay: (show: boolean) => void;
  setError: (error: string | null, failedJobInfo?: { jobId: string; jobType: string; errorMessage: string } | null) => void;
  preserveLastSuccessfulStep: () => void;
  clearError: () => void;
  reset: () => void;
}

export const useEpisodeJourneyStore = create<EpisodeJourneyState>((set, get) => ({
  currentEpisodeId: null,
  currentStep: 'template_selection',
  subState: 'idle',
  completedSteps: [],
  showJourneyOverlay: false,
  isBlocking: false,
  blockingReason: null,
  lastSuccessfulStep: null,
  lastSuccessfulSubState: null,
  error: null,
  failedJobInfo: null,

  setCurrentEpisode: (episodeId, status, hasTemplate = false, hasScript = false) => {
    const mapping = statusToJourneyStep(status, hasTemplate, hasScript);
    const stepIndex = getStepIndex(mapping.step);
    
    // Mark all previous steps as complete
    const completedSteps = JOURNEY_STEPS
      .slice(0, stepIndex)
      .map((s) => s.id);

    // Track last successful step (non-error, non-blocking) - Requirement 10.5
    const lastSuccessfulStep = mapping.subState !== 'error' && !mapping.isBlocking
      ? mapping.step
      : get().lastSuccessfulStep;
    
    const lastSuccessfulSubState = mapping.subState !== 'error' && !mapping.isBlocking
      ? mapping.subState
      : get().lastSuccessfulSubState;

    set({
      currentEpisodeId: episodeId,
      currentStep: mapping.step,
      subState: mapping.subState,
      completedSteps,
      isBlocking: mapping.isBlocking,
      blockingReason: mapping.blockingReason,
      lastSuccessfulStep,
      lastSuccessfulSubState,
      error: mapping.subState === 'error' ? 'Processing failed' : null,
      // Clear failed job info if not in error state
      failedJobInfo: mapping.subState === 'error' ? get().failedJobInfo : null,
    });
  },

  updateStep: (status, hasTemplate = false, hasScript = false) => {
    const { currentStep, completedSteps, lastSuccessfulStep, lastSuccessfulSubState } = get();
    const mapping = statusToJourneyStep(status, hasTemplate, hasScript);
    
    // If moving forward, add current step to completed
    let newCompletedSteps = completedSteps;
    if (getStepIndex(mapping.step) > getStepIndex(currentStep)) {
      newCompletedSteps = [...completedSteps, currentStep];
    }

    // Track last successful step (non-error, non-blocking) - Requirement 10.5
    const newLastSuccessfulStep = mapping.subState !== 'error' && !mapping.isBlocking
      ? mapping.step
      : lastSuccessfulStep;
    
    const newLastSuccessfulSubState = mapping.subState !== 'error' && !mapping.isBlocking
      ? mapping.subState
      : lastSuccessfulSubState;

    set({
      currentStep: mapping.step,
      subState: mapping.subState,
      completedSteps: newCompletedSteps,
      isBlocking: mapping.isBlocking,
      blockingReason: mapping.blockingReason,
      lastSuccessfulStep: newLastSuccessfulStep,
      lastSuccessfulSubState: newLastSuccessfulSubState,
      error: mapping.subState === 'error' ? 'Processing failed' : null,
      // Clear failed job info if not in error state
      failedJobInfo: mapping.subState === 'error' ? get().failedJobInfo : null,
    });
  },

  markStepComplete: (step) => {
    const { completedSteps } = get();
    if (!completedSteps.includes(step)) {
      set({ completedSteps: [...completedSteps, step] });
    }
  },

  setShowJourneyOverlay: (show) => {
    set({ showJourneyOverlay: show });
  },

  /**
   * Set error state with optional failed job info
   * Requirement 10.5: Preserve last successful state for context
   */
  setError: (error, failedJobInfo = null) => {
    const { currentStep, subState } = get();
    
    // Preserve current step as last successful if transitioning to error
    if (error && subState !== 'error') {
      set({ 
        lastSuccessfulStep: currentStep,
        lastSuccessfulSubState: subState,
      });
    }
    
    set({ 
      error,
      subState: error ? 'error' : get().subState,
      failedJobInfo: failedJobInfo ? {
        jobId: failedJobInfo.jobId,
        jobType: failedJobInfo.jobType,
        errorMessage: failedJobInfo.errorMessage,
        timestamp: new Date(),
      } : null,
    });
  },

  preserveLastSuccessfulStep: () => {
    const { currentStep, subState } = get();
    if (subState !== 'error') {
      set({ 
        lastSuccessfulStep: currentStep,
        lastSuccessfulSubState: subState,
      });
    }
  },

  /**
   * Clear error state and restore to last successful state
   * Requirement 10.5: Preserve last successful state for context
   */
  clearError: () => {
    const { lastSuccessfulStep, lastSuccessfulSubState } = get();
    set({
      error: null,
      failedJobInfo: null,
      // Optionally restore to last successful state
      subState: lastSuccessfulSubState || 'idle',
    });
  },

  reset: () => {
    set({
      currentEpisodeId: null,
      currentStep: 'template_selection',
      subState: 'idle',
      completedSteps: [],
      showJourneyOverlay: false,
      isBlocking: false,
      blockingReason: null,
      lastSuccessfulStep: null,
      lastSuccessfulSubState: null,
      error: null,
      failedJobInfo: null,
    });
  },
}));
