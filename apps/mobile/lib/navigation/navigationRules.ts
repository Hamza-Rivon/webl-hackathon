/**
 * Canonical status-driven navigation rules.
 */

import { normalizeScreenName } from './navigationFlows';

export interface NavigationRules {
  canNavigateFrom(from: string, to: string): boolean;
  shouldAutoNavigate(fromStatus: string, toStatus: string): boolean;
  getNextScreen(currentScreen: string, status: string): string | null;
  getScreenForStatus(status: string): string | null;
}

const VALID_NAVIGATION_PATHS: Record<string, string[]> = {
  'episode/[id]/index': [
    'episode/[id]/record',
    'episode/[id]/slots',
    'episode/[id]/upload',
    'episode/[id]/processing',
    'episode/[id]/preview',
  ],
  'episode/[id]/record': ['episode/[id]/index', 'episode/[id]/slots'],
  'episode/[id]/upload': ['episode/[id]/index', 'episode/[id]/slots'],
  'episode/[id]/slots': [
    'episode/[id]/index',
    'episode/[id]/slots/[slotId]/record',
    'episode/[id]/slots/[slotId]/upload',
    'episode/[id]/processing',
  ],
  'episode/[id]/slots/[slotId]/record': ['episode/[id]/slots'],
  'episode/[id]/slots/[slotId]/upload': ['episode/[id]/slots'],
  'episode/[id]/processing': ['episode/[id]/index', 'episode/[id]/preview'],
  'episode/[id]/preview': ['episode/[id]/index', 'episode/[id]/processing'],
};

const AUTO_NAVIGATE_TRANSITIONS: Record<string, string[]> = {
  cut_plan_ready: ['rendering'],
  rendering: ['ready'],
};

const STATUS_TO_SCREEN: Record<string, string> = {
  draft: 'episode/[id]/index',
  voiceover_uploaded: 'episode/[id]/index',
  voiceover_cleaning: 'episode/[id]/index',
  voiceover_cleaned: 'episode/[id]/index',
  collecting_clips: 'episode/[id]/index',
  needs_more_clips: 'episode/[id]/index',
  chunking_clips: 'episode/[id]/processing',
  enriching_chunks: 'episode/[id]/processing',
  matching: 'episode/[id]/processing',
  cut_plan_ready: 'episode/[id]/processing',
  rendering: 'episode/[id]/processing',
  ready: 'episode/[id]/preview',
  published: 'episode/[id]/preview',
  failed: 'episode/[id]/processing',
};

const STATUS_TRANSITION_TARGET: Record<string, string> = {
  rendering: 'episode/[id]/processing',
  ready: 'episode/[id]/preview',
};

export const navigationRules: NavigationRules = {
  canNavigateFrom(from: string, to: string): boolean {
    const normalizedFrom = normalizeScreenName(from);
    const normalizedTo = normalizeScreenName(to);
    const validPaths = VALID_NAVIGATION_PATHS[normalizedFrom];
    if (!validPaths) return true;
    return validPaths.includes(normalizedTo);
  },

  shouldAutoNavigate(fromStatus: string, toStatus: string): boolean {
    const transitions = AUTO_NAVIGATE_TRANSITIONS[fromStatus];
    if (!transitions) return false;
    return transitions.includes(toStatus);
  },

  getNextScreen(_currentScreen: string, status: string): string | null {
    const transitionTarget = STATUS_TRANSITION_TARGET[status];
    if (transitionTarget) return transitionTarget;
    return STATUS_TO_SCREEN[status] || null;
  },

  getScreenForStatus(status: string): string | null {
    return STATUS_TO_SCREEN[status] || null;
  },
};

export function getValidNavigationPaths(screen: string): string[] {
  const normalizedScreen = normalizeScreenName(screen);
  return VALID_NAVIGATION_PATHS[normalizedScreen] || [];
}

export function getAutoNavigateTransitions(): Record<string, string[]> {
  return { ...AUTO_NAVIGATE_TRANSITIONS };
}

export function getStatusToScreenMap(): Record<string, string> {
  return { ...STATUS_TO_SCREEN };
}

export function getNavigationTargetForTransition(fromStatus: string, toStatus: string): string | null {
  if (!navigationRules.shouldAutoNavigate(fromStatus, toStatus)) {
    return null;
  }
  return STATUS_TRANSITION_TARGET[toStatus] || null;
}

export default navigationRules;
