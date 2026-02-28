/**
 * Voiceover Upload Hook
 *
 * Hook for uploading voiceover recordings to S3 and triggering voice cleanup job.
 * Supports both full recordings and per-segment recordings.
 * Per-segment recordings are uploaded individually and combined server-side.
 * Requirements: 9.7, 9.8
 */

import { useState, useCallback, useRef } from 'react';
import * as FileSystem from 'expo-file-system/legacy';
import { useApiClient } from '../lib/api';
import { useUploadStore } from '../stores/upload';
import { triggerHaptic } from '../lib/haptics';

export interface VoiceoverUploadResult {
  success: boolean;
  key?: string;
  keys?: string[];
  jobId?: string;
  error?: string;
}

export interface UploadProgress {
  progress: number;
  status: 'preparing' | 'uploading' | 'processing' | 'completed' | 'failed';
  message: string;
  currentSegment?: number;
  totalSegments?: number;
}

interface PresignedUploadResponse {
  url: string;
  fields: Record<string, string>;
  key: string;
}

interface CompleteUploadResponse {
  jobId: string;
}

interface VoiceoverSegment {
  uri: string;
  beatIndex: number;
  duration?: number;
}

export function useVoiceoverUpload(episodeId: string) {
  const apiClient = useApiClient();
  const { addUpload, updateProgress, setStatus } = useUploadStore();
  
  const [uploadProgress, setUploadProgress] = useState<UploadProgress>({
    progress: 0,
    status: 'preparing',
    message: 'Preparing upload...',
  });
  const [isUploading, setIsUploading] = useState(false);
  const uploadTaskRef = useRef<FileSystem.UploadTask | null>(null);

  /**
   * Get file info for upload
   */
  const getFileInfo = async (uri: string, segmentIndex?: number) => {
    const info = await FileSystem.getInfoAsync(uri);
    if (!info.exists) {
      throw new Error('Recording file not found');
    }
    
    const timestamp = Date.now();
    const segmentSuffix = segmentIndex !== undefined ? `_seg${segmentIndex}` : '';
    const filename = `voiceover_${timestamp}${segmentSuffix}.m4a`;
    
    return {
      uri,
      filename,
      size: info.size || 0,
      mimeType: 'audio/m4a',
    };
  };

  /**
   * Upload a single segment to S3
   */
  const uploadSingleSegment = async (
    uri: string,
    segmentIndex: number,
    totalSegments: number,
    uploadId: string
  ): Promise<string> => {
    const fileInfo = await getFileInfo(uri, segmentIndex);

    // Calculate progress range for this segment
    const segmentProgressStart = 10 + (segmentIndex / totalSegments) * 75;
    const segmentProgressEnd = 10 + ((segmentIndex + 1) / totalSegments) * 75;

    // Get presigned URL
    const presignedResponse = await apiClient.post<PresignedUploadResponse>(
      '/uploads/init',
      {
        type: 'voiceover_segment',
        episodeId,
        filename: fileInfo.filename,
        contentType: fileInfo.mimeType,
        fileSize: fileInfo.size,
        segmentIndex,
        totalSegments,
      }
    );

    const { url, fields, key } = presignedResponse.data;

    // Upload to S3 with progress tracking
    const uploadTask = FileSystem.createUploadTask(
      url,
      fileInfo.uri,
      {
        uploadType: FileSystem.FileSystemUploadType.MULTIPART,
        fieldName: 'file',
        parameters: fields,
        headers: {
          'Content-Type': 'multipart/form-data',
        },
      },
      (progress) => {
        const segmentProgress = progress.totalBytesSent / progress.totalBytesExpectedToSend;
        const overallProgress = segmentProgressStart + segmentProgress * (segmentProgressEnd - segmentProgressStart);
        
        setUploadProgress({
          progress: overallProgress,
          status: 'uploading',
          message: `Uploading segment ${segmentIndex + 1}/${totalSegments}...`,
          currentSegment: segmentIndex + 1,
          totalSegments,
        });
        updateProgress(uploadId, overallProgress);
      }
    );

    uploadTaskRef.current = uploadTask;
    const uploadResult = await uploadTask.uploadAsync();
    uploadTaskRef.current = null;

    if (!uploadResult || uploadResult.status >= 400) {
      throw new Error(`Failed to upload segment ${segmentIndex + 1}`);
    }

    return key;
  };

  /**
   * Upload voiceover to S3 - handles both single and multi-segment recordings
   */
  const uploadVoiceover = useCallback(async (
    segmentUris: string[]
  ): Promise<VoiceoverUploadResult> => {
    if (isUploading) {
      return { success: false, error: 'Upload already in progress' };
    }

    if (segmentUris.length === 0) {
      return { success: false, error: 'No segments to upload' };
    }

    setIsUploading(true);
    const uploadId = `voiceover_${episodeId}_${Date.now()}`;

    try {
      // Step 1: Prepare
      setUploadProgress({
        progress: 5,
        status: 'preparing',
        message: 'Preparing audio files...',
        totalSegments: segmentUris.length,
      });

      addUpload(uploadId, `voiceover_${episodeId}`, 0);

      const uploadedKeys: string[] = [];

      // Step 2: Upload each segment
      for (let i = 0; i < segmentUris.length; i++) {
        setUploadProgress({
          progress: 10 + (i / segmentUris.length) * 75,
          status: 'uploading',
          message: `Uploading segment ${i + 1}/${segmentUris.length}...`,
          currentSegment: i + 1,
          totalSegments: segmentUris.length,
        });

        const key = await uploadSingleSegment(
          segmentUris[i],
          i,
          segmentUris.length,
          uploadId
        );
        uploadedKeys.push(key);
      }

      // Step 3: Complete upload - tell server to combine segments
      setUploadProgress({
        progress: 90,
        status: 'processing',
        message: segmentUris.length > 1 
          ? 'Combining audio segments...' 
          : 'Processing voiceover...',
      });

      // Use longer timeout for upload completion (may need to queue jobs)
      const completeResponse = await apiClient.post<CompleteUploadResponse>(
        '/uploads/voiceover/complete',
        {
          episodeId,
          keys: uploadedKeys,
          segmentCount: segmentUris.length,
        },
        {
          timeout: 60000, // 60 seconds - upload completion may take longer due to job queueing
        }
      );

      // Step 4: Success
      setUploadProgress({
        progress: 100,
        status: 'completed',
        message: 'Upload complete!',
      });

      setStatus(uploadId, 'completed');
      triggerHaptic('success');

      return {
        success: true,
        keys: uploadedKeys,
        key: uploadedKeys[0],
        jobId: completeResponse.data.jobId,
      };
    } catch (error) {
      console.error('Voiceover upload failed:', error);
      
      setUploadProgress({
        progress: 0,
        status: 'failed',
        message: error instanceof Error ? error.message : 'Upload failed',
      });

      setStatus(uploadId, 'failed', error instanceof Error ? error.message : 'Upload failed');
      triggerHaptic('error');

      return {
        success: false,
        error: error instanceof Error ? error.message : 'Upload failed',
      };
    } finally {
      setIsUploading(false);
      uploadTaskRef.current = null;
    }
  }, [episodeId, apiClient, isUploading, addUpload, updateProgress, setStatus]);

  /**
   * Upload voiceover with beat indices for per-segment recording
   */
  const uploadVoiceoverSegments = useCallback(async (
    segments: VoiceoverSegment[]
  ): Promise<VoiceoverUploadResult> => {
    // Sort segments by beat index
    const sortedSegments = [...segments].sort((a, b) => a.beatIndex - b.beatIndex);
    const uris = sortedSegments.map(s => s.uri);
    return uploadVoiceover(uris);
  }, [uploadVoiceover]);

  /**
   * Cancel ongoing upload
   */
  const cancelUpload = useCallback(() => {
    if (uploadTaskRef.current) {
      uploadTaskRef.current.cancelAsync();
      uploadTaskRef.current = null;
    }
    setIsUploading(false);
    setUploadProgress({
      progress: 0,
      status: 'preparing',
      message: 'Upload cancelled',
    });
    triggerHaptic('warning');
  }, []);

  /**
   * Reset upload state
   */
  const resetUpload = useCallback(() => {
    setIsUploading(false);
    setUploadProgress({
      progress: 0,
      status: 'preparing',
      message: 'Preparing upload...',
    });
  }, []);

  return {
    uploadVoiceover,
    uploadVoiceoverSegments,
    cancelUpload,
    resetUpload,
    uploadProgress,
    isUploading,
  };
}

export default useVoiceoverUpload;
