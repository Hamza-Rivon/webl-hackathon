/**
 * Slot Upload Hook
 *
 * Hook for uploading slot clips (facecam and B-roll) to S3 with progress tracking.
 * Requirements: Task 6.5 - Add Slot Upload Hooks
 */

import { useState, useCallback, useRef } from 'react';
import * as FileSystem from 'expo-file-system/legacy';
import { useApiClient, SlotType, SlotSource } from '../lib/api';
import { useUploadStore } from '../stores/upload';
import { triggerHaptic } from '../lib/haptics';

// Constants
const CHUNK_SIZE = 5 * 1024 * 1024; // 5MB chunks

export type SlotUploadStatus = 'pending' | 'uploading' | 'processing' | 'completed' | 'failed';

export interface SlotUploadState {
  id: string;
  slotId: string;
  slotType: SlotType;
  source: SlotSource;
  fileName: string;
  fileSize: number;
  progress: number;
  status: SlotUploadStatus;
  error?: string;
  key?: string;
  slotClipId?: string;
}

interface SlotUploadInput {
  uri: string;
  slotId: string;
  slotType: SlotType;
  source: SlotSource;
  duration?: number;
  width?: number;
  height?: number;
  fps?: number;
}

interface PresignedUploadResponse {
  url: string;
  fields: Record<string, string>;
  key: string;
}

export function useSlotUpload(episodeId: string) {
  const apiClient = useApiClient();
  const { addUpload, updateProgress, setStatus, removeUpload } = useUploadStore();

  const [uploads, setUploads] = useState<SlotUploadState[]>([]);
  const [isUploading, setIsUploading] = useState(false);
  const uploadTasksRef = useRef<Map<string, FileSystem.UploadTask>>(new Map());

  /**
   * Update upload state helper
   */
  const updateUploadState = useCallback(
    (uploadId: string, updates: Partial<SlotUploadState>) => {
      setUploads((prev) =>
        prev.map((u) => (u.id === uploadId ? { ...u, ...updates } : u))
      );
      if (updates.progress !== undefined) {
        updateProgress(uploadId, updates.progress);
      }
      if (updates.status !== undefined) {
        setStatus(uploadId, updates.status as any, updates.error);
      }
    },
    [updateProgress, setStatus]
  );

  /**
   * Get file info from URI
   */
  const getFileInfo = async (uri: string) => {
    const info = await FileSystem.getInfoAsync(uri);
    if (!info.exists) {
      throw new Error('Video file not found');
    }

    // Extract filename from URI
    const uriParts = uri.split('/');
    const originalFileName = uriParts[uriParts.length - 1] || 'slot_clip.mp4';
    
    // Clean filename for API validation
    const cleanFileName = originalFileName
      .replace(/[^a-zA-Z0-9\-_.]/g, '_')
      .replace(/\.+/g, '.');
    
    // Ensure proper extension
    const hasValidExt = /\.(mp4|mov|m4v)$/i.test(cleanFileName);
    const filename = hasValidExt ? cleanFileName : `${cleanFileName}.mp4`;

    return {
      uri,
      filename,
      size: info.size || 0,
      mimeType: 'video/mp4',
    };
  };

  /**
   * Upload a single slot clip
   */
  const uploadSlotClip = useCallback(
    async (input: SlotUploadInput): Promise<SlotUploadState | null> => {
      const uploadId = `slot_${input.slotId}_${Date.now()}`;

      try {
        // Get file info
        const fileInfo = await getFileInfo(input.uri);

        // Initialize upload state
        const initialState: SlotUploadState = {
          id: uploadId,
          slotId: input.slotId,
          slotType: input.slotType,
          source: input.source,
          fileName: fileInfo.filename,
          fileSize: fileInfo.size,
          progress: 0,
          status: 'pending',
        };

        setUploads((prev) => [...prev, initialState]);
        addUpload(uploadId, fileInfo.filename, fileInfo.size);

        // Update to uploading
        updateUploadState(uploadId, { status: 'uploading', progress: 5 });

        // Get presigned URL
        const presignedResponse = await apiClient.post<PresignedUploadResponse>(
          '/uploads/init',
          {
            type: 'slot_clip',
            episodeId,
            filename: fileInfo.filename,
            contentType: fileInfo.mimeType,
            fileSize: fileInfo.size,
            slotId: input.slotId,
            slotType: input.slotType,
            source: input.source,
          }
        );

        const { url, fields, key } = presignedResponse.data;
        updateUploadState(uploadId, { progress: 10, key });

        // Upload to S3
        const uploadTask = FileSystem.createUploadTask(
          url,
          input.uri,
          {
            uploadType: FileSystem.FileSystemUploadType.MULTIPART,
            fieldName: 'file',
            parameters: fields,
            headers: {
              'Content-Type': 'multipart/form-data',
            },
          },
          (progress) => {
            const percent =
              10 + (progress.totalBytesSent / progress.totalBytesExpectedToSend) * 75;
            updateUploadState(uploadId, { progress: percent });
          }
        );

        uploadTasksRef.current.set(uploadId, uploadTask);
        const uploadResult = await uploadTask.uploadAsync();
        uploadTasksRef.current.delete(uploadId);

        if (!uploadResult || uploadResult.status >= 400) {
          throw new Error('Upload failed');
        }

        // Complete upload
        updateUploadState(uploadId, { status: 'processing', progress: 90 });

        const completeResponse = await apiClient.post<{
          slotClipId: string;
          jobId?: string | null;
          voiceoverJobId?: string | null;
        }>(
          '/uploads/complete',
          {
            type: 'slot_clip',
            episodeId,
            key,
            slotId: input.slotId,
            slotType: input.slotType,
            source: input.source,
            duration: input.duration,
            width: input.width,
            height: input.height,
            fps: input.fps,
          },
          {
            timeout: 60000, // 60 seconds - upload completion may take longer due to job queueing
          }
        );

        updateUploadState(uploadId, {
          status: 'completed',
          progress: 100,
          slotClipId: completeResponse.data.slotClipId,
        });

        triggerHaptic('success');

        return {
          ...initialState,
          status: 'completed',
          progress: 100,
          key,
          slotClipId: completeResponse.data.slotClipId,
        };
      } catch (error) {
        console.error(`Slot upload failed for ${input.slotId}:`, error);
        updateUploadState(uploadId, {
          status: 'failed',
          error: error instanceof Error ? error.message : 'Upload failed',
        });
        triggerHaptic('error');
        return null;
      }
    },
    [apiClient, episodeId, addUpload, updateUploadState]
  );

  /**
   * Upload multiple slot clips for a single slot (e.g., multiple B-roll clips)
   */
  const uploadMultipleClips = useCallback(
    async (inputs: SlotUploadInput[]): Promise<(SlotUploadState | null)[]> => {
      setIsUploading(true);

      const results: (SlotUploadState | null)[] = [];
      for (const input of inputs) {
        const result = await uploadSlotClip(input);
        results.push(result);
      }

      setIsUploading(false);
      return results;
    },
    [uploadSlotClip]
  );

  /**
   * Cancel an ongoing upload
   */
  const cancelUpload = useCallback(
    (uploadId: string) => {
      const task = uploadTasksRef.current.get(uploadId);
      if (task) {
        task.cancelAsync();
        uploadTasksRef.current.delete(uploadId);
      }

      updateUploadState(uploadId, {
        status: 'failed',
        error: 'Upload cancelled',
      });

      triggerHaptic('warning');
    },
    [updateUploadState]
  );

  /**
   * Remove upload from state
   */
  const removeUploadState = useCallback(
    (uploadId: string) => {
      setUploads((prev) => prev.filter((u) => u.id !== uploadId));
      removeUpload(uploadId);
    },
    [removeUpload]
  );

  /**
   * Get uploads for a specific slot
   */
  const getSlotUploads = useCallback(
    (slotId: string) => {
      return uploads.filter((u) => u.slotId === slotId);
    },
    [uploads]
  );

  /**
   * Clear completed uploads
   */
  const clearCompleted = useCallback(() => {
    setUploads((prev) => prev.filter((u) => u.status !== 'completed'));
  }, []);

  // Computed values
  const hasFailedUploads = uploads.some((u) => u.status === 'failed');
  const allUploadsComplete =
    uploads.length > 0 && uploads.every((u) => u.status === 'completed');
  const pendingCount = uploads.filter((u) => u.status === 'pending').length;
  const uploadingCount = uploads.filter((u) => u.status === 'uploading').length;

  return {
    uploads,
    uploadSlotClip,
    uploadMultipleClips,
    cancelUpload,
    removeUploadState,
    getSlotUploads,
    clearCompleted,
    isUploading,
    hasFailedUploads,
    allUploadsComplete,
    pendingCount,
    uploadingCount,
  };
}

export default useSlotUpload;
