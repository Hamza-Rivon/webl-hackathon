/**
 * Episode Journey Hook
 *
 * Hook for tracking and navigating the episode creation journey.
 * Provides step info, progress calculation, and navigation helpers.
 * 
 * Requirements: 1.1-1.13, 2.1-2.10
 */

import { useEffect, useMemo } from 'react';
import {
  useEpisodeJourneyStore,
  JOURNEY_STEPS,
  JourneyStep,
  JourneySubState,
  JourneyStepConfig,
  statusToJourneyStep,
  getStepIndex,
  getStepConfig,
  calculateJourneyProgress,
  isStepComplete,
  isCurrentStep,
  isUpcomingStep,
  isBlockingStatus,
  getBlockingReason,
  EpisodeStatus as StoreEpisodeStatus,
} from '../stores/episodeJourney';
import { EpisodeStatus } from './useEpisodes';

interface UseEpisodeJourneyOptions {
  episodeId: string;
  status: EpisodeStatus;
  hasTemplate?: boolean;
  hasScript?: boolean;
  hasVoiceover?: boolean;
  slotsComplete?: boolean;
}

interface JourneyStepWithState extends JourneyStepConfig {
  isComplete: boolean;
  isCurrent: boolean;
  isUpcoming: boolean;
  isClickable: boolean;
}

/**
 * Hook for tracking and navigating the episode creation journey.
 * Provides step info, progress calculation, and journey step tracking.
 * 
 * NOTE: Navigation helper methods have been removed (moved to useNavigation).
 * Use useNavigation hook for navigation needs.
 * 
 * Requirements: 1.1-1.13, 2.1-2.10, 3.2
 */
export function useEpisodeJourney({
  episodeId,
  status,
  hasTemplate = false,
  hasScript = false,
  hasVoiceover = false,
  slotsComplete = false,
}: UseEpisodeJourneyOptions) {
  const {
    currentStep,
    subState,
    completedSteps,
    showJourneyOverlay,
    isBlocking,
    blockingReason,
    lastSuccessfulStep,
    error,
    setCurrentEpisode,
    updateStep,
    setShowJourneyOverlay,
    setError,
    preserveLastSuccessfulStep,
  } = useEpisodeJourneyStore();

  // Sync episode status with journey store (with template/script context)
  useEffect(() => {
    setCurrentEpisode(episodeId, status as StoreEpisodeStatus, hasTemplate, hasScript);
  }, [episodeId, status, hasTemplate, hasScript, setCurrentEpisode]);

  // Update step when status changes
  useEffect(() => {
    updateStep(status as StoreEpisodeStatus, hasTemplate, hasScript);
  }, [status, hasTemplate, hasScript, updateStep]);

  // Calculate overall progress
  const progress = useMemo(() => {
    return calculateJourneyProgress(currentStep);
  }, [currentStep]);

  // Build steps with state
  const stepsWithState: JourneyStepWithState[] = useMemo(() => {
    return JOURNEY_STEPS.map((step) => {
      const isComplete = isStepComplete(currentStep, step.id);
      const isCurrent = isCurrentStep(currentStep, step.id);
      const isUpcoming = isUpcomingStep(currentStep, step.id);
      
      // Determine if step is clickable (can navigate back to it)
      let isClickable = false;
      if (isComplete) {
        // Can go back to completed steps
        isClickable = true;
      } else if (isCurrent) {
        // Current step is always clickable
        isClickable = true;
      }

      return {
        ...step,
        isComplete,
        isCurrent,
        isUpcoming,
        isClickable,
      };
    });
  }, [currentStep]);

  // Get current step config
  const currentStepConfig = useMemo(() => {
    return getStepConfig(currentStep);
  }, [currentStep]);

  // Get next step config
  const nextStepConfig = useMemo(() => {
    const nextIndex = getStepIndex(currentStep) + 1;
    if (nextIndex < JOURNEY_STEPS.length) {
      return JOURNEY_STEPS[nextIndex];
    }
    return null;
  }, [currentStep]);

  // Navigation helper methods removed - use useNavigation hook instead
  // Requirements: 3.2 - Navigation moved to useNavigation

  // Get action button config for current step (kept for UI purposes, no navigation)
  const getActionButton = useMemo(() => {
    switch (currentStep) {
      case 'template_selection':
        if (!hasTemplate) {
          return { label: 'Choose Template', emoji: '📺', action: 'select_template' };
        }
        return { label: 'Generate Script', emoji: '✨', action: 'generate_script' };
      case 'script_generation':
        return { label: 'Generate Script', emoji: '✨', action: 'generate_script' };
      case 'voiceover_recording':
        return { label: 'Record Voiceover', emoji: '🎙️', action: 'record_voiceover' };
      case 'slot_collection':
        return { label: 'Collect Clips', emoji: '🎬', action: 'collect_clips' };
      case 'processing':
        return { label: 'View Progress', emoji: '⏳', action: 'view_progress' };
      case 'final_video':
        return { label: 'View Video', emoji: '▶️', action: 'view_video' };
      default:
        return null;
    }
  }, [currentStep, hasTemplate]);

  // Check if can proceed to next step
  const canProceed = useMemo(() => {
    switch (currentStep) {
      case 'template_selection':
        return hasTemplate;
      case 'script_generation':
        return hasScript;
      case 'voiceover_recording':
        return hasVoiceover;
      case 'slot_collection':
        return slotsComplete;
      case 'processing':
        return status === 'ready';
      case 'final_video':
        return true;
      default:
        return false;
    }
  }, [currentStep, hasTemplate, hasScript, hasVoiceover, slotsComplete, status]);

  return {
    // Current state
    currentStep,
    currentStepConfig,
    nextStepConfig,
    progress,
    stepsWithState,
    completedSteps,
    canProceed,

    // Sub-state and blocking state (Requirements: 1.2-1.11, 2.1-2.10)
    subState,
    isBlocking,
    blockingReason,
    lastSuccessfulStep,
    error,

    // UI state
    showJourneyOverlay,
    setShowJourneyOverlay,

    // Actions (navigation removed - use useNavigation hook)
    getActionButton,
    setError,
    preserveLastSuccessfulStep,
  };
}

export default useEpisodeJourney;
