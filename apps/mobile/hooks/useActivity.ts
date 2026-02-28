import { useInfiniteQuery, useQuery, type InfiniteData } from '@tanstack/react-query';
import { useApiClient } from '@/lib/api';
import { useAuthReady } from './useAuthReady';

export type ActivityPriority =
  | 'needs_attention'
  | 'in_progress'
  | 'needs_input'
  | 'recently_completed'
  | 'history';

export type ActivityMode = 'active' | 'recent' | 'all';
export type ActivityBucket = 'attention' | 'active' | 'recent' | 'history';

export interface ActivityEpisodeSummary {
  episodeId: string;
  title: string;
  status: string;
  updatedAt: string;
  priority: ActivityPriority;
  hasActionRequired: boolean;
  counts: {
    total: number;
    active: number;
    pending: number;
    failed: number;
    done: number;
    cancelled: number;
  };
  latestJob: {
    id: string;
    type: string;
    status: string;
    stage: string;
    progress: number;
    updatedAt: string;
    errorMessage: string | null;
  } | null;
}

export interface ActivityEpisodePage {
  items: ActivityEpisodeSummary[];
  sections: {
    needsAttention: ActivityEpisodeSummary[];
    inProgress: ActivityEpisodeSummary[];
    needsInput: ActivityEpisodeSummary[];
    recentlyCompleted: ActivityEpisodeSummary[];
    history: ActivityEpisodeSummary[];
  };
  nextCursor: string | null;
}

export interface ActivityJobItem {
  id: string;
  type: string;
  status: string;
  stage: string;
  progress: number;
  errorMessage: string | null;
  createdAt: string;
  updatedAt: string;
  episodeId: string;
  userId: string;
}

export interface ActivityJobsPage {
  bucket: ActivityBucket;
  items: ActivityJobItem[];
  nextCursor: string | null;
}

export const activityKeys = {
  all: ['activity'] as const,
  episodes: (mode: ActivityMode) => [...activityKeys.all, 'episodes', mode] as const,
  episodeSummary: (episodeId: string) => [...activityKeys.all, 'episode-summary', episodeId] as const,
  episodeJobs: (episodeId: string, bucket: ActivityBucket) =>
    [...activityKeys.all, 'episode-jobs', episodeId, bucket] as const,
};

const NEEDS_INPUT_STATUSES = new Set(['voiceover_cleaned', 'collecting_clips', 'needs_more_clips']);

function isNotFoundError(error: unknown): boolean {
  return Boolean(
    typeof error === 'object' &&
      error !== null &&
      'response' in error &&
      (error as { response?: { status?: number } }).response?.status === 404
  );
}

function normalizeJob(job: Partial<ActivityJobItem>): ActivityJobItem {
  return {
    id: String(job.id ?? ''),
    type: String(job.type ?? 'unknown'),
    status: String(job.status ?? 'pending'),
    stage: String(job.stage ?? 'processing'),
    progress: Number(job.progress ?? 0),
    errorMessage: typeof job.errorMessage === 'string' ? job.errorMessage : null,
    createdAt: String(job.createdAt ?? new Date().toISOString()),
    updatedAt: String(job.updatedAt ?? new Date().toISOString()),
    episodeId: String(job.episodeId ?? ''),
    userId: String(job.userId ?? ''),
  };
}

function priorityWeight(priority: ActivityPriority): number {
  if (priority === 'needs_attention') return 0;
  if (priority === 'in_progress') return 1;
  if (priority === 'needs_input') return 2;
  if (priority === 'recently_completed') return 3;
  return 4;
}

function buildActivitySummary(
  episode: { id: string; title: string; status: string; updatedAt: string },
  jobs: ActivityJobItem[]
): ActivityEpisodeSummary {
  const counts = {
    total: jobs.length,
    active: jobs.filter((job) => job.status === 'processing').length,
    pending: jobs.filter((job) => job.status === 'pending').length,
    failed: jobs.filter((job) => job.status === 'error').length,
    done: jobs.filter((job) => job.status === 'done').length,
    cancelled: jobs.filter((job) => job.status === 'cancelled').length,
  };

  let priority: ActivityPriority = 'history';
  if (counts.failed > 0 || episode.status === 'failed') {
    priority = 'needs_attention';
  } else if (counts.active > 0 || counts.pending > 0) {
    priority = 'in_progress';
  } else if (NEEDS_INPUT_STATUSES.has(episode.status)) {
    priority = 'needs_input';
  } else if (counts.done > 0) {
    const ageMs = Date.now() - new Date(episode.updatedAt).getTime();
    if (ageMs <= 24 * 60 * 60 * 1000) {
      priority = 'recently_completed';
    }
  }

  const sortedJobs = [...jobs].sort(
    (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
  );
  const latest = sortedJobs[0];

  return {
    episodeId: episode.id,
    title: episode.title,
    status: episode.status,
    updatedAt: episode.updatedAt,
    priority,
    hasActionRequired: priority === 'needs_attention' || priority === 'needs_input',
    counts,
    latestJob: latest
      ? {
          id: latest.id,
          type: latest.type,
          status: latest.status,
          stage: latest.stage,
          progress: latest.progress,
          updatedAt: latest.updatedAt,
          errorMessage: latest.errorMessage,
        }
      : null,
  };
}

function shouldIncludeByMode(summary: ActivityEpisodeSummary, mode: ActivityMode): boolean {
  if (mode === 'all') return true;
  if (mode === 'recent') {
    return summary.priority === 'recently_completed' || summary.priority === 'history';
  }
  return summary.priority !== 'history';
}

function buildSections(items: ActivityEpisodeSummary[]): ActivityEpisodePage['sections'] {
  return {
    needsAttention: items.filter((item) => item.priority === 'needs_attention'),
    inProgress: items.filter((item) => item.priority === 'in_progress'),
    needsInput: items.filter((item) => item.priority === 'needs_input'),
    recentlyCompleted: items.filter((item) => item.priority === 'recently_completed'),
    history: items.filter((item) => item.priority === 'history'),
  };
}

function matchesBucket(job: ActivityJobItem, bucket: ActivityBucket): boolean {
  if (bucket === 'attention') return job.status === 'error' || job.status === 'cancelled';
  if (bucket === 'active') return job.status === 'pending' || job.status === 'processing';
  if (bucket === 'recent') return job.status === 'done';
  return ['done', 'cancelled', 'error'].includes(job.status);
}

async function fetchEpisodeJobsWithFallback(
  apiClient: ReturnType<typeof useApiClient>,
  episodeId: string
): Promise<ActivityJobItem[]> {
  try {
    const response = await apiClient.get<ActivityJobItem[]>(`/jobs?episodeId=${episodeId}&limit=120`);
    if (Array.isArray(response.data)) {
      return response.data.map((job) => normalizeJob(job));
    }
  } catch (error) {
    if (!isNotFoundError(error)) {
      throw error;
    }
  }

  const legacyResponse = await apiClient.get<{ jobs: ActivityJobItem[] }>(`/jobs/episode/${episodeId}`);
  if (!Array.isArray(legacyResponse.data?.jobs)) {
    return [];
  }
  return legacyResponse.data.jobs.map((job) => normalizeJob(job));
}

export function useActivityEpisodes(options?: {
  mode?: ActivityMode;
  limit?: number;
  enabled?: boolean;
}) {
  const apiClient = useApiClient();
  const authReady = useAuthReady();
  const mode = options?.mode ?? 'active';
  const limit = options?.limit ?? 12;

  return useInfiniteQuery({
    queryKey: activityKeys.episodes(mode),
    enabled: Boolean(authReady && (options?.enabled ?? true)),
    initialPageParam: null as string | null,
    queryFn: async ({ pageParam }): Promise<ActivityEpisodePage> => {
      const params = new URLSearchParams();
      params.set('mode', mode);
      params.set('limit', String(limit));
      if (pageParam) {
        params.set('cursor', pageParam);
      }

      try {
        const response = await apiClient.get<ActivityEpisodePage>(`/activity/episodes?${params.toString()}`);
        return response.data;
      } catch (error) {
        if (!isNotFoundError(error)) {
          throw error;
        }

        // Legacy API fallback (for servers without /activity routes).
        if (pageParam) {
          return {
            items: [],
            sections: {
              needsAttention: [],
              inProgress: [],
              needsInput: [],
              recentlyCompleted: [],
              history: [],
            },
            nextCursor: null,
          };
        }

        const [episodesResponse, jobsResponse] = await Promise.all([
          apiClient.get<Array<{ id: string; title: string; status: string; updatedAt: string }>>('/episodes'),
          apiClient.get<ActivityJobItem[]>('/jobs?limit=200'),
        ]);

        const episodes = Array.isArray(episodesResponse.data) ? episodesResponse.data : [];
        const jobs = Array.isArray(jobsResponse.data)
          ? jobsResponse.data.map((job) => normalizeJob(job))
          : [];
        const jobsByEpisode = new Map<string, ActivityJobItem[]>();

        jobs.forEach((job) => {
          const key = job.episodeId;
          if (!key) return;
          const existing = jobsByEpisode.get(key) ?? [];
          existing.push(job);
          jobsByEpisode.set(key, existing);
        });

        const items = episodes
          .map((episode) =>
            buildActivitySummary(
              {
                id: episode.id,
                title: episode.title,
                status: episode.status,
                updatedAt: episode.updatedAt,
              },
              jobsByEpisode.get(episode.id) ?? []
            )
          )
          .filter((summary) => shouldIncludeByMode(summary, mode))
          .sort((a, b) => {
            const priorityDelta = priorityWeight(a.priority) - priorityWeight(b.priority);
            if (priorityDelta !== 0) return priorityDelta;
            return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
          })
          .slice(0, limit);

        return {
          items,
          sections: buildSections(items),
          nextCursor: null,
        };
      }
    },
    getNextPageParam: (lastPage) => lastPage.nextCursor,
    staleTime: 30_000,
  });
}

export function useActivityEpisodeSummary(episodeId: string, enabled = true) {
  const apiClient = useApiClient();
  const authReady = useAuthReady();

  return useQuery({
    queryKey: activityKeys.episodeSummary(episodeId),
    enabled: Boolean(authReady && enabled && !!episodeId),
    queryFn: async (): Promise<{ item: ActivityEpisodeSummary }> => {
      try {
        const response = await apiClient.get<{ item: ActivityEpisodeSummary }>(
          `/activity/episodes/${episodeId}/summary`
        );
        return response.data;
      } catch (error) {
        if (!isNotFoundError(error)) {
          throw error;
        }

        const response = await apiClient.get<{
          id: string;
          title: string;
          status: string;
          updatedAt: string;
          jobs?: ActivityJobItem[];
        }>(`/episodes/${episodeId}`);

        const jobs = Array.isArray(response.data.jobs)
          ? response.data.jobs.map((job) => normalizeJob(job))
          : await fetchEpisodeJobsWithFallback(apiClient, episodeId);

        return {
          item: buildActivitySummary(
            {
              id: response.data.id,
              title: response.data.title,
              status: response.data.status,
              updatedAt: response.data.updatedAt,
            },
            jobs
          ),
        };
      }
    },
    staleTime: 20_000,
  });
}

export function useActivityEpisodeJobs(options: {
  episodeId: string;
  bucket: ActivityBucket;
  limit?: number;
  enabled?: boolean;
}) {
  const apiClient = useApiClient();
  const authReady = useAuthReady();
  const limit = options.limit ?? 8;

  return useInfiniteQuery({
    queryKey: activityKeys.episodeJobs(options.episodeId, options.bucket),
    enabled: Boolean(authReady && (options.enabled ?? true) && !!options.episodeId),
    initialPageParam: null as string | null,
    queryFn: async ({ pageParam }): Promise<ActivityJobsPage> => {
      const params = new URLSearchParams();
      params.set('bucket', options.bucket);
      params.set('limit', String(limit));
      if (pageParam) {
        params.set('cursor', pageParam);
      }

      try {
        const response = await apiClient.get<ActivityJobsPage>(
          `/activity/episodes/${options.episodeId}/jobs?${params.toString()}`
        );
        return response.data;
      } catch (error) {
        if (!isNotFoundError(error)) {
          throw error;
        }

        if (pageParam) {
          return {
            bucket: options.bucket,
            items: [],
            nextCursor: null,
          };
        }

        const jobs = await fetchEpisodeJobsWithFallback(apiClient, options.episodeId);
        const items = jobs
          .filter((job) => matchesBucket(job, options.bucket))
          .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
          .slice(0, limit);

        return {
          bucket: options.bucket,
          items,
          nextCursor: null,
        };
      }
    },
    getNextPageParam: (lastPage) => lastPage.nextCursor,
    staleTime: 30_000,
  });
}

export function flattenActivityEpisodePages(data?: InfiniteData<ActivityEpisodePage>): ActivityEpisodeSummary[] {
  if (!data?.pages?.length) return [];
  return data.pages.flatMap((page) => page.items);
}

export function upsertActivityEpisodeSummaryPages(
  existing: InfiniteData<ActivityEpisodePage> | undefined,
  item: ActivityEpisodeSummary
): InfiniteData<ActivityEpisodePage> | undefined {
  if (!existing) return existing;

  const pages = existing.pages.map((page) => {
    const index = page.items.findIndex((episode) => episode.episodeId === item.episodeId);
    if (index < 0) return page;

    const items = [...page.items];
    items[index] = item;

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

export function upsertActivityJobPages(
  existing: InfiniteData<ActivityJobsPage> | undefined,
  item: ActivityJobItem
): InfiniteData<ActivityJobsPage> | undefined {
  if (!existing) return existing;

  const pages = existing.pages.map((page) => {
    const index = page.items.findIndex((job) => job.id === item.id);
    if (index >= 0) {
      const updatedItems = [...page.items];
      updatedItems[index] = item;
      return {
        ...page,
        items: updatedItems,
      };
    }

    // Insert into first page only when bucket matches status semantics.
    if (page !== existing.pages[0]) {
      return page;
    }

    const shouldInclude =
      (page.bucket === 'attention' && (item.status === 'error' || item.status === 'cancelled')) ||
      (page.bucket === 'active' && (item.status === 'pending' || item.status === 'processing')) ||
      (page.bucket === 'recent' && item.status === 'done') ||
      (page.bucket === 'history' && ['done', 'cancelled', 'error'].includes(item.status));

    if (!shouldInclude) {
      return page;
    }

    return {
      ...page,
      items: [item, ...page.items],
    };
  });

  return {
    ...existing,
    pages,
  };
}
