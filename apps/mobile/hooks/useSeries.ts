/**
 * Series Hooks
 *
 * React Query hooks for series CRUD operations.
 * Requirements: 6.1, 6.2, 6.6
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useApiClient, CreateSeriesInput, UpdateSeriesInput } from '../lib/api';
import { useAuthReady } from './useAuthReady';

// Types
export interface Series {
  id: string;
  name: string;
  description: string | null;
  cadence: 'daily' | 'weekly' | 'biweekly' | 'monthly';
  personaOverrides: Record<string, unknown> | null;
  createdAt: string;
  updatedAt: string;
  userId: string;
  templateId: string | null;
}

export interface SeriesWithEpisodeCount extends Series {
  _count: {
    episodes: number;
  };
}

export interface SeriesWithEpisodes extends Series {
  episodes: Array<{
    id: string;
    title: string;
    status: string;
    createdAt: string;
  }>;
}

// Query keys
export const seriesKeys = {
  all: ['series'] as const,
  lists: () => [...seriesKeys.all, 'list'] as const,
  list: (filters?: Record<string, unknown>) => [...seriesKeys.lists(), filters] as const,
  details: () => [...seriesKeys.all, 'detail'] as const,
  detail: (id: string) => [...seriesKeys.details(), id] as const,
};

/**
 * Hook to fetch all user's series
 * Requirements: 6.1
 */
export function useSeries() {
  const apiClient = useApiClient();
  const authReady = useAuthReady();

  return useQuery({
    queryKey: seriesKeys.lists(),
    queryFn: async (): Promise<SeriesWithEpisodeCount[]> => {
      const response = await apiClient.get<SeriesWithEpisodeCount[]>('/series');
      return response.data;
    },
    enabled: authReady,
  });
}

/**
 * Hook to fetch a single series with episodes
 * Requirements: 6.4
 */
export function useSeriesDetail(id: string) {
  const apiClient = useApiClient();
  const authReady = useAuthReady();

  return useQuery({
    queryKey: seriesKeys.detail(id),
    queryFn: async (): Promise<SeriesWithEpisodes> => {
      try {
        const response = await apiClient.get<SeriesWithEpisodes>(`/series/${id}`);
        return response.data;
      } catch (error: any) {
        // Handle 404 gracefully - series was deleted or doesn't exist
        if (error?.response?.status === 404) {
          // Return null data instead of throwing, so the component can handle it
          return null as any;
        }
        throw error;
      }
    },
    enabled: authReady && !!id,
    retry: (failureCount, error: any) => {
      // Don't retry on 404 errors (series not found)
      if (error?.response?.status === 404) {
        return false;
      }
      // Retry other errors up to 2 times
      return failureCount < 2;
    },
  });
}

/**
 * Hook to create a new series
 * Requirements: 6.2
 */
export function useCreateSeries() {
  const apiClient = useApiClient();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (data: CreateSeriesInput): Promise<Series> => {
      const response = await apiClient.post<Series>('/series', data);
      return response.data;
    },
    onSuccess: () => {
      // Invalidate all series queries to refetch (including list and detail queries)
      queryClient.invalidateQueries({ queryKey: seriesKeys.all });
    },
  });
}

/**
 * Hook to update a series
 * Requirements: 6.5
 */
export function useUpdateSeries() {
  const apiClient = useApiClient();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      id,
      data,
    }: {
      id: string;
      data: UpdateSeriesInput;
    }): Promise<void> => {
      await apiClient.put(`/series/${id}`, data);
    },
    onSuccess: (_, { id }) => {
      // Invalidate both list and detail queries
      queryClient.invalidateQueries({ queryKey: seriesKeys.lists() });
      queryClient.invalidateQueries({ queryKey: seriesKeys.detail(id) });
    },
  });
}

/**
 * Hook to delete a series
 * Requirements: 6.6
 */
export function useDeleteSeries() {
  const apiClient = useApiClient();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (id: string): Promise<void> => {
      await apiClient.delete(`/series/${id}`);
    },
    onSuccess: (_, id) => {
      // Remove from cache and invalidate all series queries
      queryClient.removeQueries({ queryKey: seriesKeys.detail(id) });
      queryClient.invalidateQueries({ queryKey: seriesKeys.all });
    },
  });
}
