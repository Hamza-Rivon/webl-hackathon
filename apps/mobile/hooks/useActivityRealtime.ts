import { useEffect, useMemo, useRef, useState } from 'react';
import { io, type Socket } from 'socket.io-client';
import { useAuth } from '@clerk/clerk-expo';
import { useQueryClient, type InfiniteData } from '@tanstack/react-query';
import { useApiUrl } from '@/lib/api';
import {
  activityKeys,
  type ActivityEpisodePage,
  type ActivityJobItem,
  type ActivityJobsPage,
  upsertActivityJobPages,
} from './useActivity';

type RealtimeConnectionState = 'connecting' | 'connected' | 'reconnecting' | 'degraded' | 'offline';

type ActivityRealtimeEvent = {
  id: string;
  userId: string;
  episodeId: string | null;
  jobId: string;
  entityType: 'job' | 'episode';
  eventType:
    | 'episode_status_changed'
    | 'job_created'
    | 'job_updated'
    | 'job_completed'
    | 'job_failed'
    | 'job_cancelled';
  occurredAt: string;
  payload: {
    message?: string | null;
    job?: ActivityJobItem;
    episode?: {
      id: string;
      title: string;
      status: string;
      updatedAt: string;
    } | null;
  };
};

function updateEpisodePagesForRealtimeEvent(
  existing: InfiniteData<ActivityEpisodePage> | undefined,
  event: ActivityRealtimeEvent
): InfiniteData<ActivityEpisodePage> | undefined {
  if (!existing || !event.episodeId) return existing;

  const pages = existing.pages.map((page) => {
    const items = page.items.map((item) => {
      if (item.episodeId !== event.episodeId) return item;

      return {
        ...item,
        status: event.payload.episode?.status || item.status,
        updatedAt: event.payload.episode?.updatedAt || event.occurredAt,
        latestJob: event.payload.job
          ? {
              id: event.payload.job.id,
              type: event.payload.job.type,
              status: event.payload.job.status,
              stage: event.payload.job.stage,
              progress: event.payload.job.progress,
              updatedAt: event.payload.job.updatedAt,
              errorMessage: event.payload.job.errorMessage,
            }
          : item.latestJob,
      };
    });

    return {
      ...page,
      items,
      sections: {
        needsAttention: items.filter((episode) => episode.priority === 'needs_attention'),
        inProgress: items.filter((episode) => episode.priority === 'in_progress'),
        needsInput: items.filter((episode) => episode.priority === 'needs_input'),
        recentlyCompleted: items.filter((episode) => episode.priority === 'recently_completed'),
        history: items.filter((episode) => episode.priority === 'history'),
      },
    };
  });

  return {
    ...existing,
    pages,
  };
}

export function useActivityRealtime(options: {
  enabled?: boolean;
  episodeIds?: string[];
}) {
  const { enabled = true, episodeIds = [] } = options;

  const apiUrl = useApiUrl();
  const { getToken, isLoaded, isSignedIn } = useAuth();
  const queryClient = useQueryClient();

  const socketRef = useRef<Socket | null>(null);
  const subscribedEpisodesRef = useRef<Set<string>>(new Set());
  const summaryRefreshTimeouts = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
  const lastEventIdRef = useRef<string | null>(null);

  const [connectionState, setConnectionState] = useState<RealtimeConnectionState>('offline');

  const sortedEpisodeIds = useMemo(() => [...episodeIds].sort(), [episodeIds]);

  useEffect(() => {
    if (!enabled || !isLoaded || !isSignedIn) {
      socketRef.current?.disconnect();
      socketRef.current = null;
      setConnectionState('offline');
      return;
    }

    let mounted = true;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

    const scheduleReconnect = () => {
      if (!mounted) return;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      reconnectTimer = setTimeout(() => {
        if (!mounted) return;
        void connect();
      }, 2500);
    };

    const connect = async () => {
      setConnectionState((current) => (current === 'offline' ? 'connecting' : 'reconnecting'));

      let token: string | null = null;
      try {
        token = await getToken();
      } catch {
        token = null;
      }

      if (!mounted) {
        return;
      }

      if (!token) {
        setConnectionState('offline');
        scheduleReconnect();
        return;
      }

      if (socketRef.current) {
        socketRef.current.disconnect();
        socketRef.current = null;
      }

      const socket = io(apiUrl, {
        path: '/realtime',
        transports: ['websocket', 'polling'],
        auth: { token },
        autoConnect: true,
        reconnection: true,
        reconnectionAttempts: Infinity,
        reconnectionDelay: 1000,
        reconnectionDelayMax: 10_000,
      });

      const processEvent = (event: ActivityRealtimeEvent) => {
        lastEventIdRef.current = event.id;

        for (const mode of ['active', 'recent', 'all'] as const) {
          queryClient.setQueryData(
            activityKeys.episodes(mode),
            (existing: InfiniteData<ActivityEpisodePage> | undefined) =>
              updateEpisodePagesForRealtimeEvent(existing, event)
          );
        }

        const job = event.payload.job;
        if (job && job.episodeId) {
          for (const bucket of ['attention', 'active', 'recent', 'history'] as const) {
            queryClient.setQueryData(
              activityKeys.episodeJobs(job.episodeId, bucket),
              (existing: InfiniteData<ActivityJobsPage> | undefined) => upsertActivityJobPages(existing, job)
            );
          }
        }

        if (event.episodeId) {
          const existingTimeout = summaryRefreshTimeouts.current.get(event.episodeId);
          if (existingTimeout) {
            clearTimeout(existingTimeout);
          }

          const timeout = setTimeout(() => {
            queryClient.invalidateQueries({ queryKey: activityKeys.episodeSummary(event.episodeId!) });
            summaryRefreshTimeouts.current.delete(event.episodeId!);
          }, 1500);

          summaryRefreshTimeouts.current.set(event.episodeId, timeout);
        }
      };

      socket.on('connect', () => {
        if (!mounted) return;
        setConnectionState('connected');
        subscribedEpisodesRef.current = new Set();

        if (lastEventIdRef.current) {
          socket.emit(
            'activity:resume',
            { cursor: lastEventIdRef.current, limit: 120 },
            (response: { ok: boolean; items?: ActivityRealtimeEvent[] }) => {
              if (!response?.ok || !response.items) return;
              response.items.forEach((event) => processEvent(event));
            }
          );
        }
      });

      socket.on('reconnect_attempt', () => {
        if (!mounted) return;
        setConnectionState('reconnecting');
      });

      socket.on('reconnect', () => {
        if (!mounted) return;
        setConnectionState('connected');
      });

      socket.on('disconnect', () => {
        if (!mounted) return;
        setConnectionState('reconnecting');
      });

      socket.on('connect_error', () => {
        if (!mounted) return;
        setConnectionState('reconnecting');
      });

      socket.on('activity:event', processEvent);

      socketRef.current = socket;
    };

    void connect();

    return () => {
      mounted = false;
      if (reconnectTimer) {
        clearTimeout(reconnectTimer);
      }
      socketRef.current?.disconnect();
      socketRef.current = null;

      summaryRefreshTimeouts.current.forEach((timeout) => clearTimeout(timeout));
      summaryRefreshTimeouts.current.clear();
    };
  }, [apiUrl, enabled, getToken, isLoaded, isSignedIn, queryClient]);

  useEffect(() => {
    const socket = socketRef.current;
    if (!socket || connectionState !== 'connected') {
      return;
    }

    const currentSet = subscribedEpisodesRef.current;
    const targetSet = new Set(sortedEpisodeIds);

    // Subscribe newly expanded episodes.
    targetSet.forEach((episodeId) => {
      if (!currentSet.has(episodeId)) {
        socket.emit('episode:subscribe', episodeId);
      }
    });

    // Unsubscribe closed episodes.
    currentSet.forEach((episodeId) => {
      if (!targetSet.has(episodeId)) {
        socket.emit('episode:unsubscribe', episodeId);
      }
    });

    subscribedEpisodesRef.current = targetSet;
  }, [connectionState, sortedEpisodeIds]);

  return {
    connectionState,
    isConnected: connectionState === 'connected',
  };
}

export default useActivityRealtime;
