/**
 * Audio File Picker Hook
 *
 * Hook for picking audio files from device and uploading them as voiceover.
 * Integrates with existing voiceover upload flow.
 */

import { useState, useCallback } from 'react';
import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system/legacy';
import { useVoiceoverUpload } from './useVoiceoverUpload';
import { triggerHaptic } from '../lib/haptics';

export interface AudioFileInfo {
  uri: string;
  name: string;
  size: number;
  mimeType: string;
}

export interface AudioPickResult {
  success: boolean;
  file?: AudioFileInfo;
  error?: string;
}

const SUPPORTED_AUDIO_TYPES = [
  'audio/mpeg', // .mp3
  'audio/mp4', // .m4a
  'audio/x-m4a', // .m4a (alternative)
  'audio/wav', // .wav
  'audio/x-wav', // .wav (alternative)
  'audio/aac', // .aac
  'audio/ogg', // .ogg
  'audio/webm', // .webm
];

const MAX_FILE_SIZE = 500 * 1024 * 1024; // 500MB

export function useAudioFilePicker(episodeId: string) {
  const [isPicking, setIsPicking] = useState(false);
  const [pickedFile, setPickedFile] = useState<AudioFileInfo | null>(null);
  
  const {
    uploadVoiceover,
    uploadProgress,
    isUploading,
    cancelUpload,
    resetUpload,
  } = useVoiceoverUpload(episodeId);

  /**
   * Pick audio file from device
   */
  const pickAudioFile = useCallback(async (): Promise<AudioPickResult> => {
    if (isPicking || isUploading) {
      return { success: false, error: 'Already picking or uploading' };
    }

    setIsPicking(true);
    triggerHaptic('selection');

    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: SUPPORTED_AUDIO_TYPES,
        copyToCacheDirectory: true,
        multiple: false,
      });

      if (result.canceled || !result.assets || result.assets.length === 0) {
        setIsPicking(false);
        return { success: false, error: 'No file selected' };
      }

      const asset = result.assets[0];
      
      if (!asset || !asset.uri) {
        setIsPicking(false);
        return { success: false, error: 'Invalid file selected' };
      }

      // Validate file exists and get size
      const fileInfo = await FileSystem.getInfoAsync(asset.uri);
      
      if (!fileInfo.exists) {
        setIsPicking(false);
        return { success: false, error: 'Selected file not found' };
      }

      const fileSize = fileInfo.size || 0;

      // Validate file size
      if (fileSize > MAX_FILE_SIZE) {
        setIsPicking(false);
        return {
          success: false,
          error: `File too large (${(fileSize / 1024 / 1024).toFixed(1)}MB). Maximum size is 500MB.`,
        };
      }

      if (fileSize === 0) {
        setIsPicking(false);
        return { success: false, error: 'File is empty' };
      }

      // Validate MIME type
      const mimeType = asset.mimeType || 'audio/mpeg';
      if (!SUPPORTED_AUDIO_TYPES.includes(mimeType)) {
        console.warn(`[useAudioFilePicker] Unsupported MIME type: ${mimeType}, defaulting to audio/mpeg`);
      }

      const audioFile: AudioFileInfo = {
        uri: asset.uri,
        name: asset.name || 'audio.mp3',
        size: fileSize,
        mimeType,
      };

      setPickedFile(audioFile);
      triggerHaptic('success');

      return {
        success: true,
        file: audioFile,
      };
    } catch (error) {
      console.error('[useAudioFilePicker] Failed to pick audio file:', error);
      triggerHaptic('error');
      
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to pick file',
      };
    } finally {
      setIsPicking(false);
    }
  }, [isPicking, isUploading, episodeId]);

  /**
   * Pick and upload audio file in one step
   */
  const pickAndUploadAudioFile = useCallback(async () => {
    const pickResult = await pickAudioFile();
    
    if (!pickResult.success || !pickResult.file) {
      return {
        success: false,
        error: pickResult.error,
      };
    }

    // Upload the picked file
    const uploadResult = await uploadVoiceover([pickResult.file.uri]);
    
    if (uploadResult.success) {
      triggerHaptic('success');
    } else {
      triggerHaptic('error');
    }

    return uploadResult;
  }, [pickAudioFile, uploadVoiceover]);

  /**
   * Reset picker state
   */
  const resetPicker = useCallback(() => {
    setPickedFile(null);
    resetUpload();
  }, [resetUpload]);

  return {
    // Picker functions
    pickAudioFile,
    pickAndUploadAudioFile,
    
    // Picker state
    isPicking,
    pickedFile,
    
    // Upload state (from useVoiceoverUpload)
    uploadProgress,
    isUploading,
    
    // Actions
    cancelUpload,
    resetPicker,
  };
}

export default useAudioFilePicker;
