/**
 * Navigation guards aligned with pipeline action matrix.
 */

import { getEpisodeActionState } from '@/lib/pipeline';

export interface GuardResult {
  canAccess: boolean;
  redirectTarget?: string;
  explanation?: string;
}

export interface GuardRule {
  screen: string;
  action: 'slot_collection' | 'processing_timeline' | 'preview';
}

const GUARD_RULES: GuardRule[] = [
  { screen: 'episode/[id]/slots', action: 'slot_collection' },
  { screen: 'episode/[id]/slots/[slotId]/record', action: 'slot_collection' },
  { screen: 'episode/[id]/slots/[slotId]/upload', action: 'slot_collection' },
  { screen: 'episode/[id]/processing', action: 'processing_timeline' },
  { screen: 'episode/[id]/preview', action: 'preview' },
];

function normalizeScreenForGuard(screen: string): string {
  return screen
    .replace(/^\//, '')
    .replace(/^\(main\)\//, '')
    .replace(/episode\/[^/]+\//, 'episode/[id]/')
    .replace(/slots\/[^/]+\//, 'slots/[slotId]/');
}

function getFallbackRoute(normalizedScreen: string, episodeId: string, canUseSlots: boolean, canUseProcessing: boolean): string {
  if (normalizedScreen.startsWith('episode/[id]/preview')) {
    if (canUseProcessing) return `episode/${episodeId}/processing`;
    if (canUseSlots) return `episode/${episodeId}/slots`;
    return `episode/${episodeId}/index`;
  }

  if (normalizedScreen.startsWith('episode/[id]/slots')) {
    if (canUseProcessing) return `episode/${episodeId}/processing`;
    return `episode/${episodeId}/index`;
  }

  if (normalizedScreen.startsWith('episode/[id]/processing')) {
    if (canUseSlots) return `episode/${episodeId}/slots`;
    return `episode/${episodeId}/index`;
  }

  return `episode/${episodeId}/index`;
}

export function checkNavigationGuard(
  screen: string,
  episodeId: string,
  status: string,
  options?: { hasPlayback?: boolean; hasActiveJobs?: boolean }
): GuardResult {
  const normalizedScreen = normalizeScreenForGuard(screen);
  const rule = GUARD_RULES.find((candidate) =>
    normalizedScreen === candidate.screen || normalizedScreen.startsWith(`${candidate.screen}/`)
  );

  if (!rule) {
    return { canAccess: true };
  }

  const slotGuard = getEpisodeActionState('slot_collection', {
    status,
    hasActiveJobs: options?.hasActiveJobs,
  });
  const processingGuard = getEpisodeActionState('processing_timeline', {
    status,
    hasActiveJobs: options?.hasActiveJobs,
  });

  const actionGuard = getEpisodeActionState(rule.action, {
    status,
    hasPlayback: options?.hasPlayback,
    hasActiveJobs: options?.hasActiveJobs,
  });

  if (actionGuard.allowed) {
    return { canAccess: true };
  }

  return {
    canAccess: false,
    redirectTarget: getFallbackRoute(
      normalizedScreen,
      episodeId,
      slotGuard.allowed,
      processingGuard.allowed
    ),
    explanation: actionGuard.disabledReason || 'This screen is not available for the current episode state.',
  };
}

export function getGuardRules(): GuardRule[] {
  return [...GUARD_RULES];
}

export function canAccessScreenType(
  screenType: string,
  status: string,
  options?: { hasPlayback?: boolean; hasActiveJobs?: boolean }
): boolean {
  if (screenType === 'slots') {
    return getEpisodeActionState('slot_collection', {
      status,
      hasActiveJobs: options?.hasActiveJobs,
    }).allowed;
  }
  if (screenType === 'processing') {
    return getEpisodeActionState('processing_timeline', {
      status,
      hasActiveJobs: options?.hasActiveJobs,
    }).allowed;
  }
  if (screenType === 'preview') {
    return getEpisodeActionState('preview', {
      status,
      hasPlayback: options?.hasPlayback,
      hasActiveJobs: options?.hasActiveJobs,
    }).allowed;
  }
  return true;
}

export function getRedirectInfo(
  screenType: string,
  episodeId: string,
  status: string,
  options?: { hasPlayback?: boolean; hasActiveJobs?: boolean }
): { redirectTarget: string; explanation: string } | null {
  const path = `episode/[id]/${screenType}`;
  const guard = checkNavigationGuard(path, episodeId, status, options);

  if (guard.canAccess || !guard.redirectTarget) {
    return null;
  }

  return {
    redirectTarget: guard.redirectTarget,
    explanation: guard.explanation || 'This screen is currently unavailable.',
  };
}

export default checkNavigationGuard;
