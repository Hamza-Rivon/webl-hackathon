/**
 * B-Roll Chunks Hook
 *
 * React Query hook to fetch B-roll chunks for an episode.
 */

import { useQuery } from '@tanstack/react-query';
import { useApiClient } from '../lib/api';
import { useAuthReady } from './useAuthReady';

export interface BrollChunk {
  id: string;
  slotClipId: string;
  chunkIndex: number;
  startMs: number;
  endMs: number;
  durationMs: number;
  s3Key: string | null;
  muxAssetId: string | null;
  muxPlaybackId: string | null;
  thumbnailUrl: string | null;
  playbackUrl: string | null;
  aiTags: string[];
  aiSummary: string | null;
  moderationStatus: string | null;
  qualityScore: number | null;
  motionScore: number | null;
  compositionScore: number | null;
  matchScore: number | null;
  matchedToSegmentId: string | null;
  isUsedInFinalCut: boolean;
  embeddingText: string | null;
  metadata: Record<string, unknown> | null;
  createdAt: string;
}

export interface BrollChunksResponse {
  chunks: BrollChunk[];
  total: number;
  usedInFinalCut: number;
}

export const brollChunkKeys = {
  all: ['broll-chunks'] as const,
  list: (episodeId: string) => [...brollChunkKeys.all, episodeId] as const,
};

export function useBrollChunks(episodeId: string, options?: { enabled?: boolean }) {
  const apiClient = useApiClient();
  const authReady = useAuthReady();

  return useQuery({
    queryKey: brollChunkKeys.list(episodeId),
    queryFn: async (): Promise<BrollChunksResponse> => {
      const response = await apiClient.get<BrollChunksResponse>(
        `/episodes/${episodeId}/broll-chunks`
      );
      return response.data;
    },
    enabled: authReady && !!episodeId && (options?.enabled !== false),
  });
}
