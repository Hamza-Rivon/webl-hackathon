/**
 * File Validation Utilities
 *
 * Validates video files for format, size, and other constraints.
 * Requirements: 10.5
 */

import * as FileSystem from 'expo-file-system/legacy';

// Validation constants
export const VIDEO_VALIDATION_CONFIG = {
  maxFileSizeMB: 500,
  maxFileSizeBytes: 500 * 1024 * 1024,
  allowedFormats: ['mp4', 'mov', 'MP4', 'MOV'],
  allowedMimeTypes: ['video/mp4', 'video/quicktime', 'video/x-m4v'],
  minDurationSeconds: 1,
  maxDurationSeconds: 600, // 10 minutes
  minResolution: { width: 480, height: 480 },
  maxResolution: { width: 4096, height: 4096 },
};

export interface ValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
  fileInfo?: {
    size: number;
    sizeFormatted: string;
    extension: string;
    uri: string;
  };
}

export interface VideoMetadata {
  duration?: number;
  width?: number;
  height?: number;
  codec?: string;
  bitrate?: number;
}

/**
 * Validate a video file for upload
 */
export async function validateVideoFile(
  uri: string,
  fileName: string,
  metadata?: VideoMetadata
): Promise<ValidationResult> {
  const errors: string[] = [];
  const warnings: string[] = [];

  // 1. Validate file extension
  const extension = getFileExtension(fileName);
  if (!extension) {
    errors.push('File has no extension');
  } else if (!isAllowedFormat(extension)) {
    errors.push(
      `Invalid format "${extension}". Allowed formats: ${VIDEO_VALIDATION_CONFIG.allowedFormats.join(', ')}`
    );
  }

  // 2. Check file exists and get size
  let fileSize = 0;
  try {
    const fileInfo = await FileSystem.getInfoAsync(uri);
    
    if (!fileInfo.exists) {
      errors.push('File not found');
      return { valid: false, errors, warnings };
    }

    fileSize = fileInfo.size || 0;
  } catch (error) {
    errors.push('Could not read file information');
    return { valid: false, errors, warnings };
  }

  // 3. Validate file size
  if (fileSize === 0) {
    errors.push('File is empty');
  } else if (fileSize > VIDEO_VALIDATION_CONFIG.maxFileSizeBytes) {
    errors.push(
      `File too large (${formatBytes(fileSize)}). Maximum size: ${VIDEO_VALIDATION_CONFIG.maxFileSizeMB}MB`
    );
  } else if (fileSize > VIDEO_VALIDATION_CONFIG.maxFileSizeBytes * 0.8) {
    warnings.push(
      `Large file (${formatBytes(fileSize)}). Upload may take a while.`
    );
  }

  // 4. Validate duration if available
  if (metadata?.duration !== undefined) {
    if (metadata.duration < VIDEO_VALIDATION_CONFIG.minDurationSeconds) {
      errors.push(
        `Video too short (${metadata.duration}s). Minimum duration: ${VIDEO_VALIDATION_CONFIG.minDurationSeconds}s`
      );
    } else if (metadata.duration > VIDEO_VALIDATION_CONFIG.maxDurationSeconds) {
      errors.push(
        `Video too long (${formatDuration(metadata.duration)}). Maximum duration: ${formatDuration(VIDEO_VALIDATION_CONFIG.maxDurationSeconds)}`
      );
    }
  }

  // 5. Validate resolution if available
  if (metadata?.width !== undefined && metadata?.height !== undefined) {
    const { width, height } = metadata;
    const { minResolution, maxResolution } = VIDEO_VALIDATION_CONFIG;

    if (width < minResolution.width || height < minResolution.height) {
      warnings.push(
        `Low resolution (${width}x${height}). Recommended minimum: ${minResolution.width}x${minResolution.height}`
      );
    }

    if (width > maxResolution.width || height > maxResolution.height) {
      warnings.push(
        `High resolution (${width}x${height}). Video will be processed at lower resolution.`
      );
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
    fileInfo: {
      size: fileSize,
      sizeFormatted: formatBytes(fileSize),
      extension: extension || 'unknown',
      uri,
    },
  };
}

/**
 * Validate multiple files at once
 */
export async function validateMultipleFiles(
  files: Array<{ uri: string; fileName: string; metadata?: VideoMetadata }>
): Promise<{
  validFiles: Array<{ uri: string; fileName: string; fileInfo: ValidationResult['fileInfo'] }>;
  invalidFiles: Array<{ uri: string; fileName: string; errors: string[] }>;
  warnings: string[];
}> {
  const validFiles: Array<{ uri: string; fileName: string; fileInfo: ValidationResult['fileInfo'] }> = [];
  const invalidFiles: Array<{ uri: string; fileName: string; errors: string[] }> = [];
  const allWarnings: string[] = [];

  for (const file of files) {
    const result = await validateVideoFile(file.uri, file.fileName, file.metadata);
    
    if (result.valid && result.fileInfo) {
      validFiles.push({
        uri: file.uri,
        fileName: file.fileName,
        fileInfo: result.fileInfo,
      });
      allWarnings.push(...result.warnings.map((w) => `${file.fileName}: ${w}`));
    } else {
      invalidFiles.push({
        uri: file.uri,
        fileName: file.fileName,
        errors: result.errors,
      });
    }
  }

  return { validFiles, invalidFiles, warnings: allWarnings };
}

/**
 * Check if file format is allowed
 */
export function isAllowedFormat(extension: string): boolean {
  return VIDEO_VALIDATION_CONFIG.allowedFormats
    .map((f) => f.toLowerCase())
    .includes(extension.toLowerCase());
}

/**
 * Check if MIME type is allowed
 */
export function isAllowedMimeType(mimeType: string): boolean {
  return VIDEO_VALIDATION_CONFIG.allowedMimeTypes.includes(mimeType.toLowerCase());
}

/**
 * Get file extension from filename
 */
export function getFileExtension(fileName: string): string | null {
  const parts = fileName.split('.');
  if (parts.length < 2) return null;
  return parts.pop() || null;
}

/**
 * Format bytes to human readable string
 */
export function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  
  const units = ['B', 'KB', 'MB', 'GB'];
  const k = 1024;
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${units[i]}`;
}

/**
 * Format duration in seconds to human readable string
 */
export function formatDuration(seconds: number): string {
  if (seconds < 60) {
    return `${Math.round(seconds)}s`;
  }
  
  const mins = Math.floor(seconds / 60);
  const secs = Math.round(seconds % 60);
  
  if (mins < 60) {
    return secs > 0 ? `${mins}m ${secs}s` : `${mins}m`;
  }
  
  const hours = Math.floor(mins / 60);
  const remainingMins = mins % 60;
  
  return `${hours}h ${remainingMins}m`;
}

/**
 * Estimate upload time based on file size
 */
export function estimateUploadTime(
  fileSize: number,
  uploadSpeedMbps: number = 10
): string {
  const uploadSpeedBps = uploadSpeedMbps * 1024 * 1024 / 8; // Convert Mbps to bytes per second
  const seconds = Math.ceil(fileSize / uploadSpeedBps);
  
  return formatDuration(seconds);
}

/**
 * Get validation error message for display
 */
export function getValidationErrorMessage(errors: string[]): string {
  if (errors.length === 0) return '';
  if (errors.length === 1) return errors[0];
  return `${errors.length} issues found:\n• ${errors.join('\n• ')}`;
}

/**
 * Check if file needs chunked upload
 */
export function needsChunkedUpload(fileSize: number, chunkSize: number = 5 * 1024 * 1024): boolean {
  return fileSize > chunkSize * 2;
}

/**
 * Calculate number of chunks for a file
 */
export function calculateChunks(fileSize: number, chunkSize: number = 5 * 1024 * 1024): number {
  return Math.ceil(fileSize / chunkSize);
}
