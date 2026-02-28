/**
 * Mux Video Service for Workers
 *
 * Handles Mux Video API operations including asset creation,
 * transcript retrieval, and subtitle generation.
 *
 * @see https://docs.mux.com/api-reference
 */

import Mux from '@mux/mux-node';
import { config } from '../config.js';
import { logger } from '@webl/shared';

// Initialize Mux client
const mux = new Mux({
  tokenId: config.mux.tokenId,
  tokenSecret: config.mux.tokenSecret,
});

// Export the raw client for advanced use cases
export { mux };

// ==================== TYPES ====================

export interface CreateAssetOptions {
  inputUrl: string;
  passthrough?: string;
  generateSubtitles?: boolean;
  language?: string;
}

export interface AssetInfo {
  id: string;
  status: string;
  playbackIds: Array<{ id: string; policy: string }>;
  duration?: number;
  aspectRatio?: string;
  maxResolution?: string;
  tracks?: Array<{
    id: string;
    type: string;
    maxWidth?: number;
    maxHeight?: number;
    duration?: number;
    languageCode?: string;
    textType?: string;
    status?: string;
    textSource?: string;
  }>;
}

export interface TranscriptWord {
  start: number;
  end: number;
  word: string;
}

export interface TranscriptSegment {
  start: number;
  end: number;
  text: string;
  words?: TranscriptWord[];
}

export interface Transcript {
  language: string;
  segments: TranscriptSegment[];
}

// ==================== MUX SERVICE ====================

export const muxService = {
  /**
   * Create a new video asset from an S3 signed URL
   * Auto-generates subtitles using Mux ASR
   */
  async createAssetFromUrl(options: CreateAssetOptions): Promise<AssetInfo> {
    const { inputUrl, passthrough, generateSubtitles = true, language = 'en' } = options;

    const inputConfig: Mux.Video.AssetCreateParams.Input = {
      url: inputUrl,
    };

    // Add generated subtitles configuration if requested
    if (generateSubtitles) {
      inputConfig.generated_subtitles = [
        {
          language_code: language as 'en',
          name: 'English',
        },
      ];
    }

    const createParams: Mux.Video.AssetCreateParams & {
      static_renditions?: Array<{ resolution: string }>;
    } = {
      input: [inputConfig],
      playback_policy: ['public'],
      video_quality: 'basic',
      // Enable static MP4 renditions for Remotion rendering
      // Static renditions work better with FFmpeg and don't require HTTPS protocol support
      // Note: static_renditions is supported by Mux API but not in TypeScript types yet
      static_renditions: [{ resolution: 'highest' }],
      ...(passthrough && { passthrough }),
    };

    const maxAttempts = 6;
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      try {
        const asset = await mux.video.assets.create(createParams);

        logger.info(`Mux asset created: ${asset.id}`, { passthrough });
        return mapAssetToInfo(asset);
      } catch (error) {
        const retryable = isRetryableMuxCreateError(error);
        if (!retryable || attempt >= maxAttempts) {
          logger.error('Failed to create Mux asset:', error);
          throw error;
        }

        const delayMs = getMuxCreateRetryDelayMs(error, attempt);
        logger.warn(
          `Mux create asset failed (attempt ${attempt}/${maxAttempts}), retrying in ${delayMs}ms`,
          { passthrough }
        );
        await sleep(delayMs);
      }
    }

    throw new Error('Unexpected Mux create asset retry flow');
  },

  /**
   * Retrieve asset information by ID
   */
  async getAsset(assetId: string): Promise<AssetInfo> {
    try {
      const asset = await mux.video.assets.retrieve(assetId);
      return mapAssetToInfo(asset);
    } catch (error) {
      logger.error(`Failed to get Mux asset ${assetId}:`, error);
      throw error;
    }
  },

  /**
   * Poll for asset to become ready
   * @param assetId - Mux asset ID
   * @param maxAttempts - Maximum polling attempts (default: 60)
   * @param intervalMs - Polling interval in ms (default: 5000)
   */
  async waitForAssetReady(
    assetId: string,
    maxAttempts = 60,
    intervalMs = 5000
  ): Promise<AssetInfo> {
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      const asset = await this.getAsset(assetId);

      if (asset.status === 'ready') {
        logger.info(`Mux asset ${assetId} is ready`);
        return asset;
      }

      if (asset.status === 'errored') {
        throw new Error(`Mux asset ${assetId} errored during processing`);
      }

      logger.debug(`Mux asset ${assetId} status: ${asset.status}, attempt ${attempt + 1}/${maxAttempts}`);
      await sleep(intervalMs);
    }

    throw new Error(`Timeout waiting for Mux asset ${assetId} to become ready`);
  },

  /**
   * Wait for text track (subtitles) to become ready
   */
  async waitForSubtitlesReady(
    assetId: string,
    maxAttempts = 30,
    intervalMs = 5000
  ): Promise<string | null> {
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      const asset = await this.getAsset(assetId);
      
      const textTrack = asset.tracks?.find(
        (t) => t.type === 'text' && t.textType === 'subtitles'
      );

      if (textTrack?.status === 'ready') {
        logger.info(`Mux asset ${assetId} subtitles ready, track ID: ${textTrack.id}`);
        return textTrack.id;
      }

      if (textTrack?.status === 'errored') {
        logger.warn(`Mux asset ${assetId} subtitle generation errored`);
        return null;
      }

      logger.debug(`Waiting for subtitles on asset ${assetId}, attempt ${attempt + 1}/${maxAttempts}`);
      await sleep(intervalMs);
    }

    logger.warn(`Timeout waiting for subtitles on asset ${assetId}`);
    return null;
  },

  /**
   * Get transcript from a Mux asset
   * Fetches the WebVTT transcript and parses it into structured format
   * 
   * Mux provides transcripts in these formats:
   * - .vtt (WebVTT with timestamps) - used for structured parsing
   * - .txt (plain text) - no timestamps
   */
  async getTranscript(playbackId: string, trackId: string): Promise<Transcript | null> {
    try {
      // Fetch the WebVTT transcript directly from Mux (consistent with voiceoverTranscript.ts)
      const vttUrl = `https://stream.mux.com/${playbackId}/text/${trackId}.vtt`;
      const response = await fetch(vttUrl);
      
      if (!response.ok) {
        logger.warn(`Failed to fetch VTT transcript: ${response.status} ${response.statusText}`);
        return null;
      }

      const vttContent = await response.text();
      return parseVttToTranscript(vttContent);
    } catch (error) {
      logger.error(`Failed to get transcript for ${playbackId}:`, error);
      return null;
    }
  },

  /**
   * Generate subtitles for an asset after creation
   */
  async generateSubtitles(assetId: string, trackId: string, language = 'en'): Promise<void> {
    try {
      await mux.video.assets.generateSubtitles(assetId, trackId, {
        generated_subtitles: [
          {
            language_code: language as 'en',
            name: 'English',
          },
        ],
      });
      logger.info(`Subtitle generation triggered for asset ${assetId}`);
    } catch (error) {
      logger.error(`Failed to generate subtitles for asset ${assetId}:`, error);
      throw error;
    }
  },

  /**
   * Get the primary playback ID for an asset
   */
  async getPlaybackId(assetId: string): Promise<string | null> {
    const asset = await this.getAsset(assetId);
    return asset.playbackIds?.[0]?.id ?? null;
  },

  /**
   * Create a clip from an existing Mux asset
   * Uses Mux's clip creation API with start_time and end_time
   * 
   * @param sourceAssetId - The source Mux asset ID to create clip from
   * @param startTime - Start time in seconds
   * @param endTime - End time in seconds
   * @param passthrough - Optional passthrough metadata
   * @returns The newly created asset info
   */
  async createClipFromAsset(
    sourceAssetId: string,
    startTime: number,
    endTime: number,
    passthrough?: string
  ): Promise<AssetInfo> {
    try {
      logger.info(`Creating Mux clip from asset ${sourceAssetId}`, {
        startTime,
        endTime,
        duration: endTime - startTime,
      });

      const createParams: Mux.Video.AssetCreateParams = {
        input: [
          {
            url: `mux://assets/${sourceAssetId}`,
            start_time: startTime,
            end_time: endTime,
          },
        ],
        playback_policy: ['public'],
        video_quality: 'basic',
        ...(passthrough && { passthrough }),
      };

      const asset = await mux.video.assets.create(createParams);

      logger.info(`Mux clip asset created: ${asset.id}`, {
        sourceAssetId,
        startTime,
        endTime,
        passthrough,
      });

      return mapAssetToInfo(asset);
    } catch (error) {
      logger.error(`Failed to create Mux clip from asset ${sourceAssetId}:`, error);
      throw error;
    }
  },

  /**
   * @deprecated Mux does NOT support composing multiple video clips into one asset.
   * Additional inputs must be overlay images, text tracks, or audio tracks.
   * 
   * For multi-clip video composition, use one of these approaches:
   * - Use Remotion for server-side video composition
   * - Return individual segments for client-side sequential playback
   * - Create clips individually and stitch client-side
   * 
   * This function will throw an error to prevent misuse.
   * 
   * @see https://docs.mux.com/api-reference/video#operation/create-asset
   */
  async createComposedClip(
    _inputs: Array<{
      assetId: string;
      startTime: number;
      endTime: number;
    }>,
    _passthrough?: string
  ): Promise<AssetInfo> {
    throw new Error(
      'createComposedClip is not supported by Mux. ' +
      'Mux only allows one video input per asset - additional inputs must be overlays, text tracks, or audio. ' +
      'Use Remotion for server-side video composition or return segments for client-side sequential playback.'
    );
  },

  /**
   * Wait for an asset to be ready and return its playback ID
   * Combines waitForAssetReady and getPlaybackId for convenience
   * 
   * @param assetId - Mux asset ID
   * @param maxAttempts - Maximum polling attempts
   * @param intervalMs - Polling interval in ms
   * @returns The playback ID once asset is ready
   */
  async waitForAssetAndGetPlaybackId(
    assetId: string,
    maxAttempts = 60,
    intervalMs = 3000
  ): Promise<string> {
    const asset = await this.waitForAssetReady(assetId, maxAttempts, intervalMs);
    const playbackId = asset.playbackIds?.[0]?.id;
    
    if (!playbackId) {
      throw new Error(`Asset ${assetId} is ready but has no playback ID`);
    }
    
    return playbackId;
  },

  /**
   * Delete a Mux asset
   */
  async deleteAsset(assetId: string): Promise<void> {
    try {
      await mux.video.assets.delete(assetId);
      logger.info(`Mux asset deleted: ${assetId}`);
    } catch (error) {
      logger.error(`Failed to delete Mux asset ${assetId}:`, error);
      throw error;
    }
  },

  /**
   * Get HLS playback URL
   */
  getPlaybackUrl(playbackId: string): string {
    return `https://stream.mux.com/${playbackId}.m3u8`;
  },

  /**
   * Get thumbnail URL
   */
  getThumbnailUrl(
    playbackId: string,
    options: { time?: number; width?: number; format?: 'jpg' | 'png' } = {}
  ): string {
    const { time = 0, width = 640, format = 'jpg' } = options;
    const params = new URLSearchParams({
      time: time.toString(),
      width: width.toString(),
    });
    return `https://image.mux.com/${playbackId}/thumbnail.${format}?${params}`;
  },

  /**
   * Get animated GIF URL
   */
  getAnimatedUrl(
    playbackId: string,
    options: { start?: number; end?: number; width?: number; fps?: number } = {}
  ): string {
    const { start = 0, end = 5, width = 320, fps = 15 } = options;
    const params = new URLSearchParams({
      start: start.toString(),
      end: end.toString(),
      width: width.toString(),
      fps: fps.toString(),
    });
    return `https://image.mux.com/${playbackId}/animated.gif?${params}`;
  },

  /**
   * Check if asset is ready
   */
  isAssetReady(status: string): boolean {
    return status === 'ready';
  },

  /**
   * Check if asset has errored
   */
  isAssetErrored(status: string): boolean {
    return status === 'errored';
  },

  /**
   * Ensure static renditions exist for an asset
   * Creates a static rendition if it doesn't exist
   * 
   * @param assetId - Mux asset ID
   * @param resolution - Resolution for static rendition (default: 'highest')
   * @returns Promise that resolves when static rendition is created (may be in 'preparing' status)
   */
  async ensureStaticRendition(
    assetId: string,
    resolution: 'highest' | '1080p' | '720p' = 'highest'
  ): Promise<void> {
    try {
      // Check if asset already has static renditions
      const asset = await mux.video.assets.retrieve(assetId);
      
      // Check if static renditions exist and are ready
      const staticRenditions = (asset as any).static_renditions;
      const hasReadyRenditions = staticRenditions?.files?.some(
        (f: any) => f.status === 'ready' && f.name?.includes('.mp4')
      );

      if (hasReadyRenditions) {
        logger.info(`Asset ${assetId} already has ready static renditions`);
        return;
      }

      // Create static rendition using direct API call
      // The Mux SDK doesn't expose this method, so we use the underlying HTTP client
      logger.info(`Creating static rendition for asset ${assetId} with resolution ${resolution}`);
      
      const response = await fetch(
        `https://api.mux.com/video/v1/assets/${assetId}/static_renditions`,
        {
          method: 'POST',
          headers: {
            'Authorization': `Basic ${Buffer.from(`${config.mux.tokenId}:${config.mux.tokenSecret}`).toString('base64')}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ resolution }),
        }
      );

      if (!response.ok) {
        const errorText = await response.text();
        // If static rendition already exists or is being created, that's fine
        if (response.status === 409 || errorText.includes('already exists')) {
          logger.info(`Static rendition already exists or is being prepared for asset ${assetId}`);
          return;
        }
        // Handle 404 - asset not found (may have been deleted or never existed)
        if (response.status === 404) {
          logger.warn(`Asset ${assetId} not found (404) - cannot create static rendition. This may be a deleted asset.`);
          throw new Error(`Asset not found: ${assetId}`);
        }
        throw new Error(`Failed to create static rendition: ${response.status} ${errorText}`);
      }

      const result = await response.json() as { data?: { id?: string; status?: string } };
      logger.info(`Static rendition creation initiated for asset ${assetId}`, {
        renditionId: result.data?.id,
        status: result.data?.status,
      });
    } catch (error: any) {
      // If asset not found, log warning but don't throw - allow rendering to continue
      if (error.message?.includes('not found') || error.message?.includes('404')) {
        logger.warn(`Asset ${assetId} not found - skipping static rendition creation`);
        return;
      }
      logger.error(`Failed to create static rendition for asset ${assetId}:`, error);
      throw error;
    }
  },

  /**
   * Wait for static rendition to be ready
   * Polls Mux API until static rendition status is 'ready'
   * 
   * @param assetId - Mux asset ID
   * @param resolution - Resolution for static rendition (default: 'highest')
   * @param maxAttempts - Maximum number of polling attempts (default: 60)
   * @param intervalMs - Polling interval in milliseconds (default: 5000)
   * @returns Promise that resolves when static rendition is ready, or rejects if timeout
   */
  async waitForStaticRendition(
    assetId: string,
    resolution: 'highest' | '1080p' | '720p' = 'highest',
    maxAttempts: number = 60,
    intervalMs: number = 5000
  ): Promise<{ status: string; files?: Array<{ name?: string; status?: string }> }> {
    // First ensure static rendition exists (may fail gracefully if asset not found)
    try {
      await this.ensureStaticRendition(assetId, resolution);
    } catch (error: any) {
      // If asset not found, throw immediately instead of polling
      if (error.message?.includes('not found') || error.message?.includes('404')) {
        throw new Error(`Asset ${assetId} not found - cannot wait for static rendition`);
      }
      // Re-throw other errors
      throw error;
    }

    logger.info(
      `Waiting for static rendition to be ready for asset ${assetId} ` +
      `(max ${maxAttempts} attempts, ${intervalMs}ms interval)`
    );

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        const asset = await mux.video.assets.retrieve(assetId);
        const staticRenditions = (asset as any).static_renditions;

        if (staticRenditions) {
          // Check if any MP4 file is ready
          const readyFiles = staticRenditions.files?.filter(
            (f: any) => f.status === 'ready' && f.name?.includes('.mp4')
          );

          if (readyFiles && readyFiles.length > 0) {
            logger.info(
              `Static rendition ready for asset ${assetId} after ${attempt} attempts ` +
              `(${readyFiles.length} ready files)`
            );
            return staticRenditions;
          }

          // Check if any file is preparing
          const preparingFiles = staticRenditions.files?.filter(
            (f: any) => f.status === 'preparing'
          );

          if (preparingFiles && preparingFiles.length > 0) {
            logger.debug(
              `Static rendition still preparing for asset ${assetId} ` +
              `(attempt ${attempt}/${maxAttempts})`
            );
          } else {
            // No files in preparing state - might be ready or errored
            logger.debug(
              `Static rendition status unclear for asset ${assetId} ` +
              `(attempt ${attempt}/${maxAttempts})`
            );
          }
        } else {
          logger.debug(
            `Static renditions not yet available for asset ${assetId} ` +
            `(attempt ${attempt}/${maxAttempts})`
          );
        }

        // Wait before next attempt (except on last attempt)
        if (attempt < maxAttempts) {
          await sleep(intervalMs);
        }
      } catch (error: any) {
        logger.warn(
          `Error checking static rendition status for asset ${assetId} ` +
          `(attempt ${attempt}/${maxAttempts}): ${error.message}`
        );
        
        // Wait before retry (except on last attempt)
        if (attempt < maxAttempts) {
          await sleep(intervalMs);
        }
      }
    }

    // Timeout - check final status
    const asset = await mux.video.assets.retrieve(assetId);
    const staticRenditions = (asset as any).static_renditions;

    if (staticRenditions?.files?.some((f: any) => f.status === 'ready' && f.name?.includes('.mp4'))) {
      logger.warn(
        `Static rendition became ready for asset ${assetId} after timeout ` +
        `(but returning success)`
      );
      return staticRenditions;
    }

    throw new Error(
      `Static rendition not ready for asset ${assetId} after ${maxAttempts} attempts ` +
      `(${(maxAttempts * intervalMs) / 1000}s timeout)`
    );
  },
};

// ==================== HELPERS ====================

function mapAssetToInfo(asset: Mux.Video.Asset): AssetInfo {
  return {
    id: asset.id,
    status: asset.status ?? 'unknown',
    playbackIds: (asset.playback_ids ?? []).map((p) => ({
      id: p.id ?? '',
      policy: p.policy ?? 'public',
    })),
    duration: asset.duration ?? undefined,
    aspectRatio: asset.aspect_ratio ?? undefined,
    maxResolution: asset.max_stored_resolution ?? undefined,
    tracks: asset.tracks?.map((t) => ({
      id: t.id ?? '',
      type: t.type ?? '',
      maxWidth: t.max_width ?? undefined,
      maxHeight: t.max_height ?? undefined,
      duration: t.duration ?? undefined,
      languageCode: t.language_code ?? undefined,
      textType: t.text_type ?? undefined,
      status: t.status ?? undefined,
      textSource: t.text_source ?? undefined,
    })),
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isRetryableMuxCreateError(error: unknown): boolean {
  const status = getMuxErrorStatus(error);
  if (status === 429) {
    return true;
  }
  if (status !== null && status >= 500) {
    return true;
  }
  const message = getMuxErrorMessage(error);
  return (
    message.includes('too many requests') ||
    message.includes('rate limit') ||
    message.includes('timed out') ||
    message.includes('network')
  );
}

function getMuxCreateRetryDelayMs(error: unknown, attempt: number): number {
  const retryAfterMs = getRetryAfterMs(error);
  if (retryAfterMs !== null) {
    return retryAfterMs;
  }
  const baseDelayMs = 3000;
  const exponentialDelay = baseDelayMs * Math.pow(2, Math.max(0, attempt - 1));
  const jitter = Math.floor(Math.random() * 1000);
  return Math.min(exponentialDelay + jitter, 120000);
}

function getMuxErrorStatus(error: unknown): number | null {
  if (
    typeof error === 'object' &&
    error !== null &&
    'status' in error &&
    typeof (error as { status?: unknown }).status === 'number'
  ) {
    return (error as { status: number }).status;
  }
  return null;
}

function getMuxErrorMessage(error: unknown): string {
  if (
    typeof error === 'object' &&
    error !== null &&
    'message' in error &&
    typeof (error as { message?: unknown }).message === 'string'
  ) {
    return (error as { message: string }).message.toLowerCase();
  }
  return '';
}

function getRetryAfterMs(error: unknown): number | null {
  if (typeof error !== 'object' || error === null || !('headers' in error)) {
    return null;
  }
  const headers = (error as { headers?: unknown }).headers;
  if (!headers || typeof headers !== 'object') {
    return null;
  }

  const retryAfterValue =
    typeof (headers as Record<string, unknown>)['retry-after'] === 'string'
      ? (headers as Record<string, string>)['retry-after']
      : typeof (headers as Record<string, unknown>)['Retry-After'] === 'string'
        ? (headers as Record<string, string>)['Retry-After']
        : null;

  if (!retryAfterValue) {
    return null;
  }

  const seconds = Number.parseInt(retryAfterValue, 10);
  if (Number.isFinite(seconds) && seconds > 0) {
    return seconds * 1000;
  }

  const dateMs = Date.parse(retryAfterValue);
  if (!Number.isNaN(dateMs)) {
    return Math.max(0, dateMs - Date.now());
  }

  return null;
}

/**
 * Parse VTT content into structured transcript
 */
function parseVttToTranscript(vttContent: string): Transcript {
  const lines = vttContent.split('\n');
  const segments: TranscriptSegment[] = [];
  
  let i = 0;
  // Skip WEBVTT header
  while (i < lines.length && !(lines[i] ?? '').includes('-->')) {
    i++;
  }

  while (i < lines.length) {
    const line = (lines[i] ?? '').trim();
    
    // Parse timestamp line
    if (line.includes('-->')) {
      const parts = line.split('-->').map((s) => s.trim());
      const startStr = parts[0] ?? '00:00:00.000';
      const endStr = parts[1] ?? '00:00:00.000';
      const start = parseVttTimestamp(startStr);
      const end = parseVttTimestamp(endStr);
      
      // Collect text lines until empty line
      const textLines: string[] = [];
      i++;
      while (i < lines.length && (lines[i] ?? '').trim() !== '') {
        textLines.push((lines[i] ?? '').trim());
        i++;
      }
      
      const text = textLines.join(' ');
      if (text) {
        segments.push({
          start,
          end,
          text,
          // Word-level timing would require more advanced parsing
        });
      }
    }
    i++;
  }

  return {
    language: 'en',
    segments,
  };
}

/**
 * Parse VTT timestamp (HH:MM:SS.mmm or MM:SS.mmm) to seconds
 */
function parseVttTimestamp(timestamp: string): number {
  const parts = timestamp.split(':');
  let seconds = 0;
  
  if (parts.length === 3) {
    // HH:MM:SS.mmm
    seconds = parseFloat(parts[0] ?? '0') * 3600 + parseFloat(parts[1] ?? '0') * 60 + parseFloat(parts[2] ?? '0');
  } else if (parts.length === 2) {
    // MM:SS.mmm
    seconds = parseFloat(parts[0] ?? '0') * 60 + parseFloat(parts[1] ?? '0');
  }
  
  return seconds;
}
