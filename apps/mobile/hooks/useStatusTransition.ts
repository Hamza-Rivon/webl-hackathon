/**
 * Status Transition Hook
 *
 * Manages status transitions and triggers appropriate animations.
 * Detects status changes immediately (via polling or SSE) and triggers
 * animations without waiting for next poll cycle.
 *
 * NOTE: This hook only handles animation logic. Navigation logic has been
 * moved to useStatusChangeHandler. This hook should NOT trigger navigation.
 *
 * Requirements: 3.2, 4.1, 9.1-9.12
 */

import { useEffect, useRef, useCallback, useState } from 'react';
import { triggerHaptic, HapticType } from '../lib/haptics';
import { EpisodeStatus } from './useEpisodes';
import { TransitionAnimationType } from '../components/episode/StatusTransitionAnimation';

/**
 * Status transition configuration
 */
interface StatusTransitionConfig {
  /** Animation type to show */
  animationType: TransitionAnimationType;
  /** Haptic feedback type */
  hapticType: HapticType;
  /** Duration to show animation (ms) */
  duration: number;
  /** Whether this is a success transition */
  isSuccess: boolean;
  /** Custom title for the animation */
  title?: string;
  /** Custom subtitle for the animation */
  subtitle?: string;
}

/**
 * Map of status transitions to their configurations
 * Key format: "fromStatus->toStatus"
 */
const STATUS_TRANSITION_CONFIGS: Record<string, StatusTransitionConfig> = {
  // Phase 1 transitions - Requirements: 9.1, 9.2
  'voiceover_uploaded->voiceover_cleaning': {
    animationType: 'processing',
    hapticType: 'light',
    duration: 0,
    isSuccess: false,
    title: 'Cleaning Audio',
    subtitle: 'Removing silence and fillers...',
  },
  'voiceover_cleaning->voiceover_cleaned': {
    animationType: 'voiceover_ready',
    hapticType: 'success',
    duration: 1500,
    isSuccess: true,
    title: 'Voiceover Ready!',
    subtitle: 'You can now add video clips',
  },

  // Phase 2 transitions - Requirements: 9.3
  'collecting_clips->chunking_clips': {
    animationType: 'processing',
    hapticType: 'light',
    duration: 0,
    isSuccess: false,
    title: 'Processing Started',
    subtitle: 'Analyzing your footage...',
  },
  'chunking_clips->enriching_chunks': {
    animationType: 'processing',
    hapticType: 'light',
    duration: 0,
    isSuccess: false,
    title: 'AI Analyzing',
    subtitle: 'Understanding your content...',
  },

  // Phase 3 transitions - Requirements: 9.4
  'enriching_chunks->matching': {
    animationType: 'processing',
    hapticType: 'light',
    duration: 0,
    isSuccess: false,
    title: 'Matching Content',
    subtitle: 'Finding the best clips...',
  },

  // Phase 4 transitions - Requirements: 9.5
  'matching->cut_plan_ready': {
    animationType: 'processing',
    hapticType: 'light',
    duration: 0,
    isSuccess: false,
    title: 'Creating Edit Plan',
    subtitle: 'Building your video...',
  },
  // Phase 5 transitions - Requirements: 9.6, 9.7
  'cut_plan_ready->rendering': {
    animationType: 'processing',
    hapticType: 'light',
    duration: 0,
    isSuccess: false,
    title: 'Rendering Video',
    subtitle: 'Creating your final video...',
  },
  'rendering->ready': {
    animationType: 'video_complete',
    hapticType: 'success',
    duration: 2000,
    isSuccess: true,
    title: 'Video Complete!',
    subtitle: 'Your video is ready to view',
  },

  // Error transitions
  '*->failed': {
    animationType: 'error',
    hapticType: 'error',
    duration: 2000,
    isSuccess: false,
    title: 'Something went wrong',
    subtitle: 'Please try again',
  },
};

/**
 * Get transition config for a status change
 */
function getTransitionConfig(
  fromStatus: EpisodeStatus | null,
  toStatus: EpisodeStatus
): StatusTransitionConfig | null {
  // Check for specific transition
  const specificKey = `${fromStatus}->${toStatus}`;
  if (STATUS_TRANSITION_CONFIGS[specificKey]) {
    return STATUS_TRANSITION_CONFIGS[specificKey];
  }

  // Check for wildcard transitions (e.g., *->failed)
  const wildcardKey = `*->${toStatus}`;
  if (STATUS_TRANSITION_CONFIGS[wildcardKey]) {
    return STATUS_TRANSITION_CONFIGS[wildcardKey];
  }

  return null;
}

export interface UseStatusTransitionOptions {
  /** Current episode status */
  status: EpisodeStatus | null;
  /** Whether to enable transition animations */
  enabled?: boolean;
  /** Callback when a success transition completes */
  onSuccessTransition?: (toStatus: EpisodeStatus) => void;
  /** Callback when any transition occurs */
  onTransition?: (fromStatus: EpisodeStatus | null, toStatus: EpisodeStatus) => void;
}

export interface UseStatusTransitionResult {
  /** Whether an animation is currently showing */
  isAnimating: boolean;
  /** Current animation type */
  animationType: TransitionAnimationType | null;
  /** Animation title */
  animationTitle: string | null;
  /** Animation subtitle */
  animationSubtitle: string | null;
  /** Dismiss the current animation */
  dismissAnimation: () => void;
  /** Previous status for reference */
  previousStatus: EpisodeStatus | null;
  /** Whether a status change was detected */
  hasStatusChanged: boolean;
}

/**
 * Hook for managing status transitions and animations
 *
 * Requirements: 3.2, 4.1, 9.1-9.12
 * - Immediate animation on status transitions (no delay)
 * - Success animations for 1-2 seconds before transitioning
 * - Same animation timing for recorded and ElevenLabs voiceover
 * - Trigger animations immediately when status changes detected
 * - NO navigation logic (moved to useStatusChangeHandler)
 * - NO setTimeout-based navigation (only animation dismissal)
 */
export function useStatusTransition({
  status,
  enabled = true,
  onSuccessTransition,
  onTransition,
}: UseStatusTransitionOptions): UseStatusTransitionResult {
  const previousStatusRef = useRef<EpisodeStatus | null>(null);
  const [isAnimating, setIsAnimating] = useState(false);
  const [animationType, setAnimationType] = useState<TransitionAnimationType | null>(null);
  const [animationTitle, setAnimationTitle] = useState<string | null>(null);
  const [animationSubtitle, setAnimationSubtitle] = useState<string | null>(null);
  const [hasStatusChanged, setHasStatusChanged] = useState(false);
  const animationTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Dismiss animation
  const dismissAnimation = useCallback(() => {
    if (animationTimeoutRef.current) {
      clearTimeout(animationTimeoutRef.current);
      animationTimeoutRef.current = null;
    }
    setIsAnimating(false);
    setAnimationType(null);
    setAnimationTitle(null);
    setAnimationSubtitle(null);
  }, []);

  // Detect status changes and trigger animations immediately
  // Requirements: 9.12 - Trigger animations immediately when status changes detected
  useEffect(() => {
    if (!enabled || !status) {
      return;
    }

    const previousStatus = previousStatusRef.current;

    // Check if status has changed
    if (previousStatus !== status) {
      setHasStatusChanged(true);

      // Get transition config
      const config = getTransitionConfig(previousStatus, status);

      // Trigger transition callback
      onTransition?.(previousStatus, status);

      // Show animation if config exists
      if (config) {
        // Clear any existing animation timeout
        if (animationTimeoutRef.current) {
          clearTimeout(animationTimeoutRef.current);
        }

        // Trigger haptic feedback immediately - Requirements: 9.9
        triggerHaptic(config.hapticType);

        // Show animation
        setAnimationType(config.animationType);
        setAnimationTitle(config.title || null);
        setAnimationSubtitle(config.subtitle || null);
        setIsAnimating(true);

        // Auto-dismiss after duration (for success animations)
        if (config.duration > 0) {
          animationTimeoutRef.current = setTimeout(() => {
            dismissAnimation();
            
            // Trigger success callback
            if (config.isSuccess) {
              onSuccessTransition?.(status);
            }
          }, config.duration);
        }
      }

      // Update previous status
      previousStatusRef.current = status;
    } else {
      setHasStatusChanged(false);
    }

    // Cleanup
    return () => {
      if (animationTimeoutRef.current) {
        clearTimeout(animationTimeoutRef.current);
      }
    };
  }, [status, enabled, onSuccessTransition, onTransition, dismissAnimation]);

  return {
    isAnimating,
    animationType,
    animationTitle,
    animationSubtitle,
    dismissAnimation,
    previousStatus: previousStatusRef.current,
    hasStatusChanged,
  };
}

/**
 * Trigger a manual status transition animation
 * Useful for user-initiated actions
 */
export function triggerTransitionAnimation(
  type: TransitionAnimationType,
  hapticType: HapticType = 'success'
): void {
  triggerHaptic(hapticType);
}

export default useStatusTransition;
