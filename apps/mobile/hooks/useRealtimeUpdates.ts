/**
 * Real-time update hooks (polling).
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, type AppStateStatus } from 'react-native';
import { useQueryClient } from '@tanstack/react-query';
import { episodeKeys } from './useEpisodes';
import { jobKeys } from './useJobProgress';
import { slotClipKeys } from './useSlotClips';
import { seriesKeys } from './useSeries';
import { rateLimitManager } from '@/lib/rateLimitManager';

const POLLING_INTERVALS = {
  ACTIVE_JOB: 6000,
  NO_ACTIVE_JOB: 15000,
  BACKGROUND: 60000,
} as const;

export type ConnectionType = 'polling' | 'none';

export interface RealtimeUpdatesResult {
  isConnected: boolean;
  connectionType: ConnectionType;
  lastUpdate: Date | null;
  forceRefresh: () => Promise<void>;
  pollingInterval: number;
}

interface UseRealtimeUpdatesOptions {
  episodeId?: string;
  enabled?: boolean;
  hasActiveJobs?: boolean;
  episodeStatus?: string;
  onStatusUpdate?: (oldStatus: string, newStatus: string) => void;
  onJobUpdate?: (jobData: {
    jobId: string;
    status: string;
    progress?: number;
    stage?: string;
    errorMessage?: string;
  }) => void;
}

export function useRealtimeUpdates({
  episodeId,
  enabled = true,
  hasActiveJobs = false,
  episodeStatus,
  onStatusUpdate,
  onJobUpdate: _onJobUpdate,
}: UseRealtimeUpdatesOptions = {}): RealtimeUpdatesResult {
  const queryClient = useQueryClient();
  const [connectionType, setConnectionType] = useState<ConnectionType>('none');
  const [lastUpdate, setLastUpdate] = useState<Date | null>(null);
  const [isConnected, setIsConnected] = useState(false);

  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const appStateRef = useRef<AppStateStatus>('active');
  const lastFetchRef = useRef<number>(0);
  const previousStatusRef = useRef<string | undefined>(episodeStatus);

  useEffect(() => {
    const previous = previousStatusRef.current;
    if (previous && episodeStatus && previous !== episodeStatus) {
      onStatusUpdate?.(previous, episodeStatus);
    }
    previousStatusRef.current = episodeStatus;
  }, [episodeStatus, onStatusUpdate]);

  const getPollingInterval = useCallback(() => {
    if (appStateRef.current !== 'active') {
      return POLLING_INTERVALS.BACKGROUND;
    }
    return hasActiveJobs ? POLLING_INTERVALS.ACTIVE_JOB : POLLING_INTERVALS.NO_ACTIVE_JOB;
  }, [hasActiveJobs]);

  const refreshData = useCallback(async () => {
    if (rateLimitManager.isRateLimited()) {
      setConnectionType('none');
      setIsConnected(false);
      return;
    }

    const now = Date.now();
    if (now - lastFetchRef.current < 1000) {
      return;
    }
    lastFetchRef.current = now;

    const invalidations: Promise<void>[] = [];

    if (episodeId) {
      invalidations.push(
        queryClient.invalidateQueries({ queryKey: episodeKeys.detail(episodeId) }),
        queryClient.invalidateQueries({ queryKey: slotClipKeys.list(episodeId) }),
        queryClient.invalidateQueries({ queryKey: jobKeys.list({ episodeId }) })
      );
    }

    await Promise.all(invalidations);
    setLastUpdate(new Date());
  }, [queryClient, episodeId]);

  const clearPolling = useCallback(() => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
  }, []);

  const startPolling = useCallback(() => {
    clearPolling();

    if (!enabled || rateLimitManager.isRateLimited()) {
      setConnectionType('none');
      setIsConnected(false);
      return;
    }

    const interval = getPollingInterval();
    intervalRef.current = setInterval(() => {
      void refreshData();
    }, interval);

    setConnectionType('polling');
    setIsConnected(true);
  }, [clearPolling, enabled, getPollingInterval, refreshData]);

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (nextAppState) => {
      const previousState = appStateRef.current;
      appStateRef.current = nextAppState;

      if (nextAppState === 'active' && previousState !== 'active') {
        void refreshData();
        startPolling();
      }
    });

    return () => subscription.remove();
  }, [refreshData, startPolling]);

  useEffect(() => {
    const unsubscribe = rateLimitManager.subscribe(() => {
      if (rateLimitManager.isRateLimited()) {
        clearPolling();
        setConnectionType('none');
        setIsConnected(false);
        return;
      }
      if (enabled) {
        startPolling();
      }
    });

    return unsubscribe;
  }, [clearPolling, enabled, startPolling]);

  useEffect(() => {
    if (!enabled) {
      clearPolling();
      setConnectionType('none');
      setIsConnected(false);
      return;
    }

    void refreshData();
    startPolling();

    return () => {
      clearPolling();
    };
  }, [enabled, startPolling, clearPolling, refreshData]);

  useEffect(() => {
    if (!enabled || connectionType !== 'polling') return;
    startPolling();
  }, [hasActiveJobs, enabled, connectionType, startPolling]);

  return {
    isConnected,
    connectionType,
    lastUpdate,
    forceRefresh: refreshData,
    pollingInterval: getPollingInterval(),
  };
}

export function useHomeRealtimeUpdates(enabled = true) {
  const queryClient = useQueryClient();
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const appStateRef = useRef<AppStateStatus>('active');
  const [lastUpdate, setLastUpdate] = useState<Date | null>(null);

  const refreshHomeData = useCallback(async () => {
    if (rateLimitManager.isRateLimited()) {
      return;
    }

    await Promise.all([
      // Keep home refresh scoped to list-level queries to avoid refetching hidden detail screens.
      queryClient.invalidateQueries({ queryKey: seriesKeys.lists() }),
      queryClient.invalidateQueries({ queryKey: episodeKeys.lists() }),
      queryClient.invalidateQueries({ queryKey: jobKeys.list({ status: 'processing' }) }),
      queryClient.invalidateQueries({ queryKey: ['notifications'] }),
    ]);

    setLastUpdate(new Date());
  }, [queryClient]);

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (nextAppState) => {
      const previous = appStateRef.current;
      appStateRef.current = nextAppState;

      if (nextAppState === 'active' && previous !== 'active') {
        void refreshHomeData();
      }
    });

    return () => subscription.remove();
  }, [refreshHomeData]);

  useEffect(() => {
    if (!enabled || rateLimitManager.isRateLimited()) {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
      return;
    }

    void refreshHomeData();

    const interval = appStateRef.current === 'active'
      ? POLLING_INTERVALS.NO_ACTIVE_JOB
      : POLLING_INTERVALS.BACKGROUND;

    intervalRef.current = setInterval(() => {
      void refreshHomeData();
    }, interval);

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
  }, [enabled, refreshHomeData]);

  return {
    forceRefresh: refreshHomeData,
    lastUpdate,
    connectionType: (enabled ? 'polling' : 'none') as ConnectionType,
    isConnected: enabled && !rateLimitManager.isRateLimited(),
  };
}

export function useActiveJobsPolling(episodeId?: string, hasActiveJobs = false) {
  const queryClient = useQueryClient();
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [lastUpdate, setLastUpdate] = useState<Date | null>(null);

  const refreshJobs = useCallback(async () => {
    if (rateLimitManager.isRateLimited()) {
      return;
    }

    const invalidations: Promise<void>[] = [
      queryClient.invalidateQueries({ queryKey: jobKeys.list({ status: 'processing' }) }),
    ];

    if (episodeId) {
      invalidations.push(
        queryClient.invalidateQueries({ queryKey: jobKeys.list({ episodeId }) }),
        queryClient.invalidateQueries({ queryKey: episodeKeys.detail(episodeId) })
      );
    }

    await Promise.all(invalidations);
    setLastUpdate(new Date());
  }, [queryClient, episodeId]);

  useEffect(() => {
    if (rateLimitManager.isRateLimited()) {
      return;
    }

    void refreshJobs();

    const interval = hasActiveJobs
      ? POLLING_INTERVALS.ACTIVE_JOB
      : POLLING_INTERVALS.NO_ACTIVE_JOB;

    intervalRef.current = setInterval(() => {
      void refreshJobs();
    }, interval);

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
  }, [refreshJobs, hasActiveJobs]);

  return {
    forceRefresh: refreshJobs,
    lastUpdate,
  };
}

export default useRealtimeUpdates;
