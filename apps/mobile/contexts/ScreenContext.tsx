/**
 * Screen Context Provider
 *
 * Tracks current screen, user activity state, and navigation blocking state.
 * Coordinates with NavigationService to prevent navigation during critical actions.
 *
 * Requirements: 5.1-5.7
 */

import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { usePathname } from 'expo-router';
import { useNavigationService } from '../lib/navigation/NavigationServiceProvider';
import { saveLastRoute } from '../lib/sessionRestore';
import { trackScreenView } from '../lib/analytics';

/**
 * Screen Context Value Interface
 *
 * Provides current screen state and methods to control navigation blocking.
 * Requirements: 5.1-5.7
 */
export interface ScreenContextValue {
  /** Current screen route name */
  currentScreen: string | null;
  
  /** Whether user is actively interacting (typing, recording, uploading) */
  isUserActive: boolean;
  
  /** Whether navigation is currently allowed */
  canNavigate: boolean;
  
  /** Reason why navigation is blocked (if blocked) */
  blockedReason: string | null;
  
  /** Set user activity state */
  setUserActive: (active: boolean) => void;
  
  /** Block navigation with a reason */
  blockNavigation: (reason: string) => void;
  
  /** Allow navigation (remove block) */
  allowNavigation: () => void;
  
  /** Manually set current screen (usually handled automatically) */
  setCurrentScreen: (screen: string | null) => void;
}

/**
 * Screen Context
 */
const ScreenContext = createContext<ScreenContextValue | null>(null);

/**
 * Props for ScreenProvider
 */
interface ScreenProviderProps {
  children: React.ReactNode;
}

/**
 * Screen Provider Component
 *
 * Wraps the app and provides screen context to all screens.
 * Automatically tracks screen changes via Expo Router navigation events.
 *
 * Requirements: 5.1-5.7
 */
export function ScreenProvider({ children }: ScreenProviderProps): React.ReactElement {
  const [currentScreen, setCurrentScreenState] = useState<string | null>(null);
  const [isUserActive, setIsUserActive] = useState(false);
  const [canNavigate, setCanNavigate] = useState(true);
  const [blockedReason, setBlockedReason] = useState<string | null>(null);
  
  const pathname = usePathname();
  const navigationService = useNavigationService();

  /**
   * Track screen changes via Expo Router
   * Requirements: 5.10
   */
  useEffect(() => {
    // Construct screen name from pathname
    const screen = pathname || null;
    
    if (screen !== currentScreen) {
      setCurrentScreenState(screen);
      
      // Update navigation service
      if (navigationService) {
        navigationService.setCurrentScreen(screen);
      }
    }
  }, [pathname, currentScreen, navigationService]);

  useEffect(() => {
    if (!pathname) return;
    trackScreenView(pathname);
    void saveLastRoute(pathname);
  }, [pathname]);

  /**
   * Set user activity state
   * Requirements: 5.5
   */
  const setUserActive = useCallback((active: boolean) => {
    setIsUserActive(active);
    
    // Update navigation service with new context
    if (navigationService) {
      navigationService.setScreenContext({
        currentScreen,
        isUserActive: active,
        canNavigate,
        blockedReason,
      });
    }
  }, [navigationService, currentScreen, canNavigate, blockedReason]);

  /**
   * Block navigation with a reason
   * Requirements: 5.6
   */
  const blockNavigation = useCallback((reason: string) => {
    setCanNavigate(false);
    setBlockedReason(reason);
    
    // Update navigation service with new context
    if (navigationService) {
      navigationService.setScreenContext({
        currentScreen,
        isUserActive,
        canNavigate: false,
        blockedReason: reason,
      });
    }
  }, [navigationService, currentScreen, isUserActive]);

  /**
   * Allow navigation (remove block)
   * Requirements: 5.7
   */
  const allowNavigation = useCallback(() => {
    setCanNavigate(true);
    setBlockedReason(null);
    
    // Update navigation service with new context
    if (navigationService) {
      navigationService.setScreenContext({
        currentScreen,
        isUserActive,
        canNavigate: true,
        blockedReason: null,
      });
    }
  }, [navigationService, currentScreen, isUserActive]);

  /**
   * Manually set current screen
   * Usually handled automatically via pathname tracking
   */
  const setCurrentScreen = useCallback((screen: string | null) => {
    setCurrentScreenState(screen);
    
    // Update navigation service
    if (navigationService) {
      navigationService.setCurrentScreen(screen);
    }
  }, [navigationService]);

  /**
   * Update navigation service whenever context changes
   * Requirements: 5.8, 5.9
   */
  useEffect(() => {
    if (navigationService) {
      navigationService.setScreenContext({
        currentScreen,
        isUserActive,
        canNavigate,
        blockedReason,
      });
    }
  }, [navigationService, currentScreen, isUserActive, canNavigate, blockedReason]);

  const value: ScreenContextValue = {
    currentScreen,
    isUserActive,
    canNavigate,
    blockedReason,
    setUserActive,
    blockNavigation,
    allowNavigation,
    setCurrentScreen,
  };

  return (
    <ScreenContext.Provider value={value}>
      {children}
    </ScreenContext.Provider>
  );
}

/**
 * Hook to access Screen Context
 *
 * Requirements: 5.1
 *
 * @throws Error if used outside ScreenProvider
 */
export function useScreenContext(): ScreenContextValue {
  const context = useContext(ScreenContext);

  if (!context) {
    throw new Error('useScreenContext must be used within ScreenProvider');
  }

  return context;
}

/**
 * Hook to check if Screen Context is available
 * Useful for conditional rendering
 */
export function useScreenContextOptional(): ScreenContextValue | null {
  return useContext(ScreenContext);
}

export default ScreenProvider;
