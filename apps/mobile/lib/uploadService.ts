/**
 * Upload Service
 *
 * Handles resumable file uploads with chunking and progress tracking.
 * Requirements: 10.4
 */

import * as FileSystem from 'expo-file-system/legacy';

// Constants
const CHUNK_SIZE = 5 * 1024 * 1024; // 5MB chunks
const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 1000;
const UPLOAD_STATE_DIR = `${FileSystem.documentDirectory}upload_states/`;

export interface UploadChunkState {
  uploadId: string;
  key: string;
  totalChunks: number;
  uploadedParts: Array<{ partNumber: number; etag: string }>;
  currentChunk: number;
  fileUri: string;
  fileSize: number;
  fileName: string;
  episodeId: string;
}

export interface UploadProgressCallback {
  (progress: number, uploadedChunks: number, totalChunks: number): void;
}

/**
 * Ensure upload state directory exists
 */
async function ensureStateDir(): Promise<void> {
  const dirInfo = await FileSystem.getInfoAsync(UPLOAD_STATE_DIR);
  if (!dirInfo.exists) {
    await FileSystem.makeDirectoryAsync(UPLOAD_STATE_DIR, { intermediates: true });
  }
}

/**
 * Save upload state for resume capability
 */
export async function saveUploadState(
  clipId: string,
  state: UploadChunkState
): Promise<void> {
  try {
    await ensureStateDir();
    await FileSystem.writeAsStringAsync(
      `${UPLOAD_STATE_DIR}${clipId}.json`,
      JSON.stringify(state)
    );
  } catch (error) {
    console.error('Failed to save upload state:', error);
  }
}

/**
 * Load saved upload state for resume
 */
export async function loadUploadState(
  clipId: string
): Promise<UploadChunkState | null> {
  try {
    const filePath = `${UPLOAD_STATE_DIR}${clipId}.json`;
    const fileInfo = await FileSystem.getInfoAsync(filePath);
    if (fileInfo.exists) {
      const stateJson = await FileSystem.readAsStringAsync(filePath);
      return JSON.parse(stateJson);
    }
  } catch (error) {
    console.error('Failed to load upload state:', error);
  }
  return null;
}

/**
 * Clear saved upload state
 */
export async function clearUploadState(clipId: string): Promise<void> {
  try {
    const filePath = `${UPLOAD_STATE_DIR}${clipId}.json`;
    const fileInfo = await FileSystem.getInfoAsync(filePath);
    if (fileInfo.exists) {
      await FileSystem.deleteAsync(filePath, { idempotent: true });
    }
  } catch (error) {
    console.error('Failed to clear upload state:', error);
  }
}

/**
 * Get all pending upload states
 */
export async function getPendingUploads(): Promise<UploadChunkState[]> {
  try {
    await ensureStateDir();
    const files = await FileSystem.readDirectoryAsync(UPLOAD_STATE_DIR);
    const states: UploadChunkState[] = [];
    
    for (const file of files) {
      if (file.endsWith('.json')) {
        try {
          const content = await FileSystem.readAsStringAsync(`${UPLOAD_STATE_DIR}${file}`);
          states.push(JSON.parse(content));
        } catch (e) {
          // Skip invalid files
        }
      }
    }
    
    return states;
  } catch (error) {
    console.error('Failed to get pending uploads:', error);
    return [];
  }
}

/**
 * Calculate total chunks for a file
 */
export function calculateTotalChunks(fileSize: number): number {
  return Math.ceil(fileSize / CHUNK_SIZE);
}

/**
 * Read a chunk from a file
 */
export async function readFileChunk(
  uri: string,
  chunkIndex: number,
  fileSize: number
): Promise<string> {
  const start = chunkIndex * CHUNK_SIZE;
  const end = Math.min(start + CHUNK_SIZE, fileSize);
  const length = end - start;

  // Read chunk as base64
  const chunk = await FileSystem.readAsStringAsync(uri, {
    encoding: FileSystem.EncodingType.Base64,
    position: start,
    length,
  });

  return chunk;
}

/**
 * Upload a single chunk with retry logic
 */
export async function uploadChunk(
  url: string,
  chunkData: string,
  partNumber: number,
  retries = MAX_RETRIES
): Promise<{ etag: string }> {
  let lastError: Error | null = null;

  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      const response = await fetch(url, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/octet-stream',
        },
        body: Buffer.from(chunkData, 'base64'),
      });

      if (!response.ok) {
        throw new Error(`Chunk upload failed: ${response.status}`);
      }

      const etag = response.headers.get('etag') || `part-${partNumber}`;
      return { etag };
    } catch (error) {
      lastError = error instanceof Error ? error : new Error('Unknown error');
      
      if (attempt < retries - 1) {
        await delay(RETRY_DELAY_MS * Math.pow(2, attempt)); // Exponential backoff
      }
    }
  }

  throw lastError || new Error('Chunk upload failed after retries');
}

/**
 * Perform chunked upload with resume support
 */
export async function performChunkedUpload(
  clipId: string,
  uri: string,
  fileSize: number,
  fileName: string,
  episodeId: string,
  apiClient: {
    post: <T>(url: string, data: any) => Promise<{ data: T }>;
  },
  onProgress: UploadProgressCallback
): Promise<{ key: string; jobId: string }> {
  const totalChunks = calculateTotalChunks(fileSize);
  
  // Try to resume from saved state
  let state = await loadUploadState(clipId);
  
  if (!state) {
    // Initialize new multipart upload
    const initResponse = await apiClient.post<{ uploadId: string; key: string }>(
      '/uploads/multipart/init',
      {
        type: 'clip',
        episodeId,
        filename: fileName,
        contentType: 'video/mp4',
        fileSize,
      }
    );

    state = {
      uploadId: initResponse.data.uploadId,
      key: initResponse.data.key,
      totalChunks,
      uploadedParts: [],
      currentChunk: 0,
      fileUri: uri,
      fileSize,
      fileName,
      episodeId,
    };

    await saveUploadState(clipId, state);
  }

  // Upload remaining chunks
  for (let i = state.currentChunk; i < totalChunks; i++) {
    // Get presigned URL for this part
    const partResponse = await apiClient.post<{ url: string }>(
      '/uploads/multipart/part',
      {
        uploadId: state.uploadId,
        key: state.key,
        partNumber: i + 1,
      }
    );

    // Read and upload chunk
    const chunkData = await readFileChunk(uri, i, fileSize);
    const { etag } = await uploadChunk(partResponse.data.url, chunkData, i + 1);

    // Update state
    state.uploadedParts.push({ partNumber: i + 1, etag });
    state.currentChunk = i + 1;
    await saveUploadState(clipId, state);

    // Report progress
    const progress = ((i + 1) / totalChunks) * 100;
    onProgress(progress, i + 1, totalChunks);
  }

  // Complete multipart upload
  await apiClient.post('/uploads/multipart/complete', {
    uploadId: state.uploadId,
    key: state.key,
    parts: state.uploadedParts,
  });

  // Trigger processing
  const completeResponse = await apiClient.post<{ jobId: string }>(
    '/uploads/complete',
    {
      type: 'clip',
      episodeId,
      key: state.key,
    }
  );

  // Clear saved state
  await clearUploadState(clipId);

  return {
    key: state.key,
    jobId: completeResponse.data.jobId,
  };
}

/**
 * Simple upload for smaller files
 */
export async function performSimpleUpload(
  uri: string,
  url: string,
  fields: Record<string, string>,
  onProgress: (progress: number) => void
): Promise<void> {
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
      const percent = (progress.totalBytesSent / progress.totalBytesExpectedToSend) * 100;
      onProgress(percent);
    }
  );

  const result = await uploadTask.uploadAsync();

  if (!result || result.status >= 400) {
    throw new Error(`Upload failed with status: ${result?.status || 'unknown'}`);
  }
}

/**
 * Validate file before upload
 */
export interface FileValidationResult {
  valid: boolean;
  error?: string;
  fileSize?: number;
}

export async function validateFile(
  uri: string,
  fileName: string,
  maxSizeMB: number = 500,
  allowedFormats: string[] = ['mp4', 'mov']
): Promise<FileValidationResult> {
  // Check format
  const extension = fileName.split('.').pop()?.toLowerCase();
  if (!extension || !allowedFormats.map((f) => f.toLowerCase()).includes(extension)) {
    return {
      valid: false,
      error: `Invalid format. Allowed: ${allowedFormats.join(', ')}`,
    };
  }

  // Check file exists and get size
  try {
    const fileInfo = await FileSystem.getInfoAsync(uri);
    
    if (!fileInfo.exists) {
      return { valid: false, error: 'File not found' };
    }

    const maxSizeBytes = maxSizeMB * 1024 * 1024;
    if (fileInfo.size && fileInfo.size > maxSizeBytes) {
      return {
        valid: false,
        error: `File too large. Maximum size: ${maxSizeMB}MB`,
      };
    }

    return { valid: true, fileSize: fileInfo.size };
  } catch (error) {
    return {
      valid: false,
      error: 'Could not read file information',
    };
  }
}

/**
 * Utility: Delay function
 */
function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Utility: Format bytes to human readable
 */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

/**
 * Utility: Estimate upload time
 */
export function estimateUploadTime(
  fileSize: number,
  uploadSpeedBps: number = 5 * 1024 * 1024 // Default 5 Mbps
): number {
  return Math.ceil(fileSize / uploadSpeedBps);
}
