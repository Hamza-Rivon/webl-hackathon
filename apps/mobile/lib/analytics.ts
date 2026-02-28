/**
 * Lightweight analytics helper for funnel instrumentation.
 */

import { EpisodeStatus } from '@/lib/pipeline';

type AnalyticsPayload = Record<string, unknown>;

interface BaseEvent {
  name: string;
  timestamp: string;
  payload?: AnalyticsPayload;
}

function emitEvent(event: BaseEvent) {
  // Replace with vendor SDK when available.
  if (__DEV__) {
    // eslint-disable-next-line no-console
    console.log('[analytics]', event.name, event.payload || {});
  }
}

export function trackEvent(name: string, payload?: AnalyticsPayload) {
  emitEvent({
    name,
    timestamp: new Date().toISOString(),
    payload,
  });
}

export function trackScreenView(screen: string, payload?: AnalyticsPayload) {
  trackEvent('screen_view', {
    screen,
    ...payload,
  });
}

export function trackPrimaryAction(action: string, payload?: AnalyticsPayload) {
  trackEvent('primary_action', {
    action,
    ...payload,
  });
}

export function trackFailure(
  context: string,
  payload: {
    episodeId?: string;
    jobId?: string;
    jobType?: string;
    status?: EpisodeStatus | string;
    reason?: string;
    [key: string]: unknown;
  }
) {
  trackEvent('failure', {
    context,
    ...payload,
  });
}
