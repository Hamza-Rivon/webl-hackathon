/**
 * ElevenLabs Voiceover Generation Hook
 *
 * Hook for generating voiceover using ElevenLabs TTS API.
 * This is an optional alternative to recording voiceover manually.
 */

import { useState, useCallback } from 'react';
import { useApiClient } from '../lib/api';
import { useUploadStore } from '../stores/upload';
import { triggerHaptic } from '../lib/haptics';

export interface ElevenLabsVoiceoverResult {
  success: boolean;
  key?: string;
  keys?: string[];
  jobId?: string;
  error?: string;
}

export interface ElevenLabsProgress {
  progress: number;
  status: 'idle' | 'generating' | 'uploading' | 'completed' | 'failed';
  message: string;
}

export function useElevenLabsVoiceover(episodeId: string) {
  const apiClient = useApiClient();
  const { addUpload, updateProgress, setStatus } = useUploadStore();
  
  const [progress, setProgress] = useState<ElevenLabsProgress>({
    progress: 0,
    status: 'idle',
    message: 'Ready to generate',
  });
  const [isGenerating, setIsGenerating] = useState(false);

  /**
   * Generate voiceover using ElevenLabs
   */
  const generateVoiceover = useCallback(async (): Promise<ElevenLabsVoiceoverResult> => {
    if (isGenerating) {
      return { success: false, error: 'Generation already in progress' };
    }

    setIsGenerating(true);
    const uploadId = `elevenlabs_voiceover_${episodeId}_${Date.now()}`;

    try {
      // Step 1: Generating
      setProgress({
        progress: 10,
        status: 'generating',
        message: 'Generating voiceover with ElevenLabs...',
      });

      addUpload(uploadId, `elevenlabs_voiceover_${episodeId}`, 10);

      // Step 2: Call API endpoint
      setProgress({
        progress: 30,
        status: 'generating',
        message: 'Creating audio from script...',
      });
      updateProgress(uploadId, 30);

      const response = await apiClient.post<{
        success: boolean;
        key: string;
        keys: string[];
        jobId: string;
        message: string;
      }>(
        `/episodes/${episodeId}/generate-voiceover`,
        {},
        {
          timeout: 120000, // 2 minutes - ElevenLabs generation can take time
        }
      );

      // Step 3: Uploading (server handles this, but we show progress)
      setProgress({
        progress: 80,
        status: 'uploading',
        message: 'Uploading generated audio...',
      });
      updateProgress(uploadId, 80);

      // Step 4: Success
      setProgress({
        progress: 100,
        status: 'completed',
        message: 'Voiceover generated successfully!',
      });
      updateProgress(uploadId, 100);
      setStatus(uploadId, 'completed');
      triggerHaptic('success');

      return {
        success: true,
        keys: response.data.keys,
        key: response.data.key,
        jobId: response.data.jobId,
      };
    } catch (error) {
      console.error('ElevenLabs voiceover generation failed:', error);
      
      setProgress({
        progress: 0,
        status: 'failed',
        message: error instanceof Error ? error.message : 'Generation failed',
      });

      setStatus(uploadId, 'failed', error instanceof Error ? error.message : 'Generation failed');
      triggerHaptic('error');

      return {
        success: false,
        error: error instanceof Error ? error.message : 'Generation failed',
      };
    } finally {
      setIsGenerating(false);
    }
  }, [episodeId, apiClient, isGenerating, addUpload, updateProgress, setStatus]);

  /**
   * Reset progress state
   */
  const resetProgress = useCallback(() => {
    setIsGenerating(false);
    setProgress({
      progress: 0,
      status: 'idle',
      message: 'Ready to generate',
    });
  }, []);

  return {
    generateVoiceover,
    progress,
    isGenerating,
    resetProgress,
  };
}

export default useElevenLabsVoiceover;
