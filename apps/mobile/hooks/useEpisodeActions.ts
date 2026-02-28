/**
 * Episode Actions Hook
 *
 * Hook for managing episode render requests.
 * Implements Phase 6: Intent-based actions with request status tracking.
 */

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useApiClient } from '../lib/api';
import { useEpisode, episodeKeys } from './useEpisodes';

export function useEpisodeActions(episodeId: string) {
  const { data: episode } = useEpisode(episodeId);
  const apiClient = useApiClient();
  const queryClient = useQueryClient();

  const isRenderRequested = episode?.renderRequested ?? false;

  const requestRender = useMutation({
    mutationFn: async () => {
      const response = await apiClient.post(`/episodes/${episodeId}/render`);
      return response.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: episodeKeys.detail(episodeId) });
    },
  });

  // UI should block taps only while the request itself is in-flight.
  // Render orchestration state is represented by `renderRequested`/episode status.
  const isProcessing = requestRender.isPending;

  return {
    isRenderRequested,
    isProcessing,
    canRequestRender: !isRenderRequested && !isProcessing,
    requestRender,
  };
}
