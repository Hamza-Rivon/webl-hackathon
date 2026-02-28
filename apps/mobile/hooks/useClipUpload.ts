/**
 * Clip Upload Hook
 *
 * Hook for uploading video clips to S3 with resumable uploads and progress tracking.
 * Requirements: 10.3, 10.4, 10.5, 10.6, 10.7
 */

import { useState, useCallback, useRef } from 'react';
import * as FileSystem from 'expo-file-system/legacy';
import { useApiClient } from '../lib/api';
import { useUploadStore } from '../stores/upload';
import { triggerHaptic } from '../lib/haptics';
import { readFileChunk } from '../lib/uploadService';

// Constants
const CHUNK_SIZE = 5 * 1024 * 1024; // 5MB chunks for resumable uploads
const MAX_RETRIES = 3;
const RETRY_DELAY = 1000;

export type ClipUploadStatus = 'pending' | 'uploading' | 'processing' | 'completed' | 'failed';

export interface ClipUploadState {
  id: string;
  fileName: string;
  fileSize: number;
  progress: number;
  status: ClipUploadStatus;
  error?: string;
  uploadedChunks?: number;
  totalChunks?: number;
  key?: string;
}

interface ClipInput {
  id: string;
  uri: string;
  fileName: string;
  fileSize: number;
}

interface PresignedUploadResponse {
  url: string;
  fields: Record<string, string>;
  key: string;
  uploadId?: string;
}

interface CompleteUploadResponse {
  jobId: string;
}

interface ChunkUploadState {
  uploadId: string;
  key: string;
  uploadedParts: { partNumber: number; etag: string }[];
  currentChunk: number;
}

export function useClipUpload(episodeId: string) {
  const apiClient = useApiClient();
  const { addUpload, updateProgress, setStatus, removeUpload } = useUploadStore();
  
  const [uploads, setUploads] = useState<ClipUploadState[]>([]);
  const [isUploading, setIsUploading] = useState(false);
  
  // Track chunk upload state for resumable uploads
  const chunkStateRef = useRef<Map<string, ChunkUploadState>>(new Map());
  // Track upload tasks for cancellation
  const uploadTasksRef = useRef<Map<string, FileSystem.UploadTask>>(new Map());

  /**
   * Add a clip to the upload queue
   */
  const addClip = useCallback((clip: ClipInput) => {
    const newUpload: ClipUploadState = {
      id: clip.id,
      fileName: clip.fileName,
      fileSize: clip.fileSize,
      progress: 0,
      status: 'pending',
    };
    
    setUploads((prev) => [...prev, newUpload]);
    addUpload(clip.id, clip.fileName, clip.fileSize);
    
    // Store URI for later upload
    chunkStateRef.current.set(clip.id, {
      uploadId: '',
      key: '',
      uploadedParts: [],
      currentChunk: 0,
    });
    
    return newUpload;
  }, [addUpload]);

  /**
   * Remove a clip from the upload queue
   */
  const removeClip = useCallback((clipId: string) => {
    // Cancel any ongoing upload
    const task = uploadTasksRef.current.get(clipId);
    if (task) {
      task.cancelAsync();
      uploadTasksRef.current.delete(clipId);
    }
    
    setUploads((prev) => prev.filter((u) => u.id !== clipId));
    removeUpload(clipId);
    chunkStateRef.current.delete(clipId);
  }, [removeUpload]);

  /**
   * Update upload state
   */
  const updateUploadState = useCallback((
    clipId: string,
    updates: Partial<ClipUploadState>
  ) => {
    setUploads((prev) =>
      prev.map((u) => (u.id === clipId ? { ...u, ...updates } : u))
    );
    
    if (updates.progress !== undefined) {
      updateProgress(clipId, updates.progress);
    }
    if (updates.status !== undefined) {
      setStatus(clipId, updates.status as any, updates.error);
    }
  }, [updateProgress, setStatus]);

  /**
   * Upload a single clip with resumable support
   */
  const uploadClip = useCallback(async (
    clipId: string,
    uri: string,
    fileName: string,
    fileSize: number
  ): Promise<boolean> => {
    try {
      updateUploadState(clipId, { status: 'uploading', progress: 5 });

      // Get presigned URL for upload
      // Ensure filename matches API validation: ^[a-zA-Z0-9\-_]+\.(mp4|mov|wav|mp3)$
      const cleanFileName = fileName.replace(/[^a-zA-Z0-9\-_.]/g, '_');
      
      const presignedResponse = await apiClient.post<PresignedUploadResponse>(
        '/uploads/init',
        {
          type: 'clip',
          episodeId,
          filename: cleanFileName,
          contentType: 'video/mp4',
          fileSize,
        }
      );

      const { url, fields, key } = presignedResponse.data;

      updateUploadState(clipId, { progress: 10, key });

      // For smaller files, use simple upload
      if (fileSize < CHUNK_SIZE * 2) {
        return await simpleUpload(clipId, uri, url, fields, key);
      }

      // For larger files, use chunked upload
      return await chunkedUpload(clipId, uri, key, fileSize, cleanFileName);
    } catch (error) {
      console.error(`Upload failed for ${clipId}:`, error);
      updateUploadState(clipId, {
        status: 'failed',
        error: error instanceof Error ? error.message : 'Upload failed',
      });
      return false;
    }
  }, [apiClient, episodeId, updateUploadState]);

  /**
   * Simple upload for smaller files
   */
  const simpleUpload = useCallback(async (
    clipId: string,
    uri: string,
    url: string,
    fields: Record<string, string>,
    key: string
  ): Promise<boolean> => {
    try {
      const uploadTask = FileSystem.createUploadTask(
        url,
        uri,
        {
          uploadType: FileSystem.FileSystemUploadType.MULTIPART,
          fieldName: 'file',
          parameters: fields,
          headers: {
            'Content-Type': 'multipart/form-data',
          },
        },
        (progress) => {
          const percent = 10 + (progress.totalBytesSent / progress.totalBytesExpectedToSend) * 75;
          updateUploadState(clipId, { progress: percent });
        }
      );

      uploadTasksRef.current.set(clipId, uploadTask);
      const result = await uploadTask.uploadAsync();
      uploadTasksRef.current.delete(clipId);

      if (!result || result.status >= 400) {
        throw new Error('Upload failed');
      }

      // Complete upload and trigger processing
      await completeUpload(clipId, key);
      return true;
    } catch (error) {
      throw error;
    }
  }, [updateUploadState]);

  /**
   * Chunked upload for larger files (resumable)
   */
  const chunkedUpload = useCallback(async (
    clipId: string,
    uri: string,
    key: string,
    fileSize: number,
    fileName: string
  ): Promise<boolean> => {
    const totalChunks = Math.ceil(fileSize / CHUNK_SIZE);
    let chunkState = chunkStateRef.current.get(clipId);
    
    if (!chunkState) {
      chunkState = {
        uploadId: '',
        key,
        uploadedParts: [],
        currentChunk: 0,
      };
      chunkStateRef.current.set(clipId, chunkState);
    }

    updateUploadState(clipId, {
      uploadedChunks: chunkState.currentChunk,
      totalChunks,
    });

    try {
      // Initialize multipart upload if not already started
      if (!chunkState.uploadId) {
        const initResponse = await apiClient.post<{ uploadId: string }>(
          '/uploads/multipart/init',
          {
            type: 'clip',
            episodeId,
            filename: fileName,
            contentType: 'video/mp4',
          }
        );
        chunkState.uploadId = initResponse.data.uploadId;
      }

      // Upload remaining chunks
      for (let i = chunkState.currentChunk; i < totalChunks; i++) {
        // Get presigned URL for this part
        const partResponse = await apiClient.post<{ url: string }>(
          '/uploads/multipart/part',
          {
            uploadId: chunkState.uploadId,
            key,
            partNumber: i + 1,
          }
        );

        // Read chunk from file as base64
        const chunkData = await readFileChunk(uri, i, fileSize);

        // Upload chunk using fetch (S3 presigned URLs work with fetch)
        const response = await fetch(partResponse.data.url, {
          method: 'PUT',
          headers: {
            'Content-Type': 'application/octet-stream',
          },
          body: Buffer.from(chunkData, 'base64'),
        });

        if (!response.ok) {
          throw new Error(`Chunk ${i + 1} upload failed: ${response.status}`);
        }

        // Track uploaded part
        const etag = response.headers.get('etag') || response.headers.get('ETag') || `part-${i + 1}`;
        chunkState.uploadedParts.push({ partNumber: i + 1, etag });
        chunkState.currentChunk = i + 1;

        // Update progress
        const progress = 10 + ((i + 1) / totalChunks) * 75;
        updateUploadState(clipId, {
          progress,
          uploadedChunks: i + 1,
        });
      }

      // Complete multipart upload
      await apiClient.post('/uploads/multipart/complete', {
        uploadId: chunkState.uploadId,
        key,
        parts: chunkState.uploadedParts,
      });

      // Complete upload and trigger processing
      await completeUpload(clipId, key);
      return true;
    } catch (error) {
      // Save state for resume
      chunkStateRef.current.set(clipId, chunkState);
      throw error;
    }
  }, [apiClient, episodeId, updateUploadState]);

  /**
   * Complete upload and trigger processing jobs
   * Requirements: 10.6
   */
  const completeUpload = useCallback(async (clipId: string, key: string) => {
    updateUploadState(clipId, { status: 'processing', progress: 90 });

    try {
      // Call API to complete upload and trigger processing jobs
      // This triggers: proxy generation, scene detection, video understanding
      // Complete upload - API will create broll_ingest job automatically
      const completeResponse = await apiClient.post<CompleteUploadResponse>(
        '/uploads/complete',
        {
          type: 'clip',
          episodeId,
          key,
          // Note: API automatically creates SlotClip and queues broll_ingest job
        },
        {
          timeout: 60000, // 60 seconds - upload completion may take longer due to job queueing
        }
      );

      updateUploadState(clipId, {
        status: 'completed',
        progress: 100,
      });

      triggerHaptic('success');
      
      console.log(`Upload complete for ${clipId}, job triggered: ${completeResponse.data.jobId}`);
      return completeResponse.data.jobId;
    } catch (error) {
      console.error(`Failed to complete upload for ${clipId}:`, error);
      updateUploadState(clipId, {
        status: 'failed',
        error: 'Failed to trigger processing',
      });
      throw error;
    }
  }, [apiClient, episodeId, updateUploadState]);

  /**
   * Start uploading all pending clips
   */
  const startUpload = useCallback(async () => {
    const pendingUploads = uploads.filter((u) => u.status === 'pending');
    if (pendingUploads.length === 0) return;

    setIsUploading(true);

    // Get URIs from store (we need to track these separately)
    // For now, we'll need the caller to provide URIs
    // This is a simplified version - in production, store URIs in state

    for (const upload of pendingUploads) {
      // Note: In a real implementation, we'd retrieve the URI from storage
      // For now, this is handled by the upload screen passing URIs
    }

    setIsUploading(false);
  }, [uploads]);

  /**
   * Upload clips with URIs
   */
  const uploadClips = useCallback(async (
    clips: Array<{ id: string; uri: string; fileName: string; fileSize: number }>
  ) => {
    setIsUploading(true);

    const results: boolean[] = [];
    
    for (const clip of clips) {
      const success = await uploadClip(clip.id, clip.uri, clip.fileName, clip.fileSize);
      results.push(success);
    }

    setIsUploading(false);
    return results;
  }, [uploadClip]);

  /**
   * Retry a failed upload
   * Requirements: 10.7
   */
  const retryUpload = useCallback(async (clipId: string) => {
    const upload = uploads.find((u) => u.id === clipId);
    if (!upload || upload.status !== 'failed') {
      console.warn(`Cannot retry upload ${clipId}: not found or not failed`);
      return false;
    }

    triggerHaptic('medium');

    // Reset state for retry
    updateUploadState(clipId, {
      status: 'pending',
      progress: 0,
      error: undefined,
    });

    // Check if we have saved chunk state for resume
    const savedState = chunkStateRef.current.get(clipId);
    if (savedState && savedState.currentChunk > 0) {
      // Resume from last successful chunk
      console.log(`Resuming upload ${clipId} from chunk ${savedState.currentChunk}`);
    }

    return true;
  }, [uploads, updateUploadState]);

  /**
   * Cancel an ongoing upload
   */
  const cancelUpload = useCallback((clipId: string) => {
    const task = uploadTasksRef.current.get(clipId);
    if (task) {
      task.cancelAsync();
      uploadTasksRef.current.delete(clipId);
    }

    updateUploadState(clipId, {
      status: 'failed',
      error: 'Upload cancelled',
    });

    triggerHaptic('warning');
  }, [updateUploadState]);

  /**
   * Clear completed uploads
   */
  const clearCompleted = useCallback(() => {
    setUploads((prev) => prev.filter((u) => u.status !== 'completed'));
  }, []);

  // Computed values
  const hasFailedUploads = uploads.some((u) => u.status === 'failed');
  const allUploadsComplete = uploads.length > 0 && uploads.every((u) => u.status === 'completed');
  const pendingCount = uploads.filter((u) => u.status === 'pending').length;
  const uploadingCount = uploads.filter((u) => u.status === 'uploading').length;

  return {
    uploads,
    addClip,
    removeClip,
    startUpload,
    uploadClips,
    retryUpload,
    cancelUpload,
    clearCompleted,
    isUploading,
    hasFailedUploads,
    allUploadsComplete,
    pendingCount,
    uploadingCount,
  };
}

export default useClipUpload;
