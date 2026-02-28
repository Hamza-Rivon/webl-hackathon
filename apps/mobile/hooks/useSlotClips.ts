/**
 * Slot Clips Hook
 *
 * React Query hooks for slot clip operations in the template-driven capture flow.
 * Requirements: Task 6 - Mobile App Updates
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useApiClient, SlotClip, SlotType, SlotSource } from '../lib/api';
import { episodeKeys } from './useEpisodes';
import { useAuthReady } from './useAuthReady';

// Types for slot progress tracking
export interface SlotProgress {
  requiredTotal: number;
  requiredCompleted: number;
  optionalTotal: number;
  optionalCompleted: number;
  isComplete: boolean;
  slots: Array<{
    slotId: string;
    slotType: SlotType;
    priority: 'required' | 'optional';
    description: string;
    examples: string[];
    duration: { min: number; target: number; max: number };
    allowedSources: SlotSource[];
    clips: SlotClip[];
    status: 'pending' | 'in_progress' | 'complete' | 'needs_more';
    totalDuration: number;
  }>;
}

export interface SlotClipWithUrl extends SlotClip {
  playbackUrl?: string;
  thumbnailUrl?: string;
  downloadUrl?: string;
}

// Query keys
export const slotClipKeys = {
  all: ['slotClips'] as const,
  lists: () => [...slotClipKeys.all, 'list'] as const,
  list: (episodeId: string) => [...slotClipKeys.lists(), episodeId] as const,
  details: () => [...slotClipKeys.all, 'detail'] as const,
  detail: (id: string) => [...slotClipKeys.details(), id] as const,
  progress: (episodeId: string) => [...slotClipKeys.all, 'progress', episodeId] as const,
};

/**
 * Hook to fetch all slot clips for an episode
 */
export function useSlotClips(episodeId: string) {
  const apiClient = useApiClient();
  const authReady = useAuthReady();

  return useQuery({
    queryKey: slotClipKeys.list(episodeId),
    queryFn: async (): Promise<{ slotClips: SlotClip[]; progress: SlotProgress }> => {
      const response = await apiClient.get<{ slotClips: SlotClip[]; progress: SlotProgress }>(
        `/episodes/${episodeId}/slots`
      );
      return response.data;
    },
    enabled: authReady && !!episodeId,
    staleTime: 0, // Always refetch when query is invalidated or component remounts
    refetchOnMount: true, // Refetch when component mounts
    refetchOnWindowFocus: true, // Refetch when app comes to foreground
  });
}

/**
 * Hook to fetch a single slot clip with URLs
 */
export function useSlotClip(id: string) {
  const apiClient = useApiClient();
  const authReady = useAuthReady();

  return useQuery({
    queryKey: slotClipKeys.detail(id),
    queryFn: async (): Promise<SlotClipWithUrl> => {
      const response = await apiClient.get<SlotClipWithUrl>(`/slots/${id}`);
      return response.data;
    },
    enabled: authReady && !!id,
  });
}

/**
 * Hook to create a new slot clip
 */
export function useCreateSlotClip() {
  const apiClient = useApiClient();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      episodeId,
      slotId,
      slotType,
      source,
      s3Key,
      duration,
      width,
      height,
      fps,
    }: {
      episodeId: string;
      slotId: string;
      slotType: SlotType;
      source: SlotSource;
      s3Key: string;
      duration?: number;
      width?: number;
      height?: number;
      fps?: number;
    }): Promise<SlotClip> => {
      const response = await apiClient.post<SlotClip>(`/episodes/${episodeId}/slots`, {
        slotId,
        slotType,
        source,
        s3Key,
        duration,
        width,
        height,
        fps,
      });
      return response.data;
    },
    onSuccess: (_, { episodeId }) => {
      queryClient.invalidateQueries({ queryKey: slotClipKeys.list(episodeId) });
      queryClient.invalidateQueries({ queryKey: episodeKeys.detail(episodeId) });
    },
  });
}

/**
 * Hook to update a slot clip
 */
export function useUpdateSlotClip() {
  const apiClient = useApiClient();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      id,
      episodeId,
      selectedSegments,
    }: {
      id: string;
      episodeId: string;
      selectedSegments?: Array<{ startTime: number; endTime: number; score?: number }>;
    }): Promise<SlotClip> => {
      const response = await apiClient.put<SlotClip>(`/slots/${id}`, {
        selectedSegments,
      });
      return response.data;
    },
    onSuccess: (_, { id, episodeId }) => {
      queryClient.invalidateQueries({ queryKey: slotClipKeys.detail(id) });
      queryClient.invalidateQueries({ queryKey: slotClipKeys.list(episodeId) });
    },
  });
}

/**
 * Hook to delete a slot clip
 */
export function useDeleteSlotClip() {
  const apiClient = useApiClient();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      id,
      episodeId,
    }: {
      id: string;
      episodeId: string;
    }): Promise<void> => {
      await apiClient.delete(`/slots/${id}`);
    },
    onSuccess: (_, { id, episodeId }) => {
      queryClient.removeQueries({ queryKey: slotClipKeys.detail(id) });
      queryClient.invalidateQueries({ queryKey: slotClipKeys.list(episodeId) });
      queryClient.invalidateQueries({ queryKey: episodeKeys.detail(episodeId) });
    },
  });
}

/**
 * Hook to get download URL for a slot clip
 */
export function useSlotClipDownloadUrl(id: string) {
  const apiClient = useApiClient();
  const authReady = useAuthReady();

  return useQuery({
    queryKey: [...slotClipKeys.detail(id), 'download'] as const,
    queryFn: async (): Promise<{ url: string; expiresIn: number }> => {
      const response = await apiClient.get<{ url: string; expiresIn: number }>(
        `/slots/${id}/download-url`
      );
      return response.data;
    },
    enabled: authReady && !!id,
    staleTime: 1000 * 60 * 50, // 50 minutes (URLs typically expire in 1 hour)
  });
}

export default {
  useSlotClips,
  useSlotClip,
  useCreateSlotClip,
  useUpdateSlotClip,
  useDeleteSlotClip,
  useSlotClipDownloadUrl,
};
