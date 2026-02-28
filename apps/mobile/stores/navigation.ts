/**
 * Navigation Store
 *
 * Zustand store for managing navigation state.
 * Tracks current screen, navigation stack, and history.
 *
 * Requirements: 10.1-10.8
 */

import { create } from 'zustand';
import type { NavigationAction, NavigationEvent } from '../lib/navigation/navigationService';

/**
 * Navigation store state interface
 * Requirements: 10.1
 */
interface NavigationState {
  /** Current screen name */
  currentScreen: string | null;
  /** Navigation stack for back navigation */
  navigationStack: string[];
  /** Whether navigation is in progress */
  isNavigating: boolean;
  /** Pending navigation action */
  pendingNavigation: NavigationAction | null;
  /** Navigation history for debugging */
  navigationHistory: NavigationEvent[];
}

/**
 * Navigation store actions interface
 * Requirements: 10.2
 */
interface NavigationActions {
  /** Set current screen */
  setCurrentScreen: (screen: string | null) => void;
  /** Push screen to navigation stack */
  pushToStack: (screen: string) => void;
  /** Pop screen from navigation stack */
  popFromStack: () => string | null;
  /** Set navigation in progress flag */
  setIsNavigating: (isNavigating: boolean) => void;
  /** Set pending navigation action */
  setPendingNavigation: (action: NavigationAction | null) => void;
  /** Add event to navigation history */
  addToHistory: (event: NavigationEvent) => void;
  /** Clear navigation stack */
  clearStack: () => void;
  /** Get navigation history */
  getNavigationHistory: () => NavigationEvent[];
  /** Reset store to initial state */
  reset: () => void;
}

type NavigationStore = NavigationState & NavigationActions;

// Stack and history limits
const MAX_STACK_SIZE = 20;
const MAX_HISTORY_SIZE = 50;

/**
 * Initial state
 */
const initialState: NavigationState = {
  currentScreen: null,
  navigationStack: [],
  isNavigating: false,
  pendingNavigation: null,
  navigationHistory: [],
};

/**
 * Navigation store
 * Requirements: 10.1-10.8
 */
export const useNavigationStore = create<NavigationStore>((set, get) => ({
  ...initialState,

  /**
   * Set current screen
   * Requirements: 10.4
   */
  setCurrentScreen: (screen) => {
    set({ currentScreen: screen });
  },

  /**
   * Push screen to navigation stack
   * Requirements: 10.4, 10.7
   */
  pushToStack: (screen) => {
    const { navigationStack } = get();
    // Limit stack size to prevent memory issues
    const newStack = [...navigationStack, screen].slice(-MAX_STACK_SIZE);
    set({ navigationStack: newStack });
  },

  /**
   * Pop screen from navigation stack
   * Requirements: 10.5
   */
  popFromStack: () => {
    const { navigationStack } = get();
    if (navigationStack.length === 0) {
      return null;
    }
    const poppedScreen = navigationStack[navigationStack.length - 1];
    const newStack = navigationStack.slice(0, -1);
    set({ navigationStack: newStack });
    return poppedScreen ?? null;
  },

  /**
   * Set navigation in progress flag
   * Requirements: 10.2
   */
  setIsNavigating: (isNavigating) => {
    set({ isNavigating });
  },

  /**
   * Set pending navigation action
   * Requirements: 10.2
   */
  setPendingNavigation: (action) => {
    set({ pendingNavigation: action });
  },

  /**
   * Add event to navigation history
   * Requirements: 10.2
   */
  addToHistory: (event) => {
    const { navigationHistory } = get();
    // Limit history size to prevent memory issues
    const newHistory = [...navigationHistory, event].slice(-MAX_HISTORY_SIZE);
    set({ navigationHistory: newHistory });
  },

  /**
   * Clear navigation stack
   * Requirements: 10.6
   */
  clearStack: () => {
    set({ navigationStack: [] });
  },

  /**
   * Get navigation history
   */
  getNavigationHistory: () => {
    return get().navigationHistory;
  },

  /**
   * Reset store to initial state
   * Requirements: 10.8
   */
  reset: () => {
    set(initialState);
  },
}));

/**
 * Selector hooks for specific state slices
 */
export const useCurrentScreen = () => useNavigationStore((state) => state.currentScreen);
export const useNavigationStack = () => useNavigationStore((state) => state.navigationStack);
export const useIsNavigating = () => useNavigationStore((state) => state.isNavigating);
export const usePendingNavigation = () => useNavigationStore((state) => state.pendingNavigation);
export const useNavigationHistory = () => useNavigationStore((state) => state.navigationHistory);

export default useNavigationStore;
