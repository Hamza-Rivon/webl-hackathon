/**
 * Standardized Button Handlers
 *
 * Factory function for creating standardized button handlers for episode actions.
 * All handlers validate state before navigating and use NavigationService for navigation.
 *
 * Requirements: 7.1-7.10
 */

import { NavigationService } from './navigationService';
import type { Episode, EpisodeWithDetails } from '../../hooks/useEpisodes';
import {
  getPrimaryARollSlotId,
  isARollFirstTemplateWithFallback,
} from '../templateWorkflow';
// Import hooks for type inference (ReturnType<typeof ...> requires actual function)
// These are only used in type positions, so they won't be included in runtime bundle
import { useStartProcessing } from '../../hooks/useEpisodes';
import { useToast } from '../../components/ui/Toast';

/**
 * Button Handlers Interface
 * Requirements: 7.1-7.10
 */
export interface ButtonHandlers {
  /** Navigate to record voiceover screen */
  handleRecord: () => Promise<void>;
  
  /** Navigate to slots screen for collecting clips */
  handleCollectSlots: () => Promise<void>;
  
  /** Start processing pipeline and navigate to processing screen */
  handleStartProcessing: () => Promise<void>;
}

/**
 * Options for creating button handlers
 * Requirements: 7.1, 7.9
 */
export interface CreateButtonHandlersOptions {
  /** Episode ID */
  episodeId: string;
  
  /** Navigation Service instance */
  navigationService: NavigationService;
  
  /** Episode data (can be undefined if not loaded yet) */
  episode: Episode | EpisodeWithDetails | undefined;
  
  /** Hook for starting processing (from useStartProcessing) */
  startProcessing: ReturnType<typeof useStartProcessing>;
  
  /** Toast function for showing error messages */
  showToast: ReturnType<typeof useToast>['showToast'];
  
  /** Optional refetch function to refresh episode data after actions */
  refetch?: (options?: { throwOnError?: boolean; cancelRefetch?: boolean }) => Promise<unknown>;
}

/**
 * Create standardized button handlers for episode actions
 *
 * Requirements: 7.1-7.10
 * - Each handler validates episode state before navigating
 * - Each handler uses NavigationService methods instead of direct router calls
 * - Each handler shows error toast if validation fails
 * - Each handler prevents double-taps by checking isNavigating
 *
 * @param options - Options for creating handlers
 * @returns Button handlers object
 */
export function createButtonHandlers(
  options: CreateButtonHandlersOptions
): ButtonHandlers {
  const {
    episodeId,
    navigationService,
    episode,
    startProcessing,
    showToast,
    refetch,
  } = options;

  /**
   * Handle record voiceover button click
   * Requirements: 7.4
   */
  const handleRecord = async (): Promise<void> => {
    // Prevent double-taps by checking if navigation is in progress
    if (navigationService.isNavigationInProgress()) {
      return;
    }

    // Validate episode exists
    if (!episode) {
      showToast({
        type: 'error',
        title: 'Error',
        message: 'Episode not found',
      });
      return;
    }

    // Validate status is draft
    if (episode.status !== 'draft') {
      showToast({
        type: 'error',
        title: 'Cannot Record',
        message: 'Cannot record voiceover in current state',
      });
      return;
    }

    // Validate script exists
    if (!episode.scriptContent) {
      showToast({
        type: 'error',
        title: 'Script Required',
        message: 'Please generate a script first',
      });
      return;
    }

    const templateSlotRequirements =
      'template' in episode ? episode.template?.slotRequirements : null;
    const useArollFirstCapture = isARollFirstTemplateWithFallback(
      templateSlotRequirements as any,
      'template' in episode ? episode.template?.name : null
    );

    if (useArollFirstCapture) {
      const arollSlotId = getPrimaryARollSlotId(templateSlotRequirements as any) || 'A1';
      await navigationService.navigate(
        `/(main)/episode/${episodeId}/slots/${arollSlotId}/record`
      );
      return;
    }

    // Navigate via service
    await navigationService.navigateToRecord(episodeId);
  };

  /**
   * Handle collect slots button click
   * Requirements: 7.5
   */
  const handleCollectSlots = async (): Promise<void> => {
    // Prevent double-taps
    if (navigationService.isNavigationInProgress()) {
      return;
    }

    // Validate episode exists
    if (!episode) {
      showToast({
        type: 'error',
        title: 'Error',
        message: 'Episode not found',
      });
      return;
    }

    // Validate status allows slot collection
    const allowedStatuses = ['voiceover_cleaned', 'collecting_clips', 'needs_more_clips'];
    if (!allowedStatuses.includes(episode.status)) {
      showToast({
        type: 'error',
        title: 'Cannot Collect Clips',
        message: 'Please wait for voiceover processing to complete',
      });
      return;
    }

    // Navigate via service
    await navigationService.navigateToSlots(episodeId);
  };

  /**
   * Handle start processing button click
   * Requirements: 7.6
   */
  const handleStartProcessing = async (): Promise<void> => {
    // Prevent double-taps by checking if mutation is pending
    if (startProcessing.isPending) {
      return;
    }

    // Prevent navigation if already navigating
    if (navigationService.isNavigationInProgress()) {
      return;
    }

    // Validate episode exists
    if (!episode) {
      showToast({
        type: 'error',
        title: 'Error',
        message: 'Episode not found',
      });
      return;
    }

    // Validate status allows processing
    const allowedStatuses = ['collecting_clips', 'needs_more_clips', 'chunking_clips', 'enriching_chunks'];
    if (!allowedStatuses.includes(episode.status)) {
      showToast({
        type: 'error',
        title: 'Cannot Start Processing',
        message: 'Please add video clips first',
      });
      return;
    }

    try {
      // Start processing job
      await startProcessing.mutateAsync(episodeId);
      
      // Wait a moment for status to update
      await new Promise(resolve => setTimeout(resolve, 500));
      
      // Refetch to get updated status
      if (refetch) {
        await refetch();
      }
      
      // Navigate to processing screen via service
      await navigationService.navigateToProcessing(episodeId);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Failed to start processing';
      
      // Check if error is about missing slots (backend validation)
      if (errorMessage.includes('Missing required slots') || errorMessage.includes('missing slots')) {
        showToast({
          type: 'warning',
          title: 'Missing Required Footage',
          message: 'Please upload clips for all required slots before processing.',
        });
      } else {
        showToast({
          type: 'error',
          title: 'Error',
          message: errorMessage,
        });
      }
    }
  };

  return {
    handleRecord,
    handleCollectSlots,
    handleStartProcessing,
  };
}

export default createButtonHandlers;
