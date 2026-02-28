/**
 * Unified Navigation Hook
 *
 * Single hook that provides all navigation functionality for episodes.
 * Replaces direct router.push(), router.replace(), and router.back() calls.
 * Coordinates with NavigationService and ScreenContext to prevent conflicts.
 *
 * Requirements: 3.1-3.9
 */

import { useCallback } from 'react';
import { useNavigationService } from '../lib/navigation/NavigationServiceProvider';
import { useScreenContext } from '../contexts/ScreenContext';
import { useEpisode, type EpisodeStatus } from './useEpisodes';

/**
 * Navigation methods provided by useNavigation hook
 * Requirements: 3.1-3.9
 */
export interface UseNavigationResult {
  /** Navigate to episode detail screen */
  navigateToEpisode: (options?: { replace?: boolean }) => Promise<void>;
  
  /** Navigate to record voiceover screen */
  navigateToRecord: () => Promise<void>;
  
  /** Navigate to slots screen */
  navigateToSlots: () => Promise<void>;
  
  /** Navigate to processing screen */
  navigateToProcessing: () => Promise<void>;
  
  /** Navigate to video screen */
  navigateToPreview: () => Promise<void>;
  
  /** Navigate back */
  navigateBack: () => Promise<void>;
  
  /** Handle status change navigation */
  handleStatusChange: (oldStatus: string, newStatus: string) => Promise<void>;
  
  /** Check if screen is accessible */
  canAccessScreen: (screen: string) => boolean;
  
  /** Get next step in flow */
  getNextStep: () => string | null;
  
  /** Navigate to next step in flow */
  navigateToNextStep: () => Promise<void>;
  
  /** Generic navigate method for custom routes */
  navigate: (route: string, options?: { replace?: boolean; priority?: 'high' | 'normal' | 'low' }) => Promise<void>;
}

/**
 * Unified Navigation Hook
 *
 * Provides centralized navigation methods for episode screens.
 * All navigation goes through NavigationService to prevent conflicts.
 *
 * Requirements: 3.1-3.9
 *
 * @param episodeId - The episode ID to navigate for
 * @returns Navigation methods and helpers
 */
export function useNavigation(episodeId: string): UseNavigationResult {
  const navigationService = useNavigationService();
  const screenContext = useScreenContext();
  const { data: episode } = useEpisode(episodeId);

  /**
   * Check if navigation is allowed before executing
   * Requirements: 3.4
   */
  const checkNavigationAllowed = useCallback((): boolean => {
    if (!screenContext.canNavigate) {
      console.warn('[useNavigation] Navigation blocked:', screenContext.blockedReason);
      return false;
    }
    return true;
  }, [screenContext.canNavigate, screenContext.blockedReason]);

  /**
   * Navigate to episode detail screen
   * Requirements: 3.3
   */
  const navigateToEpisode = useCallback(async (options?: { replace?: boolean }): Promise<void> => {
    if (!checkNavigationAllowed()) return;
    await navigationService.navigateToEpisode(episodeId, options);
  }, [episodeId, navigationService, checkNavigationAllowed]);

  /**
   * Navigate to record voiceover screen
   * Requirements: 3.3
   */
  const navigateToRecord = useCallback(async (): Promise<void> => {
    if (!checkNavigationAllowed()) return;
    await navigationService.navigateToRecord(episodeId);
  }, [episodeId, navigationService, checkNavigationAllowed]);

  /**
   * Navigate to slots screen
   * Requirements: 3.3
   */
  const navigateToSlots = useCallback(async (): Promise<void> => {
    if (!checkNavigationAllowed()) return;
    await navigationService.navigateToSlots(episodeId);
  }, [episodeId, navigationService, checkNavigationAllowed]);

  /**
   * Navigate to processing screen
   * Requirements: 3.3
   */
  const navigateToProcessing = useCallback(async (): Promise<void> => {
    if (!checkNavigationAllowed()) return;
    await navigationService.navigateToProcessing(episodeId);
  }, [episodeId, navigationService, checkNavigationAllowed]);

  /**
   * Navigate to video screen
   * Requirements: 3.3
   */
  const navigateToPreview = useCallback(async (): Promise<void> => {
    if (!checkNavigationAllowed()) return;
    await navigationService.navigateToPreview(episodeId);
  }, [episodeId, navigationService, checkNavigationAllowed]);

  /**
   * Navigate back
   * Requirements: 3.3, 12.1-12.8
   */
  const navigateBack = useCallback(async (): Promise<void> => {
    if (!checkNavigationAllowed()) return;
    // Pass episode status for blocking state check
    const episodeStatus = episode?.status;
    await navigationService.navigateBack(episodeStatus);
  }, [navigationService, checkNavigationAllowed, episode?.status]);

  /**
   * Handle status change navigation
   * Requirements: 3.4
   */
  const handleStatusChange = useCallback(
    async (oldStatus: string, newStatus: string): Promise<void> => {
      // Check if user is active - defer navigation if so
      if (screenContext.isUserActive) {
        console.log('[useNavigation] Status change navigation deferred - user is active');
        return;
      }

      // Check if navigation is allowed
      if (!checkNavigationAllowed()) {
        return;
      }

      await navigationService.handleStatusChange(episodeId, oldStatus, newStatus);
    },
    [episodeId, navigationService, screenContext.isUserActive, checkNavigationAllowed]
  );

  /**
   * Check if screen is accessible
   * Requirements: 3.5
   */
  const canAccessScreen = useCallback(
    (screen: string): boolean => {
      if (!episode) return false;
      return navigationService.checkAccess(screen, episodeId, episode.status);
    },
    [episode, episodeId, navigationService]
  );

  /**
   * Get next step in flow
   * Requirements: 3.6
   */
  const getNextStep = useCallback((): string | null => {
    if (!episode) return null;
    return navigationService.getNextStep(episodeId, episode.status);
  }, [episode, episodeId, navigationService]);

  /**
   * Navigate to next step in flow
   * Requirements: 3.7
   */
  const navigateToNextStep = useCallback(async (): Promise<void> => {
    if (!checkNavigationAllowed()) return;
    if (!episode) return;
    await navigationService.navigateToNextStep(episodeId, episode.status);
  }, [episode, episodeId, navigationService, checkNavigationAllowed]);

  /**
   * Generic navigate method for custom routes
   */
  const navigate = useCallback(async (route: string, options?: { replace?: boolean; priority?: 'high' | 'normal' | 'low' }): Promise<void> => {
    if (!checkNavigationAllowed()) return;
    await navigationService.navigate(route, options);
  }, [navigationService, checkNavigationAllowed]);

  return {
    navigateToEpisode,
    navigateToRecord,
    navigateToSlots,
    navigateToProcessing,
    navigateToPreview,
    navigateBack,
    handleStatusChange,
    canAccessScreen,
    getNextStep,
    navigateToNextStep,
    navigate,
  };
}

export default useNavigation;
