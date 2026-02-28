/**
 * User Settings Hook
 *
 * Hook for managing user settings including ElevenLabs voice ID.
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useApiClient } from '../lib/api';

export interface UserSettings {
  elevenLabsVoiceId: string | null;
  elevenLabsApiKey: string | null; // Note: API key is never returned from server for security
}

export const userSettingsKeys = {
  all: ['userSettings'] as const,
  detail: () => [...userSettingsKeys.all, 'detail'] as const,
};

/**
 * Hook to get current user settings
 */
export function useUserSettings() {
  const apiClient = useApiClient();

  return useQuery({
    queryKey: userSettingsKeys.detail(),
    queryFn: async (): Promise<UserSettings> => {
      const response = await apiClient.get<{ 
        elevenLabsVoiceId: string | null;
        elevenLabsApiKey?: string | null; // Server never returns this for security
      }>('/users/me');
      return {
        elevenLabsVoiceId: response.data.elevenLabsVoiceId || null,
        elevenLabsApiKey: null, // Never returned from server
      };
    },
  });
}

/**
 * Hook to update ElevenLabs voice ID
 */
export function useUpdateElevenLabsVoiceId() {
  const apiClient = useApiClient();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (voiceId: string | null): Promise<{ success: boolean; elevenLabsVoiceId: string | null }> => {
      const response = await apiClient.put<{ success: boolean; elevenLabsVoiceId: string | null }>(
        '/users/elevenlabs-voice-id',
        { voiceId: voiceId || null }
      );
      return response.data;
    },
    onSuccess: () => {
      // Invalidate user settings query
      queryClient.invalidateQueries({ queryKey: userSettingsKeys.detail() });
      // Also invalidate user profile query
      queryClient.invalidateQueries({ queryKey: ['users', 'me'] });
    },
  });
}

/**
 * Hook to update ElevenLabs API key
 */
export function useUpdateElevenLabsApiKey() {
  const apiClient = useApiClient();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (apiKey: string | null): Promise<{ success: boolean; message: string }> => {
      const response = await apiClient.put<{ success: boolean; message: string }>(
        '/users/elevenlabs-api-key',
        { apiKey: apiKey || null }
      );
      return response.data;
    },
    onSuccess: () => {
      // Invalidate user settings query
      queryClient.invalidateQueries({ queryKey: userSettingsKeys.detail() });
      // Also invalidate user profile query
      queryClient.invalidateQueries({ queryKey: ['users', 'me'] });
    },
  });
}

/**
 * Hook to update both ElevenLabs voice ID and API key at once
 */
export function useUpdateElevenLabsSettings() {
  const apiClient = useApiClient();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (settings: { voiceId?: string | null; apiKey?: string | null }): Promise<{ 
      success: boolean; 
      elevenLabsVoiceId: string | null;
      message: string;
    }> => {
      const response = await apiClient.put<{ 
        success: boolean; 
        elevenLabsVoiceId: string | null;
        message: string;
      }>(
        '/users/elevenlabs-settings',
        settings
      );
      return response.data;
    },
    onSuccess: () => {
      // Invalidate user settings query
      queryClient.invalidateQueries({ queryKey: userSettingsKeys.detail() });
      // Also invalidate user profile query
      queryClient.invalidateQueries({ queryKey: ['users', 'me'] });
    },
  });
}
