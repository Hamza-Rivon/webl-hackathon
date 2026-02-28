/**
 * Unified realtime updates hook.
 * Handles polling + status-driven navigation + notification emission.
 */

import { useCallback, useRef } from 'react';
import { useNavigationService } from '@/lib/navigation/NavigationServiceProvider';
import { useScreenContext } from '@/contexts/ScreenContext';
import { useEpisode } from './useEpisodes';
import { useRealtimeUpdates, type RealtimeUpdatesResult } from './useRealtimeUpdates';
import { showNotification } from '@/lib/notifications';
import { STATUS_LABELS } from '@/lib/pipeline';

export interface UseUnifiedRealtimeUpdatesOptions {
  episodeId: string;
  enabled?: boolean;
}

export interface UnifiedRealtimeUpdatesResult extends RealtimeUpdatesResult {
  episodeStatus: string | undefined;
}

const globalStatusEvents = new Map<string, { status: string; at: number }>();

export function useUnifiedRealtimeUpdates(
  options: UseUnifiedRealtimeUpdatesOptions
): UnifiedRealtimeUpdatesResult {
  const { episodeId, enabled = true } = options;

  const navigationService = useNavigationService();
  const screenContext = useScreenContext();
  const { data: episode } = useEpisode(episodeId);

  const lastHandledStatusRef = useRef<string | null>(null);
  const lastHandledAtRef = useRef<number>(0);

  const handleStatusUpdate = useCallback((oldStatus: string, newStatus: string) => {
    const now = Date.now();
    const globalKey = episodeId;
    const globalEvent = globalStatusEvents.get(globalKey);

    // Ignore duplicates and rapid repeats from polling bursts.
    if (lastHandledStatusRef.current === newStatus && now - lastHandledAtRef.current < 1200) {
      return;
    }
    if (globalEvent && globalEvent.status === newStatus && now - globalEvent.at < 1500) {
      return;
    }

    lastHandledStatusRef.current = newStatus;
    lastHandledAtRef.current = now;
    globalStatusEvents.set(globalKey, { status: newStatus, at: now });

    if (newStatus !== oldStatus) {
      void showNotification({
        title: 'Pipeline updated',
        body: `${STATUS_LABELS[oldStatus as keyof typeof STATUS_LABELS] || oldStatus} → ${STATUS_LABELS[newStatus as keyof typeof STATUS_LABELS] || newStatus}`,
        type: newStatus === 'failed' ? 'error' : 'info',
        route: `/(main)/episode/${episodeId}`,
        category: 'pipeline',
        immediate: false,
        metadata: { episodeId, oldStatus, newStatus },
      });
    }

    if (screenContext.isUserActive || !screenContext.canNavigate) {
      return;
    }

    void navigationService.handleStatusChange(episodeId, oldStatus, newStatus);
  }, [navigationService, screenContext, episodeId]);

  const realtime = useRealtimeUpdates({
    episodeId,
    enabled,
    hasActiveJobs: episode?.jobs?.some((job) => job.status === 'pending' || job.status === 'processing') || false,
    episodeStatus: episode?.status,
    onStatusUpdate: handleStatusUpdate,
  });

  return {
    ...realtime,
    episodeStatus: episode?.status,
  };
}

export default useUnifiedRealtimeUpdates;
