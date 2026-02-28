/**
 * Templates Hooks
 *
 * React Query hooks for template browsing and search.
 * Requirements: 8.1, 8.4, 8.5
 */

import { useQuery, useMutation } from '@tanstack/react-query';
import { useApiClient, TemplateFilters, TemplateSearchInput } from '../lib/api';

// Types
export interface TemplateBeat {
  type: string;
  duration: number;
  description: string;
}

export interface TemplateStructure {
  beats: TemplateBeat[];
}

export interface CaptionStyle {
  fontFamily?: string;
  fontSize?: number;
  fontWeight?: string;
  color?: string;
  backgroundColor?: string;
  position?: 'top' | 'bottom' | 'center';
  animation?: 'fade' | 'slide' | 'typewriter' | 'pop';
  highlightWords?: boolean;
  highlightColor?: string;
  // Legacy field aliases
  font?: string;
  size?: number;
  type?: string;
  highlightKeywords?: boolean;
}

export type CaptionStyleType = 'animated' | 'bold' | 'minimal' | 'none';

export interface EditingRecipe {
  cutRhythm: 'fast' | 'medium' | 'slow' | 'variable';
  captionStyle: CaptionStyleType | CaptionStyle;
  musicType: 'upbeat' | 'cinematic' | 'dramatic' | 'ambient' | 'none';
  transitions: string[] | Record<string, string>;
  musicGuidance?: {
    type: string;
    bpm?: string;
    mood?: string;
    fadeIn?: boolean;
    fadeOut?: boolean;
    duckOnVoice?: boolean;
    volume?: number;
  };
}

export interface Template {
  id: string;
  name: string;
  description: string | null;
  platform: 'tiktok' | 'reels' | 'shorts' | 'all';
  language: string;
  durationTarget: number;
  canonicalScript: string;
  scriptStructure: TemplateStructure;
  editingRecipe: EditingRecipe;
  personaTags: string[];
  niche: string | null;
  tone: string | null;
  viewCount: number;
  retentionRate: number | null;
  saveRate: number | null;
  embeddingId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface TemplateWithScore extends Template {
  similarityScore?: number;
}

// Query keys
export const templateKeys = {
  all: ['templates'] as const,
  lists: () => [...templateKeys.all, 'list'] as const,
  list: (filters?: TemplateFilters) => [...templateKeys.lists(), filters] as const,
  details: () => [...templateKeys.all, 'detail'] as const,
  detail: (id: string) => [...templateKeys.details(), id] as const,
  recommended: () => [...templateKeys.all, 'recommended'] as const,
  search: (query: string) => [...templateKeys.all, 'search', query] as const,
};

/**
 * Hook to fetch templates with optional filters
 * Requirements: 8.1
 */
export function useTemplates(filters?: TemplateFilters) {
  const apiClient = useApiClient();

  return useQuery({
    queryKey: templateKeys.list(filters),
    queryFn: async (): Promise<Template[]> => {
      const params = new URLSearchParams();
      if (filters?.platform) params.append('platform', filters.platform);
      if (filters?.niche) params.append('niche', filters.niche);
      if (filters?.tone) params.append('tone', filters.tone);
      if (filters?.limit) params.append('limit', String(filters.limit));
      if (filters?.offset) params.append('offset', String(filters.offset));

      const queryString = params.toString();
      const url = queryString ? `/templates?${queryString}` : '/templates';
      const response = await apiClient.get<Template[]>(url);
      return response.data;
    },
  });
}

/**
 * Hook to fetch a single template
 * Requirements: 8.6
 */
export function useTemplate(id: string) {
  const apiClient = useApiClient();

  return useQuery({
    queryKey: templateKeys.detail(id),
    queryFn: async (): Promise<Template> => {
      const response = await apiClient.get<Template>(`/templates/${id}`);
      return response.data;
    },
    enabled: !!id,
  });
}

/**
 * Hook to fetch personalized template recommendations
 * Requirements: 8.5
 */
export function useRecommendedTemplates() {
  const apiClient = useApiClient();

  return useQuery({
    queryKey: templateKeys.recommended(),
    queryFn: async (): Promise<Template[]> => {
      const response = await apiClient.get<Template[]>('/templates/recommended');
      return response.data;
    },
  });
}

/**
 * Hook for semantic template search
 * Requirements: 8.4
 */
export function useSearchTemplates(query: string, options?: Omit<TemplateSearchInput, 'query'>) {
  const apiClient = useApiClient();

  return useQuery({
    queryKey: templateKeys.search(query),
    queryFn: async (): Promise<TemplateWithScore[]> => {
      const response = await apiClient.post<TemplateWithScore[]>('/templates/search', {
        query,
        ...options,
      });
      return response.data;
    },
    enabled: query.length >= 2, // Only search when query has at least 2 characters
  });
}

/**
 * Mutation hook for semantic search (for imperative calls)
 * Requirements: 8.4
 */
export function useSearchTemplatesMutation() {
  const apiClient = useApiClient();

  return useMutation({
    mutationFn: async (input: TemplateSearchInput): Promise<TemplateWithScore[]> => {
      const response = await apiClient.post<TemplateWithScore[]>('/templates/search', input);
      return response.data;
    },
  });
}
