/**
 * Mux Video Service
 *
 * Handles all Mux Video API operations including asset creation,
 * playback ID management, and transcript retrieval.
 *
 * @see https://docs.mux.com/api-reference
 */

import Mux from '@mux/mux-node';
import { config } from '../config/index.js';
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
  }>;
}

export interface TranscriptSegment {
  start: number;
  end: number;
  text: string;
  words?: Array<{
    start: number;
    end: number;
    word: string;
  }>;
}

export interface Transcript {
  language: string;
  segments: TranscriptSegment[];
}

// ==================== MUX SERVICE ====================

export const muxService = {
  /**
   * Create a new video asset from an S3 signed URL
   *
   * @param options - Asset creation options
   * @returns Created asset info
   */
  async createAssetFromUrl(options: CreateAssetOptions): Promise<AssetInfo> {
    const { inputUrl, passthrough, generateSubtitles = true } = options;

    try {
      const createParams: Mux.Video.AssetCreateParams & {
        static_renditions?: Array<{ resolution: string }>;
      } = {
        input: [{ url: inputUrl }],
        playback_policy: ['public'],
        // Enable static MP4 renditions for Remotion rendering
        // Static renditions work better with FFmpeg and don't require HTTPS protocol support
        // Note: static_renditions is supported by Mux API but not in TypeScript types yet
        static_renditions: [{ resolution: 'highest' }],
        ...(passthrough && { passthrough }),
        ...(generateSubtitles && {
          master_access: 'temporary',
          video_quality: 'basic',
        }),
      };

      const asset = await mux.video.assets.create(createParams);

      logger.info(`Mux asset created: ${asset.id}`, { passthrough });

      return {
        id: asset.id,
        status: asset.status ?? 'preparing',
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
        })),
      };
    } catch (error) {
      logger.error('Failed to create Mux asset:', error);
      throw error;
    }
  },

  /**
   * Retrieve asset information by ID
   *
   * @param assetId - Mux asset ID
   * @returns Asset info
   */
  async getAsset(assetId: string): Promise<AssetInfo> {
    try {
      const asset = await mux.video.assets.retrieve(assetId);

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
        })),
      };
    } catch (error) {
      logger.error(`Failed to get Mux asset ${assetId}:`, error);
      throw error;
    }
  },

  /**
   * Get the primary playback ID for an asset
   *
   * @param assetId - Mux asset ID
   * @returns Playback ID string or null
   */
  async getPlaybackId(assetId: string): Promise<string | null> {
    try {
      const asset = await mux.video.assets.retrieve(assetId);
      return asset.playback_ids?.[0]?.id ?? null;
    } catch (error) {
      logger.error(`Failed to get playback ID for asset ${assetId}:`, error);
      throw error;
    }
  },

  /**
   * Create a new playback ID for an asset
   *
   * @param assetId - Mux asset ID
   * @param policy - Playback policy ('public' or 'signed')
   * @returns Created playback ID
   */
  async createPlaybackId(assetId: string, policy: 'public' | 'signed' = 'public'): Promise<string> {
    try {
      const playbackId = await mux.video.assets.createPlaybackId(assetId, {
        policy,
      });
      return playbackId.id ?? '';
    } catch (error) {
      logger.error(`Failed to create playback ID for asset ${assetId}:`, error);
      throw error;
    }
  },

  /**
   * Delete a Mux asset
   *
   * @param assetId - Mux asset ID
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
   * Generate subtitles/captions for an asset
   *
   * Note: Mux auto-generates subtitles for assets with generate_subtitles option.
   * This is now done at asset creation time.
   *
   * @param assetId - Mux asset ID
   * @param _language - Language code (default: 'en')
   */
  async generateSubtitles(assetId: string, _language = 'en'): Promise<void> {
    // Mux generates subtitles automatically when the asset is created with
    // the appropriate settings. This method is kept for backwards compatibility.
    logger.info(`Subtitle generation is automatic for asset ${assetId}`);
  },

  /**
   * Get the HLS playback URL for an asset
   *
   * @param playbackId - Mux playback ID
   * @returns HLS streaming URL
   */
  getPlaybackUrl(playbackId: string): string {
    return `https://stream.mux.com/${playbackId}.m3u8`;
  },

  /**
   * Get a static MP4 rendition URL for a playback ID.
   *
   * @param playbackId - Mux playback ID
   * @param rendition - Rendition name supported by Mux static URLs
   * @returns Static MP4 URL
   */
  getStaticMp4Url(
    playbackId: string,
    rendition: 'highest' | 'high' | 'medium' | 'low' = 'highest'
  ): string {
    return `https://stream.mux.com/${playbackId}/${rendition}.mp4`;
  },

  /**
   * Get static MP4 fallback URLs ordered by quality preference.
   *
   * Some assets expose only `highest.mp4` (static_renditions) while older assets
   * may expose the standard quality variants.
   */
  getStaticMp4FallbackUrls(playbackId: string): string[] {
    return [
      this.getStaticMp4Url(playbackId, 'highest'),
      this.getStaticMp4Url(playbackId, 'high'),
      this.getStaticMp4Url(playbackId, 'medium'),
      this.getStaticMp4Url(playbackId, 'low'),
    ];
  },

  /**
   * Get a thumbnail URL for an asset
   *
   * @param playbackId - Mux playback ID
   * @param options - Thumbnail options
   * @returns Thumbnail image URL
   */
  getThumbnailUrl(
    playbackId: string,
    options: {
      time?: number;
      width?: number;
      height?: number;
      format?: 'jpg' | 'png' | 'gif' | 'webp';
    } = {}
  ): string {
    const { time = 0, width = 640, format = 'jpg' } = options;
    const params = new URLSearchParams({
      time: time.toString(),
      width: width.toString(),
    });
    return `https://image.mux.com/${playbackId}/thumbnail.${format}?${params}`;
  },

  /**
   * Get an animated GIF/WebP URL for an asset
   *
   * @param playbackId - Mux playback ID
   * @param options - Animation options
   * @returns Animated image URL
   */
  getAnimatedUrl(
    playbackId: string,
    options: {
      start?: number;
      end?: number;
      width?: number;
      format?: 'gif' | 'webp';
      fps?: number;
    } = {}
  ): string {
    const { start = 0, end = 5, width = 320, format = 'gif', fps = 15 } = options;
    const params = new URLSearchParams({
      start: start.toString(),
      end: end.toString(),
      width: width.toString(),
      fps: fps.toString(),
    });
    return `https://image.mux.com/${playbackId}/animated.${format}?${params}`;
  },

  /**
   * Verify a Mux webhook signature
   *
   * @param rawBody - Raw request body as string
   * @param headers - Request headers (must include Mux-Signature)
   * @returns Parsed webhook event or throws on invalid signature
   */
  verifyWebhookSignature(
    rawBody: string,
    headers: Record<string, string | string[] | undefined>
  ): unknown {
    const webhookSecret = config.mux.webhookSecret;
    if (!webhookSecret) {
      throw new Error('MUX_WEBHOOK_SECRET not configured');
    }

    // Convert headers to the format expected by Mux SDK
    const normalizedHeaders = new Headers();
    for (const [key, value] of Object.entries(headers)) {
      if (value) {
        const headerValue = Array.isArray(value) ? value[0] : value;
        if (headerValue) {
          normalizedHeaders.set(key, headerValue);
        }
      }
    }

    return mux.webhooks.unwrap(rawBody, normalizedHeaders, webhookSecret);
  },

  /**
   * Check if an asset status is ready
   *
   * @param status - Mux asset status
   * @returns True if asset is ready
   */
  isAssetReady(status: string): boolean {
    return status === 'ready';
  },

  /**
   * Check if an asset status indicates an error
   *
   * @param status - Mux asset status
   * @returns True if asset has an error
   */
  isAssetErrored(status: string): boolean {
    return status === 'errored';
  },
};
