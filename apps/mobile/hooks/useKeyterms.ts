import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useApiClient } from '../lib/api';

export type KeytermCategory =
  | 'company'
  | 'product'
  | 'jargon'
  | 'non_english'
  | 'person'
  | 'location'
  | 'other';

export type EpisodeKeytermSource = 'user' | 'matched' | 'llm';

export interface EpisodeKeyterm {
  id: string;
  term: string;
  normalizedTerm: string;
  category: KeytermCategory;
  language?: string | null;
  source: EpisodeKeytermSource;
  confirmed: boolean;
}

export const keytermKeys = {
  all: ['keyterms'] as const,
  episode: (episodeId: string) => [...keytermKeys.all, 'episode', episodeId] as const,
};

export function useEpisodeKeyterms(episodeId: string) {
  const apiClient = useApiClient();

  return useQuery({
    queryKey: keytermKeys.episode(episodeId),
    queryFn: async (): Promise<{ keyterms: EpisodeKeyterm[] }> => {
      const response = await apiClient.get<{ keyterms: EpisodeKeyterm[] }>(
        `/episodes/${episodeId}/keyterms`
      );
      return response.data;
    },
    enabled: !!episodeId,
  });
}

export function useAddEpisodeKeyterm() {
  const apiClient = useApiClient();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: {
      episodeId: string;
      term: string;
      category: KeytermCategory;
      language?: string;
    }): Promise<{ keyterm: EpisodeKeyterm }> => {
      const response = await apiClient.post<{ keyterm: EpisodeKeyterm }>(
        `/episodes/${input.episodeId}/keyterms`,
        {
          term: input.term,
          category: input.category,
          language: input.language,
        }
      );
      return response.data;
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: keytermKeys.episode(variables.episodeId) });
    },
  });
}

